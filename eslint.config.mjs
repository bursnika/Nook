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
    // plain browser scripts served as-is from apps/api/public
    files: ['apps/api/public/**/*.js'],
    languageOptions: {
      sourceType: 'script',
      globals: { window: 'readonly', document: 'readonly', fetch: 'readonly' },
    },
  },
);
