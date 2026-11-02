import type { Express } from 'express';
import { mimeTypeOfStoredName } from '../attachments/upload.config.js';
import {
  STORED_NAME,
  UPLOAD_PREFIX,
  UPLOAD_RESPONSE_HEADERS,
  type FileStorage,
} from './file-storage.js';

export function serveUploadsFromStorage(server: Express, storage: FileStorage) {
  server.get(`${UPLOAD_PREFIX}:name`, async (req, res) => {
    const name = req.params.name;
    if (typeof name !== 'string' || !STORED_NAME.test(name)) {
      res.status(404).end();
      return;
    }
    try {
      const file = await storage.open(name);
      if (!file) {
        res.status(404).end();
        return;
      }
      res.set(UPLOAD_RESPONSE_HEADERS);
      res.type(mimeTypeOfStoredName(name));
      res.set('Cache-Control', 'public, max-age=3600');
      if (file.size !== undefined) res.set('Content-Length', String(file.size));
      file.stream.on('error', () => res.destroy());
      file.stream.pipe(res);
    } catch {
      res.status(502).json({ statusCode: 502, message: 'File storage is unavailable' });
    }
  });
}
