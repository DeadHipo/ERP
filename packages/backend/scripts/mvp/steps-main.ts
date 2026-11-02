/** Stage 4.4 to 4.6 steps: echo8, main (history of payments), terms. */
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { Decimal } from '../../src/shared/money';
import { normalizeName, normalizeUpc } from '../../src/shared/identifiers';
import { Ctx, LOAD_DIR, errText, hasFile, pct, readJson } from './lib';
import { stepTracks } from './steps-annex';
import { firstReportMonths } from './steps-stage6';
import type { DocumentKind } from '../../src/modules/owners';

// ================================================================= echo8 (4.4)

interface Echo8Splits {
  splits: {
    isrc: string;
    document: string | null;
    notes: string[];
    rows: { pseudonym: string; percent: number; labelRow: boolean; artistId: string | null; newArtist: boolean }[];
  }[];
}

export async function stepEcho8(ctx: Ctx) {
  const { log } = ctx;
  await stepTracks(ctx, 'echo8');
  const j = readJson<Echo8Splits>('echo8/splits.json');
  log.h('Echo8 splits');
  let n = 0;
  for (const s of j.splits) {
    const marker = `mvp:echo8:${s.isrc}`;
    if (ctx.model.hasNote(s.isrc, marker)) {
      log.count('already_done');
      continue;
    }
    if (ctx.model.of(s.isrc).length > 0) {
      log.count('skipped_split_exists');
      continue;
    }
    const ambiguous = s.rows.filter(
      (r) => !r.labelRow && !r.newArtist && !r.artistId && ctx.resolveArtist({ pseudonym: r.pseudonym }).status === 'ambiguous',
    );
    if (ambiguous.length > 0) {
      log.event('skipped_ambiguous_artist', `${s.isrc}: ${ambiguous.map((r) => r.pseudonym).join(', ')}`, 60);
      continue;
    }
    const rows: { artistId: string; percent: string }[] = [];
    let blocked = false;
    for (const r of s.rows.filter((x) => !x.labelRow && x.percent > 0)) {
      const id = await ctx.artistOrCreate({ artistId: r.artistId, pseudonym: r.pseudonym }, 'mvp:echo8');
      if (!id) {
        log.event('skipped_ambiguous_artist', `${s.isrc}: ${r.pseudonym} (several artists after normalisation)`, 60);
        blocked = true;
        break;
      }
      if (rows.some((x) => x.artistId === id)) {
        // the same artist printed twice in the export: rows are added up
        const prev = rows.find((x) => x.artistId === id);
        if (prev) prev.percent = new Decimal(prev.percent).add(pct(r.percent)).toFixed();
      } else rows.push({ artistId: id, percent: pct(r.percent) });
    }
    if (blocked) continue;
    // the named Echo8 RSA confirms the split when the artist it was signed with has an owner
    let docId: string | null = null;
    if (s.document) {
      const base = (s.document.split('/').pop() ?? '').replace(/\.pdf$/i, '');
      const baseNorm = normalizeName(base);
      const holder = rows.find((r) => {
        const name = ctx.knownArtist(r.artistId)?.pseudonym;
        return name !== undefined && baseNorm.includes(normalizeName(name));
      });
      const ownerId = holder ? ctx.ownerOfArtist(holder.artistId) : null;
      if (ownerId) {
        docId = await ctx.ensureDoc({ kind: 'contract', title: `Echo8 RSA: ${base}`, ownerId, approve: true, ref: 'mvp-load:echo8' });
        log.count('echo8_split_with_rsa_document');
      } else log.count('echo8_rsa_artist_has_no_owner_no_document');
    }
    try {
      await ctx.createSplit({ isrc: s.isrc, from: '2000-01-01', rows, docId, note: marker });
      log.count('echo8_splits_created');
    } catch (e) {
      log.event('split_error', `${s.isrc}: ${errText(e)}`, 100);
    }
    if (++n % 500 === 0) console.log(`  echo8: ${n} splits`);
  }
}

// ================================================================= main (4.5)

interface CashRow {
  rowNo: number;
  comment: string;
  reportMonth: string | null;
  date: string;
  nickname: string;
  type: string;
  category: string;
  amount: string;
  side: 'expense' | 'income';
  nicknameStatus: 'matched' | 'unmatched' | 'ambiguous';
  ownerId: string | null;
  artistId: string | null;
  load: string;
  scope?: 'any' | 'publishing';
  noRecap?: boolean;
  overpayment?: boolean;
  requiresCredit?: number;
  role?: string;
  carve?: { upcs: string[]; participants: string[]; title: string };
  parts?: { load: string; amount: string; why: string }[];
}
interface CarvePair {
  participants: string[];
  upcs: string[];
  title: string;
  reportMonth: string;
  total: string;
  rows: { rowNo: number; nickname: string; amount: string }[];
}

const D0 = () => new Decimal(0);

