/**
 * The stage loop of `docker-compose.app.stage.yml` (D-209, D-210): the built client and the API on PORT, rebuilt and
 * restarted on change, but not on every save.
 *
 * A change only marks what is stale (the client, the server or both); the work starts once the files have been quiet for
 * STAGE_QUIET_MS (default 5 s) and at least STAGE_MIN_GAP_MS (default 30 s) after the start of the previous run.
 * Changes during a run wait for the next one. The client is built into a temporary directory and copied over dist only
 * when the build succeeds, so the running server keeps the previous build meanwhile; a failed build changes nothing.
 * The server is restarted only for a change of the backend or of shared (and after the first build).
 *
 * Usage (inside the container, from the repo root): npx tsx packages/backend/scripts/stage-watch.ts
 */
import { spawn, type ChildProcess } from 'node:child_process';
import { watch } from 'node:fs';
import { cp, mkdtemp, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

const root = resolve(import.meta.dirname, '..', '..', '..');
const QUIET_MS = Number(process.env.STAGE_QUIET_MS ?? 5000);
const MIN_GAP_MS = Number(process.env.STAGE_MIN_GAP_MS ?? 30000);
const dist = join(root, 'packages', 'frontend', 'dist');
const vite = join(root, 'node_modules', '.bin', 'vite');
const main = join(root, 'packages', 'backend', 'src', 'main.ts');

type Part = 'client' | 'server';
// what a change under each watched path makes stale
const WATCHED: Array<{ path: string; parts: Part[] }> = [
  { path: 'packages/frontend/src', parts: ['client'] },
  { path: 'packages/frontend/index.html', parts: ['client'] },
  { path: 'packages/frontend/vite.config.ts', parts: ['client'] },
  { path: 'packages/shared/src', parts: ['client', 'server'] },
  { path: 'packages/backend/src', parts: ['server'] },
];

const log = (msg: string) => console.log(`${new Date().toISOString().slice(11, 19)} [stage] ${msg}`);

const stale = new Set<Part>();
let lastChange = 0;
let lastRun = 0;
let running = false;
let timer: NodeJS.Timeout | undefined;
let server: ChildProcess | undefined;

function run(cmd: string, args: string[]): Promise<boolean> {
  return new Promise((done) => {
    const child = spawn(cmd, args, { cwd: root, stdio: 'inherit' });
    child.on('exit', (code) => done(code === 0));
    child.on('error', () => done(false));
  });
}

async function buildClient(): Promise<boolean> {
  const out = await mkdtemp(join(tmpdir(), 'stage-dist-'));
  try {
    const t = Date.now();
    const ok = await run(vite, [
      'build',
      '--config',
      'packages/frontend/vite.config.ts',
      '--outDir',
      out,
      '--emptyOutDir',
      '--logLevel',
      'warn',
    ]);
    if (!ok) {
      log('client build failed: the previous build stays');
      return false;
    }
    // dist is a volume (its own mount point): replace its contents, never the directory itself
    for (const entry of await readdir(dist)) await rm(join(dist, entry), { recursive: true, force: true });
    await cp(out, dist, { recursive: true });
    log(`client built in ${Date.now() - t} ms`);
    return true;
  } finally {
    await rm(out, { recursive: true, force: true });
  }
}

async function stopServer(): Promise<void> {
  const child = server;
  if (!child || child.exitCode !== null) return;
  server = undefined;
  await new Promise<void>((done) => {
    child.once('exit', () => done());
    child.kill('SIGTERM');
    setTimeout(() => child.kill('SIGKILL'), 10000).unref();
  });
}

async function startServer(): Promise<void> {
  await stopServer();
  server = spawn(process.execPath, ['--import', 'tsx', main], { cwd: root, stdio: 'inherit' });
  log('server started');
}

async function work(): Promise<void> {
  running = true;
  lastRun = Date.now();
  const parts = new Set(stale);
  stale.clear();
  log(`rebuild: ${[...parts].join(' + ')}`);
  try {
    if (parts.has('client')) await buildClient();
    if (parts.has('server')) await startServer();
  } catch (e) {
    log(`run failed: ${(e as Error).message}`);
  } finally {
    running = false;
    schedule();
  }
}

function schedule(): void {
  if (timer) clearTimeout(timer);
  timer = undefined;
  if (running || stale.size === 0) return;
  const now = Date.now();
  const wait = Math.max(lastChange + QUIET_MS - now, lastRun + MIN_GAP_MS - now, 0);
  timer = setTimeout(() => {
    timer = undefined;
    if (Date.now() - lastChange < QUIET_MS) return schedule(); // a change arrived meanwhile
    void work();
  }, wait);
}

function onChange(parts: Part[], file: string): void {
  const fresh = parts.some((p) => !stale.has(p));
  for (const p of parts) stale.add(p);
  lastChange = Date.now();
  if (fresh && !running) log(`change in ${file}: waiting for ${QUIET_MS / 1000} s of quiet`);
  schedule();
}

for (const { path, parts } of WATCHED) {
  watch(join(root, path), { recursive: true }, (_event, name) =>
    onChange(parts, name ? join(path, name) : path),
  );
}

for (const signal of ['SIGTERM', 'SIGINT'] as const) {
  process.on(signal, () => {
    void stopServer().then(() => process.exit(0));
  });
}

log(`quiet ${QUIET_MS} ms, at most one run per ${MIN_GAP_MS} ms`);
stale.add('client');
stale.add('server');
void work();
