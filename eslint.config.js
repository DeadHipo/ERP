import js from '@eslint/js';
import tseslint from 'typescript-eslint';

// Names that carry money in the API responses: arithmetic on them in the client is banned (R1).
const MONEY_NAME = '/(amount|net|payable|percent|cents|earned|waiting|paid|recouped|credits|returns)$/i';
const moneyOperand = ['left.name', 'right.name', 'left.property.name', 'right.property.name'].map((x) => `[${x}=${MONEY_NAME}]`).join(',');
const R1 = [
  { id: 'numberCall', selector: "CallExpression[callee.name='Number']", message: 'R1: the frontend does not convert money to numbers; format the decimal string (lib/money.ts)' },
  { id: 'parseFloat', selector: "CallExpression[callee.name='parseFloat']", message: 'R1: the frontend does not parse money; format the decimal string (lib/money.ts)' },
  { id: 'parseInt', selector: "CallExpression[callee.name='parseInt']", message: 'R1: no parseInt in the frontend (paging values: toInt in pages/reference/shared.tsx)' },
  { id: 'numberMember', selector: "MemberExpression[object.name='Number']", message: 'R1: no Number.* helpers in the frontend (Number.parseFloat included)' },
  { id: 'windowParse', selector: "MemberExpression[object.name=/^(window|globalThis)$/][property.name=/^(parseFloat|parseInt)$/]", message: 'R1: no window.parseFloat in the frontend' },
  { id: 'unaryPlus', selector: "UnaryExpression[operator='+']", message: 'R1: unary plus converts to a number; the frontend computes nothing' },
  { id: 'math', selector: "MemberExpression[object.name='Math']", message: 'R1: no Math.* in the frontend (the backend computes)' },
  { id: 'toFixed', selector: "CallExpression[callee.property.name='toFixed']", message: 'R1: no toFixed; lib/money.ts formats the decimal string' },
  { id: 'bigint', selector: "CallExpression[callee.name='BigInt']", message: 'R1: no BigInt on money; the backend computes (a count compared as BigInt needs an override)' },
  { id: 'intl', selector: "MemberExpression[object.name='Intl'][property.name='NumberFormat']", message: 'R1: Intl.NumberFormat only in lib/money.ts (formatMoney)' },
  {
    id: 'arithmetic',
    selector: `BinaryExpression:matches([operator='-'],[operator='*'],[operator='/']):matches(${moneyOperand})`,
    message: 'R1: no arithmetic on money-named values; the API sends the sum',
  },
  {
    id: 'compoundArithmetic',
    selector: `AssignmentExpression:matches([operator='-='],[operator='*='],[operator='/=']):matches([left.name=${MONEY_NAME}],[left.property.name=${MONEY_NAME}])`,
    message: 'R1: no arithmetic on money-named values; the API sends the sum',
  },
];
/** The R1 selectors of `no-restricted-syntax` without the listed ids (an override block for one file lifts them). */
const r1Rules = (except = []) => R1.filter((r) => !except.includes(r.id)).map(({ selector, message }) => ({ selector, message }));

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
    // The client is async (react-query, useAction): a promise nobody awaits is a silent bug, so the type-aware rule is on
    // for src like it is for the backend (D-121).
    files: ['packages/frontend/src/**/*.{ts,tsx}'],
    languageOptions: { parserOptions: { projectService: true, tsconfigRootDir: import.meta.dirname } },
    rules: { '@typescript-eslint/no-floating-promises': 'error' },
  },
  {
    // R1 of docs/agents/17_frontend_model.md: the frontend computes nothing. Money arrives as decimal strings and is only
    // formatted (Intl.NumberFormat on the string, lib/money.ts); no number parsing, no arithmetic on money-named values,
    // no decimal libs. The ids let an override block (below) lift one rule for one file.
    files: ['packages/frontend/src/**/*.{ts,tsx}'],
    rules: {
      'no-restricted-syntax': ['error', ...r1Rules()],
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
  {
    // The one formatter of money: it may hold Intl.NumberFormat (and the helpers a formatter needs).
    files: ['packages/frontend/src/lib/money.ts'],
    rules: { 'no-restricted-syntax': ['error', ...r1Rules(['intl', 'toFixed', 'bigint', 'windowParse'])] },
  },
  {
    // `toInt` parses the digits of a paging value (limit, offset) from the URL, never money: it may use parseInt.
    files: ['packages/frontend/src/pages/reference/shared.tsx'],
    rules: { 'no-restricted-syntax': ['error', ...r1Rules(['parseInt'])] },
  },
  {
    // A line count of a file (`total.keys`) compared as BigInt: a count, never money.
    files: ['packages/frontend/src/pages/reference/sources/SourceLinesPage.tsx'],
    rules: { 'no-restricted-syntax': ['error', ...r1Rules(['bigint'])] },
  },
);
