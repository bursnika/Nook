import type { INestApplication } from '@nestjs/common';
import { existsSync, readdirSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import request from 'supertest';
import { env } from '../src/env.js';
import { createTestApp, resetDb, seedWorkspace, type TestApp } from './helpers.js';

// 1x1 transparent PNG
const PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==',
  'base64',
);

describe('Attachments API', () => {
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

  const http = () => request(app.getHttpServer());
  const storedFiles = () => (existsSync(env.uploadDir) ? readdirSync(env.uploadDir) : []);

  it('uploads a file, stores a link and serves it with safe headers', async () => {
    const { workspace } = await seedWorkspace(ctx.prisma);
    const res = await http()
      .post(`/api/workspaces/${workspace.id}/attachments`)
      .attach('file', PNG, { filename: 'cover.png', contentType: 'image/png' })
      .expect(201);

    expect(res.body).toMatchObject({
      filename: 'cover.png',
      mimeType: 'image/png',
      size: PNG.length,
    });
    expect(res.body.url).toMatch(/^\/uploads\/[0-9a-f-]{36}\.png$/);
    expect(storedFiles()).toHaveLength(1);

    const file = await http().get(res.body.url).expect(200);
    expect(file.headers['content-type']).toBe('image/png');
    expect(file.headers['x-content-type-options']).toBe('nosniff');
    expect(file.headers['content-security-policy']).toContain('sandbox');
    expect(Buffer.compare(file.body, PNG)).toBe(0);
  });

  it('keeps Cyrillic file names intact', async () => {
    const { workspace } = await seedWorkspace(ctx.prisma);
    const res = await http()
      .post(`/api/workspaces/${workspace.id}/attachments`)
      .attach('file', PNG, { filename: 'лабораторна №1.png', contentType: 'image/png' })
      .expect(201);
    expect(res.body.filename).toBe('лабораторна №1.png');
  });

  it('rejects dangerous types, a missing file and oversized uploads', async () => {
    const { workspace } = await seedWorkspace(ctx.prisma);
    const url = `/api/workspaces/${workspace.id}/attachments`;

    await http()
      .post(url)
      .attach('file', Buffer.from('<script>alert(1)</script>'), {
        filename: 'x.html',
        contentType: 'text/html',
      })
      .expect(415);
    await http()
      .post(url)
      .attach('file', Buffer.from('<svg onload=alert(1)/>'), {
        filename: 'x.svg',
        contentType: 'image/svg+xml',
      })
      .expect(415);
    await http().post(url).field('pageId', '').expect(400);
    await http()
      .post(url)
      .attach('file', Buffer.alloc(11 * 1024 * 1024), {
        filename: 'big.png',
        contentType: 'image/png',
      })
      .expect(413);
    expect(storedFiles()).toHaveLength(0);
  });

  it('links to a page of the same workspace and cleans up when the link is invalid', async () => {
    const a = await seedWorkspace(ctx.prisma, 'a');
    const b = await seedWorkspace(ctx.prisma, 'b');
    const page = (
      await http().post(`/api/workspaces/${a.workspace.id}/pages`).send({ title: 'p' }).expect(201)
    ).body;

    const ok = await http()
      .post(`/api/workspaces/${a.workspace.id}/attachments`)
      .field('pageId', page.id)
      .attach('file', PNG, { filename: 'a.png', contentType: 'image/png' })
      .expect(201);
    expect(ok.body.pageId).toBe(page.id);
    expect(storedFiles()).toHaveLength(1);

    await http()
      .post(`/api/workspaces/${b.workspace.id}/attachments`)
      .field('pageId', page.id)
      .attach('file', PNG, { filename: 'b.png', contentType: 'image/png' })
      .expect(400);
    expect(storedFiles()).toHaveLength(1);
  });

  it('lists, renames and deletes attachments together with their file', async () => {
    const a = await seedWorkspace(ctx.prisma, 'a');
    const b = await seedWorkspace(ctx.prisma, 'b');
    const base = `/api/workspaces/${a.workspace.id}/attachments`;
    const created = (
      await http()
        .post(base)
        .attach('file', PNG, { filename: 'one.png', contentType: 'image/png' })
        .expect(201)
    ).body;
    await http()
      .post(base)
      .attach('file', PNG, { filename: 'two.png', contentType: 'image/png' })
      .expect(201);

    expect((await http().get(base).expect(200)).body.total).toBe(2);
    expect((await http().get(`${base}?q=two`).expect(200)).body.total).toBe(1);

    await http().get(`/api/workspaces/${b.workspace.id}/attachments/${created.id}`).expect(404);
    await http().delete(`/api/workspaces/${b.workspace.id}/attachments/${created.id}`).expect(404);

    const renamed = await http()
      .patch(`${base}/${created.id}`)
      .send({ filename: 'renamed.png' })
      .expect(200);
    expect(renamed.body.filename).toBe('renamed.png');

    await http().delete(`${base}/${created.id}`).expect(204);
    await http().get(`${base}/${created.id}`).expect(404);
    expect(storedFiles()).toHaveLength(1);
    expect(existsSync(join(env.uploadDir, created.url.split('/').pop()))).toBe(false);
  });
});
