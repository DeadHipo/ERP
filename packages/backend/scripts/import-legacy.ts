/**
 * Imports reference data from the current ERP database (read-only) into the modules owners, splits and publishing, and
 * reconstructs the July 2026 Believe report and the B17 2026-Q2 statement in their real file formats.
 *
 * Where it writes: the modules live in the PostgreSQL database of <repo>/.env (DB_*, one schema per module, D-121), not
 * in <dataDir>/<module>.sqlite any more. Choose the data set with DB_DATABASE (a fresh database with the migrations of
 * packages/backend/migrations/postgres applied); the script refuses a database that already has owners, tracks or
 * splits. The whole import is one transaction: on any error nothing is written. The sources (Believe registry and
 * ClickHouse lines) are not written. The data directory gets only the reconstructed files (<dataDir>/import) and is the
 * directory of the original files (<dataDir>/files).
 *
 * Why reconstruction: the raw Believe CSVs and B17 statements are not present in context_data/data (only erp.db is).
 * The reconstructed files carry real ISRC/UPC/amounts; names are pseudonymized (no personal data is copied):
 * owners are "Owner of <pseudonym>", writers without a pseudonym are "Writer #<id>".
 *
 * Usage: DB_DATABASE=<db> npx tsx scripts/import-legacy.ts [dataDir]   (default data/demo in the repo root; the
 * directory is recreated)
 */
import { DatabaseSync } from 'node:sqlite';
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import ExcelJS from 'exceljs';
import Decimal from 'decimal.js';
import { openFacade } from '../src/facade';
import { connectSources } from '../src/connect-sources';
import { BELIEVE_COLUMNS } from '../src/modules/sources';
import { normalizeIsrc, normalizeName } from '../src/shared/identifiers';
import { loadImroWriterNames, MAIN_DB_DEFAULT } from './legacy-writers';

const root = resolve(import.meta.dirname, '..', '..', '..');
const ERP_DB = resolve(root, 'context_data', 'data', 'erp', 'data', 'erp.db');
// Usage: [dataDir] [--no-reconstruct]. With --no-reconstruct only reference data is imported; the real reports
// from context_data/ERP_data are then uploaded through the API like any file.
const args = process.argv.slice(2);
const reconstruct = !args.includes('--no-reconstruct');
// --writer-aliases: also import the writer names used in B17 statements (old ERP aliases with source "publishing") as
// owner aliases, so statement writers are matched to their owners (08, question 9). These are legal names: use it only
// for a local, protected data directory, never for a package that is shared.
const writerAliases = args.includes('--writer-aliases');
const dataDir = resolve(args.find((a) => !a.startsWith('--')) ?? join(root, 'data', 'demo'));
const importDir = join(dataDir, 'import');
const MONTH = '2026-07';
const QUARTER = '2026-Q2';
const ISRC_RE = /^[A-Z]{2}[A-Z0-9]{3}\d{7}$/;

// The sources module is not used here (the reports are only written to files and loaded through the API), but the
// facade needs it: it connects to PostgreSQL and ClickHouse (docker compose up -d).
const stack = connectSources(join(dataDir, 'files', 'sources'));
const { db } = stack;
const f = openFacade({ db, dataDir, payoutThresholdCents: 10000, sources: stack.sources });
const { owners, splits, publishing } = f.modules;

// The old script recreated the module files; a PostgreSQL database is never wiped here: it must be empty.
const existing = {
  owners: (await owners.listOwners()).length,
  tracks: (await owners.listTracks()).length,
  splits: (await splits.listSplits()).length,
};
if (Object.values(existing).some((n) => n > 0)) {
  console.error(
    `import-legacy: the database "${process.env.DB_DATABASE}" is not empty (${JSON.stringify(existing)}); ` +
      'use a fresh database (DB_DATABASE) with the migrations applied',
  );
  await stack.close();
  process.exit(1);
}

rmSync(dataDir, { recursive: true, force: true });
mkdirSync(importDir, { recursive: true });

const erp = new DatabaseSync(ERP_DB, { readOnly: true });
const all = <T>(sql: string, ...params: (string | number)[]) => erp.prepare(sql).all(...params) as T[];
const stats: Record<string, number> = {};
const bump = (k: string, n = 1) => (stats[k] = (stats[k] ?? 0) + n);

