export interface OAuthProfile {
  subject: string;
  email: string;
  emailVerified: boolean;
  name: string;
  picture?: string;
}

export interface OAuthProvider {
  readonly configured: boolean;
  authorizationUrl(params: { state: string; codeChallenge: string; redirectUri: string }): string;
  exchangeCode(params: {
    code: string;
    codeVerifier: string;
    redirectUri: string;
  }): Promise<OAuthProfile>;
}

export const OAUTH_PROVIDER = Symbol('OAUTH_PROVIDER');
