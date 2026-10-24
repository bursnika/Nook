import { createReadStream, createWriteStream } from 'node:fs';
import { mkdir, stat, unlink } from 'node:fs/promises';
import { basename, join } from 'node:path';
import { pipeline } from 'node:stream/promises';
import {
  ByteCounter,
  storedNameOf,
  toStream,
  UPLOAD_PREFIX,
  type FileStorage,
  type OpenedFile,
  type PutInput,
  type StoredFile,
} from './file-storage.js';

/** Files in a folder on the API's own disk (a Docker volume in production), served under /uploads. */
export class LocalDiskStorage implements FileStorage {
  readonly kind = 'local';

  constructor(private readonly directory: string) {}

  get staticRoot() {
    return this.directory;
  }

  async put({ name, data }: PutInput): Promise<StoredFile> {
    await mkdir(this.directory, { recursive: true });
    const path = this.pathOf(name);
    const counter = new ByteCounter();
    try {
      await pipeline(toStream(data), counter, createWriteStream(path));
    } catch (error) {
      await unlink(path).catch(() => undefined); // no half-written file is left behind
      throw error;
    }
    return { name, url: this.urlFor(name), size: counter.bytes };
  }

  async delete(urlOrName: string) {
    const name = storedNameOf(urlOrName);
    if (name) await unlink(this.pathOf(name)).catch(() => undefined);
  }

  async open(name: string): Promise<OpenedFile | null> {
    const path = this.pathOf(name);
    const info = await stat(path).catch(() => null);
    if (!info?.isFile()) return null;
    return { stream: createReadStream(path), size: info.size };
  }

  urlFor(name: string) {
    return `${UPLOAD_PREFIX}${name}`;
  }

  /** Only the last path segment counts, so a name can never point outside the folder. */
  private pathOf(name: string) {
    return join(this.directory, basename(name));
  }
}
