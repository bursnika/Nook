import type { CookieOptions, Response } from 'express';
import { env } from '../env.js';

export const ACCESS_COOKIE = 'nook_at';
export const REFRESH_COOKIE = 'nook_rt';
export const OAUTH_STATE_COOKIE = 'nook_oauth_state';
export const OAUTH_VERIFIER_COOKIE = 'nook_oauth_verifier';
export const OAUTH_RETURN_COOKIE = 'nook_oauth_return';
/** Why the flow was started: absent for sign-in, 'calendar' when connecting Google Calendar. */
export const OAUTH_PURPOSE_COOKIE = 'nook_oauth_purpose';

const base = (): CookieOptions => ({
  httpOnly: true, // never readable from JavaScript, so an XSS bug cannot steal the session
  secure: env.cookieSecure,
  sameSite: 'lax', // not sent with cross-site POSTs, which blocks classic CSRF
});

export const REFRESH_PATH = '/api/auth';
export const OAUTH_PATH = '/api/auth';

export function setSessionCookies(
  res: Response,
  tokens: { accessToken: string; refreshToken: string },
) {
  res.cookie(ACCESS_COOKIE, tokens.accessToken, {
    ...base(),
    path: '/',
    maxAge: env.accessTokenTtlSeconds * 1000,
  });
  res.cookie(REFRESH_COOKIE, tokens.refreshToken, {
    ...base(),
    path: REFRESH_PATH, // the long-lived token is only ever sent to the auth endpoints
    maxAge: env.refreshTokenTtlDays * 24 * 60 * 60 * 1000,
  });
}

export function clearSessionCookies(res: Response) {
  res.clearCookie(ACCESS_COOKIE, { ...base(), path: '/' });
  res.clearCookie(REFRESH_COOKIE, { ...base(), path: REFRESH_PATH });
}

export function setOAuthCookies(
  res: Response,
  values: { state: string; verifier: string; returnTo: string; purpose?: 'calendar' },
) {
  const options = { ...base(), path: OAUTH_PATH, maxAge: 10 * 60 * 1000 };
  if (values.purpose) res.cookie(OAUTH_PURPOSE_COOKIE, values.purpose, options);
  res.cookie(OAUTH_STATE_COOKIE, values.state, options);
  res.cookie(OAUTH_VERIFIER_COOKIE, values.verifier, options);
  res.cookie(OAUTH_RETURN_COOKIE, values.returnTo, options);
}

export function clearOAuthCookies(res: Response) {
  for (const name of [
    OAUTH_STATE_COOKIE,
    OAUTH_VERIFIER_COOKIE,
    OAUTH_RETURN_COOKIE,
    OAUTH_PURPOSE_COOKIE,
  ]) {
    res.clearCookie(name, { ...base(), path: OAUTH_PATH });
  }
}

/** Only same-site relative paths are allowed as a post-login destination (prevents open redirects). */
export function safeReturnTo(value: unknown, fallback = '/admin'): string {
  if (typeof value !== 'string') return fallback;
  if (
    !value.startsWith('/') ||
    value.startsWith('//') ||
    value.includes('\\') ||
    /[\r\n]/.test(value)
  ) {
    return fallback;
  }
  return value;
}
