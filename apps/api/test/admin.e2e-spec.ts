import type { INestApplication } from '@nestjs/common';
import { existsSync, readdirSync, rmSync } from 'node:fs';
import request from 'supertest';
import { env } from '../src/env.js';
import { createTestApp, resetDb, seedWorkspace, type TestApp } from './helpers.js';

const PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==',
  'base64',
);

describe('Admin (MVC) pages', () => {
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
  const idFrom = (location: string) => location.split('?')[0].split('/').pop()!;

  describe('rendering', () => {
    it('serves the dashboard, static assets and keeps the API prefix separate', async () => {
      const dash = await http().get('/admin').expect(200);
      expect(dash.text).toContain('Dashboard');
      expect(dash.text).toContain('/static/vendor/select2/js/select2.min.js');

      await http().get('/static/admin.js').expect(200);
      await http().get('/static/vendor/bootstrap/css/bootstrap.min.css').expect(200);
      await http().get('/static/vendor/jquery/jquery.min.js').expect(200);
      await http().get('/api/admin').expect(404);
      await http().get('/api/health').expect(200);
    });

    it('renders every list and form screen of a workspace', async () => {
      const { workspace } = await seedWorkspace(ctx.prisma);
      const base = `/admin/workspaces/${workspace.id}`;
      for (const path of [
        '',
        '/edit',
        '/pages',
        '/pages/new',
        '/tasks',
        '/tasks/new',
        '/attachments',
        '/attachments/new',
      ]) {
        const res = await http()
          .get(base + path)
          .expect(200);
        expect(res.text).toContain('<title>');
      }
      await http().get('/admin/workspaces').expect(200);
      await http().get('/admin/workspaces/new').expect(200);
      await http().get('/admin/users').expect(200);
    });

    it('escapes user content in HTML', async () => {
      const res = await http()
        .post('/admin/workspaces')
        .type('form')
        .send({ name: '<script>alert(1)</script>', slug: 'xss' })
        .expect(302);
      const page = await http().get(res.headers.location).expect(200);
      expect(page.text).not.toContain('<script>alert(1)</script>');
      expect(page.text).toContain('&lt;script&gt;alert(1)&lt;/script&gt;');
    });

    it('answers unknown records with an HTML 404 page', async () => {
      const res = await http()
        .get('/admin/workspaces/019a0000-0000-7000-8000-000000000000')
        .expect(404);
      expect(res.headers['content-type']).toContain('text/html');
      expect(res.text).toContain('Record not found');
      await http().get('/admin/workspaces/not-a-uuid').expect(400);
    });
  });

  describe('workspaces', () => {
    it('creates, edits and deletes a workspace through forms (post/redirect/get)', async () => {
      const created = await http()
        .post('/admin/workspaces')
        .type('form')
        .send({ name: 'Uni', slug: 'uni' })
        .expect(302);
      expect(created.headers.location).toMatch(/^\/admin\/workspaces\/[\w-]+\?flash=created$/);
      const id = idFrom(created.headers.location);
      expect((await http().get(created.headers.location).expect(200)).text).toContain(
        'Created successfully.',
      );
      expect((await ctx.prisma.workspace.findUniqueOrThrow({ where: { id } })).plan).toBe('FREE');

      await http()
        .post(`/admin/workspaces/${id}`)
        .type('form')
        .send({ name: 'University', slug: 'uni' })
        .expect(302);
      expect(await ctx.prisma.workspace.findUniqueOrThrow({ where: { id } })).toMatchObject({
        name: 'University',
        plan: 'FREE',
      });

      await http().post(`/admin/workspaces/${id}/delete`).expect(302);
      expect(await ctx.prisma.workspace.findUnique({ where: { id } })).toBeNull();
    });

    it('re-renders the form with messages for invalid and duplicate input', async () => {
      const bad = await http()
        .post('/admin/workspaces')
        .type('form')
        .send({ name: '', slug: 'Not Valid' })
        .expect(400);
      expect(bad.text).toContain('is-invalid');
      expect(bad.text).toContain('slug must be lowercase');

      await http()
        .post('/admin/workspaces')
        .type('form')
        .send({ name: 'A', slug: 'dup' })
        .expect(302);
      const dup = await http()
        .post('/admin/workspaces')
        .type('form')
        .send({ name: 'B', slug: 'dup' })
        .expect(400);
      expect(dup.text).toContain('already exists');
      expect(dup.text).toContain('value="dup"'); // what the user typed is kept
    });

    it('adds, re-roles and removes members, and protects the last owner', async () => {
      const { workspace } = await seedWorkspace(ctx.prisma);
      const other = await ctx.prisma.user.create({
        data: { email: 'new@example.com', name: 'New Person' },
      });
      const base = `/admin/workspaces/${workspace.id}`;

      await http()
        .post(`${base}/members`)
        .type('form')
        .send({ userId: other.id, role: 'ADMIN' })
        .expect(302);
      const added = await ctx.prisma.membership.findFirstOrThrow({ where: { userId: other.id } });
      expect(added.role).toBe('ADMIN');
      expect((await http().get(base).expect(200)).text).toContain('new@example.com');

      await http()
        .post(`${base}/members/${added.id}`)
        .type('form')
        .send({ role: 'MEMBER' })
        .expect(302);
      expect(
        (await ctx.prisma.membership.findUniqueOrThrow({ where: { id: added.id } })).role,
      ).toBe('MEMBER');

      const owner = await ctx.prisma.membership.findFirstOrThrow({
        where: { workspaceId: workspace.id, role: 'OWNER' },
      });
      await http().post(`${base}/members/${owner.id}/delete`).expect(409);
      await http().post(`${base}/members/${added.id}/delete`).expect(302);
      await http().post(`${base}/members`).type('form').send({ role: 'MEMBER' }).expect(400);
    });
  });

  describe('pages with a cover file', () => {
    it('creates a page with an uploaded cover, then replaces and removes it', async () => {
      const { workspace } = await seedWorkspace(ctx.prisma);
      const base = `/admin/workspaces/${workspace.id}/pages`;

      const created = await http()
        .post(base)
        .field('title', 'Landing')
        .field('slug', 'landing')
        .field('isPublished', 'on')
        .attach('cover', PNG, { filename: 'cover.png', contentType: 'image/png' })
        .expect(302);
      const id = idFrom(created.headers.location);
      const page = await ctx.prisma.page.findUniqueOrThrow({ where: { id } });
      expect(page).toMatchObject({ title: 'Landing', isPublished: true, slug: 'landing' });
      expect(page.coverUrl).toMatch(/^\/uploads\/[\w-]+\.png$/);
      expect(storedFiles()).toHaveLength(1);
      await http().get(page.coverUrl!).expect(200);

      const shown = await http().get(`${base}/${id}`).expect(200);
      expect(shown.text).toContain(page.coverUrl);

      // replacing the cover deletes the old file
      await http()
        .post(`${base}/${id}`)
        .field('title', 'Landing')
        .field('slug', 'landing')
        .field('isPublished', 'on')
        .attach('cover', PNG, { filename: 'new.png', contentType: 'image/png' })
        .expect(302);
      const replaced = await ctx.prisma.page.findUniqueOrThrow({ where: { id } });
      expect(replaced.coverUrl).not.toBe(page.coverUrl);
      expect(storedFiles()).toHaveLength(1);

      // removing it empties the column and the folder
      await http()
        .post(`${base}/${id}`)
        .type('form')
        .send({ title: 'Landing', slug: 'landing', isPublished: 'on', removeCover: 'on' })
        .expect(302);
      expect((await ctx.prisma.page.findUniqueOrThrow({ where: { id } })).coverUrl).toBeNull();
      expect(storedFiles()).toHaveLength(0);
    });

    it('rejects a non-image cover and leaves no file behind', async () => {
      const { workspace } = await seedWorkspace(ctx.prisma);
      const res = await http()
        .post(`/admin/workspaces/${workspace.id}/pages`)
        .field('title', 'x')
        .attach('cover', Buffer.from('plain text'), {
          filename: 'a.txt',
          contentType: 'text/plain',
        })
        .expect(400);
      expect(res.text).toContain('must be a PNG, JPEG, GIF or WebP');
      expect(await ctx.prisma.page.count()).toBe(0);
      expect(storedFiles()).toHaveLength(0);
    });

    it('requires a slug for publishing', async () => {
      const a = await seedWorkspace(ctx.prisma, 'a');
      const base = `/admin/workspaces/${a.workspace.id}/pages`;
      const noSlug = await http()
        .post(base)
        .type('form')
        .send({ title: 'x', isPublished: 'on' })
        .expect(400);
      expect(noSlug.text).toContain('A slug is required');
    });

    it('does not show a page of another workspace', async () => {
      const a = await seedWorkspace(ctx.prisma, 'a');
      const b = await seedWorkspace(ctx.prisma, 'b');
      const page = await ctx.prisma.page.create({
        data: { title: 'secret', workspaceId: a.workspace.id, authorId: a.user.id },
      });
      await http().get(`/admin/workspaces/${b.workspace.id}/pages/${page.id}`).expect(404);
      await http().get(`/admin/workspaces/${b.workspace.id}/pages/${page.id}/edit`).expect(404);
      await http().post(`/admin/workspaces/${b.workspace.id}/pages/${page.id}/delete`).expect(404);
      expect(await ctx.prisma.page.count()).toBe(1);
    });
  });

  describe('tasks and attachments', () => {
    it('creates a task with an assignee and a due date, then clears them', async () => {
      const { user, workspace } = await seedWorkspace(ctx.prisma);
      const base = `/admin/workspaces/${workspace.id}`;

      const created = await http()
        .post(`${base}/tasks`)
        .type('form')
        .send({
          title: 'Lab',
          status: 'IN_PROGRESS',
          priority: 'HIGH',
          dueDate: '2026-11-20',
          assigneeId: user.id,
        })
        .expect(302);
      const id = idFrom(created.headers.location);
      const task = await ctx.prisma.task.findUniqueOrThrow({ where: { id } });
      expect(task).toMatchObject({
        title: 'Lab',
        status: 'IN_PROGRESS',
        priority: 'HIGH',
        assigneeId: user.id,
      });
      expect(task.dueDate?.toISOString().slice(0, 10)).toBe('2026-11-20');

      const edit = await http().get(`${base}/tasks/${id}/edit`).expect(200);
      expect(edit.text).toContain('<option value="IN_PROGRESS" selected>');
      expect(edit.text).toContain('value="2026-11-20"');

      await http()
        .post(`${base}/tasks/${id}`)
        .type('form')
        .send({ title: 'Lab', status: 'DONE', priority: 'HIGH', dueDate: '', assigneeId: '' })
        .expect(302);
      const cleared = await ctx.prisma.task.findUniqueOrThrow({ where: { id } });
      expect(cleared).toMatchObject({ status: 'DONE', assigneeId: null, dueDate: null });
      expect(cleared.completedAt).not.toBeNull();
    });

    it('filters the task list by status and rejects foreign references', async () => {
      const a = await seedWorkspace(ctx.prisma, 'a');
      const b = await seedWorkspace(ctx.prisma, 'b');
      await ctx.prisma.task.createMany({
        data: [
          { title: 'open task', workspaceId: a.workspace.id },
          { title: 'finished task', workspaceId: a.workspace.id, status: 'DONE' },
        ],
      });
      const list = await http()
        .get(`/admin/workspaces/${a.workspace.id}/tasks?status=DONE`)
        .expect(200);
      expect(list.text).toContain('finished task');
      expect(list.text).not.toContain('open task');
      await http().get(`/admin/workspaces/${a.workspace.id}/tasks?status=NOPE`).expect(400);

      const bad = await http()
        .post(`/admin/workspaces/${a.workspace.id}/tasks`)
        .type('form')
        .send({ title: 'x', assigneeId: b.user.id })
        .expect(400);
      expect(bad.text).toContain('must be a member');
    });

    it('uploads, renames and deletes an attachment together with its file', async () => {
      const { workspace } = await seedWorkspace(ctx.prisma);
      const base = `/admin/workspaces/${workspace.id}/attachments`;

      const none = await http().post(base).type('form').send({}).expect(400);
      expect(none.text).toContain('Choose a file');

      const created = await http()
        .post(base)
        .attach('file', PNG, { filename: 'pic.png', contentType: 'image/png' })
        .expect(302);
      const id = idFrom(created.headers.location);
      expect(storedFiles()).toHaveLength(1);
      expect((await http().get(`${base}/${id}`).expect(200)).text).toContain('pic.png');

      await http().post(`${base}/${id}`).type('form').send({ filename: 'renamed.png' }).expect(302);
      expect((await ctx.prisma.attachment.findUniqueOrThrow({ where: { id } })).filename).toBe(
        'renamed.png',
      );

      await http().post(`${base}/${id}/delete`).expect(302);
      expect(storedFiles()).toHaveLength(0);
    });
  });

  describe('autocomplete lookups', () => {
    it('only searches all users from three characters and pages through the results', async () => {
      await ctx.prisma.user.createMany({
        data: Array.from({ length: 25 }, (_, i) => ({
          email: `anna${i}@example.com`,
          name: `Anna Number${i}`,
        })),
      });
      const short = await http().get('/admin/lookup/users?q=an').expect(200);
      expect(short.body).toEqual({ results: [], more: false });

      const first = await http().get('/admin/lookup/users?q=anna').expect(200);
      expect(first.body.results).toHaveLength(20);
      expect(first.body.more).toBe(true);
      expect(first.body.results[0].text).toMatch(/Anna Number\d+ · anna\d+@example\.com/);

      const second = await http().get('/admin/lookup/users?q=anna&page=2').expect(200);
      expect(second.body.results).toHaveLength(5);
      expect(second.body.more).toBe(false);

      const byEmail = await http().get('/admin/lookup/users?q=anna7@').expect(200);
      expect(byEmail.body.results).toHaveLength(1);
    });

    it('scopes members and pages lookups to the workspace', async () => {
      const a = await seedWorkspace(ctx.prisma, 'alpha');
      const b = await seedWorkspace(ctx.prisma, 'beta');
      await ctx.prisma.page.create({
        data: { title: 'Alpha plan', workspaceId: a.workspace.id, authorId: a.user.id },
      });
      await ctx.prisma.page.create({
        data: { title: 'Beta plan', workspaceId: b.workspace.id, authorId: b.user.id },
      });

      const base = `/admin/workspaces/${a.workspace.id}/lookup`;
      const members = await http().get(`${base}/members`).expect(200);
      expect(members.body.results.map((r: { id: string }) => r.id)).toEqual([a.user.id]);
      const pages = await http().get(`${base}/pages?q=plan`).expect(200);
      expect(pages.body.results.map((r: { text: string }) => r.text)).toEqual(['Alpha plan']);
      await http().get(`/admin/workspaces/not-a-uuid/lookup/pages`).expect(400);
    });
  });
});
