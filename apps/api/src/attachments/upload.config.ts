import { randomUUID } from 'node:crypto';
import { extname } from 'node:path';
import { UnsupportedMediaTypeException } from '@nestjs/common';
import type { MulterOptions } from '@nestjs/platform-express/multer/interfaces/multer-options.interface.js';
import { FileStorageEngine } from '../uploads/storage-engine.js';
import type { FileStorage } from '../uploads/file-storage.js';

export const MAX_UPLOAD_BYTES = 10 * 1024 * 1024;

// no svg/html, they can carry scripts
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
  fileFilter: (_req, file, cb) => {
    if (ALLOWED_MIME_TYPES[file.mimetype]) return cb(null, true);
    cb(new UnsupportedMediaTypeException(`File type ${file.mimetype} is not allowed`), false);
  },
};

export const storageOptions = (storage: FileStorage): MulterOptions => ({
  storage: new FileStorageEngine(
    storage,
    (file) => `${randomUUID()}${ALLOWED_MIME_TYPES[file.mimetype]}`,
  ),
});

const EXTENSION_TYPES = new Map(
  Object.entries(ALLOWED_MIME_TYPES).map(([mime, extension]) => [extension, mime]),
);

export function mimeTypeOfStoredName(name: string): string {
  const mime = EXTENSION_TYPES.get(extname(name).toLowerCase());
  if (!mime) return 'application/octet-stream';
  return mime.startsWith('text/') ? `${mime}; charset=utf-8` : mime;
}

// multer decodes file names as latin1
export function originalName(file: Express.Multer.File): string {
  const name = Buffer.from(file.originalname, 'latin1').toString('utf8');
  return (name || `file${extname(file.filename)}`).slice(0, 255);
}
