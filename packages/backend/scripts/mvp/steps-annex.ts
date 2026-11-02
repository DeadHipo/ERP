/** Stage 4.1 to 4.3 steps: labels, tracks, splits, normalise-dates, participations, exclusions. */
import { Decimal } from '../../src/shared/money';
import type { ParticipationInput } from '../../src/modules/splits';
import { Ctx, errText, floorMonth, isEmptyPeriod, pct, readJson, type SplitRec } from './lib';

// ================================================================= labels (4.1)

interface LabelsJson {
  ownLabels: string[];
  labels: {
    name: string;
    kind: 'own' | 'sublabel';
    ownLabel: string | null;
    rules: { percent: number; from: string; to: string | null; basis: string; document: string }[];
  }[];
  strings: { string: string; label: string; kind: string }[];
}

export async function stepLabels(ctx: Ctx) {
  const { log } = ctx;
  const j = readJson<LabelsJson>('annex/labels.json');
  const existing = await ctx.labels.listLabels();
  const ids = new Map(existing.map((l) => [l.name.toLowerCase(), l.id]));
  const aliasSeen = new Set(existing.flatMap((l) => l.aliases.map((a) => a.normalize('NFKC').toLowerCase().replace(/\s+/g, ' ').trim())));
  const rulesFrom = new Map(existing.map((l) => [l.id, new Set(l.rules.map((r) => r.validFrom))]));

  const ensureLabel = async (name: string, kind: 'own' | 'sublabel', ownName: string | null): Promise<string> => {
    const hit = ids.get(name.toLowerCase());
    if (hit) return hit;
    const ownId = ownName ? ids.get(ownName.toLowerCase()) : null;
    if (kind === 'sublabel' && !ownId) throw new Error(`own label ${ownName} of ${name} is missing`);
    const id = ctx.apply
      ? (await ctx.labels.createLabel({ name, kind, ownLabelId: ownId ?? null })).id
      : ctx.fakeId('label');
    ids.set(name.toLowerCase(), id);
    rulesFrom.set(id, new Set());
    log.event('label_created', `${name} (${kind}${ownName ? ` of ${ownName}` : ''})`);
    return id;
  };

  log.h('Labels');
  for (const l of j.labels.filter((x) => x.kind === 'own')) await ensureLabel(l.name, 'own', null);
  for (const l of j.labels.filter((x) => x.kind === 'sublabel')) await ensureLabel(l.name, 'sublabel', l.ownLabel);

  log.h('Aliases');
  for (const s of j.strings) {
    const labelId = ids.get(s.label.toLowerCase());
    if (!labelId) {
      log.event('alias_label_missing', `"${s.string}" -> ${s.label}`);
      continue;
    }
    const norm = s.string.normalize('NFKC').toLowerCase().replace(/\s+/g, ' ').trim();
    if (aliasSeen.has(norm)) {
      log.count('alias_exists');
      continue;
    }
    if (ctx.apply) await ctx.labels.addAlias(labelId, s.string);
    aliasSeen.add(norm);
    log.event('alias_added', `"${s.string}" -> ${s.label}`);
  }

  log.h('Sublabel rules');
  for (const l of j.labels.filter((x) => x.kind === 'sublabel')) {
    const labelId = ids.get(l.name.toLowerCase()) as string;
    const recipient = await ctx.ownerWithPseudonym(l.name, 'label', 'mvp:labels');
    for (const r of l.rules) {
      if (rulesFrom.get(labelId)?.has(r.from)) {
        log.count('rule_exists');
        continue;
      }
      let docId: string;
      if (r.basis === 'agreement')
        docId = await ctx.ensureDoc({ kind: 'contract', title: r.document, approve: true, ref: 'mvp-load:annex/labels' });
      else if (r.basis === 'owner_decision_2')
        docId = await ctx.ensureDoc({
          kind: 'other',
          title: 'Owner decision 2 of 2026-11-02 (sublabel half rule)',
          approve: true,
          ref: 'mvp-load:annex/labels',
        });
      else
        docId = await ctx.ensureDoc({
          kind: 'assumption',
          title: `Assumption Q12: half rule for ${l.name}`,
          approve: false,
          ref: 'mvp-load:annex/labels',
        });
      try {
        if (ctx.apply)
          await ctx.f.createLabelRule({
            labelId,
            percent: pct(r.percent),
            recipientArtistId: recipient.artistId,
            validFrom: r.from,
            validTo: r.to,
            documentId: docId,
            note: `mvp:labels:${l.name}:${r.from}`,
          });
        rulesFrom.get(labelId)?.add(r.from);
        log.event('rule_set', `${l.name} ${pct(r.percent)} from ${r.from} to ${r.to ?? 'open'} basis ${r.basis}`);
      } catch (e) {
        log.event('rule_error', `${l.name} from ${r.from}: ${errText(e)}`);
      }
    }
  }
}

