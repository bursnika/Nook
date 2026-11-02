import { createHash, randomBytes } from 'node:crypto';

const base64url = (buffer: Buffer) => buffer.toString('base64url');

export function newPkce() {
  const state = base64url(randomBytes(24));
  const verifier = base64url(randomBytes(48));
  const challenge = base64url(createHash('sha256').update(verifier).digest());
  return { state, verifier, challenge };
}