// ---------- parties -> owners and artists ----------
type Party = { id: number; kind: string; name: string; is_house: number };
const parties = new Map(all<Party>('SELECT id, kind, name, is_house FROM party').map((p) => [p.id, p]));
const house = new Set([...parties.values()].filter((p) => p.is_house === 1).map((p) => p.id));
// Writer legal names from the old IMRO registry, by pseudonym (party name or any alias): only with --writer-aliases.
const imroNames = writerAliases
  ? loadImroWriterNames(resolve(root, 'context_data', MAIN_DB_DEFAULT))
  : new Map<string, string[]>();
const writerNamesOfParty = (pid: number): string[] => {
  if (imroNames.size === 0) return [];
  const p = parties.get(pid);
  const keys = new Set(
    [
      p?.name ?? '',
      ...all<{ alias: string }>('SELECT alias FROM alias WHERE party_id = ?', pid).map((a) => a.alias),
    ].map((n) => normalizeName(n)),
  );
  return [...new Set([...keys].flatMap((k) => imroNames.get(k) ?? []))];
};
const splitParties = new Set(
  all<{ party_id: number }>(
    `SELECT DISTINCT sl.party_id FROM split_line sl JOIN split_version v ON v.id = sl.version_id AND v.is_current = 1`,
  )
    .map((r) => r.party_id)
    .filter((id) => !house.has(id)),
);
const pubParties = new Set(
  all<{ party_id: number }>(
    // every writer with B17 accruals in any quarter (all statements are loaded, not only 2026-Q2)
    `SELECT DISTINCT party_id FROM accrual WHERE stream='publishing' AND source LIKE 'b17:%'`,
  )
    .map((r) => r.party_id)
    .filter((id) => !house.has(id)),
);
const withContract = new Set(
  all<{ party_id: number }>('SELECT DISTINCT party_id FROM contract WHERE party_id IS NOT NULL').map(
    (r) => r.party_id,
  ),
);

// Parties paid through one payment account are one owner (the old ERP has no owner entity).
const payeeOf = new Map<number, string>();
for (const r of all<{ party_id: number; ext_id: string }>(
  'SELECT party_id, ext_id FROM payee WHERE ext_id IS NOT NULL AND party_id IS NOT NULL',
)) {
  if (!payeeOf.has(r.party_id)) payeeOf.set(r.party_id, r.ext_id);
}
const groupKey = (pid: number) => (payeeOf.has(pid) ? `payee:${payeeOf.get(pid)}` : `party:${pid}`);
const groups = new Map<string, number[]>();
for (const pid of [...splitParties, ...pubParties]) {
  const k = groupKey(pid);
  const list = groups.get(k) ?? [];
  if (!list.includes(pid)) list.push(pid);
  groups.set(k, list);
}

const artistOfParty = new Map<number, string>();
const ownerOfParty = new Map<number, string>();
const ownerName = new Map<string, string>();
const migrationApprove = (id: string) => owners.approveDocument(id, 'migration');
/**
 * Runs one write that may fail on its own (a known track, a split change, publishing terms) inside a savepoint: the old
 * SQLite code had one transaction per call, so a failed call left nothing behind; inside the import transaction a
 * failed call must not leave partial writes or abort the transaction.
 */
let savepoints = 0;
async function attempt<T>(fn: () => Promise<T>): Promise<T> {
  const name = `import_step_${++savepoints}`;
  await db.query(`SAVEPOINT ${name}`);
  try {
    const result = await fn();
    await db.query(`RELEASE SAVEPOINT ${name}`);
    return result;
  } catch (e) {
    await db.query(`ROLLBACK TO SAVEPOINT ${name}`);
    throw e;
  }
}

