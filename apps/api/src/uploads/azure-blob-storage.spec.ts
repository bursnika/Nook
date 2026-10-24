import { Readable } from 'node:stream';
import { describe, expect, it, vi } from 'vitest';
import { AzureBlobStorage, type BlobLike, type ContainerLike } from './azure-blob-storage.js';

/** A fake container: blobs are kept in a Map, and the calls are recorded. */
function fakeContainer() {
  const blobs = new Map<string, { data: Buffer; contentType?: string }>();
  const calls = { createIfNotExists: 0, uploads: [] as string[], deletes: [] as string[] };
  const failures = { create: null as Error | null, delete: null as Error | null };

  const container: ContainerLike = {
    async createIfNotExists() {
      calls.createIfNotExists++;
      if (failures.create) throw failures.create;
      return { succeeded: true };
    },
    getBlockBlobClient(name: string): BlobLike {
      return {
        async uploadStream(stream, _bufferSize, _concurrency, options) {
          const chunks: Buffer[] = [];
          for await (const chunk of stream) chunks.push(chunk as Buffer);
          calls.uploads.push(name);
          blobs.set(name, {
            data: Buffer.concat(chunks),
            contentType: options?.blobHTTPHeaders?.blobContentType,
          });
        },
        async deleteIfExists() {
          if (failures.delete) throw failures.delete;
          calls.deletes.push(name);
          return { succeeded: blobs.delete(name) };
        },
        async download() {
          const blob = blobs.get(name);
          if (!blob) throw Object.assign(new Error('BlobNotFound'), { statusCode: 404 });
          return {
            readableStreamBody: Readable.from([blob.data]),
            contentLength: blob.data.length,
          };
        },
      };
    },
  };
  return { container, blobs, calls, failures };
}

const read = async (stream: Readable) => Buffer.concat(await stream.toArray()).toString();

describe('AzureBlobStorage', () => {
  const NAME = '0b6f4a52-1d2c-4f5e-8a07-3c9d2f1e6b11.png';

  it('uploads a stream with its content type and reports url and size', async () => {
    const { container, blobs, calls } = fakeContainer();
    const storage = new AzureBlobStorage(container);

    const stored = await storage.put({
      name: NAME,
      data: Readable.from([Buffer.from('hello '), Buffer.from('world')]),
      contentType: 'image/png',
    });

    expect(stored).toEqual({ name: NAME, url: `/uploads/${NAME}`, size: 11 });
    expect(calls.uploads).toEqual([NAME]);
    expect(blobs.get(NAME)).toEqual({ data: Buffer.from('hello world'), contentType: 'image/png' });
  });

  it('accepts a buffer as well', async () => {
    const { container, blobs } = fakeContainer();
    const stored = await new AzureBlobStorage(container).put({
      name: NAME,
      data: Buffer.from('abc'),
      contentType: 'text/plain',
    });
    expect(stored.size).toBe(3);
    expect(blobs.get(NAME)?.data.toString()).toBe('abc');
  });

  it('creates the container once, before the first upload', async () => {
    const { container, calls } = fakeContainer();
    const storage = new AzureBlobStorage(container);
    await storage.put({ name: NAME, data: Buffer.from('a'), contentType: 'text/plain' });
    await storage.put({ name: NAME, data: Buffer.from('b'), contentType: 'text/plain' });
    expect(calls.createIfNotExists).toBe(1);
  });

  it('retries creating the container after a failure instead of remembering it', async () => {
    const { container, calls, failures } = fakeContainer();
    const storage = new AzureBlobStorage(container);
    failures.create = new Error('network');
    await expect(
      storage.put({ name: NAME, data: Buffer.from('a'), contentType: 'text/plain' }),
    ).rejects.toThrow('network');
    failures.create = null;
    await storage.put({ name: NAME, data: Buffer.from('a'), contentType: 'text/plain' });
    expect(calls.createIfNotExists).toBe(2);
  });

  it('does not stop the app from starting when Azure is unreachable at boot', async () => {
    const { container, failures } = fakeContainer();
    failures.create = new Error('network');
    await expect(new AzureBlobStorage(container).onModuleInit()).resolves.toBeUndefined();
  });

  it('opens a stored blob as a stream with its size, and answers null for a missing one', async () => {
    const { container } = fakeContainer();
    const storage = new AzureBlobStorage(container);
    await storage.put({ name: NAME, data: Buffer.from('payload'), contentType: 'image/png' });

    const opened = await storage.open(NAME);
    expect(opened?.size).toBe(7);
    expect(await read(opened!.stream)).toBe('payload');
    expect(await storage.open('00000000-0000-4000-8000-000000000000.png')).toBeNull();
  });

  it('rethrows storage errors other than not-found', async () => {
    const { container } = fakeContainer();
    vi.spyOn(container, 'getBlockBlobClient').mockReturnValue({
      uploadStream: vi.fn(),
      deleteIfExists: vi.fn(),
      download: vi.fn().mockRejectedValue(Object.assign(new Error('boom'), { statusCode: 503 })),
    });
    await expect(new AzureBlobStorage(container).open(NAME)).rejects.toThrow('boom');
  });

  it('deletes by stored name or by /uploads url, and leaves external links alone', async () => {
    const { container, blobs, calls } = fakeContainer();
    const storage = new AzureBlobStorage(container);
    const other = '11111111-1111-4111-8111-111111111111.png';
    await storage.put({ name: NAME, data: Buffer.from('a'), contentType: 'image/png' });
    await storage.put({ name: other, data: Buffer.from('b'), contentType: 'image/png' });

    await storage.delete(`/uploads/${NAME}`);
    await storage.delete('https://example.com/cover.png');
    expect(calls.deletes).toEqual([NAME]);
    await storage.delete(other);
    expect(blobs.size).toBe(0);
  });

  it('never fails because a blob could not be deleted', async () => {
    const { container, failures } = fakeContainer();
    failures.delete = new Error('403');
    await expect(new AzureBlobStorage(container).delete(NAME)).resolves.toBeUndefined();
  });

  it('builds the public url as /uploads/<name>, so stored links do not depend on the driver', () => {
    expect(new AzureBlobStorage(fakeContainer().container).urlFor(NAME)).toBe(`/uploads/${NAME}`);
  });
});
