import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { createTestApp, type TestApp } from './helpers.js';

describe('Serving the React app', () => {
  let ctx: TestApp;
  let app: INestApplication;

  beforeAll(async () => {
    ctx = await createTestApp({ auth: 'real' });
    app = ctx.app;
  });
  afterAll(() => app.close());

  const http = () => request(app.getHttpServer());

  it('serves index.html under /app without signing in (the app signs in by itself)', async () => {
    const res = await http().get('/app/').expect(200);
    expect(res.text).toContain('<div id="root">');
  });

  it('serves built assets as files', async () => {
    const res = await http().get('/app/assets/app.js').expect(200);
    expect(res.headers['content-type']).toContain('javascript');
    expect(res.text).toContain('nook');
  });

  it('opens any client-side route on a reload', async () => {
    const res = await http().get('/app/w/123/pages/456').expect(200);
    expect(res.headers['cache-control']).toContain('no-cache');
    expect(res.text).toContain('<div id="root">');
  });

  it('sends the bare address and /app to the app', async () => {
    await http().get('/').expect(302).expect('Location', '/app/');
    await http().get('/app').expect(301).expect('Location', '/app/');
  });

  it('does not swallow the API or the admin', async () => {
    await http().get('/api/health').expect(200);
    await http().get('/api/workspaces').expect(401);
    await http().get('/admin/signed-out').expect(200);
  });
});
