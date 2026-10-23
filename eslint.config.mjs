import js from '@eslint/js';
import tseslint from 'typescript-eslint';
import prettier from 'eslint-config-prettier';

export default tseslint.config(
  {
    // widgets/ run inside other apps (Scriptable, Übersicht) with their own globals
    ignores: ['**/dist/**', '**/coverage/**', '**/node_modules/**', 'widgets/**'],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  prettier,
  {
    // the service worker runs in its own global scope
    files: ['apps/web/public/**/*.js'],
    languageOptions: {
      sourceType: 'script',
      globals: {
        self: 'readonly',
        caches: 'readonly',
        fetch: 'readonly',
        URL: 'readonly',
        Promise: 'readonly',
      },
    },
  },
  {
    // plain browser scripts served as-is from apps/api/public
    files: ['apps/api/public/**/*.js'],
    languageOptions: {
      sourceType: 'script',
      globals: { window: 'readonly', document: 'readonly', fetch: 'readonly' },
    },
  },
);
