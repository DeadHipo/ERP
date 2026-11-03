/**
 * Stage 6 rework steps (D-137): settlement-prestart (E1, pro rata since D-138), assumption-rows (E3), hygiene (E4). The carves rework (E2)
 * is in steps-main.ts (`stepCarves`). Same conventions as the other steps: facade calls, markers in the split note,
 * a dry run against the in-memory model, no personal data in the log (owners by id prefix, stage names only where
 * they are not a person's name).
 */
import { Decimal } from '../../src/shared/money';
import { Ctx, errText, isEmptyPeriod, readJson, type SplitRec } from './lib';

/** The first report month (`YYYY-MM-01`) of every ISRC of the loaded Believe files. */
export async function firstReportMonths(ctx: Ctx): Promise<Map<string, string>> {
  const first = new Map<string, string>();
  for (const u of await ctx.believeUnits()) {
    const m = `${u.reportingMonth.slice(0, 7)}-01`;
    const cur = first.get(u.isrc);
    if (!cur || m < cur) first.set(u.isrc, m);
  }
  return first;
}

const short = (id: string | null | undefined) => (id ? id.slice(0, 8) : '-');
const later = (a: string, b: string) => (a > b ? a : b);
const earlier = (a: string | null, b: string) => (a === null || b < a ? b : a);

// ================================================================= settlement-prestart (E1)

interface SettlementPart {
  group: string;
  isrc: string;
  recipient: { artistId: string | null };
  validFrom: string;
}

/**
 * Owner decision 6 and the Main payment fact (D-137, reworked by D-138): before the settlement window (2026-02-01)
 * the participant's legacy split row is removed and its percent is spread over the other rows of the legacy split
 * **pro rata to their percents** (Main paid DJ Ikeraus and LDRR +7.5 each where both held 17.5; G47). The weights
 * are the rows of the ISRC's first split that holds the participant (the legacy appendix). A row that is 0 in a later
 * split (bought out) takes nothing: its part stays with the label, as the buy-out moved the whole row to the label.
 * Every split before the window is changed from max(its `valid_from`, the ISRC's first report month).
 *
 * Re-entry of the D-137 form: a split with the old marker `mvp:settlement-prestart:` carries the whole percent on the
 * D-137 payee row (LDRR). It is re-entered from the same date under the same document (the splits service keeps the
 * replaced split as an empty period `[d, d)`, which `hygiene` deletes); the legacy rows are its rows with the base
 * percent taken back from the payee row. A D-137 split whose rows are already the pro rata rows (the payee is the only
 * other row) is left as it is.
 */
const D137_PAYEE = 'LDRR';
const WINDOW = '2026-02-01';
const OLD_MARK = 'mvp:settlement-prestart:';
const MARK = 'mvp:settlement-prorata:';

/** `total` spread over the weights pro rata, 6 decimals (the precision of a split row); the remainder to the last. */
function spread(total: Decimal, weights: { artistId: string; percent: string }[]): Map<string, Decimal> {
  const sum = weights.reduce((t, w) => t.add(w.percent), new Decimal(0));
  const out = new Map<string, Decimal>();
  let left = total;
  weights.forEach((w, i) => {
    const v = i === weights.length - 1 ? left : total.mul(w.percent).div(sum).toDecimalPlaces(6, Decimal.ROUND_DOWN);
    out.set(w.artistId, v);
    left = left.sub(v);
  });
  return out;
}

