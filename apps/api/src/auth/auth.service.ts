import { Injectable, UnauthorizedException } from '@nestjs/common';
import { createHash, randomBytes } from 'node:crypto';
import { env } from '../env.js';
import { PrismaService } from '../prisma/prisma.service.js';
import type { OAuthProfile } from './oauth.provider.js';
import { TokenService } from './token.service.js';

export interface SessionTokens {
  accessToken: string;
  refreshToken: string;
  expiresIn: number;
}

const sha256 = (value: string) => createHash('sha256').update(value).digest('hex');
const newSecret = () => randomBytes(32).toString('base64url');

const slugify = (text: string) =>
  text
    .normalize('NFKD')
    .replace(/[^\w\s-]/g, '')
    .trim()
    .toLowerCase()
    .replace(/[\s_]+/g, '-')
    .replace(/-+/g, '-')
    .slice(0, 40) || 'space';

@Injectable()
export class AuthService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly tokens: TokenService,
  ) {}

  /**
   * Signs a person in from a verified provider profile. A known Google account signs straight in; an existing user
   * with the same (verified) e-mail gets the Google account linked; anyone else is registered with a personal workspace.
   */
  async loginWithProfile(profile: OAuthProfile, userAgent?: string) {
    if (!profile.emailVerified) {
      throw new UnauthorizedException('The e-mail address of this Google account is not verified');
    }

    let user = await this.prisma.user.findUnique({ where: { googleId: profile.subject } });
    if (!user) {
      const sameEmail = await this.prisma.user.findUnique({ where: { email: profile.email } });
      if (sameEmail?.googleId && sameEmail.googleId !== profile.subject) {
        throw new UnauthorizedException('This e-mail is already linked to another Google account');
      }
      user = sameEmail
        ? await this.prisma.user.update({
            where: { id: sameEmail.id },
            data: { googleId: profile.subject, avatarUrl: sameEmail.avatarUrl ?? profile.picture },
          })
        : await this.register(profile);
    } else if (profile.picture && user.avatarUrl !== profile.picture) {
      user = await this.prisma.user.update({
        where: { id: user.id },
        data: { avatarUrl: profile.picture },
      });
    }

    return { user, tokens: await this.issueTokens(user, userAgent) };
  }

  /** Exchanges a refresh token for a new pair. The old token dies; presenting it again revokes every session. */
  async refresh(rawToken: string | undefined, userAgent?: string): Promise<SessionTokens> {
    if (!rawToken) throw new UnauthorizedException('No refresh token');
    const stored = await this.prisma.refreshToken.findUnique({
      where: { tokenHash: sha256(rawToken) },
      include: { user: true },
    });
    if (!stored) throw new UnauthorizedException('Invalid refresh token');

    // Atomically claim the token; only one caller can win, so a stolen copy cannot be replayed in parallel.
    const claimed = await this.prisma.refreshToken.updateMany({
      where: { id: stored.id, revokedAt: null, expiresAt: { gt: new Date() } },
      data: { revokedAt: new Date() },
    });
    if (claimed.count === 0) {
      if (stored.revokedAt) await this.revokeAll(stored.userId); // reuse of a rotated token: assume theft
      throw new UnauthorizedException('Invalid refresh token');
    }
    return this.issueTokens(stored.user, userAgent);
  }

  async logout(rawToken: string | undefined) {
    if (!rawToken) return;
    await this.prisma.refreshToken.updateMany({
      where: { tokenHash: sha256(rawToken), revokedAt: null },
      data: { revokedAt: new Date() },
    });
  }

  revokeAll(userId: string) {
    return this.prisma.refreshToken.updateMany({
      where: { userId, revokedAt: null },
      data: { revokedAt: new Date() },
    });
  }

  async me(userId: string) {
    const user = await this.prisma.user.findUniqueOrThrow({
      where: { id: userId },
      select: {
        id: true,
        email: true,
        name: true,
        avatarUrl: true,
        memberships: {
          select: {
            id: true,
            role: true,
            workspace: { select: { id: true, name: true, slug: true } },
          },
          orderBy: { id: 'asc' },
        },
      },
    });
    return { ...user, isPlatformAdmin: env.adminEmails.has(user.email.toLowerCase()) };
  }

  async issueTokens(
    user: { id: string; email: string },
    userAgent?: string,
  ): Promise<SessionTokens> {
    const refreshToken = newSecret();
    await this.prisma.refreshToken.create({
      data: {
        tokenHash: sha256(refreshToken),
        userId: user.id,
        userAgent: userAgent?.slice(0, 255),
        expiresAt: new Date(Date.now() + env.refreshTokenTtlDays * 24 * 60 * 60 * 1000),
      },
    });
    return {
      accessToken: await this.tokens.signAccessToken(user),
      refreshToken,
      expiresIn: env.accessTokenTtlSeconds,
    };
  }

  /** First sign-in: create the account together with a personal workspace the user owns. */
  private register(profile: OAuthProfile) {
    const firstName = profile.name.split(' ')[0] || 'My';
    return this.prisma.user.create({
      data: {
        email: profile.email,
        name: profile.name,
        avatarUrl: profile.picture,
        googleId: profile.subject,
        memberships: {
          create: {
            role: 'OWNER',
            workspace: {
              create: {
                name: `${firstName}'s space`,
                slug: `${slugify(firstName)}-${randomBytes(3).toString('hex')}`,
              },
            },
          },
        },
      },
    });
  }
}