export async function stepMain(ctx: Ctx) {
  const { log } = ctx;
  const cash = readJson<CashRow[]>('main/cash_rows.json');
  const pairs = readJson<CarvePair[]>('main/carve_pairs.json');
  const partsJson = hasFile('annex/participations.json')
    ? readJson<{ participations: { isrc: string; recipient: { pseudonym: string } }[] }>('annex/participations.json').participations
    : [];

  // participations known now (database / this run) plus those the participations step would create
  const partKeys = new Set<string>();
  for (const p of ctx.participations) {
    const name = ctx.artistsById.get(p.artistId)?.pseudonym;
    if (name) partKeys.add(`${p.isrc}|${normalizeName(name)}`);
  }
  for (const p of partsJson) partKeys.add(`${p.isrc}|${normalizeName(p.recipient.pseudonym)}`);
  const recipientsWithParticipation = new Set<string>();
  for (const p of ctx.participations) {
    const o = ctx.ownerOfArtist(p.artistId);
    if (o) recipientsWithParticipation.add(o);
  }
  const carveMatch = (r: CashRow): string | null => {
    const isrcs = (r.carve?.upcs ?? []).flatMap((u) => ctx.tracksByUpc.get(normalizeUpc(u)) ?? []);
    for (const isrc of new Set(isrcs))
      for (const name of r.carve?.participants ?? [])
        if (partKeys.has(`${isrc}|${normalizeName(name)}`)) return `${isrc} / ${name}`;
    return null;
  };

  // ---- holders: matched nicknames carry owner and artist; unmatched ones get a person owner with one pseudonym
  const holders = new Map<string, { ownerId: string; artistId: string } | null>();
  const holderOf = async (r: CashRow, create: boolean): Promise<{ ownerId: string; artistId: string } | null> => {
    if (r.nicknameStatus === 'ambiguous') {
      const x = ctx.resolveArtist({ pseudonym: r.nickname });
      const a = x.status === 'ok' ? ctx.knownArtist(x.id) : undefined;
      return a?.ownerId ? { ownerId: a.ownerId, artistId: a.id } : null;
    }
    if (r.nicknameStatus === 'matched') {
      const a = ctx.knownArtist(r.artistId);
      if (!a) return null;
      const ownerId = a.ownerId;
      return ownerId ? { ownerId, artistId: a.id } : null;
    }
    if (holders.has(r.nickname)) return holders.get(r.nickname) ?? null;
    if (!create) return null;
    const h = await ctx.ownerWithPseudonym(r.nickname, 'person', 'mvp:main');
    holders.set(r.nickname, h);
    log.event('owner_created_for_nickname', `${r.nickname} (origin mvp:main)`, 300);
    return h;
  };

  const sums = new Map<string, { expected: Decimal; loaded: Decimal; skipped: Map<string, Decimal> }>();
  const bucket = (cls: string) => {
    let b = sums.get(cls);
    if (!b) sums.set(cls, (b = { expected: D0(), loaded: D0(), skipped: new Map() }));
    return b;
  };
  const addLoaded = (cls: string, amount: string) => (bucket(cls).loaded = bucket(cls).loaded.add(amount));
  const addSkipped = (cls: string, why: string, amount: string) => {
    const b = bucket(cls);
    b.skipped.set(why, (b.skipped.get(why) ?? D0()).add(amount));
    log.count(`skipped_${cls}_${why}`);
  };

  const post = async (marker: string, input: Parameters<Ctx['f']['createOperation']>[0]): Promise<boolean> => {
    if (ctx.opMarkers.has(marker)) {
      log.count('already_done');
      return true;
    }
    const cents = new Decimal(input.amount).mul(100);
    if (!cents.isInteger() || cents.lte(0)) throw new Error(`amount ${input.amount} is not a positive whole number of cents`);
    if (ctx.apply) await ctx.f.createOperation(input);
    ctx.opMarkers.add(marker);
    return true;
  };

  const heldCredit: string[] = [];
  const carveLog: string[] = [];
  log.h('Rows');
  let n = 0;
  for (const r of cash) {
    if (r.side === 'income') {
      if (r.load === 'income_comparison') log.count('income_comparison_not_loaded');
      else {
        log.count(`income_${r.load}_not_loaded`);
        log.event('income_row_not_loaded', `row ${r.rowNo} ${r.load} ${r.nickname} ${r.amount}`, 20);
      }
      continue;
    }
    const items = r.parts
      ? r.parts.map((p, i) => ({ load: p.load, amount: p.amount, idx: i + 1 }))
      : [{ load: r.load, amount: r.amount, idx: 0 }];
    for (const it of items) {
      bucket(it.load).expected = bucket(it.load).expected.add(it.amount);
      const marker = `mvp:main:${it.load === 'review' ? 'review:' : ''}${r.rowNo}${it.idx ? `:${it.idx}` : ''}`;
      const tag = `${r.noRecap ? ' [no recap]' : ''}${r.overpayment ? ' [overpayment]' : ''}`;
      const comment = `${marker} ${r.comment}${tag}`.trim();
      try {
        if (it.load === 'not_loaded') {
          addSkipped('not_loaded', 'not_loaded', it.amount);
          continue;
        }
        if (it.load === 'document_only') {
          const h = await holderOf(r, false);
          await ctx.ensureDoc({
            kind: 'other',
            title: `Main.xlsx row ${r.rowNo}: ${r.comment}`.slice(0, 250),
            ownerId: h?.ownerId ?? null,
            approve: true,
            ref: 'mvp-load:main',
          });
          addLoaded('document_only', it.amount);
          log.count('documents_only');
          continue;
        }
        if (it.load === 'carve_pair') {
          const m = carveMatch(r);
          if (m) {
            addSkipped('carve_pair', 'participation_exists', it.amount);
            carveLog.push(`row ${r.rowNo} ${r.nickname} ${it.amount}: participation on ${m}, not loaded`);
            continue;
          }
        }
        const requiresCredit = r.requiresCredit !== undefined;
        if (requiresCredit) {
          const h = await holderOf(r, false);
          if (!h || !recipientsWithParticipation.has(h.ownerId)) {
            addSkipped(it.load, 'held_requires_credit', it.amount);
            heldCredit.push(`row ${r.rowNo} ${r.nickname} ${it.amount} (credit row ${r.requiresCredit})`);
            continue;
          }
        }
        const h = await holderOf(r, true);
        if (!h) {
          addSkipped(it.load, r.nicknameStatus === 'ambiguous' ? 'ambiguous_nickname' : 'artist_or_owner_missing', it.amount);
          log.event('unresolved', `row ${r.rowNo} ${r.nickname} ${r.nicknameStatus} ${it.amount} (${it.load})`, 400);
          continue;
        }
        const common = { date: r.date, period: r.reportMonth, migration: true, comment };
        if (it.load === 'payout' || it.load === 'review') {
          await post(marker, { ...common, direction: 'out', amount: it.amount, ownerId: h.ownerId, artistId: h.artistId });
        } else if (it.load === 'advance') {
          const basis = await ctx.ensureDoc({
            kind: 'advance_basis',
            title: `Main.xlsx advance row ${r.rowNo}`,
            ownerId: h.ownerId,
            approve: true,
            ref: 'mvp-load:main',
          });
          const proof = await ctx.ensureDoc({
            kind: 'payment_proof',
            title: `Main.xlsx payment proof row ${r.rowNo}`,
            ownerId: h.ownerId,
            approve: true,
            ref: 'mvp-load:main',
          });
          await post(marker, {
            ...common,
            direction: 'out',
            amount: it.amount,
            ownerId: h.ownerId,
            artistId: h.artistId,
            scope: { kind: r.scope ?? 'any' },
            documentId: basis,
            paymentProofId: proof,
          });
        } else if (it.load === 'deduction' || it.load === 'carve_pair') {
          const basis = await ctx.ensureDoc({
            kind: 'adjustment_basis',
            title: `Main.xlsx ${it.load === 'carve_pair' ? 'carve' : 'deduction'} row ${r.rowNo}${it.idx ? ` part ${it.idx}` : ''}`,
            ownerId: h.ownerId,
            approve: true,
            ref: 'mvp-load:main',
          });
          await post(marker, {
            ...common,
            comment: it.load === 'carve_pair' ? `${comment} [carve without participation]` : comment,
            direction: 'in',
            amount: it.amount,
            artistId: h.artistId,
            documentId: basis,
          });
          if (it.load === 'carve_pair') carveLog.push(`row ${r.rowNo} ${r.nickname} ${it.amount}: no participation, loaded as a deduction`);
        } else {
          log.event('unknown_class', `row ${r.rowNo}: ${it.load}`);
          continue;
        }
        addLoaded(it.load, it.amount);
        log.count(`loaded_${it.load}`);
      } catch (e) {
        addSkipped(it.load, 'error', it.amount);
        log.event('row_error', `row ${r.rowNo} ${r.nickname} ${it.amount} ${it.load}: ${errText(e)}`, 200);
      }
      if (++n % 500 === 0) console.log(`  main: ${n} rows`);
    }
  }

  log.h('Carve pairs');
  for (const l of carveLog) log.bullet(l);
  log.p(`${pairs.length} pairs in carve_pairs.json; ${pairs.reduce((c, p) => c + p.rows.length, 0)} artist rows.`);
  log.h('Payout rows held back: they need the participant credit (no participation for the participant)');
  for (const l of heldCredit) log.bullet(l);

  log.h('Reconciliation against reconciliation.md (section 2: Expense classes)');
  const mdFull = readFileSync(join(LOAD_DIR, 'main', 'reconciliation.md'), 'utf8');
  const md = mdFull.slice(mdFull.indexOf('## 2.'), mdFull.indexOf('## 3.'));
  log.p('| class | expected (md) | sheet total here | loaded | not loaded (by reason) | check |');
  log.p('|---|---:|---:|---:|---|---|');
  let totalExpected = D0();
  for (const [cls, b] of [...sums.entries()].sort(([a], [c]) => a.localeCompare(c))) {
    const m = new RegExp(`\\|\\s*${cls}\\s*\\|\\s*\\d+\\s*\\|\\s*([\\d,]+\\.\\d+)\\s*\\|`).exec(md);
    const expected = m ? new Decimal((m[1] ?? '0').replace(/,/g, '')) : null;
    totalExpected = totalExpected.add(b.expected);
    const skipped = [...b.skipped.entries()].map(([k, v]) => `${k} ${v.toFixed(2)}`).join('; ') || '-';
    const skippedTotal = [...b.skipped.values()].reduce((t, v) => t.add(v), D0());
    const diff = expected ? b.expected.sub(expected) : null;
    const closes = b.loaded.add(skippedTotal).sub(b.expected).abs().lt('0.01');
    log.p(
      `| ${cls} | ${expected ? expected.toFixed(2) : 'n/a'} | ${b.expected.toFixed(2)} (diff vs md ${diff ? diff.toFixed(2) : 'n/a'}) | ${b.loaded.toFixed(2)} | ${skipped} | ${closes ? 'loaded + not loaded = total' : 'OPEN'} |`,
    );
  }
  log.p('');
  log.p(`Sheet total of the Expense classes here: ${totalExpected.toFixed(2)} (md: 8,045,246.75; per-row cents drift 0.06 is known).`);
}

