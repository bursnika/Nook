export interface OAuthProfile {
  /** Stable account id at the provider (Google's `sub`). */
  subject: string;
  email: string;
  emailVerified: boolean;
  name: string;
  picture?: string;
}

/** Everything the login flow needs from an OAuth2 / OpenID Connect identity provider. */
export interface OAuthProvider {
  readonly configured: boolean;
  authorizationUrl(params: { state: string; codeChallenge: string; redirectUri: string }): string;
  exchangeCode(params: {
    code: string;
    codeVerifier: string;
    redirectUri: string;
  }): Promise<OAuthProfile>;
}

/** Injection token, so tests can replace Google with a fake provider. */
export const OAUTH_PROVIDER = Symbol('OAUTH_PROVIDER');