await db.transaction(async () => {
  for (const [, pids] of groups) {
    const masterPids = pids.filter((p) => splitParties.has(p));
    const named = (masterPids.length ? masterPids : pids).map((p) => parties.get(p) as Party);
    // A writer without a master pseudonym gets a synthetic name: its party name may be a legal name.
    const display = masterPids.length
      ? `Owner of ${named
          .map((p) => p.name)
          .slice(0, 3)
          .join(', ')}`
      : `Writer #${named[0]?.id}`;
    const kind = named.some((p) => p.kind === 'label') ? 'label' : 'person';
    const owner = await owners.createOwner({
      name: display,
      kind,
      origin: `legacy-erp:parties:${pids.join(',')}`,
    });
    ownerName.set(owner.id, display);
    if (writerAliases) {
      for (const pid of pids) {
        for (const name of writerNamesOfParty(pid)) {
          await owners.addOwnerAlias(owner.id, name);
          bump('writer_aliases');
        }
      }
    }
    bump('owners');
    const artistIds: string[] = [];
    for (const pid of masterPids) {
      const p = parties.get(pid) as Party;
      const a = await owners.createArtist({
        pseudonym: p.name,
        ownerId: owner.id,
        origin: `legacy-erp:party:${pid}`,
      });
      artistOfParty.set(pid, a.id);
      artistIds.push(a.id);
      bump('artists');
    }
    for (const pid of pids) ownerOfParty.set(pid, owner.id);
    // Contract registry of the old ERP -> an approved contract document (migration: confirmed by the superadmin).
    if (pids.some((p) => withContract.has(p))) {
      const doc = await owners.createDocument({
        kind: 'contract',
        title: `Legacy contract register (${display})`,
        fileRef: `legacy-erp:contract/party-${pids.join('-')}`,
        ownerId: owner.id,
        requiresApproval: true,
        migration: true,
      });
      await migrationApprove(doc.id);
      await owners.createContract({
        ownerId: owner.id,
        documentId: doc.id,
        artistIds: artistIds.filter((_, i) => withContract.has(masterPids[i] as number)),
      });
      bump('owners_confirmed');
      // Publishing terms: the usual 50/50 from the contract.
      if (pids.some((p) => pubParties.has(p))) {
        await publishing.setTerms({
          ownerId: owner.id,
          percent: '50',
          validFrom: '2000-01-01',
          documentId: doc.id,
        });
        bump('publishing_terms');
      }
    }
  }

  // ---------- tracks (ISRC + UPC) ----------
  const trackRows = all<{ isrc: string; upc: string | null; title: string | null }>(
    'SELECT isrc, upc, title FROM track',
  );
  const trackOfIsrc = new Map<string, string>();
  for (const t of trackRows) {
    const isrc = normalizeIsrc(t.isrc);
    if (!ISRC_RE.test(isrc)) {
      bump('tracks_skipped_not_isrc');
      continue;
    }
    const tr = await owners.createTrack({ title: t.title ?? isrc, isrc, upc: t.upc });
    trackOfIsrc.set(isrc, tr.id);
    bump('tracks');
  }

  // Second catalogue source: the Zero catalogue (track_meta, synced from Backstage) has the other releases (UPC) of an
  // ISRC, e.g. the album version of a single. Pairs already known are skipped; nothing comes from the reports themselves.
  for (const t of all<{ isrc: string; upc: string | null; title: string | null }>(
    'SELECT isrc, upc, title FROM track_meta WHERE upc IS NOT NULL',
  )) {
    const isrc = normalizeIsrc(t.isrc);
    const upc = (t.upc ?? '').replace(/\D/g, '');
    if (!ISRC_RE.test(isrc) || !upc) continue;
    try {
      await attempt(() => owners.createTrack({ title: t.title ?? isrc, isrc, upc }));
      bump('tracks_from_zero_catalog');
    } catch {
      // pair already known
    }
  }

  // ---------- splits (current Backstage version, house share excluded = our remainder) ----------
  const exceptions = new Set(
    all<{ isrc: string }>('SELECT isrc FROM split_exception').map((r) => normalizeIsrc(r.isrc)),
  );
  const lines = all<{ isrc: string; party_id: number; rate_x: string | null; rate: number }>(
    `SELECT sl.isrc, sl.party_id, sl.rate_x, sl.rate FROM split_line sl JOIN split_version v ON v.id = sl.version_id AND v.is_current = 1 ORDER BY sl.isrc`,
  );
  const byIsrc = new Map<string, { party: number; rate: string }[]>();
  for (const l of lines) {
    if (house.has(l.party_id)) continue;
    const isrc = normalizeIsrc(l.isrc);
    const list = byIsrc.get(isrc) ?? [];
    list.push({ party: l.party_id, rate: l.rate_x ?? String(l.rate) });
    byIsrc.set(isrc, list);
  }
  const appendix = await owners.createDocument({
    kind: 'appendix',
    title: 'Legacy split register (Backstage export 2026-08-14)',
    fileRef: 'legacy-erp:split_version/1',
    requiresApproval: true,
    migration: true,
  });
  await migrationApprove(appendix.id);
  for (const [isrc, shares] of byIsrc) {
    if (!ISRC_RE.test(isrc)) {
      bump('splits_skipped_not_isrc');
      continue;
    }
    if (exceptions.has(isrc)) {
      bump('splits_skipped_exception');
      continue;
    }
    // A split counts as confirmed by an appendix when every participant with a share has a contract in the old registry.
    const confirmed = shares.every((s) => new Decimal(s.rate).isZero() || withContract.has(s.party));
    await splits.createSplit({
      isrc,
      validFrom: '2000-01-01',
      shares: shares.map((s) => ({
        artistId: artistOfParty.get(s.party) as string,
        percent: new Decimal(s.rate).toFixed(),
      })),
      documentId: confirmed ? appendix.id : null,
      origin: 'legacy-erp',
    });
    bump(confirmed ? 'splits_confirmed' : 'splits_unconfirmed');
    const trackId = trackOfIsrc.get(isrc);
    if (trackId)
      for (const s of shares)
        if (!new Decimal(s.rate).isZero())
          await owners.linkArtistTrack(artistOfParty.get(s.party) as string, trackId);
  }

  // ---------- buyouts: split change of the seller from the effective date, confirmed by a buyout document ----------
  const buyouts = all<{ id: number; effective: string; seller_id: number }>(
    'SELECT id, effective, seller_id FROM buyout ORDER BY effective',
  );
  for (const b of buyouts) {
    const seller = artistOfParty.get(b.seller_id);
    const items = all<{ isrc: string; seller_pct_x: string | null; seller_pct: number | null }>(
      'SELECT isrc, seller_pct_x, seller_pct FROM buyout_track WHERE buyout_id = ?',
      b.id,
    );
    if (!seller || items.length === 0) {
      bump('buyouts_skipped');
      continue;
    }
    const doc = await owners.createDocument({
      kind: 'buyout',
      title: `Legacy buyout #${b.id}`,
      fileRef: `legacy-erp:buyout/${b.id}`,
      ownerId: ownerOfParty.get(b.seller_id) ?? null,
      requiresApproval: true,
      migration: true,
    });
    await migrationApprove(doc.id);
    for (const it of items) {
      const isrc = normalizeIsrc(it.isrc);
      const current = await splits.splitAt(isrc, b.effective);
      const share = current?.shares.find((s) => s.artistId === seller);
      if (!current || !share) {
        bump('buyout_tracks_without_seller_share');
        continue;
      }
      const pct = new Decimal(it.seller_pct_x ?? String(it.seller_pct ?? 100));
      const moved = pct.gte(100) ? share.percent : Decimal.min(share.percent, pct);
      try {
        await attempt(() =>
          f.changeSplit({
            isrc,
            from: b.effective,
            shares: current.shares.map((s) => ({
              artistId: s.artistId,
              percent: (s.artistId === seller ? s.percent.sub(moved) : s.percent).toFixed(),
            })),
            documentId: doc.id,
            note: `buyout #${b.id}`,
          }),
        );
        bump('buyout_split_changes');
      } catch (e) {
        bump('buyout_changes_failed');
        if (stats['buyout_changes_failed'] === 1) console.warn('buyout change failed:', (e as Error).message);
      }
    }
    // Publishing buyout: the seller's author share becomes 0 from the effective date (open question 08/6, 99/12).
    const sellerOwner = ownerOfParty.get(b.seller_id);
    if (sellerOwner && pubParties.has(b.seller_id) && (await publishing.termsOf([sellerOwner])).length > 0) {
      try {
        await attempt(() =>
          publishing.setTerms({
            ownerId: sellerOwner,
            percent: '0',
            validFrom: b.effective,
            documentId: doc.id,
          }),
        );
        bump('publishing_buyouts');
      } catch {
        bump('publishing_buyouts_failed');
      }
    }
  }
});

