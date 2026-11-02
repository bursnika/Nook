import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { SignJWT } from 'jose';
import { AUTH_DIR, BASE_URL, JWT_SECRET, SEED_FILE } from './env';
import type { Seed } from './seed';

export type Person = 'ann' | 'bob' | 'root';

export const ACCESS_COOKIE = 'nook_at';

export const storageStatePath = (person: Person) => join(AUTH_DIR, `${person}.json`);

const TOKEN_HOURS = 12;

// same claims as TokenService.signAccessToken
export function mintAccessToken(user: { id: string; email: string }): Promise<string> {
  return new SignJWT({ email: user.email })
    .setProtectedHeader({ alg: 'HS256' })
    .setSubject(user.id)
    .setIssuer('nook')
    .setAudience('nook-api')
    .setIssuedAt()
    .setExpirationTime(`${TOKEN_HOURS}h`)
    .sign(new TextEncoder().encode(JWT_SECRET));
}

export async function writeStorageStates(seed: Seed) {
  mkdirSync(AUTH_DIR, { recursive: true });
  const { hostname } = new URL(BASE_URL);
  for (const person of ['ann', 'bob', 'root'] as const) {
    const value = await mintAccessToken(seed.users[person]);
    const state = {
      cookies: [
        {
          name: ACCESS_COOKIE,
          value,
          domain: hostname,
          path: '/',
          expires: Math.floor(Date.now() / 1000) + TOKEN_HOURS * 3600,
          httpOnly: true,
          secure: false,
          sameSite: 'Lax' as const,
        },
      ],
      origins: [],
    };
    writeFileSync(storageStatePath(person), JSON.stringify(state));
  }
  writeFileSync(SEED_FILE, JSON.stringify(seed, null, 2));
}

export function readSeed(): Seed {
  return JSON.parse(readFileSync(SEED_FILE, 'utf8')) as Seed;
}
