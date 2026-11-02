import { basename } from 'node:path';
import { Readable, Transform, type TransformCallback } from 'node:stream';

export const UPLOAD_PREFIX = '/uploads/';

export const UPLOAD_RESPONSE_HEADERS = {
  'X-Content-Type-Options': 'nosniff',
  'Content-Security-Policy': "sandbox; default-src 'none'; img-src 'self'",
} as const;

export interface PutInput {
  name: string;
  data: Buffer | Readable;
  contentType: string;
}

export interface StoredFile {
  name: string;
  url: string;
  size: number;
}

export interface OpenedFile {
  stream: Readable;
  size: number | undefined;
}

export interface FileStorage {
  readonly kind: 'local' | 'azure';
  readonly staticRoot?: string;
  put(input: PutInput): Promise<StoredFile>;
  delete(urlOrName: string): Promise<void>;
  open(name: string): Promise<OpenedFile | null>;
  urlFor(name: string): string;
}

export const FILE_STORAGE = Symbol('FILE_STORAGE');

// <uuid>.<ext>, the only names we produce
export const STORED_NAME =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.[a-z0-9]{2,5}$/;

export function storedNameOf(urlOrName: string): string | null {
  if (urlOrName.includes('/') && !urlOrName.startsWith(UPLOAD_PREFIX)) return null;
  return basename(urlOrName);
}

export const toStream = (data: Buffer | Readable): Readable =>
  Buffer.isBuffer(data) ? Readable.from([data]) : data;

export class ByteCounter extends Transform {
  bytes = 0;

  override _transform(chunk: Buffer, _encoding: BufferEncoding, done: TransformCallback) {
    this.bytes += chunk.length;
    done(null, chunk);
  }
}