// ================================================================= terms (4.6)

interface TermsRow {
  ownerId: string;
  percent: string;
  operationType: string | null;
  validFrom: string;
  documentTitle: string | null;
}

export async function stepTerms(ctx: Ctx) {
  const { log } = ctx;
  log.h('Publishing terms');
  if (!hasFile('terms.json')) {
    const template: TermsRow[] = [
      { ownerId: '<owner id>', percent: '50', operationType: null, validFrom: '2024-01-01', documentTitle: '<title of the confirming document, or null>' },
    ];
    writeFileSync(join(LOAD_DIR, 'terms.template.json'), JSON.stringify(template, null, 2) + '\n');
    log.p('data/mvp-load/terms.json is absent: a template was written to data/mvp-load/terms.template.json, nothing loaded.');
    log.count('terms_file_absent');
    return;
  }
  const rows = readJson<TermsRow[]>('terms.json');
  const existing = await ctx.publishing.allTerms();
  for (const t of rows) {
    if (existing.some((e) => e.ownerId === t.ownerId && e.validFrom === t.validFrom && (e.operationType ?? null) === (t.operationType ?? null))) {
      log.count('already_done');
      continue;
    }
    try {
      let documentId: string | null = null;
      if (t.documentTitle) {
        documentId = await ctx.ensureDoc({
          kind: 'contract',
          title: t.documentTitle,
          ownerId: t.ownerId,
          approve: true,
          ref: 'mvp-load:terms',
        });
      }
      if (ctx.apply)
        await ctx.f.setPublishingTerms({
          ownerId: t.ownerId,
          percent: t.percent,
          validFrom: t.validFrom,
          documentId,
          operationType: t.operationType,
        });
      log.event('terms_set', `${t.ownerId} ${t.percent}% ${t.operationType ?? 'any type'} from ${t.validFrom}`);
    } catch (e) {
      log.event('terms_error', `${t.ownerId}: ${errText(e)}`);
    }
  }
}

// ================================================================= contracts (4.7, D-133)

interface IndexDoc {
  sha256: string;
  files: { name: string }[];
  kind: string;
  party: { pseudonyms: string[]; filename_pseudonym: string | null };
  meta: { number: string | null };
}
const ROLE_WORDS = new Set([
  'composer', 'owner', 'purchaser', 'artist', 'producer', 'licensor', 'licensee', 'seller', 'buyer', 'company',
  'label', 'writer', 'publisher', 'client', 'contractor', 'author', 'assignor', 'assignee', 'party', 'parties',
]);
const KIND_LABEL: Record<string, string> = {
  recording: 'Recording agreement',
  co_pub: 'Co-publishing agreement',
  co_ownership: 'Co-ownership agreement',
  remix: 'Remix agreement',
  other: 'Artist agreement',
  schedule: 'Schedule',
  advance: 'Advance addendum',
};
const OTHER_ARTIST_RE = /participation|exclusive|administration|short.?form|publishing/i;

