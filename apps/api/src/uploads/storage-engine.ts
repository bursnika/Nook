import type { Request } from 'express';
import type { StorageEngine } from 'multer';
import type { FileStorage } from './file-storage.js';

/**
 * Lets multer hand every accepted file straight to the configured `FileStorage` (no temp file, no
 * buffering of the whole upload), and take it back when the request is rejected afterwards.
 */
export class FileStorageEngine implements StorageEngine {
  constructor(
    private readonly storage: FileStorage,
    private readonly nameFor: (file: Express.Multer.File) => string,
  ) {}

  _handleFile(
    _req: Request,
    file: Express.Multer.File,
    done: (error?: Error | null, info?: Partial<Express.Multer.File>) => void,
  ) {
    const name = this.nameFor(file);
    this.storage
      .put({ name, data: file.stream, contentType: file.mimetype })
      .then(({ size }) => done(null, { filename: name, size }), done);
  }

  _removeFile(_req: Request, file: Express.Multer.File, done: (error: Error | null) => void) {
    this.storage.delete(file.filename).then(() => done(null), done);
  }
}
