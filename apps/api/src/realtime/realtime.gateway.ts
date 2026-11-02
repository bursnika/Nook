import {
  Injectable,
  Logger,
  type OnApplicationBootstrap,
  type OnApplicationShutdown,
} from '@nestjs/common';
import { HttpAdapterHost } from '@nestjs/core';
import type { IncomingMessage, Server } from 'node:http';
import type { Duplex } from 'node:stream';
import { WebSocket, WebSocketServer, type RawData } from 'ws';
import { ACCESS_COOKIE } from '../auth/cookies.js';
import type { AuthUser } from '../auth/auth.types.js';
import { TokenService } from '../auth/token.service.js';
import { GraphqlWsService } from '../graphql/graphql-ws.service.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { ApplyOpsDto } from './ops.dto.js';
import { PresenceService } from './presence.service.js';
import { RealtimeBus } from './realtime.bus.js';
import { SyncService } from './sync.service.js';
import { TransportMetrics } from './transport-metrics.js';
import { validateOrReject } from './validate.js';

const HEARTBEAT_MS = 30_000;

export function tokenFrom(req: IncomingMessage, url: URL): string | undefined {
  const bearer = req.headers.authorization?.match(/^Bearer\s+(.+)$/i)?.[1];
  if (bearer) return bearer;
  const fromQuery = url.searchParams.get('token');
  if (fromQuery) return fromQuery;
  const cookie = req.headers.cookie
    ?.split(';')
    .map((part) => part.trim())
    .find((part) => part.startsWith(`${ACCESS_COOKIE}=`));
  return cookie ? decodeURIComponent(cookie.slice(ACCESS_COOKIE.length + 1)) : undefined;
}

@Injectable()
export class RealtimeGateway implements OnApplicationBootstrap, OnApplicationShutdown {
  private readonly log = new Logger('Realtime');
  private readonly sockets = new WebSocketServer({ noServer: true, maxPayload: 256 * 1024 });
  private server?: Server;
  private heartbeat?: NodeJS.Timeout;

  constructor(
    private readonly adapter: HttpAdapterHost,
    private readonly tokens: TokenService,
    private readonly prisma: PrismaService,
    private readonly sync: SyncService,
    private readonly presence: PresenceService,
    private readonly bus: RealtimeBus,
    private readonly metrics: TransportMetrics,
    private readonly graphql: GraphqlWsService,
  ) {}

  onApplicationBootstrap() {
    this.server = this.adapter.httpAdapter.getHttpServer() as Server;
    this.server.on('upgrade', this.onUpgrade);
    this.heartbeat = setInterval(() => this.ping(), HEARTBEAT_MS).unref();
  }

  onApplicationShutdown() {
    clearInterval(this.heartbeat);
    this.server?.off('upgrade', this.onUpgrade);
    for (const client of this.sockets.clients) client.terminate();
    this.graphql.close();
  }

  private readonly onUpgrade = (req: IncomingMessage, socket: Duplex, head: Buffer) => {
    const url = new URL(req.url ?? '/', 'http://localhost');
    if (url.pathname === '/graphql') return this.graphql.handleUpgrade(req, socket, head);
    if (url.pathname !== '/ws') return;
    void this.accept(req, socket, head, url);
  };

  private async accept(req: IncomingMessage, socket: Duplex, head: Buffer, url: URL) {
    const reject = (status: string) => {
      socket.write(`HTTP/1.1 ${status}\r\nConnection: close\r\n\r\n`);
      socket.destroy();
    };
    try {
      const token = tokenFrom(req, url);
      const user = token ? await this.tokens.verifyAccessToken(token) : null;
      if (!user) return reject('401 Unauthorized');
      const workspaceId = url.searchParams.get('workspaceId') ?? '';
      const pageId = url.searchParams.get('pageId') ?? '';
      const clientId = (url.searchParams.get('clientId') ?? '').slice(0, 64);
      if (!workspaceId || !pageId || !clientId) return reject('400 Bad Request');
      if (!(await this.mayWrite(user, workspaceId, pageId))) return reject('404 Not Found');
      this.sockets.handleUpgrade(
        req,
        socket,
        head,
        (ws) => void this.serve(ws, user, { workspaceId, pageId, clientId }),
      );
    } catch (error) {
      this.log.warn(`upgrade failed: ${String(error)}`);
      reject('500 Internal Server Error');
    }
  }