// ================================================================= tracks

interface Echo8Tracks {
  tracks: { isrc: string; upc: string; title: string }[];
}
interface DiffRecord {
  isrc: string;
  title: string;
  upc: string | null;
  erpTrack: boolean;
}

export async function ensureTrack(ctx: Ctx, t: { isrc: string; upc: string | null; title: string }, kind: string): Promise<boolean> {
  if (t.upc ? ctx.trackPairs.has(`${t.isrc}|${t.upc}`) : ctx.tracksByIsrc.has(t.isrc)) return false;
  try {
    const id = ctx.apply
      ? (await ctx.owners.createTrack({ title: t.title, isrc: t.isrc, upc: t.upc })).id
      : ctx.fakeId('track');
    const l = ctx.tracksByIsrc.get(t.isrc) ?? [];
    l.push({ id, upc: t.upc, title: t.title, note: null });
    ctx.tracksByIsrc.set(t.isrc, l);
    if (t.upc) {
      ctx.trackPairs.add(`${t.isrc}|${t.upc}`);
      ctx.tracksByUpc.set(t.upc, [...(ctx.tracksByUpc.get(t.upc) ?? []), t.isrc]);
    }
    ctx.log.count(`tracks_created_${kind}`);
    return true;
  } catch (e) {
    ctx.log.event('track_error', `${t.isrc}/${t.upc ?? '-'}: ${errText(e)}`, 50);
    return false;
  }
}

export async function stepTracks(ctx: Ctx, only: 'echo8' | 'annex' | 'both' = 'both') {
  const { log } = ctx;
  if (only !== 'annex') {
    log.h('Echo8 tracks (ISRC, UPC pairs of the Echo8 account not in the ERP)');
    for (const t of readJson<Echo8Tracks>('echo8/tracks.json').tracks) {
      if (await ensureTrack(ctx, { isrc: t.isrc, upc: t.upc, title: t.title }, 'echo8'))
        log.event('track_created', `${t.isrc} / ${t.upc}`, 20);
    }
  }
  if (only !== 'echo8') {
    log.h('Annex ISRC without a track');
    const seen = new Set<string>();
    for (const r of readJson<{ records: DiffRecord[] }>('annex/splits_diff.json').records) {
      if (r.erpTrack || seen.has(r.isrc)) continue;
      seen.add(r.isrc);
      if (await ensureTrack(ctx, { isrc: r.isrc, upc: r.upc, title: r.title }, 'annex'))
        log.event('track_created', `${r.isrc} / ${r.upc ?? '-'}`, 50);
    }
  }
}

// ================================================================= splits (4.2)

interface AnnexRow {
  name: string;
  percent: number;
  artistId: string | null;
  candidates: unknown;
}
interface SplitDiff {
  records: {
    isrc: string;
    classification: string;
    subtype: string;
    annex: { period: { from: string | null; kind: string }; rowsExpected: AnnexRow[]; rowsBasis: string };
  }[];
  buyouts: { isrc?: string; interestKind: string; seller: string; instrument: string; effectiveDate: string; erpSplitsStartingInEffectiveMonth: unknown[] }[];
  m51SeeInstrument: { isrc: string; seller: string; instrument: string; effectiveDate: string; sellerPercentPerRow: unknown }[];
  m52Normalisations: unknown[];
}
interface PartJson {
  participations: PartRec[];
  splitRewrites: Rewrite[];
  unresolved: { group: string; recipient: { pseudonym: string }; reason: string; needs: string }[];
}
interface Rewrite {
  group: string;
  isrc: string;
  validFrom: string;
  changed?: boolean;
  keepOriginalDocument?: boolean;
  artistRowsAfter?: { pseudonym: string; artistId: string; percent: number }[];
  rowsAfter?: { pseudonym: string; artistId: string; percent: number }[];
}
interface PartRec {
  id: string;
  group: string;
  isrc: string;
  recipient: { pseudonym: string; artistId: string | null; toCreate: boolean };
  percent: number;
  base: string;
  fundedFrom: string;
  fromArtist: { pseudonym: string; artistId: string | null } | null;
  validFrom: string;
  validTo: string | null;
  document: { title: string; ref?: string } | null;
  basis: string;
  recipientIsSplitRowNow: unknown;
}