export async function stepContracts(ctx: Ctx) {
  const { log } = ctx;
  const indexPath = join(LOAD_DIR, '..', '..', 'context_data', 'contract_index', 'documents.json');
  const docs = JSON.parse(readFileSync(indexPath, 'utf8')) as IndexDoc[];

  // ---- (a) contract registry
  log.h('Contracts from the PandaDoc index');
  const confirmedBefore = new Set(ctx.contractOwners);
  const ownersWithContract = new Set<string>();
  const ownersWithDoc = new Set<string>();
  let n = 0;
  for (const d of docs) {
    const isAppendix = d.kind === 'schedule' || d.kind === 'advance';
    const fname = d.files[0]?.name ?? '';
    const isContract =
      d.kind === 'recording' || d.kind === 'co_pub' || d.kind === 'co_ownership' || d.kind === 'remix' ||
      (d.kind === 'other' && OTHER_ARTIST_RE.test(fname));
    if (!isContract && !isAppendix) {
      log.count(`index_kind_not_loaded_${d.kind}`);
      continue;
    }
    // candidate names
    const raw = [...d.party.pseudonyms, ...(d.party.filename_pseudonym ? [d.party.filename_pseudonym] : [])];
    const cands = new Map<string, string>();
    for (const r of raw)
      for (const part of [r, ...r.split('/')]) {
        const nn = normalizeName(part);
        if (nn.length < 2 || ROLE_WORDS.has(nn)) continue;
        if (!cands.has(nn)) cands.set(nn, part.replace(/\s+/g, ' ').trim());
      }
    const byOwner = new Map<string, string[]>(); // owner -> artist ids
    let ambiguous = 0;
    let ownerless = 0;
    for (const [nn] of cands) {
      const found = [...(ctx.artistsByNorm.get(nn) ?? [])];
      if (found.length === 0) continue;
      if (found.length > 1) {
        ambiguous++;
        continue;
      }
      const a = ctx.artistsById.get(found[0] as string);
      if (!a) continue;
      if (!a.ownerId) {
        ownerless++;
        continue;
      }
      const l = byOwner.get(a.ownerId) ?? [];
      if (!l.includes(a.id)) l.push(a.id);
      byOwner.set(a.ownerId, l);
    }
    if (byOwner.size === 0) {
      if (ambiguous > 0) log.event('skipped_ambiguous', `${d.kind} ${d.sha256.slice(0, 8)}: ${ambiguous} ambiguous pseudonym(s)`, 80);
      else if (ownerless > 0) log.event('skipped_artist_without_owner', `${d.kind} ${d.sha256.slice(0, 8)}`, 80);
      else log.event('no_match', `${d.kind} ${d.sha256.slice(0, 8)}: ${cands.size} candidate name(s)`, 80);
      log.count(`doc_not_loaded_${d.kind}`);
      continue;
    }
    if (ambiguous > 0) log.count('doc_with_ambiguous_extra_name');
    for (const [ownerId, artistIds] of byOwner) {
      const first = ctx.artistsById.get(artistIds[0] as string)?.pseudonym ?? '?';
      const label = KIND_LABEL[d.kind] ?? 'Agreement';
      const num = d.meta.number ? ` ${d.meta.number}` : '';
      const title = `${label}${num} ${first} [${d.sha256.slice(0, 8)}]`;
      const kind: DocumentKind = isAppendix ? 'appendix' : 'contract';
      const existed = ctx.docs.has(`${kind}|${title}|${ownerId}`);
      const docId = await ctx.ensureDoc({ kind, title, ownerId, approve: true, ref: `pandadoc:${d.sha256}` });
      ownersWithDoc.add(ownerId);
      if (existed) log.count('already_done');
      if (kind === 'appendix') {
        log.count(`appendix_${d.kind}`);
        continue;
      }
      let hasContract = false;
      if (existed && !docId.startsWith('dry:'))
        hasContract = (await ctx.owners.contractsOfOwner(ownerId)).some((c) => c.documentId === docId);
      if (hasContract) continue;
      try {
        if (ctx.apply) await ctx.owners.createContract({ ownerId, documentId: docId, number: d.meta.number ?? null, artistIds });
        log.count('contracts_created');
        log.count(`contracts_created_${d.kind}`);
        ownersWithContract.add(ownerId);
      } catch (e) {
        log.event('contract_error', `${d.kind} ${d.sha256.slice(0, 8)}: ${errText(e)}`, 100);
      }
    }
    if (++n % 200 === 0) console.log(`  contracts: ${n} documents`);
  }
  for (const o of ownersWithContract) ctx.contractOwners.add(o);
  log.count('owners_with_new_contract', ownersWithContract.size);
  log.count('owners_confirmed_before_run', confirmedBefore.size);

  // ---- (b) legacy splits equal to the Annex registry
  log.h('Legacy splits confirmed by the Annex 14 registry');
  const diff = readJson<{
    records: {
      isrc: string;
      classification: string;
      subtype: string;
      annex: { period: { from: string | null; to: string | null }; rowsExpected: { name: string; percent: number; artistId: string | null }[] };
    }[];
  }>('annex/splits_diff.json');
  const annexDoc = await ctx.ensureDoc({
    kind: 'appendix',
    title: 'Annex 14 Splits by ISRC 2026-11-02',
    approve: true,
    ref: 'mvp-load:annex/splits',
  });
  const seen = new Set<string>();
  for (const rec of diff.records) {
    if (rec.classification !== 'same' || rec.subtype !== 'rows') continue;
    const from = rec.annex.period.from ?? '2000-01-01';
    const to = rec.annex.period.to;
    const expected: { artistId: string; percent: string }[] = [];
    let ok = true;
    for (const r of rec.annex.rowsExpected.filter((x) => x.percent > 0)) {
      const a = ctx.resolveArtist({ artistId: r.artistId, pseudonym: r.name });
      if (a.status !== 'ok' || !a.id) {
        ok = false;
        break;
      }
      expected.push({ artistId: a.id, percent: pct(r.percent) });
    }
    if (!ok || expected.length === 0) {
      log.count('splits_skipped_unresolved_rows');
      continue;
    }
    for (const s of ctx.model.of(rec.isrc)) {
      if (seen.has(s.id)) continue;
      if (!(s.from < (to ?? '9999-12-31') && from < (s.to ?? '9999-12-31'))) continue;
      if (s.docId) {
        log.count('splits_already_have_document');
        continue;
      }
      const cur = s.rows.map((r) => ({ artistId: ctx.knownArtist(r.artistId)?.id ?? r.artistId, percent: r.percent }));
      const eq =
        cur.length === expected.length &&
        cur.every((x) => expected.some((y) => y.artistId === x.artistId && new Decimal(y.percent).eq(x.percent)));
      if (!eq) {
        log.count('splits_rows_differ_from_annex_left_unconfirmed');
        continue;
      }
      seen.add(s.id);
      try {
        if (ctx.apply) await ctx.f.confirmSplit(s.id, annexDoc);
        s.docId = annexDoc;
        log.count('splits_confirmed');
      } catch (e) {
        log.event('split_confirm_error', `${rec.isrc}: ${errText(e)}`, 100);
      }
      if (log.counts.get('splits_confirmed') && (log.counts.get('splits_confirmed') as number) % 500 === 0)
        console.log(`  splits confirmed: ${log.counts.get('splits_confirmed')}`);
    }
  }
}

