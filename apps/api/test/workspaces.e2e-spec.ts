import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { createTestApp, resetDb, type TestApp } from './helpers.js';

describe('Workspaces API', () => {
  let ctx: TestApp;
  let app: INestApplication;

  beforeAll(async () => {
    ctx = await createTestApp();
    app = ctx.app;
  });
  afterAll(() => app.close());
  beforeEach(() => resetDb(ctx.prisma));

  it('creates a workspace', async () => {
    const res = await request(app.getHttpServer())
      .post('/api/workspaces')
      .send({ name: 'Uni', slug: 'uni' })
      .expect(201);
    expect(res.body).toMatchObject({ name: 'Uni', slug: 'uni' });
  });

  it('validates the slug format and refuses unknown fields', async () => {
    await request(app.getHttpServer())
      .post('/api/workspaces')
      .send({ name: 'Bad', slug: 'Not Valid!' })
      .expect(400);
    await request(app.getHttpServer())
      .post('/api/workspaces')
      .send({ name: 'Bad', slug: 'ok', plan: 'PRO' }) // there are no plans any more
      .expect(400);
  });

  it('rejects a duplicate slug with 409', async () => {
    const body = { name: 'Uni', slug: 'uni' };
    await request(app.getHttpServer()).post('/api/workspaces').send(body).expect(201);
    await request(app.getHttpServer()).post('/api/workspaces').send(body).expect(409);
  });

  it('deletes the workspace', async () => {
    const { body } = await request(app.getHttpServer())
      .post('/api/workspaces')
      .send({ name: 'Uni', slug: 'uni' })
      .expect(201);
    await request(app.getHttpServer()).delete(`/api/workspaces/${body.id}`).expect(204);
    await request(app.getHttpServer()).get(`/api/workspaces/${body.id}`).expect(404);
  });
});
