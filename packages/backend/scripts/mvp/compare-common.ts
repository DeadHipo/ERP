/**
 * Shared by compare-annex.ts and compare-main.ts (stage 5, docs/agents/11_plan.md): the read-only facade bootstrap,
 * Decimal helpers and a markdown writer. Nothing here writes to the database.
 */
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { openFacade } from '../../src/facade';
import { connectSources } from '../../src/connect-sources';
import { calculate, type Calculation } from '../../src/facade/calculation';
import { Decimal, ZERO } from '../../src/shared/money';

export { Decimal, ZERO };
export const ROOT = resolve(import.meta.dirname, '..', '..', '..', '..');
export const MVP = join(ROOT, 'data', 'mvp-load');
export const VERIFY = join(MVP, 'verify');
export const MAIN_ACCOUNT = '1052428';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function readJson<T = any>(path: string): T {
  return JSON.parse(readFileSync(path, 'utf8')) as T;
}

/** `--name value` and `--flag` arguments. */
export function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
}
export const flag = (name: string) => process.argv.includes(`--${name}`);

export async function bootstrap() {
  const dataDir = resolve(process.env.DATA_DIR ?? join(ROOT, 'data', 'real'));
  const stack = connectSources(join(dataDir, 'files', 'sources'));
  const f = openFacade({ db: stack.db, dataDir, payoutThresholdCents: 0, sources: stack.sources });
  const { owners, splits, labels, sources, settlements, publishing } = f.modules;
  const modules = { db: stack.db, owners, splits, labels, sources, publishing };
  return { stack, f, modules, settlements, owners, close: () => stack.close() };
}

export type Boot = Awaited<ReturnType<typeof bootstrap>>;

/** One calculate() with the documents of all operations known (so that operation proofs and bases are classified). */
export async function calculateAll(b: Boot): Promise<{ calc: Calculation; ops: Awaited<ReturnType<Boot['settlements']['allOperations']>> }> {
  const ops = await b.settlements.allOperations();
  const docIds = ops.flatMap((o) => [o.documentId, o.paymentProofId].filter((x): x is string => !!x));
  const calc = await calculate(b.modules, docIds);
  return { calc, ops };
}

export const D = (v: Decimal.Value | null | undefined) => new Decimal(v ?? 0);
export const money = (v: Decimal.Value) => D(v).toFixed(2);
export const absD = (v: Decimal.Value) => D(v).abs();
export function addTo<K>(m: Map<K, Decimal>, k: K, v: Decimal.Value) {
  m.set(k, (m.get(k) ?? ZERO).add(v));
}
export const sum = (xs: Iterable<Decimal.Value>) => {
  let s = ZERO;
  for (const x of xs) s = s.add(x);
  return s;
};

/** Markdown report builder. */
export class Md {
  private lines: string[] = [];
  h(level: number, text: string) {
    this.lines.push('', `${'#'.repeat(level)} ${text}`, '');
    return this;
  }
  p(text: string) {
    this.lines.push(text, '');
    return this;
  }
  table(head: string[], rows: (string | number)[][]) {
    const esc = (c: string | number) => String(c).replace(/\|/g, '\\|').replace(/\n/g, ' ');
    this.lines.push(`| ${head.map(esc).join(' | ')} |`, `|${head.map(() => '---').join('|')}|`);
    for (const r of rows) this.lines.push(`| ${r.map(esc).join(' | ')} |`);
    this.lines.push('');
    return this;
  }
  write(path: string) {
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, this.lines.join('\n') + '\n');
  }
}

export const monthKey = (d: string) => d.slice(0, 7);
