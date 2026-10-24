import { basename } from 'node:path';
import { Readable, Transform, type TransformCallback } from 'node:stream';

/** Where the API serves stored files, whichever driver keeps the bytes. */
export const UPLOAD_PREFIX = '/uploads/';

/** What an upload route sends back to the browser's security model: user content never runs in our origin. */
export const UPLOAD_RESPONSE_HEADERS = {
  'X-Content-Type-Options': 'nosniff',
  'Content-Security-Policy': "sandbox; default-src 'none'; img-src 'self'",
} as const;

export interface PutInput {
  /** Stored name, already random and with a checked extension (see upload.config.ts). */
  name: string;
  data: Buffer | Readable;
  contentType: string;
}

export interface StoredFile {
  name: string;
  /** What gets saved in the database and shown to people, e.g. `/uploads/<name>`. */
  url: string;
  size: number;
}

export interface OpenedFile {
  stream: Readable;
  size: number | undefined;
}

/** Where uploaded files live. Drivers: local disk (default) and Azure Blob Storage. */
export interface FileStorage {
  readonly kind: 'local' | 'azure';
  /** A folder the HTTP layer may serve as static files; drivers without one are read through `open`. */
  readonly staticRoot?: string;
  put(input: PutInput): Promise<StoredFile>;
  /** Accepts a stored name or its `/uploads/...` url; links to other sites and missing files are ignored. */
  delete(urlOrName: string): Promise<void>;
  /** The file's bytes, or null when there is no such file. */
  open(name: string): Promise<OpenedFile | null>;
  urlFor(name: string): string;
}

export const FILE_STORAGE = Symbol('FILE_STORAGE');

/** `<uuid>.<ext>`: the only shape upload.config.ts ever produces, so nothing else is read or served. */
export const STORED_NAME =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.[a-z0-9]{2,5}$/;

/** The stored name behind a url or a bare name; null for an external link, which is not ours to delete. */
export function storedNameOf(urlOrName: string): string | null {
  if (urlOrName.includes('/') && !urlOrName.startsWith(UPLOAD_PREFIX)) return null;
  return basename(urlOrName);
}

export const toStream = (data: Buffer | Readable): Readable =>
  Buffer.isBuffer(data) ? Readable.from([data]) : data;

/** Passes bytes through unchanged and remembers how many there were. */
export class ByteCounter extends Transform {
  bytes = 0;

  override _transform(chunk: Buffer, _encoding: BufferEncoding, done: TransformCallback) {
    this.bytes += chunk.length;
    done(null, chunk);
  }
}
