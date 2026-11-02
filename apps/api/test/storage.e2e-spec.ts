import type { INestApplication } from '@nestjs/common';
import { existsSync, readdirSync, rmSync } from 'node:fs';
import request from 'supertest';
import { env } from '../src/env.js';
import { FILE_STORAGE, type FileStorage } from '../src/uploads/file-storage.js';
import { LocalDiskStorage } from '../src/uploads/local-disk-storage.js';
import { createTestApp, resetDb, seedWorkspace, type TestApp } from './helpers.js';
import { MemoryFileStorage } from './memory-file-storage.js';

const PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcDpAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==',
  'base64',
);
const STORED_URL = /^\/uploads\/[0-9a-f-]{36}\.png$/;

describe('File storage: default (local disk)', () => {
  let ctx: TestApp;
  let app: INestApplication;

  beforeAll(async () => {
    ctx = await createTestApp();
    app = ctx.app;
  });
  afterAll(async () => {
    await app.close();
    rmSync(env.uploadDir, { recursive: true, force: true });
  });
  beforeEach(async () => {
    await resetDb(ctx.prisma);
    rmSync(env.uploadDir, { recursive: true, force: true });
  });

  it('is the local-disk driver unless Azure is configured, and uploads go through it', async () => {
    const storage = app.get<FileStorage>(FILE_STORAGE);
    expect(storage).toBeInstanceOf(LocalDiskStorage);
    const put = vi.spyOn(storage, 'put');
    try {
      const { workspace } = await seedWorkspace(ctx.prisma);
      const res = await request(app.getHttpServer())
        .post(`/api/workspaces/${workspace.id}/attachments`)
        .attach('file', PNG, { filename: 'a.png', contentType: 'image/png' })
        .expect(201);
      expect(put).toHaveBeenCalledOnce();
      expect(put.mock.calls[0][0]).toMatchObject({ contentType: 'image/png' });
      expect(res.body.url).toMatch(STORED_URL);
      expect(readdirSync(env.uploadDir)).toEqual([res.body.url.split('/').pop()]);
    } finally {
      put.mockRestore();
    }
  });
});