const sameRows = (a: { artistId: string; percent: string }[], b: { artistId: string; percent: string }[]) =>
  a.length === b.length &&
  a.every((x) => b.some((y) => y.artistId === x.artistId && new Decimal(y.percent).eq(x.percent)));

const showRows = (ctx: Ctx, rows: { artistId: string; percent: string }[]) =>
  rows.map((r) => `${ctx.knownArtist(r.artistId)?.pseudonym ?? r.artistId} ${r.percent}`).join(', ') || '(no rows)';

const docRef = 'mvp-load:annex/splits';

export async function stepSplits(ctx: Ctx) {
  const { log } = ctx;
  const d = readJson<SplitDiff>('annex/splits_diff.json');
  const rewriteIsrcs = new Set(readJson<PartJson>('annex/participations.json').splitRewrites.map((r) => r.isrc));
  const m51 = new Set(d.m51SeeInstrument.map((m) => m.isrc));
  const ppPresent = new Set(
    d.buyouts.filter((b) => b.isrc && b.interestKind === 'pp' && b.erpSplitsStartingInEffectiveMonth.length > 0).map((b) => b.isrc as string),
  );
  const docId = await ctx.ensureDoc({
    kind: 'appendix',
    title: 'Annex 14 Splits by ISRC 2026-11-02',
    approve: false,
    ref: docRef,
  });

  log.h('Changes');
  let n = 0;
  for (const rec of d.records) {
    const c = rec.classification;
    if (c === 'same' || c === 'erp_only') continue;
    if (c === 'different_period') {
      log.count('different_period_left_to_normalise_dates');
      continue;
    }
    if (c !== 'missing_in_erp' && c !== 'different_rows') continue;
    if (m51.has(rec.isrc)) {
      log.count('skipped_m51');
      continue;
    }
    if (rewriteIsrcs.has(rec.isrc)) {
      log.count('skipped_handled_by_participations_rewrite');
      continue;
    }
    if (c === 'different_rows' && ppPresent.has(rec.isrc)) {
      log.event('skipped_buyout_pp_erp_period_present', rec.isrc, 100);
      continue;
    }
    const from = rec.annex.period.from ?? '2000-01-01';
    const marker = `mvp:splits:${rec.isrc}:${from}`;
    if (ctx.model.hasNote(rec.isrc, marker)) {
      log.count('already_done');
      continue;
    }
    const wanted = rec.annex.rowsExpected.filter((r) => r.percent > 0);
    if (wanted.length === 0) {
      log.event('skipped_no_rows', `${rec.isrc} (${c}/${rec.subtype}): the Annex prints no artist rows`, 30);
      continue;
    }
    // resolve artists (unresolved names become artists without owner, origin mvp:annex)
    const rows: { artistId: string; percent: string }[] = [];
    let blocked = false;
    for (const r of wanted) {
      const id = await ctx.artistOrCreate({ artistId: r.artistId, pseudonym: r.name }, 'mvp:annex');
      if (!id) {
        log.event('unresolved_name', `${rec.isrc}: "${r.name}" matches several artists`, 50);
        blocked = true;
        break;
      }
      rows.push({ artistId: id, percent: pct(r.percent) });
    }
    if (blocked) continue;
    const fromFloor = floorMonth(from);
    const before = ctx.model.inForce(rec.isrc, fromFloor);
    if (before && sameRows(before.rows, rows)) {
      log.count('already_equal');
      continue;
    }
    try {
      let after: SplitRec;
      if (ctx.model.of(rec.isrc).length === 0) {
        after = await ctx.createSplit({ isrc: rec.isrc, from, rows, docId, note: marker });
        log.event('split_created', `${rec.isrc} from ${after.from}: ${showRows(ctx, rows)} | doc Annex 14`, 400);
      } else {
        const withDocs = ctx.keepRowDocs(before, rows, 'same_percent');
        after = await ctx.changeSplit({ isrc: rec.isrc, from, rows: withDocs, docId, note: marker });
        log.event(
          'split_changed',
          `${rec.isrc} from ${after.from}: before [${before ? showRows(ctx, before.rows) : 'none in force'}] after [${showRows(ctx, rows)}] | doc Annex 14`,
          400,
        );
      }
    } catch (e) {
      log.event('split_error', `${rec.isrc} from ${from}: ${errText(e)}`, 100);
    }
    if (++n % 100 === 0) console.log(`  splits: ${n} changes`);
  }

  log.h('M51: buy-outs "see the instrument" (seller percent per row unknown, no change made)');
  for (const m of d.m51SeeInstrument) log.event('m51', `${m.isrc} seller ${m.seller}, instrument ${m.instrument}, effective ${m.effectiveDate}`);
}

