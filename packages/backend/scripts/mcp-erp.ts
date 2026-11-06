#!/usr/bin/env node
// The MCP server of the ERP for Claude (D-177, recipe 19): @ivotoby/openapi-mcp-server over the read token of `.env`.
// The token goes through the environment of the child, never its arguments. ERP_API_URL switches the API (default :3000).
import { spawn } from 'node:child_process';
import { join } from 'node:path';

try {
  process.loadEnvFile(join(import.meta.dirname, '..', '..', '..', '.env')); // does not override variables already set
} catch {
  // no .env: the variables come from the environment
}

const token = process.env.MCP_READ_TOKEN?.trim();
if (!token) {
  console.error('MCP_READ_TOKEN is not set: add it to .env (openssl rand -hex 32) and restart the API');
  process.exit(1);
}
const INSTRUCTIONS = [
  'The royalty ERP of a music label, read only. Every dollar received is split: A = B + C + ours. A: received from Believe (master) and B17 statements (publishing). B: confirmed money of owners. C: money that waits, always with a reason (a document, a mapping, a contract is missing). ours: the share of the label. Answers are recalculated from the report lines, nothing is stored.',
  'An owner is the party who is paid; a pseudonym (artist) belongs to one owner; splits and money are per ISRC. A book is the own label a file was loaded under. In a balance, total.payable is what can be paid today and payout.allowed with payout.reason say whether the button works; period is for reading, not for paying. Advances are recouped from income of the same pseudonym.',
  'Money is an exact decimal string in USD; fields ending in Cents are integer cents. Never round or add money by eye: quote the fields. Months are YYYY-MM. Long lists give 50 rows with total: use limit, offset, and filters. Find ids with get-search first, then ask about one owner or one ISRC: the calculation of a list takes about 10 seconds.',
].join('\n\n');

const api = (process.env.ERP_API_URL ?? 'http://localhost:3000').replace(/\/+$/, '') + '/api/v1';

const child = spawn(
  'npx',
  [
    '-y',
    '@ivotoby/openapi-mcp-server@1.17.0',
    '--api-base-url',
    api,
    '--openapi-spec',
    `${api}/openapi.json`,
    '--name',
    'erp',
    '--operation',
    'get',
    '--exclude-tag',
    'auth',
    '--exclude-tag',
    'orgs',
    '--exclude-tag',
    'users',
    '--disable-abbreviation',
    'true',
    '--verbose',
    'false',
  ],
  { stdio: 'inherit', env: { ...process.env, API_HEADERS: `Authorization:Bearer ${token}`, SERVER_INSTRUCTIONS: INSTRUCTIONS } },
);
child.on('exit', (code) => process.exit(code ?? 1));
for (const signal of ['SIGINT', 'SIGTERM'] as const) process.on(signal, () => child.kill(signal));
