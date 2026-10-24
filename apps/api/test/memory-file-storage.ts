import { Readable } from 'node:stream';
import {
  UPLOAD_PREFIX,
  type FileStorage,
  type OpenedFile,
  type PutInput,
  type StoredFile,
} from '../src/uploads/file-storage.js';

/**
 * A storage that keeps files in memory and has no folder to serve, like blob storage: the API has to read
 * every file back through `open`. Calls are recorded so a spec can see what the app asked of it.
 */
export class MemoryFileStorage implements FileStorage {
  readonly kind = 'azure'; // takes the same code path as Azure Blob Storage
  readonly files = new Map<string, { data: Buffer; contentType: string }>();
  readonly calls: { put: string[]; delete: string[]; open: string[] } = {
    put: [],
    delete: [],
    open: [],
  };
  /** When set, `open` fails like an unreachable storage account. */
  openError: Error | null = null;

  async put({ name, data, contentType }: PutInput): Promise<StoredFile> {
    const chunks: Buffer[] = [];
    for await (const chunk of Buffer.isBuffer(data) ? Readable.from([data]) : data) {
      chunks.push(chunk as Buffer);
    }
    const buffer = Buffer.concat(chunks);
    this.calls.put.push(name);
    this.files.set(name, { data: buffer, contentType });
    return { name, url: this.urlFor(name), size: buffer.length };
  }

  async delete(urlOrName: string) {
    const name = urlOrName.split('/').pop() ?? '';
    if (urlOrName.includes('/') && !urlOrName.startsWith(UPLOAD_PREFIX)) return;
    this.calls.delete.push(name);
    this.files.delete(name);
  }

  async open(name: string): Promise<OpenedFile | null> {
    this.calls.open.push(name);
    if (this.openError) throw this.openError;
    const file = this.files.get(name);
    return file ? { stream: Readable.from([file.data]), size: file.data.length } : null;
  }

  urlFor(name: string) {
    return `${UPLOAD_PREFIX}${name}`;
  }
}