describe('File storage: a driver without a local folder (as Azure Blob Storage)', () => {
  let ctx: TestApp;
  let app: INestApplication;
  const storage = new MemoryFileStorage();

  beforeAll(async () => {
    ctx = await createTestApp({
      customize: (builder) => builder.overrideProvider(FILE_STORAGE).useValue(storage),
    });
    app = ctx.app;
  });
  afterAll(() => app.close());
  beforeEach(async () => {
    await resetDb(ctx.prisma);
    storage.files.clear();
    storage.calls.put.length = storage.calls.delete.length = storage.calls.open.length = 0;
    storage.openError = null;
  });

  const http = () => request(app.getHttpServer());
  const upload = (workspaceId: string, extra: Record<string, string> = {}) => {
    const req = http().post(`/api/workspaces/${workspaceId}/attachments`);
    for (const [key, value] of Object.entries(extra)) req.field(key, value);
    return req.attach('file', PNG, { filename: 'cover.png', contentType: 'image/png' });
  };

  it('hands an upload to the storage and keeps nothing on the local disk', async () => {
    const { workspace } = await seedWorkspace(ctx.prisma);
    const res = await upload(workspace.id).expect(201);

    expect(res.body).toMatchObject({
      filename: 'cover.png',
      mimeType: 'image/png',
      size: PNG.length,
    });
    expect(res.body.url).toMatch(STORED_URL);
    const name = res.body.url.split('/').pop();
    expect(storage.calls.put).toEqual([name]);
    expect(storage.files.get(name)).toEqual({ data: PNG, contentType: 'image/png' });
    expect(existsSync(env.uploadDir) ? readdirSync(env.uploadDir) : []).toEqual([]);
  });

  it('serves the stored file through the API with the same hardening headers as local files', async () => {
    const { workspace } = await seedWorkspace(ctx.prisma);
    const { body } = await upload(workspace.id).expect(201);

    const file = await http().get(body.url).expect(200);
    expect(file.headers['content-type']).toBe('image/png');
    expect(file.headers['x-content-type-options']).toBe('nosniff');
    expect(file.headers['content-security-policy']).toContain('sandbox');
    expect(file.headers['content-length']).toBe(String(PNG.length));
    expect(Buffer.compare(file.body, PNG)).toBe(0);
  });

  it('serves text files as text with a charset, and never as something runnable', async () => {
    const { workspace } = await seedWorkspace(ctx.prisma);
    const { body } = await http()
      .post(`/api/workspaces/${workspace.id}/attachments`)
      .attach('file', Buffer.from('# notes'), { filename: 'n.md', contentType: 'text/markdown' })
      .expect(201);
    const file = await http().get(body.url).expect(200);
    expect(file.headers['content-type']).toBe('text/markdown; charset=utf-8');
    expect(file.headers['x-content-type-options']).toBe('nosniff');
  });

  it('answers 404 for unknown files and never asks the storage about names that are not ours', async () => {
    await http().get('/uploads/00000000-0000-4000-8000-000000000000.png').expect(404);
    expect(storage.calls.open).toHaveLength(1);

    for (const bad of ['..%2F..%2Fsecret', 'index.html', 'a.html', 'x.png', '.env']) {
      await http().get(`/uploads/${bad}`).expect(404);
    }
    expect(storage.calls.open).toHaveLength(1);
  });

  it('answers 502 instead of crashing when the storage is unreachable', async () => {
    storage.openError = new Error('getaddrinfo ENOTFOUND');
    const res = await http().get('/uploads/00000000-0000-4000-8000-000000000000.png').expect(502);
    expect(res.body.message).toBe('File storage is unavailable');
  });

  it('removes the stored file when the record is rejected, so no orphan is left', async () => {
    const a = await seedWorkspace(ctx.prisma, 'a');
    const b = await seedWorkspace(ctx.prisma, 'b');
    const page = (
      await http().post(`/api/workspaces/${a.workspace.id}/pages`).send({ title: 'p' }).expect(201)
    ).body;

    await upload(b.workspace.id, { pageId: page.id }).expect(400);
    expect(storage.calls.put).toHaveLength(1);
    expect(storage.calls.delete).toEqual(storage.calls.put);
    expect(storage.files.size).toBe(0);
  });

  it('keeps rejecting dangerous or oversized uploads before anything is stored', async () => {
    const { workspace } = await seedWorkspace(ctx.prisma);
    const url = `/api/workspaces/${workspace.id}/attachments`;
    await http()
      .post(url)
      .attach('file', Buffer.from('<script>1</script>'), {
        filename: 'x.html',
        contentType: 'text/html',
      })
      .expect(415);
    expect(storage.calls.put).toHaveLength(0);

    await http()
      .post(url)
      .attach('file', Buffer.alloc(11 * 1024 * 1024), {
        filename: 'big.png',
        contentType: 'image/png',
      })
      .expect(413);
    expect(storage.files.size).toBe(0);
  });

  it('deletes the stored file together with its attachment', async () => {
    const { workspace } = await seedWorkspace(ctx.prisma);
    const { body } = await upload(workspace.id).expect(201);
    await http().delete(`/api/workspaces/${workspace.id}/attachments/${body.id}`).expect(204);
    expect(storage.files.size).toBe(0);
    await http().get(body.url).expect(404);
  });

  it('stores page covers uploaded in the admin through the same storage', async () => {
    const { workspace } = await seedWorkspace(ctx.prisma);
    const base = `/admin/workspaces/${workspace.id}/pages`;
    const created = await http()
      .post(base)
      .field('title', 'Landing')
      .attach('cover', PNG, { filename: 'cover.png', contentType: 'image/png' })
      .expect(302);
    const id = created.headers.location.split('/').pop()!.split('?')[0];
    const page = await ctx.prisma.page.findUniqueOrThrow({ where: { id } });
    expect(page.coverUrl).toMatch(STORED_URL);
    expect(storage.files.size).toBe(1);
    await http().get(page.coverUrl!).expect(200);

    await http()
      .post(`${base}/${id}`)
      .type('form')
      .send({ title: 'Landing', removeCover: 'on' })
      .expect(302);
    expect(storage.files.size).toBe(0);
  });
});
