import { Injectable } from '@nestjs/common';
import type { IncomingMessage } from 'node:http';
import type { Duplex } from 'node:stream';
import { execute, parse, subscribe, validate } from 'graphql';
import { useServer } from 'graphql-ws/use/ws';
import { WebSocketServer } from 'ws';
import { TokenService } from '../auth/token.service.js';
import type { AuthUser } from '../auth/auth.types.js';
import { TransportMetrics } from '../realtime/transport-metrics.js';
import { GraphqlService, type GraphqlContext } from './graphql.service.js';
import { schema } from './schema.js';

@Injectable()
export class GraphqlWsService {
  private readonly sockets = new WebSocketServer({ noServer: true });
  private readonly disposable;

  constructor(
    private readonly tokens: TokenService,
    private readonly metrics: TransportMetrics,
    graphql: GraphqlService,
  ) {
    this.disposable = useServer<Record<string, unknown>, { user?: AuthUser }>(
      {
        schema,
        // use our graphql copy, it rejects schemas built by another one
        parse,
        validate,
        execute,
        subscribe,
        roots: {
          query: graphql.root,
          mutation: graphql.root,
          subscription: graphql.root,
        },
        // cookie for browsers, connectionParams.token for others
        onConnect: async (ctx) => {
          const params = ctx.connectionParams as { token?: unknown } | undefined;
          const request = ctx.extra.request as IncomingMessage;
          const cookie = request.headers.cookie
            ?.split(';')
            .map((part) => part.trim())
            .find((part) => part.startsWith('nook_at='));
          const token =
            typeof params?.token === 'string'
              ? params.token
              : cookie
                ? decodeURIComponent(cookie.slice('nook_at='.length))
                : undefined;
          const user = token ? await this.tokens.verifyAccessToken(token) : null;
          if (!user) return false;
          (ctx.extra as { user?: AuthUser }).user = user;
          return true;
        },
        context: (ctx): GraphqlContext => ({ user: (ctx.extra as { user: AuthUser }).user }),
        onNext: (_ctx, _message, _args, result) => {
          this.metrics.add('graphql-ws', {
            messages: 1,
            bytesOut: Buffer.byteLength(JSON.stringify(result)),
          });
        },
      },
      this.sockets,
    );
  }

  handleUpgrade(req: IncomingMessage, socket: Duplex, head: Buffer) {
    this.sockets.handleUpgrade(req, socket, head, (ws) => this.sockets.emit('connection', ws, req));
  }

  close() {
    void this.disposable.dispose();
    for (const client of this.sockets.clients) client.terminate();
  }
}
