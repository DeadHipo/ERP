/**
 * D-181 (A21): the payout route of the owner's old ERP (`payout_checks.json` of 2026-10-20, folder 11 of the update of
 * the pack of 2026-11-06): the channel and the payee it derived from the payment history become `proposed` payee rows
 * (an owner that already has an active payee keeps it: a decision beats the history), and its open questions about the
 * channel become holds of kind `question` under the own label `0to8`. Keyed to a pseudonym by its nick; idempotent by
 * `source` (`payout_checks.json:<party_id>`, `payout_checks.json:q:<party_id>`). Dry run by default; `--apply` writes
 * through the facade. The texts of the file stay in the database only (never in this repository).
 *
 *   npx tsx packages/backend/scripts/stage3/load-payout-checks.ts <payout_checks.json> [--apply] [--org <id>] [dataDir]
 */
import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { openFacade } from '../../src/facade';
import { connectOrg, takeOrgArgument } from '../../src/connect-sources';
import { normalizeName } from '../../src/shared/identifiers';

const ORG = takeOrgArgument();
const args = process.argv.slice(2);
const apply = args.includes('--apply');
const [file, dataDirArg] = args.filter((a) => !a.startsWith('--'));
if (!file) {
  console.error('usage: load-payout-checks.ts <payout_checks.json> [--apply] [--org <id>] [dataDir]');
  process.exit(1);
}
const root = resolve(import.meta.dirname, '..', '..', '..', '..');
const dataDir = resolve(dataDirArg ?? join(root, 'data'));

interface Item {
  party_id: number | string;
  name: string;
  channel: string | null;
  payee: string | null;
  history: string | null;
  question: string | null;
}
const doc = JSON.parse(readFileSync(file, 'utf8')) as { built_at?: string; checked_at?: string; items: Item[] };
const checkedDay = (doc.checked_at ?? doc.built_at ?? '2026-10-20').slice(0, 10);
const CHANNELS = new Set(['tipalti', 'easystaff']);

const stack = await connectOrg({ dataDir, org: ORG });
const f = openFacade({ db: stack.db, orgId: stack.orgId, dataDir, payoutThresholdCents: 5000, sources: stack.sources });
try {
  const { labels, owners } = f.modules;
  const zero = (await labels.index()).ownLabels().find((l) => l.name === '0to8');
  if (!zero) throw new Error('no own label named 0to8');
  const index = await owners.artistIndex();
  const resolveOwner = await owners.ownerResolver();
  const byNorm = new Map<string, { ownerId: string | null }[]>();
  for (const [id, a] of index) if (id === a.id) byNorm.set(normalizeName(a.pseudonym), [...(byNorm.get(normalizeName(a.pseudonym)) ?? []), { ownerId: a.ownerId }]);
  const ownerOf = (nick: string): string | null => {
    const found = byNorm.get(normalizeName(nick)) ?? [];
    if (found.length !== 1 || !found[0]?.ownerId) {
      console.log(`  ${nick}: ${found.length === 0 ? 'pseudonym not found' : found.length > 1 ? 'pseudonym ambiguous' : 'pseudonym without an owner'} — skipped`);
      return null;
    }
    return resolveOwner(found[0].ownerId);
  };
  const existing = await f.listAdmission({ active: false });
  const sources = new Set([...existing.payees, ...existing.holds].map((r) => r.source).filter((x): x is string => !!x));
  const withPayee = new Set(existing.payees.filter((p) => p.active).map((p) => p.ownerId));
  const counts = { payees: 0, keptDecision: 0, questions: 0, skipped: 0, noChannel: 0 };
  const todo: { source: string; what: string; run: () => Promise<unknown> }[] = [];
  for (const it of doc.items) {
    const ownerId = ownerOf(it.name);
    if (!ownerId) continue;
    if (it.channel && CHANNELS.has(it.channel)) {
      const channel = it.channel as 'tipalti' | 'easystaff';
      const source = `payout_checks.json:${it.party_id}`;
      if (withPayee.has(ownerId)) counts.keptDecision++;
      else {
        const ref = it.payee && it.payee.startsWith(`${channel}:`) ? it.payee.slice(channel.length + 1) : it.payee;
        const basis = `payout_checks.json ${checkedDay}: маршрут по истории платежей старой ERP${it.history ? `; ${it.history}` : ''}`.slice(0, 2000);
        todo.push({ source, what: `payee ${it.name} ${channel} (proposed)`, run: () => f.setPayee({ ownerId, channel, payeeRef: ref || null, status: 'proposed', basis, validFrom: checkedDay, source }) });
        counts.payees++;
      }
    } else counts.noChannel++;
    if (it.question) {
      const source = `payout_checks.json:q:${it.party_id}`;
      todo.push({ source, what: `question ${it.name}`, run: () => f.createHold({ ownerId, labelId: zero.id, kind: 'question', blocks: true, reason: `Маршрут выплаты ${checkedDay}: ${it.question}`.slice(0, 4000), since: checkedDay, source }) });
      counts.questions++;
    }
  }
  let created = 0;
  for (const t of todo) {
    if (sources.has(t.source)) {
      counts.skipped++;
      continue;
    }
    console.log(`${apply ? '+' : '·'} ${t.what}`);
    if (apply) {
      await t.run();
      created++;
    }
  }
  console.log(`items ${doc.items.length}: payees to propose ${counts.payees}, decision kept ${counts.keptDecision}, no channel ${counts.noChannel}, questions ${counts.questions}; ${apply ? 'created' : 'to create'} ${apply ? created : todo.filter((t) => !sources.has(t.source)).length}, skipped (already there) ${counts.skipped}`);
} finally {
  await stack.close();
}
