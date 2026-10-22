import { PrismaPg } from '@prisma/adapter-pg';
import { SignJWT } from 'jose';
import { writeFileSync } from 'node:fs';
import WebSocket from 'ws';
import { env } from '../src/env.js';
import { PrismaClient } from '../src/generated/prisma/client.js';

/**
 * C10 benchmark: the same stream of block operations over WebSocket, long poll and adaptive polling.
 *
 *   BENCH_ADMIN=bench@nook.local ... the API must run with ADMIN_EMAILS=bench@nook.local (for /api/sync-metrics)
 *   pnpm --filter @nook/api bench:sync -- --url http://localhost:3100 --listeners 10 --writes 60 --rate 4 --idle 10
 *
 * One writer posts `writes` operations at `rate` per second; `listeners` readers (other tabs) receive them
 * over the transport under test. Latency is measured from "just before the write" to "arrived at the reader"
 * on the same machine clock. After the writes the readers sit idle for `idle` seconds, which is where polling
 * pays for requests that bring nothing. The server counts requests, bytes and CPU per transport.
 */
const argv = process.argv.slice(2);
const arg = (name: string, fallback: string) => {
  const i = argv.indexOf(`--${name}`);
  return i >= 0 && argv[i + 1] ? argv[i + 1] : fallback;
};
const BASE = arg('url', 'http://localhost:3000').replace(/\/$/, '');
const LISTENERS = Number(arg('listeners', '10'));
const WRITES = Number(arg('writes', '60'));
const RATE = Number(arg('rate', '4'));
const IDLE_SECONDS = Number(arg('idle', '10'));
const OUT = arg('out', '');
const EMAIL = process.env.BENCH_ADMIN ?? 'bench@nook.local';

const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString: env.databaseUrl }) });
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

type Kind = 'websocket' | 'longpoll' | 'polling';
interface Reader {
  stop(): void;
  requests: number;
}

const stats = { latencies: [] as number[], received: 0 };
const reset = () => {
  stats.latencies = [];
  stats.received = 0;
};

function record(messages: { ops: { content?: { text?: string } }[] }[]) {
  const now = Date.now();
  for (const message of messages) {
    for (const op of message.ops) {
      const sent = Number(op.content?.text?.split(':')[1]);
      if (Number.isFinite(sent)) stats.latencies.push(now - sent);
    }
    stats.received += 1;
  }
}

