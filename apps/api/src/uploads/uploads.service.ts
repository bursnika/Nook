import { Inject, Injectable } from '@nestjs/common';
import { FILE_STORAGE, type FileStorage } from './file-storage.js';

@Injectable()
export class UploadsService {
  constructor(@Inject(FILE_STORAGE) private readonly storage: FileStorage) {}

  /** Removes a stored file by its public url (`/uploads/<name>`) or bare stored name. Ignores missing files. */
  async remove(urlOrName: string | null | undefined) {
    if (urlOrName) await this.storage.delete(urlOrName);
  }

  urlFor(storedName: string) {
    return this.storage.urlFor(storedName);
  }
}