if (!reconstruct) {
  await stack.close();
  erp.close();
  console.log(JSON.stringify({ dataDir, reconstructed: false, stats }, null, 2));
  process.exit(0);
}

// ---------- reconstructed July 2026 Believe report ----------
const q = (v: string) => `"${v.replace(/"/g, '""')}"`;
const revenue = all<{
  isrc: string;
  net_x: string;
  upc: string | null;
  title: string | null;
  release: string | null;
}>(
  `SELECT r.isrc, r.net_x, t.upc, t.title, t.release FROM revenue r LEFT JOIN track t ON t.isrc = r.isrc WHERE r.source='believe' AND r.month = ? ORDER BY r.isrc`,
  MONTH,
);
const out: string[] = [BELIEVE_COLUMNS.map(q).join(';')];
let total = new Decimal(0);
for (const r of revenue) {
  const isrc = r.isrc.startsWith('NOISRC') ? '' : normalizeIsrc(r.isrc);
  const rec: Record<string, string> = {
    'Reporting month': '2026/07/01',
    'Sales Month': '2026/07/01',
    Platform: 'RECONSTRUCTED_FROM_ERP_DB',
    'Country / Region': 'ALL',
    'Label Name': '',
    'Artist Name': '',
    'Release title': r.release ?? '',
    'Track title': isrc ? (r.title ?? '') : '',
    UPC: r.upc ?? '',
    ISRC: isrc,
    'Release Catalog nb': '',
    'Streaming Subscription Type': 'ALL',
    'Release type': 'Music Release',
    'Sales Type': isrc ? 'Stream' : 'Download',
    Quantity: '0',
    'Client Payment Currency': 'USD',
    'Unit Price': '',
    'Mechanical Fee': '',
    'Gross Revenue': r.net_x,
    'Client share rate': '',
    'Net Revenue': r.net_x,
  };
  total = total.add(r.net_x);
  out.push(BELIEVE_COLUMNS.map((c) => q(rec[c] ?? '')).join(';'));
}
// Same report id and account as the original July file listed in the archive manifest.
const believeName = '2152271_1052428_2026-07-01_2026-07-01.csv';
writeFileSync(join(importDir, believeName), '﻿' + out.join('\r\n') + '\r\n');