export async function stepSettlementPrestart(ctx: Ctx) {
  const { log } = ctx;
  const parts = readJson<{ participations: SettlementPart[] }>('annex/participations.json').participations.filter(
    (p) => p.group === 'settlement_15',
  );
  const participant = ctx.knownArtist(parts[0]?.recipient.artistId)?.id;
  if (!participant) {
    log.event('unresolved', 'settlement participant not found: nothing done');
    return;
  }
  const oldPayee = ctx.resolveArtist({ pseudonym: D137_PAYEE });
  const oldPayeeId = oldPayee.status === 'ok' ? oldPayee.id : null;
  log.p(
    `Settlement participant artist ${short(participant)} (owner ${short(ctx.ownerOfArtist(participant))}); ${parts.length} ISRC; window from ${WINDOW} unchanged; the participant's legacy percent is spread pro rata over the other legacy rows (D-138). D-137 payee ${D137_PAYEE} ${short(oldPayeeId)} (only to re-enter the splits of the D-137 form).`,
  );
  const doc = await ctx.ensureDoc({
    kind: 'other',
    title: 'Owner decision 6 of 2026-11-02: settlement share before 2026-02-27',
    approve: true,
    ref: 'mvp-load:annex/participations#settlement',
  });
  const first = await firstReportMonths(ctx);
  const gt0 = (p: string) => new Decimal(p).gt(0);
  const holds = (s: SplitRec) => s.rows.some((r) => r.artistId === participant && gt0(r.percent));
  const label = (id: string) => (id === participant ? 'S' : id === oldPayeeId ? D137_PAYEE : short(id));
  log.h('Splits changed before the window');
  for (const p of parts) {
    const fm = first.get(p.isrc);
    if (!fm) {
      log.event('no_report_month', `${p.isrc}: not in the loaded reports, nothing to change`);
      continue;
    }
    const list = ctx.model.of(p.isrc).filter((s) => !isEmptyPeriod(s));
    const base = list.find(holds);
    if (!base) {
      log.event('no_legacy_split', `${p.isrc}: no split holds the participant, nothing to change`);
      continue;
    }
    const legacyPart = new Decimal((base.rows.find((r) => r.artistId === participant) as { percent: string }).percent);
    const weights = base.rows.filter((r) => r.artistId !== participant && gt0(r.percent));
    if (weights.length === 0) {
      log.event('no_other_rows', `${p.isrc}: the legacy split has no other row, left as is`);
      continue;
    }
    const inc = spread(legacyPart, weights);
    // the splits before the window still in a legacy form: holding the participant, or the D-137 form (oldest first)
    const todo = list
      .filter((s) => s.from < WINDOW && later(s.from, fm) < earlier(s.to, WINDOW))
      .filter((s) => holds(s) || (s.note ?? '').startsWith(OLD_MARK));
    if (todo.length === 0) {
      log.count('already_done');
      continue;
    }
    for (const s of todo) {
      const start = later(s.from, fm);
      let legacy: { artistId: string; percent: string }[];
      if (holds(s)) legacy = s.rows.filter((r) => r.artistId !== participant);
      else {
        const payeeRow = s.rows.find((r) => r.artistId === oldPayeeId);
        if (!payeeRow || new Decimal(payeeRow.percent).lt(legacyPart)) {
          log.event('d137_form_unexpected', `${p.isrc} ${s.from}: no ${D137_PAYEE} row carrying ${legacyPart.toFixed()}, left as is`);
          continue;
        }
        legacy = s.rows.map((r) =>
          r.artistId === oldPayeeId ? { artistId: r.artistId, percent: new Decimal(r.percent).sub(legacyPart).toFixed() } : r,
        );
      }
      let kept = new Decimal(0);
      const rows = ctx.keepRowDocs(s, legacy, 'always').map((r) => {
        const add = inc.get(r.artistId);
        if (!add) return r;
        if (!gt0(r.percent)) {
          kept = kept.add(add);
          return r;
        }
        return { artistId: r.artistId, percent: new Decimal(r.percent).add(add).toFixed(), docId: doc };
      });
      const same =
        rows.length === s.rows.length &&
        rows.every((r) => s.rows.some((x) => x.artistId === r.artistId && new Decimal(x.percent).eq(r.percent) && x.docId === r.docId));
      if (same) {
        // a D-137 split whose only other row is the payee: the pro rata rows are the same, nothing to change
        log.count('already_pro_rata');
        continue;
      }
      const before = s.rows.map((r) => `${label(r.artistId)} ${new Decimal(r.percent).toFixed()}`).join(', ');
      const after = rows.map((r) => `${label(r.artistId)} ${new Decimal(r.percent).toFixed()}`).join(', ');
      try {
        const rec = await ctx.changeSplit({
          isrc: p.isrc,
          from: start,
          rows,
          docId: doc,
          note: `${MARK}${p.isrc}:${start}`,
        });
        log.count('splits_changed');
        if (!holds(s)) log.count('d137_form_reentered');
        if (kept.gt(0)) log.count('splits_with_bought_out_part_to_label');
        log.event(
          'split_changed',
          `${p.isrc} ${rec.from}..${rec.to ?? 'open'}: [${before}] -> [${after}]${kept.gt(0) ? ` (${kept.toFixed()} of a bought-out row stays with the label)` : ''}`,
        );
      } catch (e) {
        log.event('change_error', `${p.isrc} from ${start}: ${errText(e)}`);
      }
    }
  }
}

