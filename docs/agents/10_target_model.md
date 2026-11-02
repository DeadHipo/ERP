# Target model: layered calculation (stage 2 of the MVP goal, 2026-11-02, revision 2 after the council)

Input: `09_settlement_cases.md` (accepted, `reviews/stage1_*.md`). Council verdicts on revision 1 of this design and
what changed: `reviews/stage2_*.md`. This file is the design that stage 3 implements and stage 4 fills with data.
Decisions are logged as D-123 … in `docs/97_принятые_решения.md` when each step lands (plan: `11_plan.md`); the
expected numbers are in `12_golden_cases.md`.

The idea does not change: every source and reference book is a module; modules do not know each other and compute
no money; the facade recalculates everything from scratch for every request; nothing is accrued, only a payout
snapshot is frozen; A = B + C + ours per source, account and month; money is assigned by a document or a reference
book; the key is ISRC (+ UPC); names are never keys.

## 1. Modules, three sentences each

**owners** (module 1, unchanged shape). Knows owners (`person` or `label`), their pseudonyms (artists), tracks
(ISRC + UPC), documents and contracts, and which owner is confirmed. Every recipient of money is a pseudonym: a
company, sublabel, representative, buyer or participant gets its own pseudonym under an owner of kind `label` (or
`person`). New document kind `assumption`: a council decision recorded as a document that is never approved.

**labels** (new). Knows our labels (0to8, Echo8), the imprint strings Believe prints and which label each string is
an alias of, and the sublabel rule of a label (a percent of the label share to a recipient pseudonym, for a period,
by a document). It validates shapes (unique alias, period, percent) and stores nothing about money. The facade asks
it for the label of record of a unit and the rule in force at a date.

