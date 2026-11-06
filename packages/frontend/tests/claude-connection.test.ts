import { describe, expect, it } from 'vitest';
import { claudeCodeCommand, claudeDesktopConfig, MCP_INSTRUCTIONS, mcpServerArgs } from '@erp/shared/mcp-connection';

// The commands of P31 (D-179): they name the page's own address, read only, and survive a shell.

const ORIGIN = 'https://erp.example.test';

describe('the connection of Claude (D-179)', () => {
  it('opens only the reads, without the login and the administration', () => {
    const args = mcpServerArgs(`${ORIGIN}/`);
    expect(args).toContain(`${ORIGIN}/api/v1`);
    expect(args).toContain(`${ORIGIN}/api/v1/openapi.json`);
    expect(args.join(' ')).toContain('--operation get');
    for (const tag of ['auth', 'orgs', 'users']) expect(args.join(' ')).toContain(`--exclude-tag ${tag}`);
  });

  it('the command keeps the token in the environment and has nothing a shell would break', () => {
    const command = claudeCodeCommand(ORIGIN, 'TOKEN');
    expect(command.startsWith('claude mcp add erp --scope user -e ')).toBe(true);
    expect(command).toContain(`-e 'API_HEADERS=Authorization:Bearer TOKEN'`);
    expect(command.indexOf('TOKEN')).toBeLessThan(command.indexOf(' -- npx'));
    expect(MCP_INSTRUCTIONS).not.toMatch(/['"`$\\\n]/);
  });

  it('the block of the application is valid JSON with the same server', () => {
    const config = JSON.parse(claudeDesktopConfig(ORIGIN, 'TOKEN')) as {
      mcpServers: { erp: { command: string; args: string[]; env: Record<string, string> } };
    };
    expect(config.mcpServers.erp.command).toBe('npx');
    expect(config.mcpServers.erp.args).toEqual(mcpServerArgs(ORIGIN));
    expect(config.mcpServers.erp.env.API_HEADERS).toBe('Authorization:Bearer TOKEN');
  });
});
