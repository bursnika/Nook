import { randomUUID } from 'node:crypto';
import { extname } from 'node:path';
import { UnsupportedMediaTypeException } from '@nestjs/common';
import type { MulterOptions } from '@nestjs/platform-express/multer/interfaces/multer-options.interface.js';
import { FileStorageEngine } from '../uploads/storage-engine.js';
import type { FileStorage } from '../uploads/file-storage.js';

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

/** Size and type rules. Where the bytes go is the `FileStorage`'s business (see `storageOptions`). */
export const uploadOptions: MulterOptions = {
  limits: { fileSize: MAX_UPLOAD_BYTES, files: 1 },
  fileFilter: (_req, file, cb) => {
    if (ALLOWED_MIME_TYPES[file.mimetype]) return cb(null, true);
    cb(new UnsupportedMediaTypeException(`File type ${file.mimetype} is not allowed`), false);
  },
};

/** multer's module-wide options: every upload interceptor writes through the configured storage. */
export const storageOptions = (storage: FileStorage): MulterOptions => ({
  // The stored name is random and its extension comes from the checked MIME type, never from the client.
  storage: new FileStorageEngine(
    storage,
    (file) => `${randomUUID()}${ALLOWED_MIME_TYPES[file.mimetype]}`,
  ),
});

const EXTENSION_TYPES = new Map(
  Object.entries(ALLOWED_MIME_TYPES).map(([mime, extension]) => [extension, mime]),
);

/** The content type to serve a stored file with, from its extension (which only we choose). */
export function mimeTypeOfStoredName(name: string): string {
  const mime = EXTENSION_TYPES.get(extname(name).toLowerCase());
  if (!mime) return 'application/octet-stream';
  return mime.startsWith('text/') ? `${mime}; charset=utf-8` : mime;
}

/** multer decodes the client file name as latin1, which garbles Cyrillic names. */
export function originalName(file: Express.Multer.File): string {
  const name = Buffer.from(file.originalname, 'latin1').toString('utf8');
  return (name || `file${extname(file.filename)}`).slice(0, 255);
}