// ================================================================= stage 6 fixes (D-135)

const stripDiacritics = (s: string) => normalizeName(s.normalize('NFD').replace(/\p{M}+/gu, ''));
const MONTHS: Record<string, string> = {
  jan: '01', feb: '02', mar: '03', apr: '04', may: '05', jun: '06', jul: '07', aug: '08', sep: '09', oct: '10', nov: '11', dec: '12',
};
/** "29 April, 2026" / "13 JAN 2026" -> the first day of that month, or null. */
function effectiveMonth(raw: string | null | undefined): string | null {
  const m = /(\d{1,2})\s+([A-Za-z]{3})[A-Za-z]*\.?,?\s+(\d{4})/.exec(raw ?? '');
  const mm = m ? MONTHS[(m[2] as string).toLowerCase()] : undefined;
  return m && mm ? `${m[3]}-${mm}-01` : null;
}

// ---- 1. pairs: the second UPC of a known ISRC

export async function stepPairs(ctx: Ctx) {
  const { log } = ctx;
  log.h('(ISRC, UPC) pairs of the loaded Believe files whose ISRC is a track but the pair is not');
  const [units, attrs] = await Promise.all([ctx.believeUnits(), ctx.stack.sources.pairAttributes()]);
  const net = new Map<string, bigint>();
  for (const u of units) {
    if (!u.isrc || !u.upc) continue;
    const k = `${u.isrc}|${u.upc}`;
    net.set(k, (net.get(k) ?? 0n) + u.netPico);
  }
  let total = D0();
  for (const [k, pico] of [...net.entries()].sort(([a], [b]) => a.localeCompare(b))) {
    const [isrc, upc] = k.split('|') as [string, string];
    if (ctx.trackPairs.has(k)) continue;
    if (!ctx.tracksByIsrc.has(isrc)) {
      log.count('pair_isrc_not_a_track_left');
      continue;
    }
    const title = attrs.get(k)?.trackTitle?.trim() || isrc;
    const usd = new Decimal(pico.toString()).div('1e12');
    if (!ctx.apply && ctx.trackPairs.has(k)) continue;
    const created = await ensureTrackPair(ctx, isrc, upc, title);
    if (created) {
      total = total.add(usd);
      log.event('pair_registered', `${isrc} / ${upc} "${title}" net ${usd.toFixed(2)}`);
    }
  }
  log.count('net_of_registered_pairs_cents', total.mul(100).round().toNumber());
  log.p(`Net of the registered pairs: ${total.toFixed(2)}`);
}

async function ensureTrackPair(ctx: Ctx, isrc: string, upc: string, title: string): Promise<boolean> {
  const { ensureTrack } = await import('./steps-annex');
  const ok = await ensureTrack(ctx, { isrc, upc, title }, 'pairs');
  return ok;
}

// ---- 2. label-fixes: 0to8/lost

export async function stepLabelFixes(ctx: Ctx) {
  const { log } = ctx;
  log.h('0to8/lost: a representative paid by split rows (M7), not a sublabel');
  const lost = (await ctx.labels.listLabels()).find((l) => l.name.toLowerCase() === 'lost');
  if (!lost) {
    log.count('label_lost_absent');
    return;
  }
  const open = lost.rules.filter((r) => r.validTo === null);
  if (open.length === 0) {
    log.count('already_done');
    return;
  }
  for (const r of open) {
    const to = new Date(`${r.validFrom}T00:00:00Z`);
    to.setUTCMonth(to.getUTCMonth() + 1);
    const validTo = to.toISOString().slice(0, 10);
    if (ctx.apply) await ctx.f.closeLabelRule(r.id, validTo);
    log.event(
      'rule_closed',
      `lost rule ${r.percent}% from ${r.validFrom} closed at ${validTo}: that one month stays an assumption; later months of "0to8/lost" have no sublabel rule, so the whole label share stays with 0to8`,
    );
  }
  log.p('The labels service has no call to re-point an alias to another label (alias "0to8/lost" stays an alias of label "lost"); closing the rule gives the same money result from the second month.');
}

// ---- 3. lunar: LUNAR MEDIA 10 % vocal licence

