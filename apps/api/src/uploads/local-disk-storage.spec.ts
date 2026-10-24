import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Readable } from 'node:stream';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { LocalDiskStorage } from './local-disk-storage.js';

describe('LocalDiskStorage', () => {
  let dir: string;
  let storage: LocalDiskStorage;
  const NAME = '0b6f4a52-1d2c-4f5e-8a07-3c9d2f1e6b11.txt';

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'nook-local-storage-'));
    storage = new LocalDiskStorage(join(dir, 'nested')); // the folder does not exist yet
  });
  afterEach(() => rmSync(dir, { recursive: true, force: true }));

  it('writes a stream into the folder (created on demand) and counts the bytes', async () => {
    const stored = await storage.put({
      name: NAME,
      data: Readable.from([Buffer.from('abc'), Buffer.from('def')]),
      contentType: 'text/plain',
    });
    expect(stored).toEqual({ name: NAME, url: `/uploads/${NAME}`, size: 6 });
    expect(readFileSync(join(dir, 'nested', NAME), 'utf8')).toBe('abcdef');
    expect(storage.staticRoot).toBe(join(dir, 'nested'));
  });

  it('removes a half-written file when the source stream fails', async () => {
    const broken = new Readable({
      read() {
        this.push(Buffer.from('partial'));
        this.destroy(new Error('connection reset'));
      },
    });
    await expect(
      storage.put({ name: NAME, data: broken, contentType: 'text/plain' }),
    ).rejects.toThrow('connection reset');
    expect(existsSync(join(dir, 'nested', NAME))).toBe(false);
  });

  it('opens a file with its size, and null when it does not exist', async () => {
    await storage.put({ name: NAME, data: Buffer.from('hello'), contentType: 'text/plain' });
    const opened = await storage.open(NAME);
    expect(opened?.size).toBe(5);
    expect(Buffer.concat(await opened!.stream.toArray()).toString()).toBe('hello');
    expect(await storage.open('missing.txt')).toBeNull();
  });

  it('deletes by name or url, ignores missing files and external links', async () => {
    await storage.put({ name: NAME, data: Buffer.from('x'), contentType: 'text/plain' });
    await storage.delete('https://example.com/a.png');
    expect(existsSync(join(dir, 'nested', NAME))).toBe(true);
    await storage.delete(`/uploads/${NAME}`);
    expect(existsSync(join(dir, 'nested', NAME))).toBe(false);
    await expect(storage.delete(NAME)).resolves.toBeUndefined();
  });

  it('cannot be pointed outside its folder', async () => {
    await storage.put({ name: NAME, data: Buffer.from('x'), contentType: 'text/plain' });
    await storage.delete('/uploads/../../../etc/passwd');
    const opened = await storage.open('../' + NAME); // reads <dir>/nested/NAME, never the parent
    expect(opened).not.toBeNull();
    await opened?.stream.toArray(); // drain it before the folder is removed
    expect(existsSync(join(dir, NAME))).toBe(false);
  });
});
