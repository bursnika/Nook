import type { NextFunction, Request, Response } from 'express';

/** Every JSON endpoint takes bodies up to this size, as Express would by default. */
export const JSON_BODY_LIMIT_BYTES = 100 * 1024;
/** The Markdown import takes a text of up to 1 MB; JSON escaping can make the body somewhat bigger. */
export const IMPORT_BODY_LIMIT = '2mb';

const IMPORT_ROUTE = /^\/api\/workspaces\/[^/]+\/pages\/import\/?$/;

/**
 * The JSON parser accepts IMPORT_BODY_LIMIT everywhere (it is one parser for the whole app), so this runs
 * first and keeps the small limit on every route except the import, by the announced size.
 */
export function limitJsonBodies(req: Request, res: Response, next: NextFunction) {
  const size = Number(req.headers['content-length']);
  const isImport = req.method === 'POST' && IMPORT_ROUTE.test(req.path);
  if (size > JSON_BODY_LIMIT_BYTES && !isImport && req.is('application/json')) {
    res.status(413).json({ statusCode: 413, message: 'Payload Too Large' });
    return;
  }
  next();
}
