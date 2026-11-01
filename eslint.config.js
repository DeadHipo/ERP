import js from '@eslint/js';
import tseslint from 'typescript-eslint';

export default tseslint.config(
  { ignores: ['**/node_modules', 'data', 'context_data', 'packages/frontend/dist'] },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    rules: {
      '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_' }],
      // A module may be imported by others only through its index.ts (public service interface).
      'no-restricted-imports': [
        'error',
        { patterns: [{ group: ['**/modules/*/*', '!**/modules/*/index'], message: 'Import a module only via its index.ts' }] },
      ],
    },
  },
  {
    // The modules are async on PostgreSQL (D-121): a call without await is a silent bug (a write that may not
    // happen before the response, an error nobody sees), so the type-aware promise rules are on for the backend.
    files: ['packages/backend/**/*.ts'],
    languageOptions: { parserOptions: { projectService: true, tsconfigRootDir: import.meta.dirname } },
    rules: {
      '@typescript-eslint/no-floating-promises': 'error',
      '@typescript-eslint/await-thenable': 'error',
    },
  },
  {
    files: ['packages/backend/src/modules/**'],
    rules: {
      'no-restricted-imports': [
        'error',
        { patterns: [{ group: ['**/facade/**', '**/api/**'], message: 'Modules do not know about the facade or the API' }] },
      ],
    },
  },
);
