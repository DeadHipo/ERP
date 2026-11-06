#!/usr/bin/env node
// The MCP server of the ERP for Claude in this repository (D-177, recipe 19): the command of `@erp/shared/mcp-connection`
// on the read token of `.env`. The token goes through the environment of the child, never its arguments. ERP_API_URL
// switches the API (default :3000). Somebody without the repository takes the command from the page P31.
import { spawn } from 'node:child_process';
import { join } from 'node:path';
import { mcpServerArgs, mcpServerEnv } from '@erp/shared/mcp-connection';

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

const child = spawn('npx', mcpServerArgs(process.env.ERP_API_URL ?? 'http://localhost:3000'), {
  stdio: 'inherit',
  env: { ...process.env, ...mcpServerEnv(token) },
});
child.on('exit', (code) => process.exit(code ?? 1));
for (const signal of ['SIGINT', 'SIGTERM'] as const) process.on(signal, () => child.kill(signal));
