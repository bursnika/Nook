import { safeReturnTo } from './cookies.js';

describe('safeReturnTo', () => {
  it.each(['/admin', '/admin/workspaces?flash=created', '/admin/invite/abc_DEF-123'])(
    'keeps the same-site path %s',
    (path) => expect(safeReturnTo(path)).toBe(path),
  );

  it.each([
    'https://evil.example',
    '//evil.example',
    '/\\evil.example',
    '\\\\evil.example',
    'javascript:alert(1)',
    'admin',
    '',
    '/admin\r\nSet-Cookie: x=1',
    undefined,
    null,
    42,
    ['/admin'],
  ])('falls back for %j', (value) => expect(safeReturnTo(value)).toBe('/admin'));

  it('uses the given fallback', () => expect(safeReturnTo('//x', '/home')).toBe('/home'));
});
