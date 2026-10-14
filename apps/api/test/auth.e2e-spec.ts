import type { INestApplication } from '@nestjs/common';
import { createHash } from 'node:crypto';
import request from 'supertest';
import {
  bearer,
  cookieValue,
  forgeToken,
  secretKey,
  setCookieLine,
  signIn,
} from './auth-helpers.js';
import { createTestApp, resetDb, type TestApp } from './helpers.js';

describe('Authentication', () => {
  let ctx: TestApp;
  let app: INestApplication;

  beforeAll(async () => {
    ctx = await createTestApp({ auth: 'real' });
    app = ctx.app;
  });
  afterAll(() => app.close());
  beforeEach(() => resetDb(ctx.prisma));

  const http = () => request(app.getHttpServer());

  describe('protected routes', () => {
    it('keeps the API closed without a token but leaves health public', async () => {
      await http().get('/api/health').expect(200);
      await http().get('/api/workspaces').expect(401);
      await http().post('/api/workspaces').send({ name: 'x', slug: 'x' }).expect(401);
      await http().get('/api/auth/me').expect(401);
      await http().get('/api/workspaces/019a0000-0000-7000-8000-000000000000/pages').expect(401);
    });

    it('sends a browser that opens the admin to the sign-in flow, and remembers where it was going', async () => {
      const res = await http()
        .get('/admin/workspaces?page=2')
        .set('Accept', 'text/html')
        .expect(302);
      expect(res.headers.location).toBe(
        `/api/auth/google?returnTo=${encodeURIComponent('/admin/workspaces?page=2')}`,
      );
      // a form post cannot be redirected: it simply fails
      await http()
        .post('/admin/workspaces')
        .type('form')
        .send({ name: 'x', slug: 'x' })
        .expect(401);
    });

    it('accepts a valid access token', async () => {
      const user = await ctx.prisma.user.create({ data: { email: 'me@example.com', name: 'Me' } });
      const res = await http()
        .get('/api/auth/me')
        .set('Authorization', await bearer(app, user))
        .expect(200);
      expect(res.body).toMatchObject({
        id: user.id,
        email: 'me@example.com',
        isPlatformAdmin: false,
      });
    });

    it.each([
      ['an expired token', () => forgeToken({ exp: Math.floor(Date.now() / 1000) - 60 })],
      [
        'a token signed with another secret',
        () => forgeToken({ key: new TextEncoder().encode('x'.repeat(48)) }),
      ],
      ['a token for another audience', () => forgeToken({ aud: 'someone-else' })],
      ['a token from another issuer', () => forgeToken({ iss: 'evil' })],
      ['garbage', async () => 'not.a.jwt'],
      [
        'an unsigned token (alg: none)',
        async () => {
          const part = (o: object) => Buffer.from(JSON.stringify(o)).toString('base64url');
          return `${part({ alg: 'none', typ: 'JWT' })}.${part({ sub: 'x', email: 'a@b.co', iss: 'nook', aud: 'nook-api', exp: 9999999999 })}.`;
        },
      ],
    ])('rejects %s', async (_name, make) => {
      await http()
        .get('/api/auth/me')
        .set('Authorization', `Bearer ${await make()}`)
        .expect(401);
    });

    it('rejects a token whose payload was tampered with', async () => {
      const token = await forgeToken({ sub: 'victim', email: 'victim@example.com' });
      const [header, , signature] = token.split('.');
      const payload = Buffer.from(
        JSON.stringify({
          sub: 'admin',
          email: 'platform-admin@example.com',
          iss: 'nook',
          aud: 'nook-api',
          exp: 9999999999,
        }),
      ).toString('base64url');
      await http()
        .get('/api/auth/me')
        .set('Authorization', `Bearer ${header}.${payload}.${signature}`)
        .expect(401);
    });

    it('treats the platform-admin list case-insensitively and only by verified token e-mail', async () => {
      const admin = await ctx.prisma.user.create({
        data: { email: 'Platform-Admin@Example.com', name: 'Admin' },
      });
      const res = await http()
        .get('/api/auth/me')
        .set('Authorization', await bearer(app, admin))
        .expect(200);
      expect(res.body.isPlatformAdmin).toBe(true);
    });
  });

  describe('Google sign-in', () => {
    it('starts the flow with state, a PKCE challenge and httpOnly cookies', async () => {
      const res = await http().get('/api/auth/google').expect(302);
      const location = new URL(res.headers.location);
      expect(location.origin + location.pathname).toBe('https://accounts.example.test/authorize');
      const state = location.searchParams.get('state')!;
      expect(state.length).toBeGreaterThanOrEqual(24);
      expect(location.searchParams.get('code_challenge')).toBeTruthy();

      expect(cookieValue(res, 'nook_oauth_state')).toBe(state);
      for (const name of ['nook_oauth_state', 'nook_oauth_verifier', 'nook_oauth_return']) {
        expect(setCookieLine(res, name)).toMatch(/HttpOnly/);
        expect(setCookieLine(res, name)).toMatch(/SameSite=Lax/);
        expect(setCookieLine(res, name)).toMatch(/Path=\/api\/auth/);
      }
      // the verifier is a secret: it is in the cookie only and the challenge is its hash
      const verifier = cookieValue(res, 'nook_oauth_verifier')!;
      expect(location.searchParams.get('code_challenge')).toBe(
        createHash('sha256').update(verifier).digest('base64url'),
      );
      expect(res.headers.location).not.toContain(verifier);
    });

    it('registers a new user with a personal workspace and opens a session', async () => {
      const { agent, callback } = await signIn(
        ctx,
        {
          email: 'new.person@example.com',
          name: 'Olena Koval',
          picture: 'https://pics.example/o.png',
        },
        '/admin/workspaces',
      );
      expect(callback.status).toBe(302);
      expect(callback.headers.location).toBe('/admin/workspaces');

      expect(setCookieLine(callback, 'nook_at')).toMatch(/HttpOnly/);
      expect(setCookieLine(callback, 'nook_rt')).toMatch(/HttpOnly/);
      expect(setCookieLine(callback, 'nook_rt')).toMatch(/Path=\/api\/auth/); // never sent to ordinary routes
      expect(setCookieLine(callback, 'nook_oauth_state')).toMatch(/Expires=Thu, 01 Jan 1970/); // one-time cookies are cleared

      const me = await agent.get('/api/auth/me').expect(200);
      expect(me.body).toMatchObject({
        email: 'new.person@example.com',
        name: 'Olena Koval',
        avatarUrl: 'https://pics.example/o.png',
      });
      expect(me.body.memberships).toHaveLength(1);
      expect(me.body.memberships[0]).toMatchObject({
        role: 'OWNER',
        workspace: { name: "Olena's space", plan: 'FREE' },
      });
    });

    it('signs the same person in again without creating a second account or workspace', async () => {
      await signIn(ctx, { email: 'again@example.com' });
      const second = await signIn(ctx, { email: 'again@example.com' });
      expect(second.callback.status).toBe(302);
      expect(await ctx.prisma.user.count({ where: { email: 'again@example.com' } })).toBe(1);
      expect(await ctx.prisma.workspace.count()).toBe(1);
    });

    it('links Google to an existing account with the same verified e-mail', async () => {
      const existing = await ctx.prisma.user.create({
        data: { email: 'invited@example.com', name: 'Invited' },
      });
      const { agent } = await signIn(ctx, { email: 'invited@example.com', subject: 'google-123' });
      expect((await agent.get('/api/auth/me').expect(200)).body.id).toBe(existing.id);
      expect(
        (await ctx.prisma.user.findUniqueOrThrow({ where: { id: existing.id } })).googleId,
      ).toBe('google-123');
    });

    it('refuses to attach a different Google account to an e-mail that is already linked', async () => {
      await signIn(ctx, { email: 'owner@example.com', subject: 'google-owner' });
      const attacker = await signIn(ctx, {
        email: 'owner@example.com',
        subject: 'google-attacker',
      });
      expect(attacker.callback.status).toBe(401);
      expect(cookieValue(attacker.callback, 'nook_at')).toBeUndefined();
    });

    it('refuses an unverified e-mail address', async () => {
      const { callback } = await signIn(ctx, {
        email: 'unverified@example.com',
        emailVerified: false,
      });
      expect(callback.status).toBe(401);
      expect(await ctx.prisma.user.count()).toBe(0);
    });

    it('rejects a callback whose state does not match the cookie', async () => {
      const code = 'forged-code';
      ctx.oauth.profiles.set(code, {
        subject: 's',
        email: 'x@example.com',
        emailVerified: true,
        name: 'X',
      });
      const agent = request.agent(app.getHttpServer());
      await agent.get('/api/auth/google').expect(302);
      const res = await agent
        .get(`/api/auth/google/callback?code=${code}&state=attacker-chosen`)
        .expect(400);
      expect(cookieValue(res, 'nook_at')).toBeUndefined();
      expect(await ctx.prisma.user.count()).toBe(0);
    });

    it('rejects a callback that did not start here (no cookies), a replay and a cancelled consent', async () => {
      ctx.oauth.profiles.set('c1', {
        subject: 's',
        email: 'x@example.com',
        emailVerified: true,
        name: 'X',
      });
      await http().get('/api/auth/google/callback?code=c1&state=whatever').expect(400);
      await http().get('/api/auth/google/callback').expect(400);

      const { agent, state } = await signIn(ctx, { email: 'replay@example.com' });
      await agent.get(`/api/auth/google/callback?code=c1&state=${state}`).expect(400); // state cookie was cleared
      const cancelled = request.agent(app.getHttpServer());
      await cancelled.get('/api/auth/google');
      await cancelled.get('/api/auth/google/callback?error=access_denied').expect(400);
    });

    it('turns an unknown or rejected code into 401', async () => {
      const agent = request.agent(app.getHttpServer());
      const start = await agent.get('/api/auth/google');
      const state = new URL(start.headers.location).searchParams.get('state');
      await agent.get(`/api/auth/google/callback?code=never-issued&state=${state}`).expect(401);
    });

    it.each([
      ['//evil.example', '/admin'],
      ['https://evil.example', '/admin'],
      ['/\\evil.example', '/admin'],
      ['javascript:alert(1)', '/admin'],
      ['/admin/pages?x=1', '/admin/pages?x=1'],
    ])('only returns to same-site paths (%s)', async (returnTo, expected) => {
      const { callback } = await signIn(
        ctx,
        { email: `ret${Math.random()}@example.com` },
        returnTo,
      );
      expect(callback.headers.location).toBe(expected);
    });
  });

  describe('sessions', () => {
    const refreshWith = (token: string) =>
      http().post('/api/auth/refresh').set('Cookie', `nook_rt=${token}`);

    it('rotates the refresh token on every use and stores only its hash', async () => {
      const { callback } = await signIn(ctx, { email: 'rot@example.com' });
      const first = cookieValue(callback, 'nook_rt')!;
      const stored = await ctx.prisma.refreshToken.findMany();
      expect(stored).toHaveLength(1);
      expect(stored[0].tokenHash).not.toBe(first);
      expect(stored[0].tokenHash).toBe(createHash('sha256').update(first).digest('hex'));

      const res = await refreshWith(first).expect(200);
      expect(res.body).toMatchObject({ tokenType: 'Bearer', expiresIn: 900 });
      const second = cookieValue(res, 'nook_rt')!;
      expect(second).not.toBe(first);
      await http()
        .get('/api/auth/me')
        .set('Authorization', `Bearer ${res.body.accessToken}`)
        .expect(200);
    });

    it('treats a reused (already rotated) refresh token as theft and ends every session', async () => {
      const { callback } = await signIn(ctx, { email: 'theft@example.com' });
      const stolen = cookieValue(callback, 'nook_rt')!;
      const legit = cookieValue(await refreshWith(stolen).expect(200), 'nook_rt')!;

      await refreshWith(stolen).expect(401); // the thief replays the old token ...
      await refreshWith(legit).expect(401); // ... and the victim's newer token is revoked too
      expect(await ctx.prisma.refreshToken.count({ where: { revokedAt: null } })).toBe(0);
    });

    it('lets only one of two parallel refreshes with the same token succeed', async () => {
      const { callback } = await signIn(ctx, { email: 'race@example.com' });
      const token = cookieValue(callback, 'nook_rt')!;
      const results = await Promise.all([
        refreshWith(token),
        refreshWith(token),
        refreshWith(token),
      ]);
      expect(results.filter((r) => r.status === 200)).toHaveLength(1);
    });

    it('rejects expired, unknown and missing refresh tokens', async () => {
      const { callback } = await signIn(ctx, { email: 'exp@example.com' });
      const token = cookieValue(callback, 'nook_rt')!;
      await ctx.prisma.refreshToken.updateMany({
        data: { expiresAt: new Date(Date.now() - 1000) },
      });
      await refreshWith(token).expect(401);
      await refreshWith('made-up-token').expect(401);
      await http().post('/api/auth/refresh').expect(401);
    });

    it('does not send the refresh cookie to ordinary routes', async () => {
      const { agent } = await signIn(ctx, { email: 'scope@example.com' });
      const sentTo = (path: string) =>
        agent.jar
          .getCookies({ domain: '127.0.0.1', path, secure: false, script: false } as never)
          .map((c) => c.name);

      // positive control: the jar does hand out cookies for these requests, so the check below is not vacuous
      expect(sentTo('/api/workspaces')).toContain('nook_at');
      expect(sentTo('/api/workspaces')).not.toContain('nook_rt');
      expect(sentTo('/api/auth/refresh')).toContain('nook_rt');
    });

    it('logs out: the session cookies are cleared and the refresh token stops working', async () => {
      const { callback } = await signIn(ctx, { email: 'out@example.com' });
      const token = cookieValue(callback, 'nook_rt')!;
      const res = await http()
        .post('/api/auth/logout')
        .set('Cookie', `nook_rt=${token}`)
        .expect(204);
      expect(setCookieLine(res, 'nook_at')).toMatch(/Expires=Thu, 01 Jan 1970/);
      expect(setCookieLine(res, 'nook_rt')).toMatch(/Expires=Thu, 01 Jan 1970/);
      await refreshWith(token).expect(401);
      await http().post('/api/auth/logout').expect(204); // idempotent
    });
  });

  describe('cross-site request forgery', () => {
    it('blocks a cookie-authenticated write that comes from another origin', async () => {
      const { callback } = await signIn(ctx, { email: 'csrf@example.com' });
      const at = cookieValue(callback, 'nook_at')!;
      const post = (origin?: string) => {
        const req = http()
          .post('/api/workspaces')
          .set('Host', 'nook.test')
          .set('Cookie', `nook_at=${at}`)
          .send({ name: 'W', slug: `w-${Math.random().toString(36).slice(2, 8)}` });
        return origin ? req.set('Origin', origin) : req;
      };

      await post('https://evil.example').expect(403);
      await post('null').expect(403);
      await post('http://nook.test').expect(201);
      await post().expect(201); // no Origin: not a browser cross-site request
      expect(await ctx.prisma.workspace.count()).toBe(3); // the personal one + two allowed posts
    });

    it('does not apply the origin check to Bearer tokens, which a browser never attaches by itself', async () => {
      const user = await ctx.prisma.user.create({
        data: { email: 'api@example.com', name: 'Api' },
      });
      await http()
        .post('/api/workspaces')
        .set('Origin', 'https://some-other-app.example')
        .set('Authorization', await bearer(app, user))
        .send({ name: 'W', slug: 'bearer-ok' })
        .expect(201);
    });

    it('lets safe reads through from any origin', async () => {
      const { callback } = await signIn(ctx, { email: 'read@example.com' });
      await http()
        .get('/api/auth/me')
        .set('Origin', 'https://evil.example')
        .set('Cookie', `nook_at=${cookieValue(callback, 'nook_at')}`)
        .expect(200);
    });
  });

  it('keeps secrets out of responses', async () => {
    const { agent, callback } = await signIn(ctx, { email: 'leak@example.com' });
    const me = JSON.stringify((await agent.get('/api/auth/me').expect(200)).body);
    expect(me).not.toContain(cookieValue(callback, 'nook_rt')!);
    expect(me).not.toMatch(/tokenHash|googleId/);
    expect(secretKey().length).toBeGreaterThan(31);
  });
});
