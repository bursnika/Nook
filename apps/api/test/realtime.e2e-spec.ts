import type { INestApplication } from '@nestjs/common';
import { createClient } from 'graphql-ws';
import type { AddressInfo } from 'node:net';
import request from 'supertest';
import WebSocket from 'ws';
import { bearer } from './auth-helpers.js';
import { createTestApp, resetDb, type TestApp } from './helpers.js';

const uuid = () => crypto.randomUUID();
const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

describe('Realtime: block operations, transports and GraphQL', () => {
  let ctx: TestApp;
  let app: INestApplication;
  let port: number;
  let wsId: string;
  let otherWsId: string;
  let pageId: string;
  let tok: { ann: string; bob: string; outsider: string };
  let raw: { ann: string; bob: string; outsider: string };

  beforeAll(async () => {
    ctx = await createTestApp({ auth: 'real' });
    app = ctx.app;
    await app.listen(0);
    port = (app.getHttpServer().address() as AddressInfo).port;
  });
  afterAll(() => app.close());

  beforeEach(async () => {
    await resetDb(ctx.prisma);
    const [ann, bob, outsider] = await Promise.all(
      [
        ['ann@example.com', 'Ann'],
        ['bob@example.com', 'Bob'],
        ['out@example.com', 'Outsider'],
      ].map(([email, name]) => ctx.prisma.user.create({ data: { email, name } })),
    );
    const ws = await ctx.prisma.workspace.create({
      data: {
        name: 'Team',
        slug: 'team',
        memberships: {
          create: [
            { userId: ann.id, role: 'OWNER' },
            { userId: bob.id, role: 'MEMBER' },
          ],
        },
      },
    });
    const other = await ctx.prisma.workspace.create({
      data: {
        name: 'Other',
        slug: 'other',
        memberships: { create: { userId: outsider.id, role: 'OWNER' } },
      },
    });
    wsId = ws.id;
    otherWsId = other.id;
    pageId = (
      await ctx.prisma.page.create({ data: { title: 'Doc', workspaceId: wsId, authorId: ann.id } })
    ).id;
    tok = {
      ann: await bearer(app, ann),
      bob: await bearer(app, bob),
      outsider: await bearer(app, outsider),
    };
    raw = {
      ann: tok.ann.slice(7),
      bob: tok.bob.slice(7),
      outsider: tok.outsider.slice(7),
    };
  });

  const http = () => request(app.getHttpServer());
  const base = () => `/api/workspaces/${wsId}/pages/${pageId}/sync`;
  const send = (ops: object[], clientId = 'tab-a', token = tok.ann) =>
    http().post(`${base()}/ops`).set('Authorization', token).send({ clientId, ops });
  const insert = (id: string, text: string, position: number) => ({
    type: 'insert',
    id,
    blockType: 'PARAGRAPH',
    content: { text },
    position,
  });
  const texts = async () =>
    (await ctx.prisma.block.findMany({ where: { pageId }, orderBy: { position: 'asc' } })).map(
      (b) => (b.content as { text: string }).text,
    );

  describe('operations', () => {
    it('applies insert, update, move and delete and numbers the log', async () => {
      const [a, b, c] = [uuid(), uuid(), uuid()];
      const first = await send([
        insert(a, 'one', 10),
        insert(b, 'two', 20),
        insert(c, 'three', 30),
      ]).expect(200);
      await send([{ type: 'update', id: a, content: { text: 'ONE' } }]).expect(200);
      await send([{ type: 'move', id: c, position: 5 }]).expect(200);
      const last = await send([{ type: 'delete', id: b }]).expect(200);
      expect(await texts()).toEqual(['three', 'ONE']);
      expect(last.body.seq).toBeGreaterThan(first.body.seq);
    });

    it('is safe to replay: a repeated insert does not duplicate, a change to a missing block is skipped', async () => {
      const a = uuid();
      await send([insert(a, 'once', 10)]).expect(200);
      await send([
        insert(a, 'once', 10),
        { type: 'update', id: uuid(), content: { text: 'ghost' } },
      ]).expect(200);
      expect(await texts()).toEqual(['once']);
    });

    it('last writer wins per block, other blocks are untouched', async () => {
      const [a, b] = [uuid(), uuid()];
      await send([insert(a, 'a', 10), insert(b, 'b', 20)]);
      await send([{ type: 'update', id: a, content: { text: 'from ann' } }], 'tab-a');
      await send([{ type: 'update', id: a, content: { text: 'from bob' } }], 'tab-b', tok.bob);
      expect(await texts()).toEqual(['from bob', 'b']);
    });

    it('returns a snapshot with the log position to continue from', async () => {
      const a = uuid();
      const res = await send([insert(a, 'hello', 10)]);
      const snap = await http().get(base()).set('Authorization', tok.bob).expect(200);
      expect(snap.body.seq).toBe(res.body.seq);
      expect(snap.body.blocks.map((blk: { id: string }) => blk.id)).toEqual([a]);
    });

    it('rejects malformed operations and keeps the page unchanged', async () => {
      await send([{ type: 'explode', id: uuid() }]).expect(400);
      await send([{ type: 'insert', id: 'not-a-uuid' }]).expect(400);
      await send([]).expect(400);
      expect(await texts()).toEqual([]);
    });

    it('does not let outsiders read or write another workspace page', async () => {
      await send([insert(uuid(), 'x', 1)], 'tab-x', tok.outsider).expect(404);
      await http().get(base()).set('Authorization', tok.outsider).expect(404);
      await http().get(`${base()}/changes`).set('Authorization', tok.outsider).expect(404);
      await http().get(base()).expect(401);
      // a page of another workspace addressed through our workspace id is just as unknown
      const foreign = await ctx.prisma.page.create({
        data: {
          title: 'F',
          workspaceId: otherWsId,
          authorId: (await ctx.prisma.user.findFirstOrThrow()).id,
        },
      });
      await http()
        .post(`/api/workspaces/${wsId}/pages/${foreign.id}/sync/ops`)
        .set('Authorization', tok.ann)
        .send({ clientId: 'c', ops: [insert(uuid(), 'x', 1)] })
        .expect(404);
    });
  });

  describe('adaptive polling (changes)', () => {
    it('returns what happened after `since`, with presence and a pause hint', async () => {
      const first = await send([insert(uuid(), 'one', 10)]);
      await send([insert(uuid(), 'two', 20)], 'tab-b', tok.bob);
      await http()
        .post(`${base()}/presence`)
        .set('Authorization', tok.bob)
        .send({ clientId: 'tab-b', blockId: null, caret: 3 })
        .expect(200);

      const res = await http()
        .get(`${base()}/changes?since=${first.body.seq}&clientId=tab-a`)
        .set('Authorization', tok.ann)
        .expect(200);
      expect(res.body.messages).toHaveLength(1);
      expect(res.body.messages[0]).toMatchObject({ type: 'ops', clientId: 'tab-b' });
      expect(res.body.presence).toEqual([
        expect.objectContaining({ clientId: 'tab-b', name: 'Bob', caret: 3 }),
      ]);
      expect(res.body.nextPollMs).toBeLessThanOrEqual(500);

      const quiet = await http()
        .get(`${base()}/changes?since=${res.body.seq}&clientId=tab-a`)
        .set('Authorization', tok.ann)
        .expect(200);
      expect(quiet.body.messages).toEqual([]);
      expect(quiet.body.nextPollMs).toBeGreaterThanOrEqual(1000);
    });

    it('does not echo a tab its own presence', async () => {
      await http()
        .post(`${base()}/presence`)
        .set('Authorization', tok.ann)
        .send({ clientId: 'tab-a' })
        .expect(200);
      const res = await http()
        .get(`${base()}/changes?clientId=tab-a`)
        .set('Authorization', tok.ann);
      expect(res.body.presence).toEqual([]);
    });
  });

  describe('long poll', () => {
    it('answers at once when something is already waiting', async () => {
      await send([insert(uuid(), 'old', 10)]);
      const res = await http()
        .get(`${base()}/poll?since=0&clientId=tab-b`)
        .set('Authorization', tok.bob)
        .expect(200);
      expect(res.body.messages).toHaveLength(1);
    });

    it('is held open and answers when another tab writes', async () => {
      const started = Date.now();
      const pending = http()
        .get(`${base()}/poll?since=0&clientId=tab-b&timeout=20`)
        .set('Authorization', tok.bob)
        .then((r) => r);
      await wait(300);
      await send([insert(uuid(), 'fresh', 10)]);
      const res = await pending;
      expect(res.status).toBe(200);
      expect(res.body.messages.map((m: { clientId: string }) => m.clientId)).toEqual(['tab-a']);
      expect(Date.now() - started).toBeLessThan(5000);
    });

    it('gives up with an empty answer when nothing happens', async () => {
      const started = Date.now();
      const res = await http()
        .get(`${base()}/poll?since=0&clientId=tab-b&timeout=1`)
        .set('Authorization', tok.bob)
        .expect(200);
      expect(res.body.messages).toEqual([]);
      expect(Date.now() - started).toBeGreaterThanOrEqual(900);
    });
  });

  describe('WebSocket', () => {
    const open = (token: string | undefined, clientId: string, workspace = wsId, page = pageId) =>
      new Promise<{ ws: WebSocket; inbox: Record<string, unknown>[] }>((resolve, reject) => {
        const query = new URLSearchParams({ workspaceId: workspace, pageId: page, clientId });
        if (token) query.set('token', token);
        const ws = new WebSocket(`ws://localhost:${port}/ws?${query}`);
        const inbox: Record<string, unknown>[] = [];
        ws.on('message', (data) =>
          inbox.push(JSON.parse(data.toString()) as Record<string, unknown>),
        );
        ws.on('error', reject);
        ws.once('message', () => resolve({ ws, inbox })); // the "hello" frame
      });
    const waitFor = async (inbox: Record<string, unknown>[], type: string) => {
      for (let i = 0; i < 100; i++) {
        const found = inbox.find((m) => m.type === type);
        if (found) return found;
        await wait(20);
      }
      throw new Error(`no "${type}" message arrived`);
    };

    it('says hello with the log position and delivers operations to the other tab, not back to the sender as ops', async () => {
      const [a, b] = await Promise.all([open(raw.ann, 'tab-a'), open(raw.bob, 'tab-b')]);
      const id = uuid();
      a.ws.send(JSON.stringify({ type: 'ops', ops: [insert(id, 'live', 10)] }));
      const delivered = await waitFor(b.inbox, 'ops');
      expect(delivered).toMatchObject({ clientId: 'tab-a', ops: [{ type: 'insert', id }] });
      expect(await waitFor(a.inbox, 'ack')).toMatchObject({ seq: delivered.seq });
      expect(a.inbox.find((m) => m.type === 'ops')).toBeUndefined();
      expect(await texts()).toEqual(['live']);
      a.ws.close();
      b.ws.close();
    });

    it('shares the cursor and tells when a tab leaves', async () => {
      const [a, b] = await Promise.all([open(raw.ann, 'tab-a'), open(raw.bob, 'tab-b')]);
      const blockId = uuid();
      a.ws.send(JSON.stringify({ type: 'presence', blockId, caret: 4 }));
      expect(await waitFor(b.inbox, 'presence')).toMatchObject({
        clientId: 'tab-a',
        name: 'Ann',
        blockId,
        caret: 4,
      });
      a.ws.close();
      expect(await waitFor(b.inbox, 'leave')).toMatchObject({ clientId: 'tab-a' });
      b.ws.close();
    });

    it('answers bad messages with an error and keeps the connection', async () => {
      const a = await open(raw.ann, 'tab-a');
      a.ws.send('not json');
      a.ws.send(JSON.stringify({ type: 'ops', ops: [{ type: 'explode', id: uuid() }] }));
      await waitFor(a.inbox, 'error');
      expect(a.ws.readyState).toBe(WebSocket.OPEN);
      a.ws.close();
    });

    it('refuses anonymous callers and non-members before the upgrade', async () => {
      await expect(open(undefined, 'tab-x')).rejects.toThrow(/401/);
      await expect(open(raw.outsider, 'tab-x')).rejects.toThrow(/404/);
      await expect(open('garbage', 'tab-x')).rejects.toThrow(/401/);
    });

    it('also accepts the access cookie of a browser', async () => {
      const ws = await new Promise<WebSocket>((resolve, reject) => {
        const socket = new WebSocket(
          `ws://localhost:${port}/ws?workspaceId=${wsId}&pageId=${pageId}&clientId=tab-c`,
          {
            headers: { cookie: `nook_at=${raw.ann}` },
          },
        );
        socket.once('message', () => resolve(socket));
        socket.on('error', reject);
      });
      ws.close();
    });
  });

  describe('GraphQL', () => {
    const query = (text: string, token = tok.ann, variables: object = {}) =>
      http().post('/graphql').set('Authorization', token).send({ query: text, variables });

    it('reads and moves tasks', async () => {
      const task = await ctx.prisma.task.create({
        data: { workspaceId: wsId, title: 'Write', position: 1 },
      });
      const read = await query(`{ tasks(workspaceId: "${wsId}") { id title status } }`).expect(200);
      expect(read.body.data.tasks).toEqual([{ id: task.id, title: 'Write', status: 'TODO' }]);
      const moved = await query(
        `mutation { moveTask(workspaceId: "${wsId}", id: "${task.id}", status: "DONE", position: 5) { status position } }`,
      ).expect(200);
      expect(moved.body.data.moveTask).toEqual({ status: 'DONE', position: 5 });
      expect(
        (await ctx.prisma.task.findUniqueOrThrow({ where: { id: task.id } })).completedAt,
      ).not.toBeNull();
    });

    it('reads events inside a window', async () => {
      await ctx.prisma.calendarEvent.create({
        data: {
          workspaceId: wsId,
          title: 'Demo',
          startsAt: new Date('2030-01-02T10:00:00Z'),
          endsAt: new Date('2030-01-02T11:00:00Z'),
        },
      });
      const res = await query(
        `{ events(workspaceId: "${wsId}", from: "2030-01-01T00:00:00Z", to: "2030-01-03T00:00:00Z") { title startsAt } }`,
      ).expect(200);
      expect(res.body.data.events).toEqual([
        { title: 'Demo', startsAt: '2030-01-02T10:00:00.000Z' },
      ]);
    });

    it('refuses non-members, bad statuses and anonymous callers', async () => {
      const denied = await query(`{ tasks(workspaceId: "${wsId}") { id } }`, tok.outsider).expect(
        200,
      );
      expect(denied.body.errors[0].message).toMatch(/Not a member/);
      const task = await ctx.prisma.task.create({ data: { workspaceId: wsId, title: 'T' } });
      const bad = await query(
        `mutation { moveTask(workspaceId: "${wsId}", id: "${task.id}", status: "NOPE") { id } }`,
      ).expect(200);
      expect(bad.body.errors[0].message).toMatch(/status must be one of/);
      await http().post('/graphql').send({ query: '{ __typename }' }).expect(401);
    });

    const subscribe = (
      token: string | undefined,
      text: string,
      onData: (data: unknown) => void,
    ) => {
      const client = createClient({
        url: `ws://localhost:${port}/graphql`,
        webSocketImpl: WebSocket,
        connectionParams: token ? { token } : {},
        retryAttempts: 0,
        lazy: false,
      });
      const stop = client.subscribe(
        { query: text },
        { next: (r) => onData(r.data), error: () => undefined, complete: () => undefined },
      );
      return () => {
        stop();
        void client.dispose();
      };
    };

    it('pushes task changes of the workspace to subscribers', async () => {
      const got: { taskChanged: { kind: string; task: { title: string } | null } }[] = [];
      const stop = subscribe(
        raw.bob,
        `subscription { taskChanged(workspaceId: "${wsId}") { kind taskId task { title status } } }`,
        (d) => got.push(d as never),
      );
      await wait(300);
      const created = await http()
        .post(`/api/workspaces/${wsId}/tasks`)
        .set('Authorization', tok.ann)
        .send({ title: 'Live task' })
        .expect(201);
      await http()
        .patch(`/api/workspaces/${wsId}/tasks/${created.body.id}`)
        .set('Authorization', tok.ann)
        .send({ status: 'DONE' })
        .expect(200);
      await http()
        .delete(`/api/workspaces/${wsId}/tasks/${created.body.id}`)
        .set('Authorization', tok.ann)
        .expect(204);
      // a change in another workspace must not show up
      await http()
        .post(`/api/workspaces/${otherWsId}/tasks`)
        .set('Authorization', tok.outsider)
        .send({ title: 'Secret' })
        .expect(201);
      for (let i = 0; i < 100 && got.length < 3; i++) await wait(20);
      stop();
      expect(got.map((g) => g.taskChanged.kind)).toEqual(['created', 'updated', 'deleted']);
      expect(got[0].taskChanged.task?.title).toBe('Live task');
      expect(got[2].taskChanged.task).toBeNull();
    });

    it('pushes calendar changes', async () => {
      const got: unknown[] = [];
      const stop = subscribe(
        raw.ann,
        `subscription { eventChanged(workspaceId: "${wsId}") { kind event { title } } }`,
        (d) => got.push(d),
      );
      await wait(300);
      await http()
        .post(`/api/workspaces/${wsId}/events`)
        .set('Authorization', tok.ann)
        .send({ title: 'Party', startsAt: '2030-05-01T10:00:00Z', endsAt: '2030-05-01T11:00:00Z' })
        .expect(201);
      for (let i = 0; i < 100 && got.length < 1; i++) await wait(20);
      stop();
      expect(got).toEqual([{ eventChanged: { kind: 'created', event: { title: 'Party' } } }]);
    });

    it('refuses a subscription from anonymous callers and non-members', async () => {
      const errors: unknown[] = [];
      const client = createClient({
        url: `ws://localhost:${port}/graphql`,
        webSocketImpl: WebSocket,
        retryAttempts: 0,
        lazy: false,
      });
      await new Promise<void>((resolve) => {
        client.on('closed', () => resolve());
        client.subscribe(
          { query: `subscription { taskChanged(workspaceId: "${wsId}") { kind } }` },
          { next: () => undefined, error: (e) => errors.push(e), complete: () => undefined },
        );
      });
      void client.dispose();

      const got: unknown[] = [];
      const denied: unknown[] = [];
      const client2 = createClient({
        url: `ws://localhost:${port}/graphql`,
        webSocketImpl: WebSocket,
        connectionParams: { token: raw.outsider },
        retryAttempts: 0,
        lazy: false,
      });
      await new Promise<void>((resolve) => {
        client2.subscribe(
          { query: `subscription { taskChanged(workspaceId: "${wsId}") { kind } }` },
          {
            next: (r) => got.push(r),
            error: (e) => {
              denied.push(e);
              resolve();
            },
            complete: () => resolve(),
          },
        );
      });
      void client2.dispose();
      // the answer is an error result, never data
      expect(got).toEqual([
        { errors: [expect.objectContaining({ message: expect.stringMatching(/Not a member/) })] },
      ]);
      expect(denied).toEqual([]);
    });
  });

  describe('metrics', () => {
    it('counts what each transport costs, for platform admins only', async () => {
      await http().delete('/api/sync-metrics').set('Authorization', tok.ann).expect(403);
      await send([insert(uuid(), 'x', 1)]);
      await http().get(`${base()}/changes`).set('Authorization', tok.ann).expect(200);
      await http()
        .get(`${base()}/poll?timeout=1&since=0`)
        .set('Authorization', tok.ann)
        .expect(200);
      const snapshot = ctx.app.get(TransportMetricsToken).snapshot();
      expect(snapshot.transports.polling.requests).toBeGreaterThanOrEqual(1);
      expect(snapshot.transports.longpoll.requests).toBeGreaterThanOrEqual(1);
      expect(snapshot.transports.polling.bytesOut).toBeGreaterThan(0);
      ctx.app.get(TransportMetricsToken).reset();
      expect(ctx.app.get(TransportMetricsToken).snapshot().transports.polling.requests).toBe(0);
    });
  });
});

import { TransportMetrics as TransportMetricsToken } from '../src/realtime/transport-metrics.js';
