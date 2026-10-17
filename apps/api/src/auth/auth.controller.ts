import {
  BadRequestException,
  Controller,
  Get,
  HttpCode,
  HttpException,
  Inject,
  Post,
  Query,
  Req,
  Res,
  ServiceUnavailableException,
  UnauthorizedException,
} from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { IsOptional, IsString } from 'class-validator';
import type { Request, Response } from 'express';
import { GoogleCalendarService } from '../google-calendar/google-calendar.service.js';
import { AuthService } from './auth.service.js';
import {
  ACCESS_COOKIE,
  OAUTH_PURPOSE_COOKIE,
  OAUTH_RETURN_COOKIE,
  OAUTH_STATE_COOKIE,
  OAUTH_VERIFIER_COOKIE,
  REFRESH_COOKIE,
  clearOAuthCookies,
  clearSessionCookies,
  safeReturnTo,
  setOAuthCookies,
  setSessionCookies,
} from './cookies.js';
import { CurrentUser, Public } from './decorators.js';
import type { AuthUser } from './auth.types.js';
import { OAUTH_PROVIDER, type OAuthProvider } from './oauth.provider.js';
import { newPkce } from './pkce.js';
import { TokenService } from './token.service.js';
import { env } from '../env.js';

class StartQuery {
  @IsOptional()
  @IsString()
  returnTo?: string;
}

function pickStrings<K extends string>(query: Request['query'], keys: K[]) {
  const result: Partial<Record<K, string>> = {};
  for (const key of keys) {
    const value = query[key];
    if (typeof value === 'string') result[key] = value;
  }
  return result;
}

/** `/admin/workspaces/x` + flash=connected -> `/admin/workspaces/x?flash=connected` */
function withParam(path: string, key: string, value: string) {
  const url = new URL(path, 'http://nook.local');
  url.searchParams.set(key, value);
  return url.pathname + url.search;
}

@ApiTags('auth')
@Controller('auth')
export class AuthController {
  constructor(
    private readonly auth: AuthService,
    private readonly tokens: TokenService,
    private readonly calendar: GoogleCalendarService,
    @Inject(OAUTH_PROVIDER) private readonly oauth: OAuthProvider,
  ) {}

  /** Step 1: send the browser to Google. `state` and the PKCE verifier are kept in short-lived httpOnly cookies. */
  @Public()
  @Get('google')
  start(@Query() { returnTo }: StartQuery, @Res() res: Response) {
    if (!this.oauth.configured)
      throw new ServiceUnavailableException('Google sign-in is not configured');
    const { state, verifier, challenge } = newPkce();
    setOAuthCookies(res, { state, verifier, returnTo: safeReturnTo(returnTo) });
    res.redirect(
      this.oauth.authorizationUrl({
        state,
        codeChallenge: challenge,
        redirectUri: env.google.callbackUrl,
      }),
    );
  }

  /** Step 2: Google sends the browser back with a code. Verify `state`, exchange the code, open a session. */
  @Public()
  @Get('google/callback')
  async callback(@Req() req: Request, @Res() res: Response) {
    // Read straight from the request: Google decides which parameters it appends (iss, scope,
    // authuser, prompt, hd, ...), so the global whitelist validation must not apply here.
    const { code, state, error } = pickStrings(req.query, ['code', 'state', 'error']);
    const expectedState = req.cookies?.[OAUTH_STATE_COOKIE] as string | undefined;
    const verifier = req.cookies?.[OAUTH_VERIFIER_COOKIE] as string | undefined;
    const returnTo = safeReturnTo(req.cookies?.[OAUTH_RETURN_COOKIE]);
    const purpose = req.cookies?.[OAUTH_PURPOSE_COOKIE] as string | undefined;
    clearOAuthCookies(res);

    if (purpose === 'calendar') {
      return this.finishCalendar(req, res, {
        code,
        state,
        error,
        expectedState,
        verifier,
        returnTo,
      });
    }
    if (error) throw new BadRequestException(`Google sign-in was cancelled (${error})`);
    if (!code || !state || !expectedState || !verifier || state !== expectedState) {
      throw new BadRequestException('Invalid or expired sign-in attempt, please start again');
    }

    const profile = await this.oauth.exchangeCode({
      code,
      codeVerifier: verifier,
      redirectUri: env.google.callbackUrl,
    });
    const { tokens } = await this.auth.loginWithProfile(profile, req.headers['user-agent']);
    setSessionCookies(res, tokens);
    res.redirect(returnTo);
  }

  /** The second kind of flow ending here: a signed-in person granting access to their Google Calendar. */
  private async finishCalendar(
    req: Request,
    res: Response,
    flow: {
      code?: string;
      state?: string;
      error?: string;
      expectedState?: string;
      verifier?: string;
      returnTo: string;
    },
  ) {
    const { code, state, error, expectedState, verifier, returnTo } = flow;
    // Who is connecting comes from the session, never from anything the callback URL says.
    const user = await this.tokens.verifyAccessToken(req.cookies?.[ACCESS_COOKIE] ?? '');
    if (!user) throw new UnauthorizedException('Sign in before connecting Google Calendar');
    if (!state || !expectedState || !verifier || state !== expectedState) {
      throw new BadRequestException('Invalid or expired attempt, please start again');
    }

    let granted = false;
    if (!error && code) {
      try {
        ({ granted } = await this.calendar.connect(user.id, {
          code,
          codeVerifier: verifier,
          redirectUri: env.google.callbackUrl,
        }));
      } catch (failure) {
        if (!(failure instanceof HttpException)) throw failure;
      }
    }
    res.redirect(
      granted
        ? withParam(returnTo, 'flash', 'connected')
        : withParam(returnTo, 'problem', 'calendar'),
    );
  }

  /** Rotates the session: needs the refresh cookie, returns a fresh access token (also set as a cookie). */
  @Public()
  @Post('refresh')
  @HttpCode(200)
  async refresh(@Req() req: Request, @Res({ passthrough: true }) res: Response) {
    const tokens = await this.auth.refresh(
      req.cookies?.[REFRESH_COOKIE],
      req.headers['user-agent'],
    );
    setSessionCookies(res, tokens);
    return { accessToken: tokens.accessToken, tokenType: 'Bearer', expiresIn: tokens.expiresIn };
  }

  /**
   * Revokes the refresh token and clears the cookies. The refresh cookie only travels to /api/auth,
   * so every sign-out (including the admin's form) has to come through here. With `returnTo` (a
   * same-site path) a form post gets redirected, otherwise the answer is 204.
   */
  @Public()
  @Post('logout')
  async logout(@Req() req: Request, @Res() res: Response, @Query('returnTo') returnTo?: string) {
    await this.auth.logout(req.cookies?.[REFRESH_COOKIE]);
    clearSessionCookies(res);
    if (returnTo) return res.redirect(safeReturnTo(returnTo));
    return res.status(204).end();
  }

  @Get('me')
  me(@CurrentUser() user: AuthUser) {
    return this.auth.me(user.id);
  }
}
