import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { Request } from 'express';
import { ACCESS_COOKIE } from './cookies.js';
import { IS_PUBLIC, PLATFORM_ADMIN_ONLY } from './decorators.js';
import { LoginRedirectException } from './login-redirect.js';
import { TokenService } from './token.service.js';

const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

/** Global guard: every route needs a valid access token unless it is marked @Public(). */
@Injectable()
export class AuthGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly tokens: TokenService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    if (context.getType() !== 'http') return true;
    const targets = [context.getHandler(), context.getClass()];
    if (this.reflector.getAllAndOverride<boolean>(IS_PUBLIC, targets)) return true;

    const req = context.switchToHttp().getRequest<Request>();
    const bearer = req.headers.authorization?.match(/^Bearer\s+(.+)$/i)?.[1];
    const cookie = req.cookies?.[ACCESS_COOKIE] as string | undefined;
    const token = bearer ?? cookie;

    const user = token ? await this.tokens.verifyAccessToken(token) : null;
    if (!user) this.reject(req);

    // A cookie is sent by the browser on its own, so cookie-authenticated writes must come from our own pages.
    if (!bearer && !SAFE_METHODS.has(req.method)) this.assertSameOrigin(req);

    req.user = user!;
    if (
      this.reflector.getAllAndOverride<boolean>(PLATFORM_ADMIN_ONLY, targets) &&
      !user!.isPlatformAdmin
    ) {
      throw new ForbiddenException('This area is only for platform administrators');
    }
    return true;
  }

  private reject(req: Request): never {
    const wantsHtml = req.method === 'GET' && req.headers.accept?.includes('text/html');
    if (wantsHtml && req.path.startsWith('/admin')) {
      throw new LoginRedirectException(
        `/api/auth/google?returnTo=${encodeURIComponent(req.originalUrl)}`,
      );
    }
    throw new UnauthorizedException('Sign in required');
  }

  private assertSameOrigin(req: Request) {
    const origin = req.headers.origin;
    if (origin === undefined) return; // not a browser cross-site request (curl, server-to-server, same-origin form posts of old browsers)
    let host: string | null = null;
    try {
      host = new URL(origin).host;
    } catch {
      // "null" origins (sandboxed frames, some redirects) fall through and are rejected
    }
    if (host !== req.headers.host) throw new ForbiddenException('Cross-origin request blocked');
  }
}
