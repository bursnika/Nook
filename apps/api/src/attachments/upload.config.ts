import { randomUUID } from 'node:crypto';
import { mkdirSync } from 'node:fs';
import { extname } from 'node:path';
import { UnsupportedMediaTypeException } from '@nestjs/common';
import type { MulterOptions } from '@nestjs/platform-express/multer/interfaces/multer-options.interface.js';
import { diskStorage } from 'multer';
import { env } from '../env.js';

export const MAX_UPLOAD_BYTES = 10 * 1024 * 1024;

/** No SVG or HTML on purpose: they can carry scripts. */
export const ALLOWED_MIME_TYPES: Record<string, string> = {
  'image/png': '.png',
  'image/jpeg': '.jpg',
  'image/gif': '.gif',
  'image/webp': '.webp',
  'application/pdf': '.pdf',
  'text/plain': '.txt',
  'text/markdown': '.md',
};

export const uploadOptions: MulterOptions = {
  limits: { fileSize: MAX_UPLOAD_BYTES, files: 1 },
  storage: diskStorage({
    destination: (_req, _file, cb) => {
      mkdirSync(env.uploadDir, { recursive: true });
      cb(null, env.uploadDir);
    },
    // The stored name is random and its extension comes from the checked MIME type, never from the client.
    filename: (_req, file, cb) => cb(null, `${randomUUID()}${ALLOWED_MIME_TYPES[file.mimetype]}`),
  }),
  fileFilter: (_req, file, cb) => {
    if (ALLOWED_MIME_TYPES[file.mimetype]) return cb(null, true);
    cb(new UnsupportedMediaTypeException(`File type ${file.mimetype} is not allowed`), false);
  },
};

/** multer decodes the client file name as latin1, which garbles Cyrillic names. */
export function originalName(file: Express.Multer.File): string {
  const name = Buffer.from(file.originalname, 'latin1').toString('utf8');
  return (name || `file${extname(file.filename)}`).slice(0, 255);
}
