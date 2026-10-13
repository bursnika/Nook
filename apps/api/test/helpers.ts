import {
  type CanActivate,
  type ExecutionContext,
  type INestApplication,
  Injectable,
} from '@nestjs/common';
import { Test } from '@nestjs/testing';
import type { Request } from 'express';
import { AppModule } from '../src/app.module.js';
import { configureApp } from '../src/app.setup.js';
import { AuthGuard } from '../src/auth/auth.guard.js';
import {
  OAUTH_PROVIDER,
  type OAuthProfile,
  type OAuthProvider,
} from '../src/auth/oauth.provider.js';
import { PrismaService } from '../src/prisma/prisma.service.js';

export const PLATFORM_ADMIN_EMAIL = 'platform-admin@example.com';

/**
 * Most e2e specs test business rules, not sign-in, so they run as a platform admin.
 * Specs that test authentication use `createTestApp({ auth: 'real' })` instead.
 */
@Injectable()
class PlatformAdminGuard implements CanActivate {
  constructor(private readonly prisma: PrismaService) {}

  async canActivate(context: ExecutionContext) {
    const user = await this.prisma.user.upsert({
      where: { email: PLATFORM_ADMIN_EMAIL },
      update: {},
      create: { email: PLATFORM_ADMIN_EMAIL, name: 'Platform Admin' },
    });
    context.switchToHttp().getRequest<Request>().user = {
      id: user.id,
      email: user.email,
      isPlatformAdmin: true,
    };
    return true;
  }
}

/** A stand-in for Google: the "code" of the authorization flow is simply the e-mail to sign in as. */
export class FakeOAuthProvider implements OAuthProvider {
  configured = true;
  /** Profiles by code, so a spec can describe exactly who signs in. */
  profiles = new Map<string, OAuthProfile>();
  lastAuthorizationUrl?: URL;

  authorizationUrl({
    state,
    codeChallenge,
    redirectUri,
  }: {
    state: string;
    codeChallenge: string;
    redirectUri: string;
  }) {
    const url = new URL('https://accounts.example.test/authorize');
    url.search = new URLSearchParams({
      state,
      code_challenge: codeChallenge,
      redirect_uri: redirectUri,
    }).toString();
    this.lastAuthorizationUrl = url;
    return url.toString();
  }

  async exchangeCode({ code }: { code: string; codeVerifier: string; redirectUri: string }) {
    const profile = this.profiles.get(code);
    if (!profile) throw new Error('unknown code');
    return profile;
  }
}

export interface TestApp {
  app: INestApplication;
  prisma: PrismaService;
  oauth: FakeOAuthProvider;
}

export async function createTestApp(options: { auth?: 'bypass' | 'real' } = {}): Promise<TestApp> {
  const oauth = new FakeOAuthProvider();
  let builder = Test.createTestingModule({ imports: [AppModule] })
    .overrideProvider(OAUTH_PROVIDER)
    .useValue(oauth);
  if (options.auth !== 'real')
    builder = builder.overrideProvider(AuthGuard).useClass(PlatformAdminGuard);
  const moduleRef = await builder.compile();
  const app = moduleRef.createNestApplication();
  configureApp(app);
  await app.init();
  return { app, prisma: app.get(PrismaService), oauth };
}

/** Empties every table (except Prisma's own bookkeeping) between tests. */
export async function resetDb(prisma: PrismaService) {
  const tables = await prisma.$queryRaw<{ tablename: string }[]>`
    SELECT tablename FROM pg_tables
    WHERE schemaname = 'public' AND tablename <> '_prisma_migrations'`;
  const list = tables.map((t) => `"${t.tablename}"`).join(', ');
  await prisma.$executeRawUnsafe(`TRUNCATE ${list} RESTART IDENTITY CASCADE`);
}

let counter = 0;

/** A workspace with one OWNER member, enough to create pages, tasks and so on. */
export async function seedWorkspace(prisma: PrismaService, label = 'ws') {
  const n = ++counter;
  const user = await prisma.user.create({
    data: { email: `${label}-${n}@example.com`, name: `${label} owner ${n}` },
  });
  const workspace = await prisma.workspace.create({
    data: { name: `${label} ${n}`, slug: `${label}-${n}` },
  });
  await prisma.membership.create({
    data: { userId: user.id, workspaceId: workspace.id, role: 'OWNER' },
  });
  return { user, workspace };
}