// ================================================================= assumption-rows (E3)

/**
 * Q1 and Q5 (D-123, 10 §7): the row of a disputed party carries its own `assumption` document, so its money is
 * C `assumption`. Q1: the FUNK DO SURPRISE licensor row (MC ROBA CENA 20 %) on FRX762590589…592. Q5: the Lost Label
 * rows on the ISRC whose split also has rows of the DJ DYLANFK or DJ Raulipues schedules. Same percents; each split
 * that holds the row is changed from max(its valid_from, the ISRC's first report month), so a split that covers only
 * months without reports is left as it is.
 */
export async function stepAssumptionRows(ctx: Ctx) {
  const { log } = ctx;
  const first = await firstReportMonths(ctx);
  const ownerOf = (pseudonym: string) => {
    const r = ctx.resolveArtist({ pseudonym });
    return r.id ? ctx.ownerOfArtist(r.id) : null;
  };
  const artistsOfOwner = (owner: string | null) =>
    new Set(owner ? [...ctx.artistsById.values()].filter((a) => a.ownerId === owner).map((a) => a.id) : []);

  const q1Doc = await ctx.ensureDoc({
    kind: 'assumption',
    title: 'Assumption Q1: licence base less other participants; envelope not closed',
    approve: false,
    ref: 'mvp-load:assumption-rows#q1',
  });
  const q5Doc = await ctx.ensureDoc({
    kind: 'assumption',
    title: 'Assumption Q5: conflicting schedules (Lost Label vs direct artist schedules)',
    approve: false,
    ref: 'mvp-load:assumption-rows#q5',
  });

  const licensor = ctx.resolveArtist({ pseudonym: 'MC ROBA CENA' }).id;
  const lostLabel = artistsOfOwner(ownerOf('Lost Label LLC'));
  const direct = new Set([...artistsOfOwner(ownerOf('DJ DYLANFK')), ...artistsOfOwner(ownerOf('DJ Raulipues'))]);
  log.p(
    `Q1 licensor artist ${short(licensor)}; Q5 Lost Label owner ${short(ownerOf('Lost Label LLC'))} (${lostLabel.size} pseudonyms), direct schedule owners ${short(ownerOf('DJ DYLANFK'))}, ${short(ownerOf('DJ Raulipues'))} (${direct.size} pseudonyms).`,
  );

  const targets: { q: 'Q1' | 'Q5'; isrc: string; artists: Set<string>; doc: string }[] = [];
  if (licensor)
    for (const isrc of ['FRX762590589', 'FRX762590590', 'FRX762590591', 'FRX762590592'])
      targets.push({ q: 'Q1', isrc, artists: new Set([licensor]), doc: q1Doc });
  for (const [isrc, list] of ctx.model.byIsrc) {
    const shared = list.some(
      (s) =>
        !isEmptyPeriod(s) &&
        s.rows.some((r) => lostLabel.has(r.artistId) && new Decimal(r.percent).gt(0)) &&
        s.rows.some((r) => direct.has(r.artistId)),
    );
    if (shared) targets.push({ q: 'Q5', isrc, artists: lostLabel, doc: q5Doc });
  }
  log.count('isrc_q1', targets.filter((t) => t.q === 'Q1').length);
  log.count('isrc_q5', targets.filter((t) => t.q === 'Q5').length);

  log.h('Rows given their assumption document');
  for (const t of targets.sort((a, b) => a.q.localeCompare(b.q) || a.isrc.localeCompare(b.isrc))) {
    const fm = first.get(t.isrc);
    if (!fm) {
      log.event('no_report_month', `${t.q} ${t.isrc}: not in the loaded reports, nothing to change`);
      continue;
    }
    const needs = (s: SplitRec) =>
      !isEmptyPeriod(s) &&
      (s.to === null || s.to > fm) &&
      (t.q === 'Q1' || s.rows.some((r) => direct.has(r.artistId))) &&
      s.rows.some((r) => t.artists.has(r.artistId) && new Decimal(r.percent).gt(0) && r.docId !== t.doc);
    const todo = ctx.model.of(t.isrc).filter(needs);
    if (todo.length === 0) {
      log.count('already_done');
      continue;
    }
    for (const s of todo) {
      const start = later(s.from, fm);
      const rows = ctx
        .keepRowDocs(s, s.rows, 'always')
        .map((r) => (t.artists.has(r.artistId) && new Decimal(r.percent).gt(0) ? { ...r, docId: t.doc } : r));
      if (!s.docId) {
        log.event('split_without_document', `${t.q} ${t.isrc} ${s.from}: the split has no document; left as is`);
        continue;
      }
      try {
        const rec = await ctx.changeSplit({
          isrc: t.isrc,
          from: start,
          rows,
          docId: s.docId,
          note: `mvp:assumption-rows:${t.q}:${t.isrc}:${start}`,
        });
        log.count(`splits_changed_${t.q}`);
        log.event(
          `row_document_${t.q}`,
          `${t.isrc} ${rec.from}..${rec.to ?? 'open'}: ${rows.filter((r) => r.docId === t.doc).map((r) => `${short(r.artistId)} ${r.percent}`).join(', ')} -> assumption document; split document kept`,
        );
      } catch (e) {
        log.event('change_error', `${t.q} ${t.isrc} from ${start}: ${errText(e)}`);
      }
    }
  }
}

