/**
 * D-229: the money of a store as one json, to compare a store before and after the switch of the sublabels
 * (`switch-off-rules.sql`). Read only. Per Believe reconciliation row: A, B, C (by reason), ours (by label of record),
 * the discrepancy; per owner: earned, waiting, payable, payableShown, the gate; per sublabel of the register: its report
 * total. Ids and numbers only. Run it with `DB_DATABASE=<store>`; then `--compare <before.json> <after.json>` prints
 * the differences.
 *
 *   DB_DATABASE=erp_shadow npx tsx packages/backend/scripts/sublabels/shadow-dump.ts <out.json> [--org <id>] [dataDir]
 *   npx tsx packages/backend/scripts/sublabels/shadow-dump.ts --compare <before.json> <after.json>
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { Decimal } from '../../src/shared/money';

type Dump = {
  rows: Record<string, Record<string, string>>;
  owners: Record<string, Record<string, string>>;
  sublabels: Record<string, Record<string, string>>;
  totals: Record<string, string>;
};

const args = process.argv.slice(2);
if (args[0] === '--compare') {
  const [a, b] = [args[1], args[2]].map((p) => JSON.parse(readFileSync(resolve(p as string), 'utf8')) as Dump);
  const diff = (x: string | undefined, y: string | undefined) => new Decimal(y ?? '0').sub(new Decimal(x ?? '0'));
  const section = (name: keyof Omit<Dump, 'totals'>) => {
    const keys = [...new Set([...Object.keys(a![name]), ...Object.keys(b![name])])].sort();
    const out: string[] = [];
    const sums = new Map<string, Decimal>();
    for (const k of keys) {
      const fx = a![name][k] ?? {};
      const fy = b![name][k] ?? {};
      const fields = [...new Set([...Object.keys(fx), ...Object.keys(fy)])].sort();
      const num = (v: string | undefined) => v === undefined || /^-?\d+(\.\d+)?$/.test(v);
      const isNum = (f: string) => num(fx[f]) && num(fy[f]);
      const changed = fields.filter((f) => isNum(f) && !diff(fx[f], fy[f]).isZero());
      const textChanged = fields.filter((f) => !isNum(f) && fx[f] !== fy[f]);
      for (const f of changed) sums.set(f, (sums.get(f) ?? new Decimal(0)).add(diff(fx[f], fy[f])));
      if (changed.length + textChanged.length > 0)
        out.push(`  ${k}: ${[...changed.map((f) => `${f} ${diff(fx[f], fy[f]).toFixed(2)}`), ...textChanged.map((f) => `${f} ${fx[f]} → ${fy[f]}`)].join(', ')}`);
    }
    console.log(`${name}: ${out.length} of ${keys.length} changed; Σ Δ ${[...sums].map(([f, d]) => `${f} ${d.toFixed(2)}`).join(', ') || '0'}`);
    for (const l of out.slice(0, 60)) console.log(l);
    if (out.length > 60) console.log(`  … ${out.length - 60} more`);
  };
  console.log('totals:', Object.keys(b!.totals).map((k) => `${k} ${a!.totals[k]} → ${b!.totals[k]} (Δ ${diff(a!.totals[k], b!.totals[k]).toFixed(2)})`).join('; '));
  section('rows');
  section('owners');
  section('sublabels');
  process.exit(0);
}

const { openFacade } = await import('../../src/facade');
const { connectOrg, takeOrgArgument } = await import('../../src/connect-sources');
const ORG = takeOrgArgument();
const positional = args.filter((x) => !x.startsWith('--'));
const [out, dataDirArg] = positional;
if (!out) {
  console.error('usage: shadow-dump.ts <out.json> [--org <id>] [dataDir] | --compare <before.json> <after.json>');
  process.exit(1);
}
const root = resolve(import.meta.dirname, '..', '..', '..', '..');
const dataDir = resolve(dataDirArg ?? join(root, 'data'));
const stack = await connectOrg({ dataDir, org: ORG });
const f = openFacade({ db: stack.db, orgId: stack.orgId, dataDir, payoutThresholdCents: 5000, sources: stack.sources });
try {
  const dump: Dump = { rows: {}, owners: {}, sublabels: {}, totals: {} };
  const text = (v: unknown): string | null =>
    typeof v === 'string' ? v : v instanceof Decimal || (v && typeof v === 'object' && 'toFixed' in v) ? (v as Decimal).toFixed() : null;
  const rec = await f.reconciliation();
  for (const r of rec as unknown as Record<string, unknown>[]) {
    const key = `${String(r.source)}|${String(r.account)}|${String(r.month ?? r.reportingMonth ?? '')}`;
    const row: Record<string, string> = {};
    for (const [k, v] of Object.entries(r)) {
      const t = text(v);
      if (t !== null && /^-?\d/.test(t) && k !== 'account' && k !== 'month') row[k] = t;
    }
    for (const [reason, v] of Object.entries((r.C_breakdown ?? {}) as Record<string, unknown>)) {
      const t = text(v);
      if (t !== null) row[`C.${reason}`] = t;
    }
    for (const [label, v] of Object.entries((r.ourShareByLabel ?? {}) as Record<string, unknown>)) {
      const t = text(v);
      if (t !== null) row[`ours.${label}`] = t;
    }
    dump.rows[key] = row;
  }
  const sum = (field: string) => Object.values(dump.rows).reduce((s, r) => s.add(new Decimal(r[field] ?? '0')), new Decimal(0)).toFixed();
  for (const k of ['A_received', 'B_notOurs', 'C_waiting', 'ourShare', 'discrepancy']) dump.totals[k] = sum(k);
  const payables = (await f.ownerPayables()) as unknown as { items?: Record<string, unknown>[] } | Record<string, unknown>[];
  const items = Array.isArray(payables) ? payables : (payables.items ?? []);
  for (const o of items) {
    const row: Record<string, string> = {};
    const flat = (prefix: string, v: unknown) => {
      const t = text(v);
      if (t !== null) row[prefix] = t;
      else if (typeof v === 'number' || typeof v === 'boolean') row[prefix] = String(v);
      else if (v && typeof v === 'object' && !Array.isArray(v)) for (const [k, x] of Object.entries(v)) flat(prefix ? `${prefix}.${k}` : k, x);
    };
    flat('', o);
    for (const k of ['id', 'ownerId', 'name', 'calculatedAt']) delete row[k];
    dump.owners[String(o.ownerId ?? o.id)] = row;
  }
  for (const s of await f.listSublabels()) {
    const r = await f.sublabelReport(s.id);
    dump.sublabels[s.id] = { ...r.total, rows: String(r.rows.length) };
  }
  writeFileSync(resolve(out), JSON.stringify(dump));
  console.log(JSON.stringify({ out, rows: Object.keys(dump.rows).length, owners: Object.keys(dump.owners).length, sublabels: Object.keys(dump.sublabels).length, totals: dump.totals }));
} finally {
  await stack.close();
}
