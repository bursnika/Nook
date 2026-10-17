import { decryptToken, encryptToken } from './token-crypto.js';

describe('token-crypto', () => {
  it('round-trips a token', () => {
    const token = '1//0g-some-refresh-token_with.symbols';
    expect(decryptToken(encryptToken(token))).toBe(token);
  });

  it('never stores the plain text and uses a fresh nonce every time', () => {
    const token = 'refresh-token-value';
    const a = encryptToken(token);
    const b = encryptToken(token);
    expect(a).not.toContain(token);
    expect(a).not.toBe(b);
    expect(a.startsWith('v1.')).toBe(true);
  });

  it('detects tampering', () => {
    const [version, iv, tag, encrypted] = encryptToken('secret').split('.');
    const flipped = Buffer.from(encrypted, 'base64url');
    flipped[0] ^= 1;
    expect(() =>
      decryptToken([version, iv, tag, flipped.toString('base64url')].join('.')),
    ).toThrow();
    expect(() =>
      decryptToken([version, iv, 'AAAAAAAAAAAAAAAAAAAAAA', encrypted].join('.')),
    ).toThrow();
  });

  it('rejects unknown formats', () => {
    expect(() => decryptToken('secret')).toThrow('Unsupported');
    expect(() => decryptToken('v2.a.b.c')).toThrow('Unsupported');
  });
});
