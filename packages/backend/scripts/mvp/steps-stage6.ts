/**
 * Stage 6 rework steps (D-137): settlement-prestart (E1), assumption-rows (E3), hygiene (E4). The carves rework (E2)
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
 * Owner decision 6 and the Main payment fact (14 §6 E1): before the settlement window (2026-02-01) the participant's
 * legacy split row is removed and its percent goes to the artist row Main paid it to. Main pays that 15 % before
 * 2026-02 to the artist LDRR on all 30 recordings (Main ledger; the stage 5 settlement measurement), so the payee is that pseudonym.
 */
const SETTLEMENT_PAYEE = 'LDRR';
const WINDOW = '2026-02-01';

export async function stepSettlementPrestart(ctx: Ctx) {
  const { log } = ctx;
  const parts = readJson<{ participations: SettlementPart[] }>('annex/participations.json').participations.filter(
    (p) => p.group === 'settlement_15',
  );
  const participant = ctx.knownArtist(parts[0]?.recipient.artistId)?.id;
  const payee = ctx.resolveArtist({ pseudonym: SETTLEMENT_PAYEE });
  if (!participant || payee.status !== 'ok' || !payee.id) {
    log.event('unresolved', `participant ${short(participant)} payee ${payee.status}: nothing done`);
    return;
  }
  const payeeId = payee.id;
  log.p(
    `Settlement participant artist ${short(participant)} (owner ${short(ctx.ownerOfArtist(participant))}); payee artist ${SETTLEMENT_PAYEE} ${short(payeeId)} (owner ${short(ctx.ownerOfArtist(payeeId))}); ${parts.length} ISRC; window from ${WINDOW} unchanged.`,
  );
  const doc = await ctx.ensureDoc({
    kind: 'other',
    title: 'Owner decision 6 of 2026-11-02: settlement share before 2026-02-27',
    approve: true,
    ref: 'mvp-load:annex/participations#settlement',
  });
  const first = await firstReportMonths(ctx);
  log.h('Splits changed before the window');
  let moved = new Decimal(0);
  for (const p of parts) {
    const fm = first.get(p.isrc);
    if (!fm) {
      log.event('no_report_month', `${p.isrc}: not in the loaded reports, nothing to change`);
      continue;
    }
    // the splits before the window that still carry the participant as a row (oldest first)
    const todo = ctx.model
      .of(p.isrc)
      .filter((s) => !isEmptyPeriod(s) && s.from < WINDOW)
      .filter((s) => s.rows.some((r) => r.artistId === participant && new Decimal(r.percent).gt(0)))
      .filter((s) => later(s.from, fm) < earlier(s.to, WINDOW));
    if (todo.length === 0) {
      log.count('already_done');
      continue;
    }
    for (const s of todo) {
      const start = later(s.from, fm);
      const part = s.rows.find((r) => r.artistId === participant) as { percent: string };
      const target = s.rows.find((r) => r.artistId === payeeId);
      if (!target) {
        log.event('payee_not_a_row', `${p.isrc} ${s.from}..${s.to ?? 'open'}: ${SETTLEMENT_PAYEE} is not a row, left as is`);
        continue;
      }
      const rows = ctx
        .keepRowDocs(s, s.rows.filter((r) => r.artistId !== participant), 'always')
        .map((r) =>
          r.artistId === payeeId
            ? { artistId: r.artistId, percent: new Decimal(r.percent).add(part.percent).toFixed(), docId: doc }
            : r,
        );
      const before = s.rows.map((r) => `${r.artistId === participant ? 'S' : r.artistId === payeeId ? SETTLEMENT_PAYEE : short(r.artistId)} ${r.percent}`).join(', ');
      const after = rows.map((r) => `${r.artistId === payeeId ? SETTLEMENT_PAYEE : short(r.artistId)} ${r.percent}`).join(', ');
      try {
        const rec = await ctx.changeSplit({
          isrc: p.isrc,
          from: start,
          rows,
          docId: doc,
          note: `mvp:settlement-prestart:${p.isrc}:${start}`,
        });
        moved = moved.add(part.percent);
        log.count('splits_changed');
        log.event('split_changed', `${p.isrc} ${rec.from}..${rec.to ?? 'open'}: [${before}] -> [${after}]`);
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
