/**
 * Users and memberships (D-170, D-171), by the administrator:
 *
 *   npx tsx packages/backend/scripts/create-user.ts <login> --org <id> --role org_admin
 *   npx tsx packages/backend/scripts/create-user.ts <login> --org <id> --role label_manager --label <labelId> [--label …]
 *       a new user as a member of the organization, or (the login exists) a new membership of that user
 *   npx tsx packages/backend/scripts/create-user.ts <login> --system                  a system administrator (no membership)
 *   npx tsx packages/backend/scripts/create-user.ts <login> --reset-password          a new password (revokes the sessions)
 *   npx tsx packages/backend/scripts/create-user.ts <login> --disable | --enable       (disabling revokes the sessions)
 *
 * `--role` defaults to org_admin. A label must be an own label of the organization. The password (create, reset) comes
 * from ERP_NEW_PASSWORD or from stdin (one line), never from the command line; an existing user keeps theirs. Prints
 * the user id, never the password. A taken login, an unknown organization, label or user, a second membership in the
 * same organization end with exit code 1.
 */
import { createAuthService, ROLES, type Role } from '../src/auth/service';
import { connectStores, resolveOrg, sourcesFor, takeOrgArgument } from '../src/connect-sources';
import { openFacade } from '../src/facade';
import { assertOwnLabels } from '../src/orgs/service';
import { AppError } from '../src/shared/errors';

const USAGE =
  'Usage: create-user.ts <login> (--org <id> [--role org_admin|label_manager] [--label <id>]… | --system | --reset-password | --disable | --enable); the password from ERP_NEW_PASSWORD or stdin';

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

/** Removes every `--name <value>` / `--name=<value>` from argv and returns the values. */
function takeAll(argv: string[], name: string): string[] {
  const out: string[] = [];
  for (let i = 0; i < argv.length; ) {
    const a = argv[i] as string;
    if (a === name) out.push(argv.splice(i, 2)[1] ?? '');
    else if (a.startsWith(`${name}=`)) out.push((argv.splice(i, 1)[0] as string).slice(name.length + 1));
    else i++;
  }
  return out;
}

const argv = process.argv;
const org = takeOrgArgument(argv);
const roles = takeAll(argv, '--role');
const labelIds = takeAll(argv, '--label');
const args = argv.slice(2);
const flags = new Set(args.filter((a) => a.startsWith('--')));
const positional = args.filter((a) => !a.startsWith('--'));
const login = positional[0];
const ACTIONS = ['--system', '--reset-password', '--disable', '--enable'];
const actions = ACTIONS.filter((f) => flags.has(f));
const unknown = [...flags].filter((f) => !ACTIONS.includes(f));
const role = (roles[0] ?? 'org_admin') as Role;
if (
  !login ||
  positional.length > 1 ||
  unknown.length ||
  actions.length + (org ? 1 : 0) !== 1 ||
  roles.length > 1 ||
  !ROLES.includes(role) ||
  ((roles.length || labelIds.length) && org === undefined) ||
  labelIds.some((l) => l === '')
) {
  console.error(USAGE);
  process.exit(1);
}

const stores = connectStores();
const auth = createAuthService(stores.db);
let code = 0;
try {
  if (org !== undefined) {
    const found = await resolveOrg(stores, [org]);
    if (!found.ok) throw new Error(found.message);
    const orgId = found.org.id;
    if (labelIds.length) {
      const facade = openFacade({
        db: stores.db,
        orgId,
        dataDir: process.env.ERP_DATA_DIR ?? 'data',
        payoutThresholdCents: 0,
        sources: sourcesFor(stores, orgId, process.env.ERP_DATA_DIR ?? 'data'),
      });
      await assertOwnLabels(facade, labelIds);
    }
    const createdBy = 'scripts/create-user.ts';
    if (await auth.findByLogin(login)) {
      console.log((await auth.addMembership({ login, orgId, role, labelIds, createdBy })).id);
    } else {
      const user = await auth.createUser({ login, password: await readPassword(), orgId, role, labelIds, createdBy });
      console.log(user.id);
    }
  } else if (flags.has('--system')) {
    const user = await auth.createUser({
      login,
      password: await readPassword(),
      system: true,
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
