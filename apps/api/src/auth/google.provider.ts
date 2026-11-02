import { Injectable, ServiceUnavailableException, UnauthorizedException } from '@nestjs/common';
import { env } from '../env.js';
import type { OAuthProfile, OAuthProvider } from './oauth.provider.js';

const AUTH_URL = 'https://accounts.google.com/o/oauth2/v2/auth';
const TOKEN_URL = 'https://oauth2.googleapis.com/token';
const USERINFO_URL = 'https://openidconnect.googleapis.com/v1/userinfo';
const TIMEOUT_MS = 10_000;

@Injectable()
export class GoogleProvider implements OAuthProvider {
  get configured() {
    return Boolean(env.google.clientId && env.google.clientSecret);
  }

  authorizationUrl({
    state,
    codeChallenge,
    redirectUri,
  }: {
    state: string;
    codeChallenge: string;
    redirectUri: string;
  }) {
    this.assertConfigured();
    const url = new URL(AUTH_URL);
    url.search = new URLSearchParams({
      client_id: env.google.clientId!,
      redirect_uri: redirectUri,
      response_type: 'code',
      scope: 'openid email profile',
      state,
      code_challenge: codeChallenge,
      code_challenge_method: 'S256',
      prompt: 'select_account',
    }).toString();
    return url.toString();
  }

  async exchangeCode({
    code,
    codeVerifier,
    redirectUri,
  }: {
    code: string;
    codeVerifier: string;
    redirectUri: string;
  }): Promise<OAuthProfile> {
    this.assertConfigured();
    const tokenResponse = await fetch(TOKEN_URL, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        code,
        client_id: env.google.clientId!,
        client_secret: env.google.clientSecret!,
        redirect_uri: redirectUri,
        grant_type: 'authorization_code',
        code_verifier: codeVerifier,
      }),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    if (!tokenResponse.ok) throw new UnauthorizedException('Google rejected the sign-in code');
    const { access_token: accessToken } = (await tokenResponse.json()) as { access_token?: string };
    if (!accessToken) throw new UnauthorizedException('Google returned no access token');

    const profileResponse = await fetch(USERINFO_URL, {
      headers: { authorization: `Bearer ${accessToken}` },
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    if (!profileResponse.ok) throw new UnauthorizedException('Could not read the Google profile');
    const profile = (await profileResponse.json()) as {
      sub: string;
      email?: string;
      email_verified?: boolean;
      name?: string;
      picture?: string;
    };
    if (!profile.email) throw new UnauthorizedException('The Google account has no e-mail address');
    return {
      subject: profile.sub,
      email: profile.email.toLowerCase(),
      emailVerified: profile.email_verified === true,
      name: profile.name ?? profile.email,
      picture: profile.picture,
    };
  }

  private assertConfigured() {
    if (!this.configured) {
      throw new ServiceUnavailableException(
        'Google sign-in is not configured (GOOGLE_CLIENT_ID / GOOGLE_CLIENT_SECRET)',
      );
    }
  }
}
