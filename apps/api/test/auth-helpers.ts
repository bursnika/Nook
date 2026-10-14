import type { INestApplication } from '@nestjs/common';
import { SignJWT } from 'jose';
import request, { type Response } from 'supertest';
import type TestAgent from 'supertest/lib/agent.js';
import { TokenService } from '../src/auth/token.service.js';
import type { OAuthProfile } from '../src/auth/oauth.provider.js';
import type { TestApp } from './helpers.js';

export const secretKey = () => new TextEncoder().encode(process.env.JWT_SECRET);

export async function bearer(app: INestApplication, user: { id: string; email: string }) {
  return `Bearer ${await app.get(TokenService).signAccessToken(user)}`;
}

/** A hand-made access token, for testing how the guard treats tokens it should reject. */
export function forgeToken(
  overrides: {
    exp?: number | string;
    aud?: string;
    iss?: string;
    key?: Uint8Array;
    sub?: string;
    email?: string;
  } = {},
) {
  return new SignJWT({ email: overrides.email ?? 'forged@example.com' })
    .setProtectedHeader({ alg: 'HS256' })
    .setSubject(overrides.sub ?? 'someone')
    .setIssuer(overrides.iss ?? 'nook')
    .setAudience(overrides.aud ?? 'nook-api')
    .setIssuedAt()
    .setExpirationTime(overrides.exp ?? '10m')
    .sign(overrides.key ?? secretKey());
}

export function cookieValue(
  res: { headers: Record<string, unknown> },
  name: string,
): string | undefined {
  const cookies = ([] as string[]).concat(
    (res.headers['set-cookie'] as string[] | undefined) ?? [],
  );
  const line = cookies.find((c) => c.startsWith(`${name}=`));
  return line?.split(';')[0].slice(name.length + 1);
}

export function setCookieLine(
  res: { headers: Record<string, unknown> },
  name: string,
): string | undefined {
  return ([] as string[])
    .concat((res.headers['set-cookie'] as string[] | undefined) ?? [])
    .find((c) => c.startsWith(`${name}=`));
}

let counter = 0;

/** Runs the whole Google flow against the fake provider and returns the browser session (cookie jar). */
export async function signIn(
  ctx: TestApp,
  profile: Partial<OAuthProfile> & { email: string },
  returnTo?: string,
): Promise<{ agent: TestAgent; start: Response; callback: Response; state: string; code: string }> {
  const code = `code-${++counter}`;
  ctx.oauth.profiles.set(code, {
    subject: `google-${profile.email}`,
    emailVerified: true,
    name: 'Test Person',
    ...profile,
  });
  const agent = request.agent(ctx.app.getHttpServer());
  const start = await agent.get(
    `/api/auth/google${returnTo ? `?returnTo=${encodeURIComponent(returnTo)}` : ''}`,
  );
  const state = new URL(start.headers.location).searchParams.get('state') ?? '';
  const callback = await agent.get(`/api/auth/google/callback?code=${code}&state=${state}`);
  return { agent, start, callback, state, code };
}
