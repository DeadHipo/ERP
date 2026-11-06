/**
 * Users of the minimal login (D-170), by the administrator:
 *
 *   npx tsx packages/backend/scripts/create-user.ts <login> --org <organization id>   a user of an organization
 *   npx tsx packages/backend/scripts/create-user.ts <login> --system                  a system administrator
 *   npx tsx packages/backend/scripts/create-user.ts <login> --reset-password          a new password
 *   npx tsx packages/backend/scripts/create-user.ts <login> --disable | --enable
 *
 * The password (create, reset) comes from ERP_NEW_PASSWORD or from stdin (one line), never from the command line.
 * Prints the user id, never the password. A taken login or an unknown organization or user ends with exit code 1.
 */
import { createAuthService } from '../src/auth/service';
import { connectStores, resolveOrg, takeOrgArgument } from '../src/connect-sources';
import { AppError } from '../src/shared/errors';

const USAGE =
  'Usage: create-user.ts <login> (--org <id> | --system | --reset-password | --disable | --enable); the password from ERP_NEW_PASSWORD or stdin';

async function readPassword(): Promise<string> {
  const fromEnv = process.env.ERP_NEW_PASSWORD;
  if (fromEnv) return fromEnv;
  if (process.stdin.isTTY) process.stderr.write('Password (one line): ');
  const chunks: Buffer[] = [];
  for await (const chunk of process.stdin) chunks.push(chunk as Buffer);
  const line = Buffer.concat(chunks).toString('utf8').split(/\r?\n/)[0] ?? '';
  if (!line) throw new Error('No password: set ERP_NEW_PASSWORD or pass it on stdin');
  return line;
}

const argv = process.argv;
const org = takeOrgArgument(argv);
const args = argv.slice(2);
const flags = new Set(args.filter((a) => a.startsWith('--')));
const positional = args.filter((a) => !a.startsWith('--'));
const login = positional[0];
const actions = ['--system', '--reset-password', '--disable', '--enable'].filter((f) => flags.has(f));
const unknown = [...flags].filter((f) => !['--system', '--reset-password', '--disable', '--enable'].includes(f));
if (!login || positional.length > 1 || unknown.length || actions.length + (org ? 1 : 0) !== 1) {
  console.error(USAGE);
  process.exit(1);
}

const stores = connectStores();
const auth = createAuthService(stores.db);
let code = 0;
try {
  if (org !== undefined || flags.has('--system')) {
    let orgId: string | undefined;
    if (org !== undefined) {
      const found = await resolveOrg(stores, [org]);
      if (!found.ok) throw new Error(found.message);
      orgId = found.org.id;
    }
    const user = await auth.createUser({
      login,
      password: await readPassword(),
      ...(orgId ? { orgId } : { system: true }),
      createdBy: 'scripts/create-user.ts',
    });
    console.log(user.id);
  } else if (flags.has('--reset-password')) {
    console.log((await auth.resetPassword(login, await readPassword())).id);
  } else {
    console.log((await auth.setDisabled(login, flags.has('--disable'))).id);
  }
} catch (e) {
  console.error(e instanceof AppError ? `${e.code}: ${e.message}` : (e as Error).message);
  code = 1;
} finally {
  await stores.close();
}
process.exit(code);
