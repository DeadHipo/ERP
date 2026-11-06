import { describe, expect, it } from 'vitest';
import { claudeCodeCommand, MCP_INSTRUCTIONS, mcpHeader, mcpServerArgs, mcpUrl } from '@erp/shared/mcp-connection';

// The connection of Claude (D-179, D-180): the remote address and header of P31, the read-only local script.

const ORIGIN = 'https://erp.example.test';

describe('the connection of Claude', () => {
  it('names the remote endpoint and sends the token in one header', () => {
    expect(mcpUrl(`${ORIGIN}/`)).toBe(`${ORIGIN}/api/mcp`);
    expect(mcpHeader('TOKEN')).toBe('Authorization: Bearer TOKEN');
    expect(claudeCodeCommand(ORIGIN, 'TOKEN')).toBe(
      `claude mcp add --transport http --scope user erp ${ORIGIN}/api/mcp --header "Authorization: Bearer TOKEN"`,
    );
  });

  it('the local script opens only the reads, without the login and the administration', () => {
    const args = mcpServerArgs(ORIGIN).join(' ');
    expect(args).toContain('--operation get');
    for (const tag of ['auth', 'orgs', 'users']) expect(args).toContain(`--exclude-tag ${tag}`);
    expect(MCP_INSTRUCTIONS).not.toMatch(/\n/);
  });
});