// ================================================================= normalise-dates (M52)

export async function stepNormalise(ctx: Ctx) {
  const { log } = ctx;
  log.h('Splits normalised to the month start');
  const dayOk = (d: string | null) => d === null || d.endsWith('-01');
  for (const [isrc, list] of [...ctx.model.byIsrc.entries()]) {
    if (list.every((s) => dayOk(s.from) && dayOk(s.to))) continue;
    const plan = list.map((s) => ({
      s,
      from: floorMonth(s.from),
      to: s.to === null ? null : floorMonth(s.to),
      wasEmpty: isEmptyPeriod(s),
    }));
    // invariants: no split that held days becomes empty; the non-empty periods do not overlap (no two start in one month)
    const bad = plan.find((p) => !p.wasEmpty && p.to !== null && p.to <= p.from);
    if (bad) {
      log.event('conflict_starts_and_ends_in_one_month', `${isrc}: split ${bad.s.from}..${bad.s.to} sits inside one month`, 200);
      continue;
    }
    const live = plan.filter((p) => !(p.to !== null && p.to <= p.from)).sort((a, b) => a.from.localeCompare(b.from));
    let clash: string | null = null;
    for (let i = 1; i < live.length; i++) {
      const prev = live[i - 1];
      const cur = live[i];
      if (prev && cur && (prev.to ?? '9999-12-31') > cur.from) clash = `${prev.from}..${prev.to ?? 'open'} overlaps ${cur.from}`;
    }
    if (clash) {
      log.event('conflict_overlap_after_flooring', `${isrc}: ${clash}`, 200);
      continue;
    }
    try {
      const changed = plan.filter((p) => p.from !== p.s.from || p.to !== p.s.to);
      await ctx.tx(async () => {
        if (ctx.apply)
          for (const p of changed)
            await ctx.stack.db.query('UPDATE splits.splits SET valid_from = $1, valid_to = $2 WHERE id = $3', [p.from, p.to, p.s.id]);
      });
      for (const p of changed) {
        log.event(
          p.from !== p.s.from ? 'valid_from_floored' : 'valid_to_floored',
          `${isrc}: ${p.s.from}..${p.s.to ?? 'open'} -> ${p.from}..${p.to ?? 'open'}`,
          60,
        );
        if (p.from !== p.s.from) log.count('valid_from_floored_all');
        if (p.to !== p.s.to) log.count('valid_to_floored_all');
        p.s.from = p.from;
        p.s.to = p.to;
      }
      list.sort((a, b) => a.from.localeCompare(b.from));
    } catch (e) {
      log.event('normalise_error', `${isrc}: ${errText(e)}`, 100);
    }
  }
}

// ================================================================= participations (4.3)

const docKindOf = (basis: string): 'contract' | 'assumption' | 'other' =>
  /assumption/.test(basis) ? 'assumption' : /contract/.test(basis) ? 'contract' : 'other';