export async function stepLunar(ctx: Ctx) {
  const { log } = ctx;
  log.h('LUNAR MEDIA 10 % vocal licence (Annex Sch3A row 4)');
  const family = 'tem que tirar o chapeu';
  // the licence covers the recordings of the Annex (Sch3A row 4: 34 recordings); same-title tracks of other catalogues
  // (Echo8 releases, fan-made versions) are listed and left out
  const annexIsrc = new Set(
    readJson<{ records: { isrc: string; title: string }[] }>('annex/splits_diff.json')
      .records.filter((r) => stripDiacritics(r.title).includes(family))
      .map((r) => r.isrc),
  );
  const isrcs = new Map<string, string>();
  for (const [isrc, list] of ctx.tracksByIsrc)
    for (const t of list)
      if (stripDiacritics(t.title).includes(family)) {
        if (annexIsrc.has(isrc)) isrcs.set(isrc, t.title);
        else log.event('title_match_not_in_annex_schedule', `${isrc} "${t.title}"`);
      }
  const first = new Map<string, string>();
  for (const u of await ctx.believeUnits()) {
    if (!isrcs.has(u.isrc)) continue;
    const cur = first.get(u.isrc);
    if (!cur || u.reportingMonth < cur) first.set(u.isrc, u.reportingMonth);
  }
  log.count('isrc_in_title_family', isrcs.size);
  const { ownerId, artistId } = await ctx.ownerWithPseudonym('LUNAR MEDIA', 'label', 'mvp:lunar');
  void ownerId;
  const docId = await ctx.ensureDoc({
    kind: 'assumption',
    title: 'Assumption Q1: LUNAR MEDIA 10 % vocal licence (cash base read as net; pool funding per owner decision 4)',
    approve: false,
    ref: 'mvp-load:lunar',
  });
  const validTo = '2026-05-01';
  for (const [isrc, title] of [...isrcs.entries()].sort(([a], [b]) => a.localeCompare(b))) {
    const m = first.get(isrc);
    if (!m) {
      log.event('no_report_month', `${isrc} "${title}": not in the loaded reports, no participation`);
      continue;
    }
    const validFrom = `${m}-01`;
    if (validFrom >= validTo) {
      log.event('after_sale', `${isrc} "${title}": first report month ${m} is not before the sale month`);
      continue;
    }
    const marker = `mvp:lunar:${isrc}`;
    if (ctx.hasParticipationNote(marker)) {
      log.count('already_done');
      continue;
    }
    try {
      let id = ctx.fakeId('participation');
      if (ctx.apply)
        id = (
          await ctx.f.createParticipation({
            isrc,
            artistId,
            percent: '10',
            base: 'net',
            fundedFrom: 'artist_pool',
            validFrom,
            validTo,
            documentId: docId,
            origin: 'mvp:lunar',
            note: marker,
          })
        ).id;
      ctx.participations.push({ id, isrc, artistId, fromArtistId: null, fundedFrom: 'artist_pool', validFrom, validTo, note: marker });
      log.event('participation_created', `${isrc} "${title}" from ${validFrom} to ${validTo}`);
    } catch (e) {
      log.event('participation_error', `${isrc}: ${errText(e)}`);
    }
  }
}

// ---- 4. b17-holders

interface HolderDoc {
  sha256: string;
  files: { name: string }[];
  kind: string;
  party: { legal_name: string | null };
  meta: { number: string | null; effective_date: string | null; signed_on: string | null };
}

export async function stepB17Holders(ctx: Ctx) {
  const { log } = ctx;
  log.h('B17 holders confirmed by their own contracts (names are matched in memory, never printed)');
  const indexPath = join(LOAD_DIR, '..', '..', 'context_data', 'contract_index', 'documents.json');
  const docs = (JSON.parse(readFileSync(indexPath, 'utf8')) as HolderDoc[]).filter((d) => d.party.legal_name);
  const kindOf = (d: HolderDoc): 'co_pub' | 'admin' | 'recording' | null =>
    d.kind === 'co_pub' ? 'co_pub' : d.kind === 'recording' ? 'recording' : d.kind === 'other' && /administration/i.test(d.files[0]?.name ?? '') ? 'admin' : null;
  const byName = new Map<string, HolderDoc[]>();
  for (const d of docs) {
    if (!kindOf(d)) continue;
    const k = normalizeName(d.party.legal_name as string);
    byName.set(k, [...(byName.get(k) ?? []), d]);
  }
  const owners = await ctx.owners.listOwners();
  const holders = owners.filter((o) => o.origin === 'publishing');
  log.count('holders', holders.length);
  const terms = await ctx.publishing.allTerms();
  const LABEL = { co_pub: 'Co-publishing agreement', admin: 'Publishing administration agreement', recording: 'Recording agreement' } as const;
  let termsSet = 0;
  for (const o of holders) {
    const names = new Set([o.name, ...o.aliases].map(normalizeName));
    const hits = [...names].flatMap((n) => byName.get(n) ?? []);
    // the administration agreement prints all its parties in one string: the owner is a party when its whole name occurs in it
    for (const d of docs)
      if (kindOf(d) === 'admin' && [...names].some((n) => n.includes(' ') && ` ${normalizeName(d.party.legal_name as string)} `.includes(` ${n} `))) hits.push(d);
    // information only: unmatched holders that would match with the words of the name in another order
    const tokens = (x: string) => x.split(' ').sort().join(' ');
    if (hits.length === 0 && docs.some((d) => kindOf(d) && [...names].some((n) => n.includes(' ') && tokens(n) === tokens(normalizeName(d.party.legal_name as string)))))
      log.count('holders_unmatched_but_same_words_in_other_order');
    const uniq = [...new Map(hits.map((d) => [d.sha256, d])).values()];
    const id8 = o.id.slice(0, 8);
    if (uniq.length === 0) {
      log.count('holders_unmatched');
      log.event('holder_unmatched', id8);
      continue;
    }
    log.count('holders_matched');
    let confirmed = false;
    const termsDone = new Set<string>();
    for (const d of uniq) {
      const k = kindOf(d) as 'co_pub' | 'admin' | 'recording';
      const num = d.meta.number ? ` ${d.meta.number}` : '';
      const title = `${LABEL[k]}${num} [${d.sha256.slice(0, 8)}]`;
      const existed = ctx.docs.has(`contract|${title}|${o.id}`);
      const docId = await ctx.ensureDoc({ kind: 'contract', title, ownerId: o.id, approve: true, ref: `pandadoc:${d.sha256}` });
      let hasRow = false;
      if (existed && !docId.startsWith('dry:')) hasRow = (await ctx.owners.contractsOfOwner(o.id)).some((c) => c.documentId === docId);
      if (!hasRow) {
        try {
          if (ctx.apply) await ctx.owners.createContract({ ownerId: o.id, documentId: docId, number: d.meta.number ?? null, artistIds: [] });
          log.count(`holder_contracts_created_${k}`);
        } catch (e) {
          log.event('holder_contract_error', `${id8} ${k}: ${errText(e)}`);
          continue;
        }
      } else log.count('already_done');
      confirmed = true;
      if (k === 'recording') continue;
      const from = effectiveMonth(d.meta.effective_date) ?? effectiveMonth(d.meta.signed_on);
      if (!from) {
        log.event('holder_no_effective_date', `${id8} ${k}: no date in the index, no terms`);
        continue;
      }
      const wanted: { type: string | null; percent: string }[] = k === 'co_pub' ? [{ type: null, percent: '50' }] : [{ type: null, percent: '90' }, { type: 'Synchronization', percent: '50' }];
      for (const w of wanted) {
        const key = `${w.type ?? ''}`;
        if (termsDone.has(key)) continue;
        if (terms.some((t) => t.ownerId === o.id && (t.operationType ?? null) === w.type)) {
          log.count('holder_terms_already_there');
          termsDone.add(key);
          continue;
        }
        try {
          if (ctx.apply) await ctx.f.setPublishingTerms({ ownerId: o.id, percent: w.percent, validFrom: from, documentId: docId, operationType: w.type });
          terms.push({ ownerId: o.id, operationType: w.type, validFrom: from } as (typeof terms)[number]);
          termsDone.add(key);
          termsSet++;
          log.event('holder_terms_set', `${id8} ${w.percent}% ${w.type ?? 'any type'} from ${from} (${k})`);
        } catch (e) {
          log.event('holder_terms_error', `${id8}: ${errText(e)}`);
        }
      }
    }
    if (confirmed) log.count('holders_confirmed');
  }
  log.count('holder_terms_set', termsSet);
}

