/**
 * D-176: the admission rows of the owner's folder 6 (the pack of 2026-11-06): `payee_decisions.json` (the channel and
 * the payee of a participant), `holds.json` (the holds), `history_exceptions.json` (the disputed history: blocks the row
 * only with `impact: block_row`), `payout_answers.json` (the answers «pay» for an amount). Every row is keyed to a
 * pseudonym by its nick (the owner of the pseudonym gets the row), under the own label `0to8` where a book matters;
 * idempotent by `source` (`<file>:<id or party>`). Dry run by default; `--apply` writes through the facade.
 *
 *   npx tsx packages/backend/scripts/stage3/load-admission.ts <folder 6> [--apply] [--org <id>] [dataDir]
 */
import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { openFacade } from '../../src/facade';
import { connectOrg, takeOrgArgument } from '../../src/connect-sources';
import { normalizeName } from '../../src/shared/identifiers';
import { Decimal } from '../../src/shared/money';

const ORG = takeOrgArgument();
const args = process.argv.slice(2);
const apply = args.includes('--apply');
const [folder, dataDirArg] = args.filter((a) => !a.startsWith('--'));
if (!folder) {
  console.error('usage: load-admission.ts <folder 6> [--apply] [--org <id>] [dataDir]');
  process.exit(1);
}
const root = resolve(import.meta.dirname, '..', '..', '..', '..');
const dataDir = resolve(dataDirArg ?? join(root, 'data'));
const read = <T>(name: string): T[] => {
  const d = JSON.parse(readFileSync(join(folder, name), 'utf8')) as { items?: T[] } | T[];
  return Array.isArray(d) ? d : (d.items ?? []);
};
const money = (v: number | string) => new Decimal(typeof v === 'number' ? v.toString() : v).toFixed(2);

interface Payee { party_id: number | string; nick: string; channel: string; payee?: string | null; status: string; basis: string; by: string; valid_from: string }
interface Hold { id: string; nick: string; reason: string; comment?: string; source?: string; since: string; release?: string; review_on?: string; status: string; kind: string }
interface Dispute { id: string; nick: string; amount: number; period?: string; kind: string; evidence?: string[]; question?: string; impact: string; effect?: string; status: string; opened?: string }
interface Answer { party_id: number | string; nick: string; due: number; decision: string; why: string; by: string; about?: string[] }

const HOLD_KINDS: Record<string, 'decision' | 'artist_request' | 'question'> = { решение: 'decision', 'просьба артиста': 'artist_request', вопрос: 'question' };

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
  const sources = new Set([...existing.payees, ...existing.holds, ...existing.answers].map((r) => r.source).filter((x): x is string => !!x));
  let created = 0;
  let skipped = 0;
  const todo: { source: string; what: string; run: () => Promise<unknown> }[] = [];

  for (const p of read<Payee>('payee_decisions.json')) {
    const source = `payee_decisions.json:${p.party_id}`;
    const ownerId = ownerOf(p.nick);
    if (!ownerId) continue;
    const channel = p.channel === 'tipalti' || p.channel === 'easystaff' ? p.channel : 'other';
    todo.push({ source, what: `payee ${p.nick} ${channel} ${p.payee ?? '(by history)'}`, run: () => f.setPayee({ ownerId, channel, payeeRef: p.payee ?? null, status: 'confirmed', basis: `${p.basis} (${p.by})`.slice(0, 2000), validFrom: p.valid_from, source }) });
  }
  for (const h of read<Hold>('holds.json')) {
    const source = `holds.json:${h.id}`;
    const ownerId = ownerOf(h.nick);
    if (!ownerId) continue;
    const kind = HOLD_KINDS[h.kind] ?? 'question';
    const reason = [h.status === 'нужно решение' ? '[нужно решение]' : '', h.reason, h.comment ?? ''].filter(Boolean).join(' ');
    todo.push({ source, what: `hold ${h.nick} ${kind}`, run: () => f.createHold({ ownerId, labelId: zero.id, kind, blocks: true, reason: reason.slice(0, 4000), releaseWhen: h.release ?? null, reviewOn: h.review_on ?? null, since: h.since, source: `${source} (${h.source ?? ''})`.slice(0, 200) }) });
  }
  for (const d of read<Dispute>('history_exceptions.json')) {
    const source = `history_exceptions.json:${d.id}`;
    if (d.status !== 'открыто') {
      skipped++;
      continue; // a closed item is history, not a hold
    }
    const ownerId = ownerOf(d.nick);
    if (!ownerId) continue;
    const reason = [`${d.kind}: ${d.question ?? ''}`, ...(d.evidence ?? []), d.effect ? `эффект: ${d.effect}` : ''].filter(Boolean).join(' | ');
    todo.push({ source, what: `dispute ${d.nick} ${d.impact} ${money(d.amount)}`, run: () => f.createHold({ ownerId, labelId: zero.id, kind: 'dispute', blocks: d.impact === 'block_row', reason: reason.slice(0, 4000), amount: money(d.amount), period: d.period ?? null, since: d.opened ?? '2026-10-19', source }) });
  }
  for (const a of read<Answer>('payout_answers.json')) {
    const source = `payout_answers.json:${a.party_id}`;
    const ownerId = ownerOf(a.nick);
    if (!ownerId) continue;
    const decision = a.decision === 'pay_task' ? 'pay_task' : 'pay';
    todo.push({ source, what: `answer ${a.nick} ${decision} ${money(a.due)}`, run: () => f.createAnswer({ ownerId, labelId: zero.id, due: money(a.due), decision, why: a.why, about: (a.about ?? []).join('; '), answeredBy: a.by, source }) });
  }

  for (const t of todo) {
    if (sources.has(t.source)) {
      skipped++;
      continue;
    }
    console.log(`${apply ? 'create' : 'would create'}: ${t.what}`);
    if (apply) {
      await t.run();
      created++;
    }
  }
  console.log(`${apply ? 'created' : 'to create'} ${apply ? created : todo.filter((t) => !sources.has(t.source)).length}, skipped (already there or closed) ${skipped}`);
} finally {
  await stack.close();
}