export async function stepParticipations(ctx: Ctx) {
  const { log } = ctx;
  const j = readJson<PartJson>('annex/participations.json');

  log.h('Split rewrites (Sleeping City Funk, floor titles)');
  const od4 = await ctx.ensureDoc({
    kind: 'other',
    title: 'Owner decision 4 (label share 50, not diluted by MC and co-authors)',
    approve: true,
    ref: 'mvp-load:annex/participations',
  });
  for (const rw of j.splitRewrites) {
    const target = rw.artistRowsAfter ?? rw.rowsAfter ?? [];
    const marker = `mvp:participations:rewrite:${rw.isrc}`;
    if (rw.changed === false) {
      log.event('rewrite_unchanged', `${rw.isrc} (${rw.group}): rows already sum to 50, nothing to do`);
      continue;
    }
    if (ctx.model.hasNote(rw.isrc, marker)) {
      log.count('already_done');
      continue;
    }
    const rows: { artistId: string; percent: string }[] = [];
    for (const r of target) {
      const id = await ctx.artistOrCreate({ artistId: r.artistId, pseudonym: r.pseudonym }, 'mvp:participations');
      if (!id) {
        log.event('unresolved_name', `${rw.isrc}: "${r.pseudonym}"`);
        continue;
      }
      rows.push({ artistId: id, percent: pct(r.percent) });
    }
    const from = floorMonth(rw.validFrom);
    const old = ctx.model.inForce(rw.isrc, from);
    if (old && sameRows(old.rows, rows)) {
      log.count('already_equal');
      continue;
    }
    try {
      const docId = old?.docId ?? od4;
      const after = await ctx.changeSplit({
        isrc: rw.isrc,
        from,
        rows: ctx.keepRowDocs(old, rows, 'always'),
        docId,
        note: marker,
      });
      log.event(
        'rewrite',
        `${rw.isrc} (${rw.group}) from ${after.from}: before [${old ? showRows(ctx, old.rows) : 'none'}] after [${showRows(ctx, rows)}] | rows keep their documents, split document ${old?.docId ? 'kept' : 'owner decision 4'}`,
      );
    } catch (e) {
      log.event('rewrite_error', `${rw.isrc}: ${errText(e)}`);
    }
  }

  log.h('Participations');
  for (const u of j.unresolved)
    log.event('unresolved_participation', `${u.group} ${u.recipient.pseudonym}: ${u.reason} Needs: ${u.needs}`);
  for (const p of j.participations) {
    const marker = `mvp:participations:${p.id}`;
    if (ctx.hasParticipationNote(marker)) {
      log.count('already_done');
      continue;
    }
    const recipient = await ctx.artistOrCreate({ artistId: p.recipient.artistId, pseudonym: p.recipient.pseudonym }, 'mvp:participations');
    const fromArtist = p.fromArtist
      ? await ctx.artistOrCreate({ artistId: p.fromArtist.artistId, pseudonym: p.fromArtist.pseudonym }, 'mvp:participations')
      : null;
    if (!recipient || (p.fromArtist && !fromArtist)) {
      log.event('unresolved_name', `${p.id}: recipient or source artist matches several artists`);
      continue;
    }
    const kind = docKindOf(p.basis);
    const documentId = p.document
      ? await ctx.ensureDoc({
          kind,
          title: p.document.title,
          approve: kind !== 'assumption',
          ref: p.document.ref ? `pandadoc:${p.document.ref}` : 'mvp-load:annex/participations',
        })
      : null;
    const from = floorMonth(p.validFrom);
    const to = p.validTo ? floorMonth(p.validTo) : null;
    const snapshot = structuredClone(ctx.model.of(p.isrc));
    try {
      await ctx.tx(async () => {
        const removed: string[] = [];
        // the recipient may not also be a split row on the ISRC in the period (D-126): remove its row first
        const affected = ctx.model
          .of(p.isrc)
          .filter((s) => !isEmptyPeriod(s) && s.from < (to ?? '9999-12-31') && from < (s.to ?? '9999-12-31'))
          .filter((s) => s.rows.some((r) => r.artistId === recipient && new Decimal(r.percent).gt(0)))
          .map((s) => (s.from > from ? s.from : from));
        for (const start of affected) {
          const old = ctx.model.inForce(p.isrc, start);
          if (!old) continue;
          if (!documentId) throw new Error('a row removal needs a document');
          const rest = old.rows.filter((r) => r.artistId !== recipient);
          await ctx.changeSplit({
            isrc: p.isrc,
            from: start,
            rows: ctx.keepRowDocs(old, rest, 'always'),
            docId: documentId,
            note: `mvp:participations:rowremove:${p.id}`,
          });
          removed.push(start);
        }
        // overlap and double-participation checks of the module, mirrored for the dry run
        for (const o of ctx.participations)
          if (o.isrc === p.isrc && o.artistId === recipient && o.fundedFrom === p.fundedFrom && (o.fromArtistId ?? null) === (fromArtist ?? null) && o.validFrom < (to ?? '9999-12-31') && from < (o.validTo ?? '9999-12-31'))
            throw new Error('participation_overlap');
        const input: ParticipationInput = {
          isrc: p.isrc,
          artistId: recipient,
          percent: pct(p.percent),
          base: p.base as ParticipationInput['base'],
          fundedFrom: p.fundedFrom as ParticipationInput['fundedFrom'],
          fromArtistId: fromArtist ?? null,
          validFrom: from,
          validTo: to,
          documentId,
          origin: 'mvp:participations',
          note: marker,
        };
        const id = ctx.apply ? (await ctx.f.createParticipation(input)).id : ctx.fakeId('part');
        ctx.participations.push({ id, isrc: p.isrc, artistId: recipient, fromArtistId: fromArtist ?? null, fundedFrom: p.fundedFrom, validFrom: from, validTo: to, note: marker });
        log.event(
          'participation_created',
          `${p.isrc} ${p.recipient.pseudonym} ${pct(p.percent)} ${p.base}/${p.fundedFrom}${p.fromArtist ? ` from ${p.fromArtist.pseudonym}` : ''} ${from}..${to ?? 'open'} | ${kind} doc "${p.document?.title.slice(0, 60) ?? '-'}"${removed.length ? ` | split row removed from ${removed.join(',')}` : ''}`,
          400,
        );
      });
    } catch (e) {
      ctx.model.byIsrc.set(p.isrc, snapshot);
      log.event('participation_error', `${p.id}: ${errText(e)}`, 100);
    }
  }
}

