import type { NextFunction, Request, Response } from 'express';

export const JSON_BODY_LIMIT_BYTES = 100 * 1024;
export const IMPORT_BODY_LIMIT = '2mb';

const IMPORT_ROUTE = /^\/api\/workspaces\/[^/]+\/pages\/import\/?$/;

// the json parser allows the import limit everywhere, so check size first
export function limitJsonBodies(req: Request, res: Response, next: NextFunction) {
  const size = Number(req.headers['content-length']);
  const isLarge = req.method === 'POST' && IMPORT_ROUTE.test(req.path);
  if (size > JSON_BODY_LIMIT_BYTES && !isLarge && req.is('application/json')) {
    res.status(413).json({ statusCode: 413, message: 'Payload Too Large' });
    return;
  }
  next();
}
