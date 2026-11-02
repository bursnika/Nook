import { Injectable } from '@nestjs/common';
import { SignJWT, jwtVerify } from 'jose';
import { env } from '../env.js';
import type { AuthUser } from './auth.types.js';

const ISSUER = 'nook';
const AUDIENCE = 'nook-api';
const key = new TextEncoder().encode(env.jwtSecret);

@Injectable()
export class TokenService {
  signAccessToken(user: { id: string; email: string }): Promise<string> {
    return new SignJWT({ email: user.email })
      .setProtectedHeader({ alg: 'HS256' })
      .setSubject(user.id)
      .setIssuer(ISSUER)
      .setAudience(AUDIENCE)
      .setIssuedAt()
      .setExpirationTime(`${env.accessTokenTtlSeconds}s`)
      .sign(key);
  }

  async verifyAccessToken(token: string): Promise<AuthUser | null> {
    try {
      const { payload } = await jwtVerify(token, key, {
        issuer: ISSUER,
        audience: AUDIENCE,
        algorithms: ['HS256'],
      });
      if (!payload.sub || typeof payload.email !== 'string') return null;
      return {
        id: payload.sub,
        email: payload.email,
        isPlatformAdmin: env.adminEmails.has(payload.email.toLowerCase()),
      };
    } catch {
      return null;
    }
  }
}
