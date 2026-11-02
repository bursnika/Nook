import { Inject, Injectable } from '@nestjs/common';
import { FILE_STORAGE, type FileStorage } from './file-storage.js';

@Injectable()
export class UploadsService {
  constructor(@Inject(FILE_STORAGE) private readonly storage: FileStorage) {}

  async remove(urlOrName: string | null | undefined) {
    if (urlOrName) await this.storage.delete(urlOrName);
  }

  urlFor(storedName: string) {
    return this.storage.urlFor(storedName);
  }
}
