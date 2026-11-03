import js from '@eslint/js';
import tseslint from 'typescript-eslint';

export default tseslint.config(
  { ignores: ['**/node_modules', 'data', 'context_data', 'packages/frontend/dist', 'packages/frontend/test-results', 'packages/frontend/playwright-report'] },
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
  {
    // R1 of docs/agents/17_frontend_model.md: the frontend computes nothing. Money arrives as decimal strings and is only
    // formatted (Intl.NumberFormat on the string, lib/money.ts); no number parsing, no arithmetic helpers, no decimal libs.
    // src/legacy/ (the pre-3.4 pages, removed in step 3.9) is exempt.
    files: ['packages/frontend/src/**/*.{ts,tsx}'],
    ignores: ['packages/frontend/src/legacy/**'],
    rules: {
      'no-restricted-syntax': [
        'error',
        { selector: "CallExpression[callee.name=/^(Number|parseFloat|parseInt)$/]", message: 'R1: the frontend does not convert money to numbers; format the decimal string (lib/money.ts)' },
        { selector: "MemberExpression[object.name='Number']", message: 'R1: no Number.* helpers in the frontend' },
        { selector: "UnaryExpression[operator='+']", message: 'R1: unary plus converts to a number; the frontend computes nothing' },
        { selector: "MemberExpression[object.name='Math']", message: 'R1: no Math.* in the frontend (the backend computes)' },
      ],
      'no-restricted-imports': [
        'error',
        {
          paths: [
            { name: 'decimal.js', message: 'R1: the frontend computes nothing' },
            { name: 'big.js', message: 'R1: the frontend computes nothing' },
            { name: 'bignumber.js', message: 'R1: the frontend computes nothing' },
          ],
        },
      ],
    },
  },
);