async function main() {
  const user = await prisma.user.upsert({
    where: { email: EMAIL },
    update: {},
    create: { email: EMAIL, name: 'Bench' },
  });
  const workspace = await prisma.workspace.create({
    data: {
      name: 'bench',
      slug: `bench-${Date.now()}`,
      memberships: { create: { userId: user.id, role: 'OWNER' } },
    },
  });
  const token = await new SignJWT({ email: user.email })
    .setProtectedHeader({ alg: 'HS256' })
    .setSubject(user.id)
    .setIssuer('nook')
    .setAudience('nook-api')
    .setIssuedAt()
    .setExpirationTime('30m')
    .sign(new TextEncoder().encode(env.jwtSecret));
  const auth = { Authorization: `Bearer ${token}` };
  // every transport gets a fresh page, so the log of the previous run does not replay into the next
  let page = { id: '' };
  let root = '';

  const call = async <T = unknown>(url: string, init: RequestInit = {}): Promise<T> => {
    const response = await fetch(url, {
      ...init,
      headers: { ...auth, 'Content-Type': 'application/json', ...init.headers },
    });
    if (!response.ok && response.status !== 204)
      throw new Error(`${init.method ?? 'GET'} ${url} -> ${response.status}`);
    return (response.status === 204 ? null : await response.json()) as T;
  };

  const readers: Record<Kind, (id: string) => Reader> = {
    websocket(id) {
      const reader: Reader = { requests: 0, stop: () => ws.close() };
      const ws = new WebSocket(
        `${BASE.replace(/^http/, 'ws')}/ws?workspaceId=${workspace.id}&pageId=${page.id}&clientId=${id}&token=${token}`,
      );
      ws.on('message', (data) => {
        const message = JSON.parse(data.toString()) as { type: string; ops?: never[] };
        if (message.type === 'ops') record([message as never]);
      });
      return reader;
    },
    longpoll(id) {
      const reader: Reader = { requests: 0, stop: () => (running = false) };
      let running = true;
      void (async () => {
        let since = 0;
        while (running) {
          try {
            reader.requests += 1;
            const reply = await call<Reply>(
              `${root}/poll?since=${since}&clientId=${id}&timeout=25`,
            );
            if (!running) return;
            record(reply.messages);
            since = reply.seq ?? since;
          } catch {
            await sleep(200);
          }
        }
      })();
      return reader;
    },
    polling(id) {
      const reader: Reader = { requests: 0, stop: () => (running = false) };
      let running = true;
      void (async () => {
        let since = 0;
        let wait = 1000;
        while (running) {
          try {
            reader.requests += 1;
            const reply = await call<Reply>(`${root}/changes?since=${since}&clientId=${id}`);
            record(reply.messages);
            since = reply.seq ?? since;
            // adaptive: fast right after activity, then slower and slower while it is quiet (capped at 10 s)
            wait = reply.more
              ? 0
              : reply.messages.length > 0
                ? 400
                : Math.min(10_000, Math.round(wait * 1.5));
          } catch {
            wait = 1000;
          }
          await sleep(wait);
        }
      })();
      return reader;
    },
  };

  const results: Record<string, unknown>[] = [];
  try {
    for (const kind of ['websocket', 'longpoll', 'polling'] as Kind[]) {
      page = await prisma.page.create({
        data: { title: `bench ${kind}`, workspaceId: workspace.id, authorId: user.id },
      });
      root = `${BASE}/api/workspaces/${workspace.id}/pages/${page.id}/sync`;
      reset();
      await call(`${BASE}/api/sync-metrics`, { method: 'DELETE' });
      const group = Array.from({ length: LISTENERS }, (_, i) => readers[kind](`${kind}-${i}`));
      await sleep(1500); // let every reader connect and settle

      const started = Date.now();
      for (let i = 0; i < WRITES; i++) {
        const sentAt = Date.now();
        await call(`${root}/ops`, {
          method: 'POST',
          body: JSON.stringify({
            clientId: 'writer',
            ops: [
              {
                type: 'insert',
                id: crypto.randomUUID(),
                blockType: 'PARAGRAPH',
                content: { text: `b${i}:${sentAt}` },
                position: i + 1,
              },
            ],
          }),
        });
        await sleep(Math.max(0, 1000 / RATE - (Date.now() - sentAt)));
      }
      await sleep(Math.max(2500, kind === 'polling' ? 3000 : 800)); // stragglers
      const busy = (Date.now() - started) / 1000;
      const busyMetrics = await call<MetricsSnapshot>(`${BASE}/api/sync-metrics`);
      const busyLatencies = [...stats.latencies];
      const busyReceived = stats.received;

      await call(`${BASE}/api/sync-metrics`, { method: 'DELETE' });
      await sleep(IDLE_SECONDS * 1000);
      const idleMetrics = await call<MetricsSnapshot>(`${BASE}/api/sync-metrics`);

      for (const reader of group) reader.stop();
      const key = kind;
      const busyCounters = busyMetrics.transports[key];
      const idleCounters = idleMetrics.transports[key];
      busyLatencies.sort((a, b) => a - b);
      const at = (p: number) =>
        busyLatencies[Math.min(busyLatencies.length - 1, Math.floor(p * busyLatencies.length))] ??
        NaN;
      results.push({
        transport: kind,
        deliveries: busyLatencies.length,
        expectedDeliveries: WRITES * LISTENERS,
        batches: busyReceived,
        p50Ms: at(0.5),
        p95Ms: at(0.95),
        maxMs: busyLatencies.at(-1) ?? NaN,
        busySeconds: round(busy),
        serverRequests: busyCounters.requests,
        clientRequests: group.reduce((sum, r) => sum + r.requests, 0),
        bytesOutKb: round(busyCounters.bytesOut / 1024),
        cpuMs: round(busyMetrics.cpuMs),
        idleSeconds: IDLE_SECONDS,
        idleRequests: idleCounters.requests,
        idleBytesOutKb: round(idleCounters.bytesOut / 1024),
        idleCpuMs: round(idleMetrics.cpuMs),
        rssMb: idleMetrics.rssMb,
      });
      await sleep(1000);
    }
  } finally {
    await prisma.workspace.delete({ where: { id: workspace.id } }).catch(() => undefined);
    await prisma.$disconnect();
  }

  const table = [
    '| Transport | Delivered | p50 ms | p95 ms | max ms | Server requests | Out KB | CPU ms | Idle req/' +
      IDLE_SECONDS +
      's | Idle KB | Idle CPU ms |',
    '|---|---|---|---|---|---|---|---|---|---|---|',
    ...results.map(
      (r) =>
        `| ${r.transport} | ${r.deliveries}/${r.expectedDeliveries} | ${r.p50Ms} | ${r.p95Ms} | ${r.maxMs} | ${r.serverRequests} | ${r.bytesOutKb} | ${r.cpuMs} | ${r.idleRequests} | ${r.idleBytesOutKb} | ${r.idleCpuMs} |`,
    ),
  ].join('\n');
  console.log(
    `\nlisteners=${LISTENERS} writes=${WRITES} rate=${RATE}/s idle=${IDLE_SECONDS}s\n\n${table}\n`,
  );
  if (OUT)
    writeFileSync(
      OUT,
      JSON.stringify(
        { listeners: LISTENERS, writes: WRITES, rate: RATE, idle: IDLE_SECONDS, results },
        null,
        2,
      ),
    );
  process.exit(0);
}

interface Reply {
  messages: { ops: { content?: { text?: string } }[] }[];
  seq?: number;
  more?: boolean;
}

interface MetricsSnapshot {
  cpuMs: number;
  rssMb: number;
  transports: Record<
    Kind,
    { requests: number; messages: number; bytesIn: number; bytesOut: number }
  >;
}
const round = (n: number) => Math.round(n * 10) / 10;

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
