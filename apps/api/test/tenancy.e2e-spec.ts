import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { bearer, cookieValue, signIn } from './auth-helpers.js';
import { createTestApp, resetDb, type TestApp } from './helpers.js';

type User = { id: string; email: string };

describe('Tenants, roles, invitations and feature flags', () => {
  let ctx: TestApp;
  let app: INestApplication;

  // wsA: owner (OWNER), admin (ADMIN), member (MEMBER).  wsB: outsider (OWNER).  platform: listed in ADMIN_EMAILS.
  let owner: User, admin: User, member: User, outsider: User, platform: User;
  let wsA: { id: string; name: string }, wsB: { id: string; name: string };
  let tok: Record<'owner' | 'admin' | 'member' | 'outsider' | 'platform', string>;
  let pageA: { id: string };

  beforeAll(async () => {
    ctx = await createTestApp({ auth: 'real' });
    app = ctx.app;
  });
  afterAll(() => app.close());

  beforeEach(async () => {
    await resetDb(ctx.prisma);
    const make = (name: string, email = `${name}@example.com`) =>
      ctx.prisma.user.create({ data: { email, name } });
    [owner, admin, member, outsider, platform] = await Promise.all([
      make('owner'),
      make('admin'),
      make('member'),
      make('outsider'),
      make('platform', 'platform-admin@example.com'),
    ]);
    wsA = await ctx.prisma.workspace.create({
      data: {
        name: 'Alpha',
        slug: 'alpha',
        memberships: {
          create: [
            { userId: owner.id, role: 'OWNER' },
            { userId: admin.id, role: 'ADMIN' },
            { userId: member.id, role: 'MEMBER' },
          ],
        },
      },
    });
    wsB = await ctx.prisma.workspace.create({
      data: {
        name: 'Beta',
        slug: 'beta',
        memberships: { create: { userId: outsider.id, role: 'OWNER' } },
      },
    });
    pageA = await ctx.prisma.page.create({
      data: { title: 'Secret plan', workspaceId: wsA.id, authorId: owner.id },
    });
    tok = {
      owner: await bearer(app, owner),
      admin: await bearer(app, admin),
      member: await bearer(app, member),
      outsider: await bearer(app, outsider),
      platform: await bearer(app, platform),
    };
  });

  const http = () => request(app.getHttpServer());
  const as = (token: string) => ({
    get: (url: string) => http().get(url).set('Authorization', token),
    post: (url: string, body: object = {}) =>
      http().post(url).set('Authorization', token).send(body),
    patch: (url: string, body: object = {}) =>
      http().patch(url).set('Authorization', token).send(body),
    delete: (url: string) => http().delete(url).set('Authorization', token),
  });
  const A = () => `/api/workspaces/${wsA.id}`;

  describe('tenant isolation', () => {
    it('hides a workspace from non-members on every route and changes nothing', async () => {
      const foreign = as(tok.outsider);
      const calls: [string, string, object?][] = [
        ['get', A()],
        ['get', `${A()}/pages`],
        ['get', `${A()}/pages/${pageA.id}`],
        ['get', `${A()}/pages/${pageA.id}/blocks`],
        ['get', `${A()}/tasks`],
        ['get', `${A()}/events`],
        ['get', `${A()}/attachments`],
        ['get', `${A()}/members`],
        ['get', `${A()}/features`],
        ['get', `${A()}/insights`],
        ['get', `${A()}/invitations`],
        ['post', `${A()}/pages`, { title: 'planted' }],
        ['post', `${A()}/pages/${pageA.id}/blocks`, {}],
        ['post', `${A()}/tasks`, { title: 'planted' }],
        [
          'post',
          `${A()}/events`,
          { title: 'p', startsAt: '2026-01-01T10:00:00Z', endsAt: '2026-01-01T11:00:00Z' },
        ],
        ['post', `${A()}/invitations`, { email: 'x@example.com' }],
        ['post', `${A()}/plan`, { plan: 'PRO' }],
        ['patch', A(), { name: 'hacked' }],
        ['patch', `${A()}/pages/${pageA.id}`, { title: 'hacked' }],
        ['delete', `${A()}/pages/${pageA.id}`],
        ['delete', A()],
      ];
      for (const [method, url, body] of calls) {
        const res = await (
          foreign as never as Record<string, (u: string, b?: object) => request.Test>
        )[method](url, body);
        expect(res.status, `${method.toUpperCase()} ${url}`).toBe(404);
      }
      expect(await ctx.prisma.workspace.findUniqueOrThrow({ where: { id: wsA.id } })).toMatchObject(
        { name: 'Alpha', plan: 'FREE' },
      );
      expect(await ctx.prisma.page.findMany({ where: { workspaceId: wsA.id } })).toHaveLength(1);
      expect(await ctx.prisma.task.count()).toBe(0);
      expect(await ctx.prisma.invitation.count()).toBe(0);
    });

    it('answers a foreign workspace exactly like a missing one, so ids cannot be probed', async () => {
      const foreign = await as(tok.outsider).get(A());
      const missing = await as(tok.outsider).get(
        '/api/workspaces/019a0000-0000-7000-8000-000000000000',
      );
      expect(foreign.status).toBe(missing.status);
      expect(foreign.body).toEqual(missing.body);
    });

    it('lists only the workspaces a person belongs to', async () => {
      const ids = async (token: string) =>
        (await as(token).get('/api/workspaces').expect(200)).body.items
          .map((w: { id: string }) => w.id)
          .sort();
      expect(await ids(tok.owner)).toEqual([wsA.id]);
      expect(await ids(tok.member)).toEqual([wsA.id]);
      expect(await ids(tok.outsider)).toEqual([wsB.id]);
      expect(await ids(tok.platform)).toEqual([wsA.id, wsB.id].sort());
    });

    it('keeps content references inside the workspace', async () => {
      const foreignPage = await ctx.prisma.page.create({
        data: { title: 'Beta page', workspaceId: wsB.id, authorId: outsider.id },
      });
      await as(tok.owner).post(`${A()}/tasks`, { title: 't', assigneeId: outsider.id }).expect(400);
      await as(tok.owner).post(`${A()}/tasks`, { title: 't', pageId: foreignPage.id }).expect(400);
    });

    it('lets a platform admin open any workspace', async () => {
      await as(tok.platform).get(A()).expect(200);
      await as(tok.platform).get(`${A()}/pages/${pageA.id}`).expect(200);
    });

    it('treats a creator as the owner of a new workspace and refuses a self-chosen plan', async () => {
      const res = await as(tok.outsider)
        .post('/api/workspaces', { name: 'Mine', slug: 'mine' })
        .expect(201);
      expect(res.body.plan).toBe('FREE');
      expect(
        (
          await ctx.prisma.membership.findFirstOrThrow({
            where: { workspaceId: res.body.id, userId: outsider.id },
          })
        ).role,
      ).toBe('OWNER');
      await as(tok.outsider)
        .post('/api/workspaces', { name: 'Rich', slug: 'rich', plan: 'PRO' })
        .expect(400);
      await as(tok.outsider).post('/api/workspaces', { name: 'Dup', slug: 'mine' }).expect(409);
    });

    it('records the signed-in user as the author of a page', async () => {
      const res = await as(tok.member).post(`${A()}/pages`, { title: 'By member' }).expect(201);
      expect(res.body.authorId).toBe(member.id);
    });
  });

  describe('roles', () => {
    const matrix: [
      role: 'owner' | 'admin' | 'member',
      action: string,
      call: (t: string, a: string) => request.Test,
      expected: number,
    ][] = [
      ['member', 'read pages', (t, a) => as(t).get(`${a}/pages`), 200],
      ['member', 'create a page', (t, a) => as(t).post(`${a}/pages`, { title: 'x' }), 201],
      ['member', 'rename the workspace', (t, a) => as(t).patch(a, { name: 'x' }), 403],
      ['admin', 'rename the workspace', (t, a) => as(t).patch(a, { name: 'x' }), 200],
      ['owner', 'rename the workspace', (t, a) => as(t).patch(a, { name: 'x' }), 200],
      ['member', 'list invitations', (t, a) => as(t).get(`${a}/invitations`), 403],
      ['admin', 'list invitations', (t, a) => as(t).get(`${a}/invitations`), 200],
      [
        'member',
        'invite someone',
        (t, a) => as(t).post(`${a}/invitations`, { email: 'n@example.com' }),
        403,
      ],
      [
        'admin',
        'invite someone',
        (t, a) => as(t).post(`${a}/invitations`, { email: 'n@example.com' }),
        201,
      ],
      ['member', 'switch the plan', (t, a) => as(t).post(`${a}/plan`, { plan: 'PRO' }), 403],
      ['admin', 'switch the plan', (t, a) => as(t).post(`${a}/plan`, { plan: 'PRO' }), 403],
      ['owner', 'switch the plan', (t, a) => as(t).post(`${a}/plan`, { plan: 'PRO' }), 200],
      ['member', 'delete the workspace', (t, a) => as(t).delete(a), 403],
      ['admin', 'delete the workspace', (t, a) => as(t).delete(a), 403],
      ['owner', 'delete the workspace', (t, a) => as(t).delete(a), 204],
    ];
    it.each(matrix)('%s: %s -> %i', async (role, _action, call, expected) => {
      const res = await call(tok[role], A());
      expect(res.status).toBe(expected);
    });

    it('lets only owners hand out roles', async () => {
      const members = await ctx.prisma.membership.findMany({ where: { workspaceId: wsA.id } });
      const idOf = (u: User) => members.find((m) => m.userId === u.id)!.id;
      const roleOf = async (u: User) =>
        (await ctx.prisma.membership.findUniqueOrThrow({ where: { id: idOf(u) } })).role;

      for (const who of ['member', 'admin'] as const) {
        await as(tok[who])
          .patch(`${A()}/members/${idOf(member)}`, { role: 'ADMIN' })
          .expect(403);
        await as(tok[who])
          .patch(`${A()}/members/${idOf(owner)}`, { role: 'MEMBER' })
          .expect(403);
      }
      expect(await roleOf(member)).toBe('MEMBER');
      expect(await roleOf(owner)).toBe('OWNER');

      await as(tok.owner)
        .patch(`${A()}/members/${idOf(member)}`, { role: 'ADMIN' })
        .expect(200);
      expect(await roleOf(member)).toBe('ADMIN');
    });

    it('never lets anyone change their own role', async () => {
      const mine = await ctx.prisma.membership.findFirstOrThrow({
        where: { workspaceId: wsA.id, userId: admin.id },
      });
      await as(tok.admin).patch(`${A()}/members/${mine.id}`, { role: 'OWNER' }).expect(403);
      const ownerMembership = await ctx.prisma.membership.findFirstOrThrow({
        where: { workspaceId: wsA.id, userId: owner.id },
      });
      await as(tok.owner)
        .patch(`${A()}/members/${ownerMembership.id}`, { role: 'MEMBER' })
        .expect(403);
      expect((await ctx.prisma.membership.findUniqueOrThrow({ where: { id: mine.id } })).role).toBe(
        'ADMIN',
      );
    });

    it('stops an admin from removing owners', async () => {
      const ownerMembership = await ctx.prisma.membership.findFirstOrThrow({
        where: { workspaceId: wsA.id, userId: owner.id },
      });
      await as(tok.admin).delete(`${A()}/members/${ownerMembership.id}`).expect(403);
    });

    it('never lets a workspace lose its last owner', async () => {
      const mine = await ctx.prisma.membership.findFirstOrThrow({
        where: { workspaceId: wsA.id, userId: owner.id },
      });
      await as(tok.owner).delete(`${A()}/members/${mine.id}`).expect(409);
      await as(tok.platform).patch(`${A()}/members/${mine.id}`, { role: 'MEMBER' }).expect(409);
    });

    it('reserves the user list and adding arbitrary users to platform admins', async () => {
      await as(tok.owner).get('/api/users').expect(403);
      await as(tok.platform).get('/api/users').expect(200);
      await as(tok.owner).post(`${A()}/members`, { userId: outsider.id }).expect(403);
      await as(tok.platform).post(`${A()}/members`, { userId: outsider.id }).expect(201);
    });
  });

  describe('invitations', () => {
    const invite = (email: string, token = tok.owner, role?: string) =>
      as(token).post(`${A()}/invitations`, { email, ...(role ? { role } : {}) });

    it('creates an invitation whose secret is shown once and stored only as a hash', async () => {
      const res = await invite('Friend@Example.com').expect(201);
      expect(res.body).toMatchObject({ email: 'friend@example.com', role: 'MEMBER' });
      expect(res.body.token.length).toBeGreaterThan(30);
      const stored = await ctx.prisma.invitation.findFirstOrThrow();
      expect(stored.tokenHash).not.toBe(res.body.token);
      expect(JSON.stringify(stored)).not.toContain(res.body.token);
      const listed = await as(tok.owner).get(`${A()}/invitations`).expect(200);
      expect(JSON.stringify(listed.body)).not.toContain(res.body.token);
    });

    it('lets admins invite members but not other admins', async () => {
      await invite('a@example.com', tok.admin, 'ADMIN').expect(403);
      await invite('a@example.com', tok.admin, 'MEMBER').expect(201);
      await invite('b@example.com', tok.admin).expect(201);
      await invite('c@example.com', tok.owner, 'ADMIN').expect(201);
    });

    it('validates the invitation request', async () => {
      await invite('not-an-email').expect(400);
      await invite('x@example.com', tok.owner, 'OWNER').expect(400); // owners are promoted, not invited
      await invite(member.email).expect(409); // already a member
    });

    it('adds the invited person with the invited role, once, and only for the right e-mail', async () => {
      const friend = await ctx.prisma.user.create({
        data: { email: 'friend@example.com', name: 'Friend' },
      });
      const stranger = await ctx.prisma.user.create({
        data: { email: 'stranger@example.com', name: 'Stranger' },
      });
      const { token } = (await invite('friend@example.com', tok.owner, 'ADMIN').expect(201)).body;
      const accept = (u: User, t = token) =>
        as(u === friend ? friendTok : strangerTok).post('/api/invitations/accept', { token: t });
      const friendTok = await bearer(app, friend);
      const strangerTok = await bearer(app, stranger);

      await accept(stranger).expect(403);
      expect(await ctx.prisma.membership.count({ where: { userId: stranger.id } })).toBe(0);

      const ok = await accept(friend).expect(200);
      expect(ok.body).toMatchObject({ role: 'ADMIN', workspace: { id: wsA.id } });
      expect(
        (
          await ctx.prisma.membership.findFirstOrThrow({
            where: { userId: friend.id, workspaceId: wsA.id },
          })
        ).role,
      ).toBe('ADMIN');

      await accept(friend).expect(410); // single use
      await http().post('/api/invitations/accept').send({ token }).expect(401);
      await as(friendTok).get(A()).expect(200); // and the new member can now work in the workspace
    });

    it('rejects expired, revoked and unknown invitations', async () => {
      const friend = await ctx.prisma.user.create({
        data: { email: 'late@example.com', name: 'Late' },
      });
      const friendTok = await bearer(app, friend);
      const expired = (await invite('late@example.com').expect(201)).body;
      await ctx.prisma.invitation.update({
        where: { id: expired.id },
        data: { expiresAt: new Date(Date.now() - 1000) },
      });
      await as(friendTok).post('/api/invitations/accept', { token: expired.token }).expect(410);

      const revoked = (await invite('late@example.com').expect(201)).body;
      await as(tok.owner).delete(`${A()}/invitations/${revoked.id}`).expect(204);
      await as(friendTok).post('/api/invitations/accept', { token: revoked.token }).expect(404);
      await as(friendTok)
        .post('/api/invitations/accept', { token: 'x'.repeat(43) })
        .expect(404);
      await as(friendTok).post('/api/invitations/accept', { token: 'short' }).expect(400);
      expect(await ctx.prisma.membership.count({ where: { userId: friend.id } })).toBe(0);
    });

    it('does not let another workspace revoke or list invitations', async () => {
      const inv = (await invite('someone@example.com').expect(201)).body;
      await as(tok.outsider).delete(`${A()}/invitations/${inv.id}`).expect(404);
      expect(await ctx.prisma.invitation.count()).toBe(1);
    });
  });

  describe('feature flags and plans', () => {
    const features = async (token = tok.member) =>
      (await as(token).get(`${A()}/features`).expect(200)).body;

    it('locks Pro features on the Free plan with a machine-readable reason', async () => {
      const res = await as(tok.member).get(`${A()}/insights`).expect(403);
      expect(res.body).toMatchObject({
        code: 'FEATURE_NOT_AVAILABLE',
        feature: 'insights',
        requiredPlan: 'PRO',
      });
      expect(res.body.message).toContain('PRO');

      const list = await features();
      expect(list.plan).toBe('FREE');
      expect(list.features.map((f: { key: string }) => f.key)).toEqual([
        'ai-assistant',
        'google-two-way-sync',
        'insights',
      ]);
      expect(list.features.every((f: { available: boolean }) => f.available === false)).toBe(true);
    });

    it('unlocks them when an owner switches to Pro, and locks them again on downgrade', async () => {
      await as(tok.owner).post(`${A()}/plan`, { plan: 'PRO' }).expect(200);
      expect((await features()).features.every((f: { available: boolean }) => f.available)).toBe(
        true,
      );
      await as(tok.member).get(`${A()}/insights`).expect(200);

      await as(tok.owner).post(`${A()}/plan`, { plan: 'FREE' }).expect(200);
      await as(tok.member).get(`${A()}/insights`).expect(403);
      await as(tok.owner).post(`${A()}/plan`, { plan: 'GOLD' }).expect(400);
    });

    it('keeps plans per workspace', async () => {
      await as(tok.owner).post(`${A()}/plan`, { plan: 'PRO' }).expect(200);
      await as(tok.outsider).get(`/api/workspaces/${wsB.id}/insights`).expect(403);
    });

    it('can switch a feature off for everybody, whatever the plan', async () => {
      await as(tok.owner).post(`${A()}/plan`, { plan: 'PRO' }).expect(200);
      await ctx.prisma.featureFlag.update({ where: { key: 'insights' }, data: { enabled: false } });
      try {
        const res = await as(tok.owner).get(`${A()}/insights`).expect(403);
        expect(res.body.message).toContain('switched off');
        expect(
          (await features()).features.find((f: { key: string }) => f.key === 'insights').available,
        ).toBe(false);
      } finally {
        await ctx.prisma.featureFlag.update({
          where: { key: 'insights' },
          data: { enabled: true },
        });
      }
      await as(tok.owner).get(`${A()}/insights`).expect(200);
    });

    it('does not reveal the plan to non-members: they get 404 before any feature check', async () => {
      await as(tok.outsider).get(`${A()}/insights`).expect(404);
      await http().get(`${A()}/insights`).expect(401);
    });

    it('computes insights from the workspace data only', async () => {
      await as(tok.owner).post(`${A()}/plan`, { plan: 'PRO' }).expect(200);
      const day = 24 * 60 * 60 * 1000;
      await ctx.prisma.task.createMany({
        data: [
          { workspaceId: wsA.id, title: 'open' },
          { workspaceId: wsA.id, title: 'overdue', dueDate: new Date(Date.now() - day) },
          { workspaceId: wsA.id, title: 'done today', status: 'DONE', completedAt: new Date() },
          {
            workspaceId: wsA.id,
            title: 'done long ago',
            status: 'DONE',
            completedAt: new Date(Date.now() - 30 * day),
          },
          { workspaceId: wsB.id, title: 'someone else', status: 'DONE', completedAt: new Date() },
        ],
      });
      const res = await as(tok.member).get(`${A()}/insights`).expect(200);
      expect(res.body).toEqual({
        tasksByStatus: { TODO: 2, DONE: 2 },
        completedLastWeek: 1,
        overdue: 1,
        pages: 1,
      });
    });
  });

  describe('the admin (MVC) behind sign-in', () => {
    const page = (token: string, url: string) =>
      http().get(url).set('Authorization', token).set('Accept', 'text/html');

    it('shows who is signed in and hides platform-only areas from everybody else', async () => {
      const home = await page(tok.owner, '/admin').expect(200);
      expect(home.text).toContain('owner@example.com');
      expect(home.text).toContain('Sign out');
      expect(home.text).not.toContain('href="/admin/users"');

      const platformHome = await page(tok.platform, '/admin').expect(200);
      expect(platformHome.text).toContain('href="/admin/users"');

      const denied = await page(tok.owner, '/admin/users').expect(403);
      expect(denied.headers['content-type']).toContain('text/html');
      expect(denied.text).toContain('platform administrators');
      await page(tok.platform, '/admin/users').expect(200);
      await page(tok.owner, '/admin/lookup/users?q=abcd').expect(403);
      await page(tok.platform, '/admin/lookup/users?q=abcd').expect(200);
    });

    it('lists only own workspaces and hides foreign ones', async () => {
      const list = await page(tok.owner, '/admin/workspaces').expect(200);
      expect(list.text).toContain('Alpha');
      expect(list.text).not.toContain('Beta');
      await page(tok.owner, `/admin/workspaces/${wsB.id}`).expect(404);
      await page(tok.owner, `/admin/workspaces/${wsB.id}/pages`).expect(404);
      await page(tok.outsider, `/admin/workspaces/${wsA.id}/pages/${pageA.id}`).expect(404);
      const dash = await page(tok.owner, '/admin').expect(200);
      expect(dash.text).toMatch(/<div class="stat">1<\/div><div class="text-muted">Workspaces/);
    });

    it('applies roles to the admin forms and hides buttons the role cannot use', async () => {
      await page(tok.member, `/admin/workspaces/${wsA.id}/edit`).expect(403);
      await http()
        .post(`/admin/workspaces/${wsA.id}`)
        .set('Authorization', tok.member)
        .type('form')
        .send({ name: 'x', slug: 'alpha' })
        .expect(403);
      await http()
        .post(`/admin/workspaces/${wsA.id}/delete`)
        .set('Authorization', tok.admin)
        .expect(403);

      const asMember = await page(tok.member, `/admin/workspaces/${wsA.id}/team`).expect(200);
      expect(asMember.text).not.toContain('Create invitation');
      expect(asMember.text).not.toContain('Switch to');
      const asOwner = await page(tok.owner, `/admin/workspaces/${wsA.id}/team`).expect(200);
      expect(asOwner.text).toContain('Create invitation');
      expect(asOwner.text).toContain('Switch to PRO');
      expect(asOwner.text).not.toContain('Add any user'); // support tool for platform admins
    });

    it('offers the role selector only to owners, and never on their own row', async () => {
      const selectors = (html: string) =>
        (html.match(/name="role" aria-label="Role"/g) ?? []).length;
      const asOwner = await page(tok.owner, `/admin/workspaces/${wsA.id}/team`).expect(200);
      expect(selectors(asOwner.text)).toBe(2); // admin and member, not the owner's own row
      expect(asOwner.text).toContain('(you)');
      const asAdmin = await page(tok.admin, `/admin/workspaces/${wsA.id}/team`).expect(200);
      expect(selectors(asAdmin.text)).toBe(0);
      await http()
        .post(
          `/admin/workspaces/${wsA.id}/members/${(await ctx.prisma.membership.findFirstOrThrow({ where: { userId: member.id } })).id}`,
        )
        .set('Authorization', tok.admin)
        .type('form')
        .send({ role: 'ADMIN' })
        .expect(403);
    });

    it('switches the plan through the form, for owners only', async () => {
      await http()
        .post(`/admin/workspaces/${wsA.id}/plan`)
        .set('Authorization', tok.admin)
        .type('form')
        .send({ plan: 'PRO' })
        .expect(403);
      await http()
        .post(`/admin/workspaces/${wsA.id}/plan`)
        .set('Authorization', tok.owner)
        .type('form')
        .send({ plan: 'PRO' })
        .expect(302);
      expect((await ctx.prisma.workspace.findUniqueOrThrow({ where: { id: wsA.id } })).plan).toBe(
        'PRO',
      );
    });

    it('creates content as the signed-in user', async () => {
      const res = await http()
        .post(`/admin/workspaces/${wsA.id}/pages`)
        .set('Authorization', tok.member)
        .field('title', 'From the admin')
        .expect(302);
      const created = await ctx.prisma.page.findFirstOrThrow({
        where: { title: 'From the admin' },
      });
      expect(created.authorId).toBe(member.id);
      expect(res.headers.location).toContain(created.id);
    });

    it('runs the invitation flow end to end', async () => {
      const friend = await ctx.prisma.user.create({
        data: { email: 'friend@example.com', name: 'Friend' },
      });
      const created = await http()
        .post(`/admin/workspaces/${wsA.id}/invitations`)
        .set('Authorization', tok.owner)
        .type('form')
        .send({ email: 'friend@example.com', role: 'ADMIN' })
        .expect(201);
      const link = created.text.match(/value="(http[^"]+\/admin\/invite\/([^"]+))"/);
      expect(link).not.toBeNull();
      const [, , token] = link!;

      // the link is not repeated anywhere else, and not in a redirect URL
      expect(created.headers.location).toBeUndefined();
      expect(
        (await page(tok.owner, `/admin/workspaces/${wsA.id}/team`).expect(200)).text,
      ).not.toContain(token);

      const friendTok = await bearer(app, friend);
      const landing = await page(friendTok, `/admin/invite/${token}`).expect(200);
      expect(landing.text).toContain('Accept the invitation');
      const wrong = await page(tok.outsider, `/admin/invite/${token}`).expect(200);
      expect(wrong.text).toContain('Sign out and sign in with the invited address');
      expect(wrong.text).not.toContain('Accept the invitation');
      await http()
        .post(`/admin/invite/${token}/accept`)
        .set('Authorization', tok.outsider)
        .expect(403);

      const accepted = await http()
        .post(`/admin/invite/${token}/accept`)
        .set('Authorization', friendTok)
        .expect(302);
      expect(accepted.headers.location).toBe(`/admin/workspaces/${wsA.id}?flash=created`);
      expect(
        (
          await ctx.prisma.membership.findFirstOrThrow({
            where: { userId: friend.id, workspaceId: wsA.id },
          })
        ).role,
      ).toBe('ADMIN');
      await http()
        .post(`/admin/invite/${token}/accept`)
        .set('Authorization', friendTok)
        .expect(410);
    });

    it('sends someone who is not signed in to Google and back to the invite page', async () => {
      const res = await http()
        .get('/admin/invite/' + 'a'.repeat(43))
        .set('Accept', 'text/html')
        .expect(302);
      expect(res.headers.location).toBe(
        `/api/auth/google?returnTo=${encodeURIComponent('/admin/invite/' + 'a'.repeat(43))}`,
      );
    });

    it('signs out: redirects, clears the cookies and revokes the refresh token', async () => {
      const { agent, callback } = await signIn(ctx, { email: 'leaver@example.com' });
      const refresh = cookieValue(callback, 'nook_rt')!;
      await agent.get('/admin').set('Accept', 'text/html').expect(200);

      const out = await agent.post('/api/auth/logout?returnTo=/admin/signed-out').expect(302);
      expect(out.headers.location).toBe('/admin/signed-out');
      await http().post('/api/auth/refresh').set('Cookie', `nook_rt=${refresh}`).expect(401);
      await http().get('/admin/signed-out').expect(200); // public page
    });

    it('rejects admin form posts that come from another site', async () => {
      const { callback } = await signIn(ctx, { email: 'victim@example.com' });
      const cookie = `nook_at=${cookieValue(callback, 'nook_at')}`;
      const before = await ctx.prisma.workspace.count();
      await http()
        .post('/admin/workspaces')
        .set('Host', 'nook.test')
        .set('Origin', 'https://evil.example')
        .set('Cookie', cookie)
        .type('form')
        .send({ name: 'Pwned', slug: 'pwned' })
        .expect(403);
      expect(await ctx.prisma.workspace.count()).toBe(before);
      await http()
        .post('/admin/workspaces')
        .set('Host', 'nook.test')
        .set('Origin', 'http://nook.test')
        .set('Cookie', cookie)
        .type('form')
        .send({ name: 'Fine', slug: 'fine' })
        .expect(302);
    });
  });
});
