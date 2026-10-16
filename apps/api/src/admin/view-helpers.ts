import type hbs from 'hbs';

const isoDate = (value: unknown) =>
  value ? new Date(value as string).toISOString().slice(0, 10) : '';

/** Small, pure helpers for the Handlebars templates. */
export function registerViewHelpers(engine: typeof hbs) {
  engine.registerHelper('eq', (a: unknown, b: unknown) => a === b);
  engine.registerHelper('date', isoDate);
  engine.registerHelper('iso', (value: unknown) =>
    value ? new Date(value as string).toISOString() : '',
  );
  engine.registerHelper('datetime', (value: unknown) =>
    value ? new Date(value as string).toISOString().replace('T', ' ').slice(0, 16) : '',
  );
  engine.registerHelper(
    'isImage',
    (mime: unknown) => typeof mime === 'string' && mime.startsWith('image/'),
  );
  engine.registerHelper('filesize', (bytes: unknown) => {
    const n = Number(bytes);
    if (!Number.isFinite(n)) return '';
    if (n < 1024) return `${n} B`;
    if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
    return `${(n / 1024 / 1024).toFixed(1)} MB`;
  });
  // concat "a" b "c": builds URLs for the lookup attributes (the last argument is Handlebars' options object)
  engine.registerHelper('concat', (...parts: unknown[]) => parts.slice(0, -1).join(''));
  engine.registerHelper('coverLabel', (url: unknown) =>
    url ? 'Replace the cover' : 'Cover image',
  );
  engine.registerHelper('lower', (value: unknown) => String(value ?? '').toLowerCase());
  engine.registerHelper('nice', (value: unknown) =>
    String(value ?? '')
      .toLowerCase()
      .replace(/_/g, ' '),
  );
}