// ================================================================= hygiene (E4)

/**
 * Deletes the splits with an empty period (`valid_to = valid_from`). They are never in force (no money); the splits
 * service leaves one behind when a split is replaced from its first day ("history is kept"), and the facade refuses to
 * create one (`empty_period`, D-130). Splits module `deleteEmptySplits` (repository SQL), logged per split.
 */
export async function stepHygiene(ctx: Ctx) {
  const { log } = ctx;
  const empty = [...ctx.model.byIsrc.values()].flat().filter((s) => isEmptyPeriod(s) && s.to === s.from);
  log.h('Empty-period splits deleted');
  if (empty.length === 0) {
    log.count('already_done');
    return;
  }
  const byNote = new Map<string, number>();
  for (const s of empty) {
    const k = (s.note ?? '').replace(/:[^:]*$/, '').slice(0, 40) || '(no note)';
    byNote.set(k, (byNote.get(k) ?? 0) + 1);
  }
  for (const [k, n] of [...byNote].sort((a, b) => b[1] - a[1])) log.bullet(`${n} with note "${k}"`);
  let deleted: string[];
  try {
    deleted = ctx.apply ? await ctx.splits.deleteEmptySplits(empty.map((s) => s.id)) : empty.map((s) => s.id);
  } catch (e) {
    log.event('delete_error', errText(e));
    return;
  }
  const gone = new Set(deleted);
  for (const s of empty) {
    if (!gone.has(s.id)) continue;
    log.event('split_deleted', `${s.isrc} ${s.from}..${s.to} (${s.rows.length} rows, note "${(s.note ?? '').slice(0, 40)}")`, 200);
    ctx.model.byIsrc.set(
      s.isrc,
      ctx.model.of(s.isrc).filter((x) => x.id !== s.id),
    );
  }
  log.count('splits_deleted', gone.size);
}