// ================================================================= exclusions

interface ExclJson {
  duetti: {
    instruments: Record<string, { agreement: string; effectiveMonth: string }>;
    isrc: { isrc: string; instrument: string; saleEffectiveMonth: string }[];
  };
  withdrawn: { isrc: string }[];
  derivativeOutsideAuthorisation: { isrc: { isrc: string; upc: string; trackNote: string }[] };
  echo8Repertoire: { count: number };
}

export async function stepExclusions(ctx: Ctx) {
  const { log } = ctx;
  const j = readJson<ExclJson>('annex/exclusions.json');

  log.h('Duetti: split to the buyer at 100 from the sale month');
  const duetti = await ctx.ownerWithPseudonym('Duetti', 'label', 'mvp:exclusions');
  const docs = new Map<string, string>();
  for (const [k, ins] of Object.entries(j.duetti.instruments))
    docs.set(
      k,
      await ctx.ensureDoc({ kind: 'contract', title: ins.agreement, ownerId: duetti.ownerId, approve: true, ref: 'mvp-load:annex/exclusions' }),
    );
  for (const r of j.duetti.isrc) {
    const marker = `mvp:exclusions:duetti:${r.isrc}`;
    if (ctx.model.hasNote(r.isrc, marker)) {
      log.count('already_done');
      continue;
    }
    const docId = docs.get(r.instrument) as string;
    const from = floorMonth(r.saleEffectiveMonth);
    const rows = [{ artistId: duetti.artistId, percent: '100' }];
    const snapshot = structuredClone(ctx.model.of(r.isrc));
    try {
      // the split in force at the sale month and every later one go to the buyer
      const starts = [from, ...ctx.model.of(r.isrc).filter((s) => !isEmptyPeriod(s) && s.from > from).map((s) => s.from)];
      for (const start of starts) {
        const old = ctx.model.inForce(r.isrc, start);
        await ctx.changeSplit({ isrc: r.isrc, from: start, rows, docId, note: marker });
        log.event(
          'duetti_split',
          `${r.isrc} ${r.instrument} from ${start}: before [${old ? showRows(ctx, old.rows) : 'none in force'}] after [Duetti 100]`,
          400,
        );
      }
    } catch (e) {
      ctx.model.byIsrc.set(r.isrc, snapshot);
      log.event('duetti_error', `${r.isrc}: ${errText(e)}`, 100);
    }
  }

  log.h('Withdrawn recordings');
  log.p(`${j.withdrawn.length} ISRC: nothing to enter (not in the current catalogue, outside the perimeter).`);
  log.count('withdrawn_listed', j.withdrawn.length);

  log.h('Derivatives outside the authorisation: track note');
  for (const t of j.derivativeOutsideAuthorisation.isrc) {
    const tracks = ctx.tracksByIsrc.get(t.isrc) ?? [];
    const track = tracks.find((x) => x.upc === t.upc) ?? tracks[0];
    if (!track) {
      log.event('note_track_missing', `${t.isrc}: no track`);
      continue;
    }
    if (track.note === t.trackNote) {
      log.count('already_done');
      continue;
    }
    try {
      if (ctx.apply) await ctx.owners.setTrackNote(track.id, t.trackNote);
      track.note = t.trackNote;
      log.event('track_note_set', `${t.isrc}: "${t.trackNote.slice(0, 80)}..."`);
    } catch (e) {
      log.event('note_error', `${t.isrc}: ${errText(e)}`);
    }
  }

  log.h('Echo8 repertoire list');
  log.p(`${j.echo8Repertoire.count} ISRC: nothing here (a filter of the stage 5 comparison).`);
}