**splits** (extended). Stores per ISRC and period the artist rows (percent of net, each row optionally with its own
document) and the participations (a percent of a base to a recipient pseudonym, funded from one bucket: the top of
the net, the artist pool, one artist's amount, or the label share), each with a document. It validates percents,
periods, "Σ off-the-top ≤ 100" and the rule "a pseudonym is a row or a participation on an ISRC and date, never
both", and computes no money. A buyout is a split change; our share is still never stored.

**sources** (Believe, extended by one column). Keeps the file registry and the raw report lines; the unit of
calculation is ISRC + UPC + report month + sales month **+ the label string** (`label_name`), with net. Equal keys
are summed by the view; nothing is deduplicated across accounts. The account comes from the registry per file.

**publishing** (B17, reduced). Loads statements and keeps lines, the writer → owner map and the terms (percent per
owner, period, optional operation type, document). It returns the aggregated lines **with `operation_type`**, the
writers and the terms; it no longer computes the author share (that moved to the facade).

**settlements** (reduced). Records operations (`in`/`out`, signed cents, optional artist, scope, documents) and
payout snapshots; the meaning of an operation stays derived from its fields. The recoupment algorithm moves to the
facade; the module keeps the scope shape and its validation.

**facade** (unchanged role). The only composer: reads every module in one snapshot and runs the layers; pays through
the payout button with a snapshot. Every layer is a pure function in `src/facade/layers/` with its own test; the
order is one list in `src/facade/layers/index.ts`. Every module gets a three-sentence `CLAUDE.md` in stage 3.

## 2. Reference data (storage)

Schema `labels` (migration `0006_labels.sql`, Drizzle `modules/labels/schema.ts`):

| Table | Columns | Notes |
|---|---|---|
| `labels.labels` | `id`, `name`, `kind` (`own` \| `sublabel`), `own_label_id` (for a sublabel: the own label its money belongs to; for `own`: null), `created_at` | two `own` rows expected: 0to8, Echo8 |
| `labels.label_aliases` | `alias_norm` PK, `label_id`, `alias` (as printed) | normalisation: NFKC, lower case, spaces and separators collapsed; `0to8` → 0to8, `Ahh Music` → 0to8, `0to8/Echo8` → 0to8, `NoGhost Records / 0to8` → NoGhost, `qaraqshy records` → qaraqshy (sublabel of Echo8) |
| `labels.label_rules` | `id`, `label_id`, `percent` (of the label share, numeric(9,6)), `recipient_artist_id` (pseudonym of the sublabel owner), `valid_from` (month start), `valid_to` (exclusive, month start or null), `document_id`, `note`, `created_at` | one rule in force per label and date (exclusion constraint); the half rule is `percent = 50` |

Schema `splits` (migration `0008_participations.sql`):

| Table | Columns | Notes |
|---|---|---|
| `splits.split_shares` | + `document_id text NULL` | a row's own document overrides the split's document for that row only (an `assumption` document on a disputed row, Q1/Q5; the delta-only variant is two rows for two pseudonyms of the same owner, no mechanism) |
| `splits.participations` | `id`, `isrc`, `artist_id` (recipient pseudonym), `percent` numeric(9,6), `base` (`net` \| `bucket`), `funded_from` (`top` \| `artist_pool` \| `artist_share` \| `label_share`), `from_artist_id` (only for `artist_share`), `valid_from`, `valid_to`, `document_id`, `origin`, `note`, `created_at` | no overlap for one (isrc, artist_id, funded_from, from_artist_id): exclusion constraint (the source artist in the key since D-130); `top` and `artist_pool` require `base = net`; `artist_share` requires `base = bucket` and `from_artist_id ≠ artist_id`; `label_share` allows both |

Meaning: `percent` of `base`, where `net` is the unit net and `bucket` is the thing the money is taken from (the
artist's amount, the label share). Taken from `funded_from`. Used combinations: remixer = (`net`, `top`);
licensed MC / sample from the pool = (`net`, `artist_pool`); settlement 15 % of net paid by the label = (`net`,
`label_share`); A&R 15 % of the label's net master royalties = (`bucket`, `label_share`); beat 10 % of the artist's
share = (`bucket`, `artist_share`).

`publishing.pub_terms` gains `operation_type text NULL` (migration `0009_pub_terms_operation_type.sql`): null = all
types; a term with a matching type wins over a null one for the same owner and date. Overlap and closing of terms
are checked per (owner, operation type); a typed term and a null-typed term may coexist.

`owners.tracks` gains `note text NULL` (migration `0007_owners_track_note_assumption.sql`): a free flag shown by the signals page ("derivative outside
authorisation", "withdrawn", "stream cap"); it moves no money (M29).

`owners.documents.kind` accepts `assumption` (CHECK constraint widened; `requires_approval` true; nothing approves
it).

ClickHouse migration `0003_units_by_label.sql`: projection `units_by_label` (group by file_id, isrc, upc,
reporting_month, sales_month, label_name; sums of quantity, gross, net), `MATERIALIZE PROJECTION`, and
`CREATE OR REPLACE VIEW believe.units` with `label_name` in the key and an `ORDER BY` (the current projection test
is flaky without one). The old projection `units` is dropped. `columnar.units()` selects `label_name`; `SourceUnit`
gains `labelName`. In the loaded data no unit key carries more than one label string, so no unit splits.

Entry rule for dates (M52, a convention about month granularity): the facade floors every `valid_from` / `from` /
`effectiveFrom` of a split, participation or label rule to the first day of its month (`monthStart`); the whole
month goes to the new holder (as in Annex; 13,363.21 net on the legacy data). End dates too: every `valid_to` of a
split, participation or label rule and the date of a close are floored the same way, and a period that becomes empty
is refused (`empty_period`, D-130). Stage 4 normalises the 1,043 legacy
mid-month split dates the same way.

## 3. The master layers (order fixed in `layers/index.ts`)

Input per unit: `{ account, isrc, upc, reportingMonth, salesMonth, labelName, net }`; context: label index, known
pairs, split index (rows and participations at a date), artist index, document statuses, confirmed owners.
State: `{ unit, ourLabelId, rule, status, scaledNet, rows: Allocation[], labelShare, labelShareCategory, shortfalls }`.
`Allocation = { artistId, ownerId, layer: 'split'|'top'|'carve'|'sublabel', ruleId, documentId, percent, amount, category, reason }`.
`explainTrack` returns the state after every layer, so every number is traceable to its rule without extra fields.

| # | Layer (file) | What it does | Cases |
|---|---|---|---|
| 1 | `label-of-record.ts` | `labelName` → alias → label; `ourLabelId` = the label itself if `own`, else its `own_label_id`; `rule` = the sublabel rule in force at the report month. Unmapped string: `ourLabelId = null`, `labelShareCategory = 'label_unmapped'`: the rows and carves still run (they are document-based); "ours" of the unit waits in C; no sublabel carve | M8, E13–E15 |
| 2 | `perimeter.ts` | empty ISRC → `no_isrc`; pair not in tracks → `unknown_pair`; the whole net is C, nothing else runs | D-023, D-035 |
| 3 | `off-the-top.ts` | participations (`net`, `top`) in force: allocation `q(net × p / 100)` each; `scaledNet = net − Σ top` (by subtraction); Σp > 100 is refused at entry (`top_above_100`) and, if met in data, the top allocations are scaled down to net (quantised, residue to the largest), `scaledNet = 0`, the excess recorded as a shortfall (pinned by a pure layer test, since the services never let it in) | M4, E24 |
| 4 | `split.ts` | rows of the split at the report month on `scaledNet`: `amount = scaledNet × percent / 100` (rows with percent 0 are skipped); `labelShare = scaledNet − Σ rows`; no split → `status = no_split`, `labelShare = scaledNet` (D-029) | M1, M2, M3a, M6, M7, M9, M10, M11 rows, M28 |
| 5 | `carve.ts` (one function, four kinds in a fixed order, one shared base per kind) | **pool**: targets `a_i = q(net × p_i / 100)` (base net); the total Σa is taken from the rows pro rata to their amounts at the start of the kind, each share quantised, the residue to the row with the largest absolute amount; if |Σa| > |pool| (same sign) the carves are scaled down to the pool (quantised, residue to the largest carve) so the pool ends at exactly 0, and the shortfall recorded. **artist_share**: `a = amount(from_artist) × p / 100` from that row, base = the row at the start of the kind; a missing source row gives 0 and a shortfall. **label_share**: base = `labelShare` at the start of the kind (after the pool kind; the pool does not change it); `a = (base === 'net' ? net : labelShare) × p / 100` each; all are taken together; if |Σa| > |labelShare| they are scaled down and the shortfall recorded. **sublabel**: `a = labelShare × rule.percent / 100` from what remains, to the rule's recipient (skipped when `labelShareCategory = 'label_unmapped'`). Inside a kind the order never changes an amount. An allocation is emitted whenever its percent is non-zero, even when the amount is 0 | M3b, M5, M11 pool, M12, M13, M14, M35, M43, Q11 |
| 6 | `categorise.ts` | per allocation, first reason wins: document kind `assumption` → `assumption` (a row looks at its own document first, then the split's); document not approved → `split_unconfirmed` (rows) or `rule_unconfirmed` (carves, sublabel); artist without owner → `artist_without_owner`; owner not confirmed → `owner_unconfirmed`; else B. Two assumptions set by the layer itself: a sublabel allocation on a unit that also has a `label_share` carve (Q11) marks both the carves and the sublabel allocation `assumption`; a sublabel allocation on a `no_split` unit (R1) is `assumption`. `ours` = `labelShare` when `labelShareCategory = 'ours'`, else C `label_unmapped`; `ourShareNoSplit` = the remainder of `no_split` units | D-057, Q11, Q12, R1 |

Exactness (one rule for every layer): every allocation amount is **quantised to 12 decimals** (pico-USD, the
precision of the source amounts, half-up) right after its multiplication; every remainder (`scaledNet`, `labelShare`,
what is left of a bucket) is obtained **by subtraction**, never by a second multiplication; a pro-rata or scale-down
distribution quantises each share and gives the residue to the row with the largest absolute amount. So
Σ allocations + labelShare = net holds exactly after every layer whatever the global decimal.js precision (a seeded
random test with 6-decimal percents in every position and nets up to 1e5 with 12 decimals asserts it). The only
divisions are the pro rata of the pool kind and the scale-downs, both closed by that rule and guarded by an empty
bucket (shortfall, no signal when the target is 0). Sign: a negative unit gives negative allocations with the same
ratios (E1); a zero unit gives zero allocations (E2).

Shortfalls: `{ isrc, upc, month, ruleId, missing }` in the signals (`unfunded`); no C money is created (the money
does not exist: the artist pool or the label share was smaller than the contract assumed, P08 §6.7(a) says a third
party reduces only the artist's share).

## 4. The publishing layers

| # | Layer | What it does | Cases |
|---|---|---|---|
| 1 | `writer-parts.ts` | an aggregated line (period, holder, songwriters, work, **operation type**, payable) goes in equal parts to our mapped writers in `songwriters` (ambiguous ones keep their part with owner null); no writer of ours → the holder (D-087, unchanged arithmetic) | M17 |
| 2 | `author-share.ts` | terms of the owner at the quarter-end month, preferring a term with the line's `operation_type` over one with null; `authorAmount = part × percent / 100`; no terms → default 50 and `defaultTerms`. B17 has no "cover" type, so cover income is paid at the general rate | M15, M16, D-043 |
| 3 | `categorise` (shared) | label owner → `writer_unmapped`; owner not confirmed → `owner_unconfirmed`; default or unapproved terms → `publishing_terms_unconfirmed`; else B; label amount = part − author amount | D-087, D-043 |

## 5. Settlement layers

`layers/recoup.ts` is `modules/settlements/recoup.ts` moved as is (D-049, D-072, D-094, D-101); `balance.ts` stays
(payable = B − recouped − paid + returns + credits). Master income recoups only positions on the **same pseudonym**
(recoup.ts), so an advance on a participation or a sublabel is entered on that pseudonym; because every
participation and sublabel has its own pseudonym, its income is its own income item (M19 participation-only,
NoGhost's advance). One balance per owner across both our labels (an assumption recorded in the D-entry: the two
labels are separate legal entities). The balance shows earned (B) and waiting (C) per label of record (from the
allocations' units, `byLabel`); recouped and paid are one total, because operations carry no label (D-130).

## 6. Reconciliation, balance, signals, explain

- `reconcile()` rows are keyed by source, **account** and month; `A_received` per account (file totals per account
  too); `ourShare` from the units' `labelShare` state (not from A − B − C: a layer that loses money must show as a
  non-zero `discrepancy`, and a test with a deliberately broken layer proves it); `ourShareByLabel` per our label;
  `C_breakdown` gains `assumption`, `rule_unconfirmed`, `label_unmapped`.
- `ownerBalance()` reads allocations by owner and artist; new layers only add allocations. It adds `byLabel`: earned
  and waiting per label of record (D-130).
- `signals()` adds: `unfunded` shortfalls, `labelUnmapped` strings with net, tracks with a note (M29), participations
  whose recipient has no owner, allocations under `assumption` documents grouped by document (M39 conflicts live
  there: the registered split stands, the conflicting rows carry the assumption document).
- `explainTrack()` returns per unit the state after each layer (allocations with layer and rule id) and asserts in
  its test that the last state sums to the unit net.
- The payout snapshot is unchanged in shape (per artist); allocations of participations appear under their
  pseudonyms.

## 7. Open questions settled for the design (each becomes a line in the D-entry)

| # | Decision | Basis |
|---|---|---|
| Q1 | sample letters: base net; where the "less other participants" clause exists, the licensor's row carries an `assumption` document (whole row in C; the delta-only variant is two rows) | contract wording; goal rule |
| Q3 | a registered split applies from the first report month of the ISRC unless the instrument has a date | decided on the payment fact in `0to8 Main.xlsx` (map §6 exception), not an assumption |
| Q5 | conflicting documents on one ISRC: the registered split stands; the other document's rows carry an `assumption` row document | goal rule; signal |
| Q6 | the settlement 15 % is (`net`, `label_share`): 15 % of net paid by the label; on 50/50: S 15, artists 50, label 35 | contract text, Annex Sch3A row 3 |
| Q11 | `label_share` carves before the sublabel half; a unit with both marks the carves and the sublabel allocation `assumption` | assumption |
| Q12 | sublabel strings outside owner decision 2 get the half rule with an `assumption` document (owner answer 3 expects the other 0to8 imprints to be our own; until the owner lists them, the sublabel half waits in C and our half stays ours) | assumption |
| R1 (QA) | no split and all-zero split both leave the label share = the whole net and the sublabel rule applies; on a `no_split` unit the sublabel allocation is `assumption` | assumption (the owner rule speaks of "the label share" of a split) |
| E15 | unmapped label string: rows and carves run, "ours" waits in C `label_unmapped`, no sublabel carve | simplicity: artists do not depend on an imprint |
| M52 | the facade floors rule dates to the month start; the part-month goes to the new holder (as in Annex) | convention on month granularity; D-025 kept |
| M33 | before a participation's `valid_from` there is no participation; the unit follows the split. A lump that is the consideration for past uses (the settlement's USD 100,000) is a document only; a lump that is accrued royalty paid at signing (MC Denny 10,774.41) is a payout operation | contract wording; owner decision 6 |
| M29 | derivative outside authorisation = a note on the track, listed by the signals page | flag, no money |
| Balance per label | one balance per owner; the balance shows earned (B) and waiting (C) per label of record (from the allocations' units); paid is one total (operations carry no label) | D-130; the Main comparison of stage 5 is per owner |
| Sublabel start | a label rule starts at its document's effective month (NoGhost 2026-06); earlier months of that imprint get a rule under an `assumption` document (C) | contract date; goal rule |
| Shortfall | a carve larger than its bucket takes the bucket; the rest is a signal, not C | P08 §6.7(a) for the artist pool; for the label share (G37) and for over-100 tops the same cap is an assumption: the allocations of that kind are scaled down to the bucket so the sums keep matching |

## 8. API and pages (minimal)

Routes added (each in `operations.ts`, called by the contract scenario): `GET/POST /labels`, `POST /labels/:id/aliases`,
`POST /labels/:id/rules`; `GET /participations?isrc=`, `POST /participations`, `POST /participations/:id/close`;
`POST /publishing/terms` gains `operationType`; `PATCH /tracks/:id` gains `note`; documents accept kind `assumption`;
split rows accept `documentId`. Responses: reconciliation rows gain `account` and `ourShareByLabel`; signals gain the
new lists; explain gains the per-layer states. The C reasons are one shared enum in `api-responses.ts`, and a guard
test checks that every reason has a label on the balance and sources pages.
Pages: Labels (list; create label, alias, rule), Participations (list by ISRC; create; close), the terms form gets an
operation type select, the balance and sources pages show the new C reasons. Numbers and inputs only.

## 9. What stays out of this design (and why)

M21 ads, M22 fees, M23 threshold rules, M24 currency, M31 payees, M44 recoup variants, M45/M46 inbound money, M50
third-party payees: payout side or new sources (map MVP ◻ items). An advance scope by UPC (E9): out of scope, a release
is entered as its ISRC list (scope `isrcs`). M41 no-ISRC folding (D-035 ⚠), M42 no-split pools
(D-029), M48 taxes, M49 period locks: consciously not done. Publishing writer shares from contracts (D-087 ⚠) and
publishing buyouts by work (D-045 ⚠): wait for the owner.
