// How Claude connects to the ERP over MCP (D-177, D-179): one description for the local script
// (`scripts/mcp-erp.ts`) and for the commands of the page P31. Plain strings, no dependency.

const PACKAGE = '@ivotoby/openapi-mcp-server@1.17.0';

/** What Claude is told about the ERP when it connects. One line: it also goes through a shell. */
export const MCP_INSTRUCTIONS = [
  'The royalty ERP of a music label, read only. Every dollar received is split: A = B + C + ours. A: received from Believe (master) and B17 statements (publishing). B: confirmed money of owners. C: money that waits, always with a reason (a document, a mapping, a contract is missing). ours: the share of the label. Answers are recalculated from the report lines, nothing is stored.',
  'An owner is the party who is paid; a pseudonym (artist) belongs to one owner; splits and money are per ISRC. A book is the own label a file was loaded under. In a balance, total.payable is what can be paid today and payout.allowed with payout.reason say whether the button works; period is for reading, not for paying. Advances are recouped from income of the same pseudonym.',
  'Money is an exact decimal string in USD; fields ending in Cents are integer cents. Never round or add money by eye: quote the fields. Months are YYYY-MM. Long lists give 50 rows with total: use limit, offset, and filters. Find ids with get-search first, then ask about one owner or one ISRC: the calculation of a list takes about 10 seconds.',
].join(' ');

/** The command line of the server: only the reads, without the login and the administration. */
export function mcpServerArgs(origin: string): string[] {
  const api = `${origin.replace(/\/+$/, '')}/api/v1`;
  return [
    '-y',
    PACKAGE,
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
  ];
}

/** The environment of the server: the token never goes into its arguments. */
export const mcpServerEnv = (token: string): Record<string, string> => ({
  API_HEADERS: `Authorization:Bearer ${token}`,
  SERVER_INSTRUCTIONS: MCP_INSTRUCTIONS,
});

/** The command that adds the server to Claude Code for the user. */
export function claudeCodeCommand(origin: string, token: string): string {
  const env = Object.entries(mcpServerEnv(token)).map(([k, v]) => `-e '${k}=${v}'`);
  return ['claude mcp add erp --scope user', ...env, '-- npx', ...mcpServerArgs(origin)].join(' ');
}

/** The block of `claude_desktop_config.json`. */
export function claudeDesktopConfig(origin: string, token: string): string {
  const server = { command: 'npx', args: mcpServerArgs(origin), env: mcpServerEnv(token) };
  return JSON.stringify({ mcpServers: { erp: server } }, null, 2);
}
