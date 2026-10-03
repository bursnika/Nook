import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { createTestApp, resetDb, type TestApp } from './helpers.js';

describe('Users API', () => {
  let ctx: TestApp;
  let app: INestApplication;

  beforeAll(async () => {
    ctx = await createTestApp();
    app = ctx.app;
  });
  afterAll(() => app.close());
  beforeEach(() => resetDb(ctx.prisma));

  const create = (n: number) =>
    request(app.getHttpServer())
      .post('/api/users')
      .send({ email: `user${n}@example.com`, name: `User ${n}` });

  it('creates, reads, updates and deletes a user', async () => {
    const created = await create(1).expect(201);
    expect(created.body).toMatchObject({ email: 'user1@example.com', name: 'User 1' });
    const id = created.body.id;

    await request(app.getHttpServer()).get(`/api/users/${id}`).expect(200);

    const updated = await request(app.getHttpServer())
      .patch(`/api/users/${id}`)
      .send({ name: 'Renamed' })
      .expect(200);
    expect(updated.body.name).toBe('Renamed');

    await request(app.getHttpServer()).delete(`/api/users/${id}`).expect(204);
    await request(app.getHttpServer()).get(`/api/users/${id}`).expect(404);
  });

  it('rejects invalid input with 400', async () => {
    await request(app.getHttpServer())
      .post('/api/users')
      .send({ email: 'not-an-email', name: '' })
      .expect(400);
    await request(app.getHttpServer())
      .post('/api/users')
      .send({ email: 'a@b.co', name: 'A', admin: true })
      .expect(400);
    await request(app.getHttpServer()).get('/api/users/not-a-uuid').expect(400);
  });

  it('returns 409 for a duplicate email and 404 for an unknown id', async () => {
    await create(1).expect(201);
    await create(1).expect(409);
    await request(app.getHttpServer())
      .patch('/api/users/019a0000-0000-7000-8000-000000000000')
      .send({ name: 'x' })
      .expect(404);
  });

  it('paginates with skip, limit and nextLink', async () => {
    for (let i = 1; i <= 5; i++) await create(i).expect(201);

    const first = await request(app.getHttpServer()).get('/api/users?limit=2').expect(200);
    expect(first.body).toMatchObject({ total: 5, skip: 0, limit: 2 });
    expect(first.body.items).toHaveLength(2);
    expect(first.body.nextLink).toContain('skip=2');

    const next = new URL(first.body.nextLink);
    const second = await request(app.getHttpServer())
      .get(next.pathname + next.search)
      .expect(200);
    expect(second.body.items).toHaveLength(2);
    expect(second.body.skip).toBe(2);

    const last = await request(app.getHttpServer()).get('/api/users?skip=4&limit=2').expect(200);
    expect(last.body.items).toHaveLength(1);
    expect(last.body.nextLink).toBeNull();

    await request(app.getHttpServer()).get('/api/users?limit=1000').expect(400);
    await request(app.getHttpServer()).get('/api/users?skip=-1').expect(400);
  });

  it('keeps search filters in nextLink', async () => {
    for (let i = 1; i <= 3; i++) await create(i).expect(201);
    const res = await request(app.getHttpServer()).get('/api/users?q=user&limit=1').expect(200);
    expect(res.body.total).toBe(3);
    expect(res.body.nextLink).toContain('q=user');
  });
});
