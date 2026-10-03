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

  it('creates a workspace on the FREE plan by default', async () => {
    const res = await request(app.getHttpServer())
      .post('/api/workspaces')
      .send({ name: 'Uni', slug: 'uni' })
      .expect(201);
    expect(res.body).toMatchObject({ name: 'Uni', slug: 'uni', plan: 'FREE' });
  });

  it('validates slug format and plan', async () => {
    await request(app.getHttpServer())
      .post('/api/workspaces')
      .send({ name: 'Bad', slug: 'Not Valid!' })
      .expect(400);
    await request(app.getHttpServer())
      .post('/api/workspaces')
      .send({ name: 'Bad', slug: 'ok', plan: 'ENTERPRISE' })
      .expect(400);
  });

  it('rejects a duplicate slug with 409', async () => {
    const body = { name: 'Uni', slug: 'uni' };
    await request(app.getHttpServer()).post('/api/workspaces').send(body).expect(201);
    await request(app.getHttpServer()).post('/api/workspaces').send(body).expect(409);
  });

  it('upgrades the plan and deletes the workspace', async () => {
    const { body } = await request(app.getHttpServer())
      .post('/api/workspaces')
      .send({ name: 'Uni', slug: 'uni' })
      .expect(201);
    const upgraded = await request(app.getHttpServer())
      .patch(`/api/workspaces/${body.id}`)
      .send({ plan: 'PRO' })
      .expect(200);
    expect(upgraded.body.plan).toBe('PRO');
    await request(app.getHttpServer()).delete(`/api/workspaces/${body.id}`).expect(204);
    await request(app.getHttpServer()).get(`/api/workspaces/${body.id}`).expect(404);
  });
});