  private async mayWrite(user: AuthUser, workspaceId: string, pageId: string) {
    const page = await this.prisma.page.findFirst({
      where: { id: pageId, workspaceId },
      select: { id: true },
    });
    if (!page) return false;
    if (user.isPlatformAdmin) return true;
    const membership = await this.prisma.membership.findUnique({
      where: { userId_workspaceId: { userId: user.id, workspaceId } },
      select: { role: true },
    });
    return !!membership;
  }

  private async serve(
    ws: WebSocket,
    user: AuthUser,
    { workspaceId, pageId, clientId }: { workspaceId: string; pageId: string; clientId: string },
  ) {
    const send = (payload: unknown) => {
      if (ws.readyState !== WebSocket.OPEN) return;
      const text = JSON.stringify(payload);
      this.metrics.add('websocket', { messages: 1, bytesOut: Buffer.byteLength(text) });
      ws.send(text);
    };
    // subscribe before reading the log so nothing is missed
    const off = this.bus.onPage(pageId, (message) => {
      // the sender gets its own changes via the ack
      if (message.clientId === clientId) return;
      send(message);
    });
    ws.on('close', () => {
      off();
      this.presence.leave(pageId, clientId);
    });
    ws.on('pong', () => ((ws as WebSocket & { alive?: boolean }).alive = true));
    (ws as WebSocket & { alive?: boolean }).alive = true;

    const { name } = await this.prisma.user.findUniqueOrThrow({
      where: { id: user.id },
      select: { name: true },
    });
    send({
      type: 'hello',
      seq: await this.sync.lastSeq(pageId),
      presence: this.presence.list(pageId, clientId),
    });

    ws.on('message', (raw) => {
      this.metrics.add('websocket', { requests: 1, bytesIn: rawLength(raw) });
      void this.handle(raw, send, { user, name, workspaceId, pageId, clientId });
    });
  }

  private async handle(
    raw: RawData,
    send: (payload: unknown) => void,
    ctx: { user: AuthUser; name: string; workspaceId: string; pageId: string; clientId: string },
  ) {
    let message: { type?: string; ops?: unknown; blockId?: string | null; caret?: number };
    try {
      message = JSON.parse(raw.toString()) as typeof message;
    } catch {
      return send({ type: 'error', message: 'Messages must be JSON' });
    }
    try {
      if (message.type === 'ops') {
        const dto = await validateOrReject(ApplyOpsDto, {
          clientId: ctx.clientId,
          ops: message.ops,
        });
        const applied = await this.sync.apply(ctx.workspaceId, ctx.pageId, ctx.user.id, dto);
        send({ type: 'ack', seq: applied.seq });
      } else if (message.type === 'presence') {
        this.presence.touch(ctx.pageId, {
          clientId: ctx.clientId,
          userId: ctx.user.id,
          name: ctx.name,
          blockId: typeof message.blockId === 'string' ? message.blockId : null,
          caret: typeof message.caret === 'number' ? message.caret : null,
        });
      } else if (message.type !== 'ping') {
        send({ type: 'error', message: `Unknown message type "${String(message.type)}"` });
      }
    } catch (error) {
      send({ type: 'error', message: error instanceof Error ? error.message : 'Bad message' });
    }
  }

  private ping() {
    for (const client of this.sockets.clients) {
      const tagged = client as WebSocket & { alive?: boolean };
      if (tagged.alive === false) client.terminate();
      else {
        tagged.alive = false;
        client.ping();
      }
    }
  }
}

const rawLength = (raw: RawData) =>
  Array.isArray(raw) ? raw.reduce((sum, part) => sum + part.length, 0) : raw.byteLength;
