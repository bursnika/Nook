import { createCipheriv, createDecipheriv, hkdfSync, randomBytes } from 'node:crypto';
import { env } from '../env.js';

// aes-256-gcm, format v1.<iv>.<tag>.<ciphertext> (base64url)
const key = () =>
  Buffer.from(hkdfSync('sha256', env.jwtSecret, 'nook', 'google-refresh-token', 32));

const b64 = (buffer: Buffer) => buffer.toString('base64url');

export function encryptToken(plain: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', key(), iv);
  const encrypted = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()]);
  return ['v1', b64(iv), b64(cipher.getAuthTag()), b64(encrypted)].join('.');
}

export function decryptToken(blob: string): string {
  const [version, iv, tag, encrypted] = blob.split('.');
  if (version !== 'v1' || !iv || !tag || !encrypted) throw new Error('Unsupported token format');
  const decipher = createDecipheriv('aes-256-gcm', key(), Buffer.from(iv, 'base64url'));
  decipher.setAuthTag(Buffer.from(tag, 'base64url'));
  return Buffer.concat([
    decipher.update(Buffer.from(encrypted, 'base64url')),
    decipher.final(),
  ]).toString('utf8');
}