// ---- 5. carves

interface CarveGroup {
  participants: string[];
  upcs: string[];
  title: string;
  reportMonth: string;
  percents: string[];
  rows: { rowNo: number; nickname: string; amount: string }[];
}

export async function stepCarves(ctx: Ctx) {
  const { log } = ctx;
  const groups = readJson<CarveGroup[]>('main/carve_pairs.json');
  const cash = new Map(readJson<CashRow[]>('main/cash_rows.json').map((r) => [r.rowNo, r]));
  const ops = await ctx.settlements.allOperations();
  const opOfRow = new Map<number, (typeof ops)[number]>();
  for (const o of ops) {
    const m = /^mvp:main:(\d+)(?:\s|$)/.exec(o.comment);
    if (m && o.direction === 'in') opOfRow.set(Number(m[1]), o);
  }

  // per participant: percent for each group
  const percentsOf = (g: CarveGroup, comment: string): string[] | null => {
    const n = g.participants.length;
    const two = /\((\d+(?:\.\d+)?)%\s*\/\s*(\d+(?:\.\d+)?)%\)/.exec(comment);
    if (two && n === 2) return [two[1] as string, two[2] as string];
    const each = /по\s+(\d+(?:[.,]\d+)?)%\s+каждому/.exec(comment);
    if (each) return Array(n).fill((each[1] as string).replace(',', '.'));
    if (g.percents.length === n) return g.percents;
    return null;
  };

  log.h('Carve groups');
  // D-137 (E2): the comment's percent is a percent OF NET per participant ("16.66 % (8.33 %/8.33 %)": 8.33 each),
  // entered once per participant and ISRC as `(net, artist_pool)` from the ISRC's first report month, open-ended;
  // the payers' rows fund it pro rata (Main deducts it from the paying artists)
  const replacedRows = new Map<number, string>(); // rowNo -> first participation id
  type Want = { participant: string; upc: string; percent: string; rows: Set<number>; group: number };
  const wants = new Map<string, Want>();
  for (const [gi, g] of groups.entries()) {
    const comment = cash.get(g.rows[0]?.rowNo ?? -1)?.comment ?? '';
    const pcts = g.percents.length === 0 ? null : percentsOf(g, comment);
    if (!pcts) {
      log.event('group_skipped_no_percent', `group ${gi} (${g.participants.length} participant(s), ${g.upcs.length} UPC, ${g.rows.length} rows, ${g.rows.reduce((t, r) => t.add(r.amount), D0()).toFixed(2)}): the percent is not stated; the carve operations stay`);
      continue;
    }
    if (g.upcs.length === 0) {
      log.event('group_skipped_no_upc', `group ${gi}: no UPC in the comment; the carve operations stay`);
      continue;
    }
    if (g.percents.length === 1 && g.participants.length > 1) log.event('percent_split_equally', `group ${gi}`);
    if (g.participants.length === 2 && g.percents.length === 3) log.event('percent_pair_split', `group ${gi}: ${g.percents.join(' / ')} read as the total and the share of each participant`);
    for (const row of g.rows) {
      const cr = cash.get(row.rowNo);
      const src = ctx.resolveArtist({ artistId: cr?.artistId ?? null, pseudonym: row.nickname });
      if (src.status !== 'ok') log.event('source_artist_unresolved', `row ${row.rowNo} ${row.nickname}: ${src.status} (the pool form takes from every row; the row stays as it is)`);
    }
    for (const [pi, participant] of g.participants.entries()) {
      for (const upc of new Set(g.upcs.map(normalizeUpc))) {
        const key = `${normalizeName(participant)}|${upc}`;
        const percent = pct(pcts[pi] as string);
        const w = wants.get(key);
        if (w) {
          if (!new Decimal(w.percent).eq(percent))
            log.event('percent_conflict', `${participant} UPC ${upc}: group ${w.group} ${w.percent}, group ${gi} ${percent}; the first is kept`);
          for (const r of g.rows) w.rows.add(r.rowNo);
        } else wants.set(key, { participant, upc, percent, rows: new Set(g.rows.map((r) => r.rowNo)), group: gi });
      }
    }
  }

  log.h('D-135 carve participations replaced');
  // the D-135 entry: `(bucket, artist_share of the source)` per participant and source, from 2026-07; loader-owned
  // rows (origin mvp:carve, note mvp:carve:...), deleted by their marker through the splits repository
  const old = ctx.participations.filter((p) => p.note?.startsWith('mvp:carve:') && p.fundedFrom === 'artist_share');
  const first = await firstReportMonths(ctx);
  const docs = new Map<string, string>();
  let created = 0;
  const covered = new Map<number, Set<string>>(); // rowNo -> participants (normalised) covered
  await ctx.tx(async () => {
    if (old.length > 0) {
      if (ctx.apply) {
        const n = await ctx.splits.deleteParticipations(old.map((p) => p.id));
        if (n !== old.length) throw new Error(`deleted ${n} of ${old.length} D-135 carve participations`);
      }
      const gone = new Set(old.map((p) => p.id));
      ctx.participations = ctx.participations.filter((p) => !gone.has(p.id));
      log.count('d135_participations_deleted', old.length);
      log.p(`${old.length} D-135 carve participations (origin mvp:carve, note mvp:carve:<participant>:<upc>:<source>:<isrc>) deleted through the splits module (repository delete by id); their assumption documents are reused.`);
    } else log.count('d135_participations_none_left');

    log.h('Participations (net, artist_pool) from the first report month');
    for (const w of wants.values()) {
      const isrcs = [...new Set(ctx.tracksByUpc.get(w.upc) ?? [])].sort();
      const pa = ctx.resolveArtist({ pseudonym: w.participant });
      if (pa.status === 'ambiguous') {
        log.event('participant_ambiguous', `${w.participant} UPC ${w.upc}`);
        continue;
      }
      if (isrcs.length === 0) {
        log.event('upc_without_track', `${w.upc} (${w.participant})`);
        continue;
      }
      let artistId = pa.id;
      if (!artistId) artistId = (await ctx.ownerWithPseudonym(w.participant, 'person', 'mvp:carve')).artistId;
      else if (!ctx.ownerOfArtist(artistId)) {
        log.event('participant_artist_without_owner', `${w.participant}: artist exists without owner; participation kept on the artist`);
      }
      const docKey = `${normalizeName(w.participant)}|${w.upc}`;
      let docId = docs.get(docKey);
      if (!docId) {
        docId = await ctx.ensureDoc({
          kind: 'assumption',
          title: `Assumption M43: participation of ${ctx.knownArtist(artistId)?.pseudonym ?? w.participant} on UPC ${w.upc} from 0to8 Main.xlsx carve rows`,
          approve: false,
          ref: 'mvp-load:carve',
        });
        docs.set(docKey, docId);
      }
      let all = true;
      for (const isrc of isrcs) {
        const fm = first.get(isrc);
        if (!fm) {
          log.event('no_report_month', `${isrc} (UPC ${w.upc}, ${w.participant}): not in the loaded reports, no participation`);
          continue;
        }
        const marker = `mvp:carve2:${normalizeName(w.participant)}:${isrc}`;
        const existing = ctx.participations.find(
          (p) => p.isrc === isrc && p.artistId === artistId && p.fundedFrom === 'artist_pool' && p.validTo === null,
        );
        let id: string | undefined = existing?.id;
        if (existing && existing.note === marker) log.count('already_done');
        else if (existing) log.event('participation_exists_other', `${w.participant} ${isrc}: a pool participation ${existing.note ?? ''} exists; kept`);
        else {
          try {
            id = ctx.fakeId('participation');
            if (ctx.apply)
              id = (
                await ctx.f.createParticipation({
                  isrc,
                  artistId,
                  percent: w.percent,
                  base: 'net',
                  fundedFrom: 'artist_pool',
                  validFrom: fm,
                  documentId: docId,
                  origin: 'mvp:carve',
                  note: marker,
                })
              ).id;
            ctx.participations.push({ id, isrc, artistId, fromArtistId: null, fundedFrom: 'artist_pool', validFrom: fm, validTo: null, note: marker });
            created++;
            log.count('participations_created');
            log.event('participation_created', `${isrc} UPC ${w.upc} ${w.participant} ${w.percent} net/artist_pool from ${fm}`, 400);
          } catch (e) {
            id = undefined;
            all = false;
            log.event('participation_error', `${w.participant} ${isrc}: ${errText(e)}`, 100);
          }
        }
        if (id) for (const r of w.rows) if (!replacedRows.has(r)) replacedRows.set(r, id);
      }
      if (all)
        for (const r of w.rows) {
          const s = covered.get(r) ?? new Set<string>();
          s.add(normalizeName(w.participant));
          covered.set(r, s);
        }
    }
  });
  log.p(`${created} participations created.`);

  log.h('Carve deduction operations replaced by the participations');
  let moved = D0();
  for (const g of groups) {
    for (const r of g.rows) {
      const need = new Set(g.participants.map(normalizeName));
      const got = covered.get(r.rowNo);
      if (!got || ![...need].every((n) => got.has(n))) {
        const op = opOfRow.get(r.rowNo);
        if (op && !op.active) log.event('deactivated_but_not_covered', `row ${r.rowNo} ${r.amount}: the deduction is inactive but not every participant has a participation`);
        continue;
      }
      const op = opOfRow.get(r.rowNo);
      if (!op) {
        log.count('carve_row_without_operation');
        continue;
      }
      if (!op.active) {
        log.count('already_done');
        continue;
      }
      const pid = replacedRows.get(r.rowNo) as string;
      if (ctx.apply) await ctx.settlements.deactivate(op.id, `replaced by participation ${pid}`);
      op.active = false;
      moved = moved.add(op.amountCents);
      log.count('operations_deactivated');
      log.event('operation_deactivated', `row ${r.rowNo} ${r.amount}: replaced by participation ${pid}`, 300);
    }
  }
  const movedUsd = moved.div(100);
  log.count('operations_deactivated_sum_cents', moved.toNumber());
  log.p(`Σ deductions moved to participations: ${movedUsd.toFixed(2)}`);

  log.h('Held participant payouts');
  for (const r of cash.values()) {
    if (r.side !== 'expense' || r.requiresCredit === undefined || r.load !== 'payout') continue;
    const marker = `mvp:main:${r.rowNo}`;
    if (ctx.opMarkers.has(marker)) {
      log.count('already_done');
      continue;
    }
    let ownerId: string, artistId: string;
    const known = r.nicknameStatus === 'matched' ? ctx.knownArtist(r.artistId) : undefined;
    if (known?.ownerId) ({ ownerId, artistId } = { ownerId: known.ownerId, artistId: known.id });
    else ({ ownerId, artistId } = await ctx.ownerWithPseudonym(r.nickname, 'person', 'mvp:main'));
    try {
      const comment = `${marker} ${r.comment}`.trim();
      if (ctx.apply)
        await ctx.f.createOperation({ date: r.date, period: r.reportMonth, migration: true, comment, direction: 'out', amount: r.amount, ownerId, artistId });
      ctx.opMarkers.add(marker);
      log.count('held_payouts_loaded');
      log.event('held_payout', `row ${r.rowNo} ${r.nickname} ${r.amount}`);
    } catch (e) {
      log.event('held_payout_error', `row ${r.rowNo}: ${errText(e)}`);
    }
  }
}
