import { Injectable } from '@nestjs/common';
import { unlink } from 'node:fs/promises';
import { basename, join } from 'node:path';
import { env } from '../env.js';

const UPLOAD_PREFIX = '/uploads/';

@Injectable()
export class UploadsService {
  /** Removes a stored file by its public url (`/uploads/<name>`) or bare stored name. Ignores missing files. */
  async remove(urlOrName: string | null | undefined) {
    if (!urlOrName) return;
    if (urlOrName.includes('/') && !urlOrName.startsWith(UPLOAD_PREFIX)) return; // external link, not ours
    await unlink(join(env.uploadDir, basename(urlOrName))).catch(() => undefined);
  }

  urlFor(storedName: string) {
    return `${UPLOAD_PREFIX}${storedName}`;
  }
}