// ---------- reconstructed B17 2026-Q2 statement ----------
// The old engine paid writers net/2 of a line; a line of the new statement carries Total Payable = 2 x writer amount
// (100% for lines that had no publisher half: bought_track, review, share_error). Publisher-half rows are implied.
const pubRows = all<{
  party_id: number;
  isrc: string;
  amount_x: string | null;
  amount: number;
  rule: string;
  from_party: number | null;
}>(
  `SELECT party_id, isrc, amount_x, amount, rule, from_party FROM accrual WHERE stream='publishing' AND period=? AND source LIKE 'b17:%' AND rule NOT LIKE '%:publisher'`,
  QUARTER,
);
// With --writer-aliases the statement names writers as B17 does (their publishing alias), so the facade links them
// to owners through those names, exactly as with a real statement.
const songwritersOf = (pid: number | null): string =>
  writerAliases && pid !== null ? (writerNamesOfParty(pid)[0] ?? '') : '';
const holderName = (pid: number | null): string => {
  if (pid === null || house.has(pid)) return 'UNRESOLVED RIGHTS-HOLDER';
  const oid = ownerOfParty.get(pid);
  return oid ? (ownerName.get(oid) as string) : `Writer #${pid}`;
};
const wb = new ExcelJS.Workbook();
wb.addWorksheet('Cover').addRow(['Reconstructed from erp.db (accrual, 2026-Q2, b17); names pseudonymized']);
const ws = wb.addWorksheet('Q226');
ws.addRow([
  'Period',
  'asset title',
  'rights-holder name',
  'work identifier',
  'songwriters',
  'operation type',
  'retailer / service',
  'country',
  'net amount',
  'Withholding',
  'Total Payable',
]);
let pubTotal = new Decimal(0);
for (const r of pubRows) {
  const amount = new Decimal(r.amount_x ?? String(r.amount));
  const full = /:(bought_track|review|share_error)$/.test(r.rule);
  const payable = full ? amount : amount.mul(2);
  const holder = /:(buyout|override)$/.test(r.rule)
    ? holderName(r.from_party)
    : full
      ? 'UNRESOLVED RIGHTS-HOLDER'
      : holderName(r.party_id);
  pubTotal = pubTotal.add(payable);
  const writerParty = /:(buyout|override)$/.test(r.rule) ? r.from_party : full ? null : r.party_id;
  ws.addRow([
    '2Q26',
    r.isrc,
    holder,
    '',
    songwritersOf(writerParty),
    r.rule,
    'ALL',
    'ALL',
    payable.toFixed(12),
    '0',
    payable.toDecimalPlaces(12).toFixed(),
  ]);
}
const b17Name = '0to8_Q22026_Publishing_Statement.xlsx';
await wb.xlsx.writeFile(join(importDir, b17Name));

await stack.close();
erp.close();
console.log(
  JSON.stringify(
    {
      dataDir,
      believe: { file: join(importDir, believeName), lines: revenue.length, net: total.toFixed() },
      b17: { file: join(importDir, b17Name), lines: pubRows.length, totalPayable: pubTotal.toFixed() },
      stats,
    },
    null,
    2,
  ),
);
