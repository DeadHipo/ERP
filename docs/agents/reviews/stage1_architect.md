Verdict: yes

# Stage 1 review: architect (2026-11-02, revision 2)

Object: `docs/agents/09_settlement_cases.md` revision 2. Read-only re-review; only this file written.

## Revision 2

Fixed (each checked in the rewritten file):
1. Blocker 1 (money inside modules): §6 "Modules compute no money": publishing returns lines with
   `operation_type`, writers and terms; writer parts, author share and categorise are facade layers; recoup and
   balance are facade layers. M15, M16, M17, M19 "Now" name where the money is computed today. Fixed.
2. Blocker 2 (recipient identity): §6 convention: every recipient is a pseudonym with an owner, a participation
   has its own recipient pseudonym and therefore its own income item; allocations carry layer and rule id. Fits
   `MasterAllocation.artistId` (`facade/calculation.ts:27`), the income key `m|artist|isrc|month`
   (`facade/balance.ts:162`), same-artist recoup (`modules/settlements/recoup.ts:57-58`) and the per-artist
   snapshot (`facade/payouts.ts:164`) without changing them. M19 participation-only and E21 now rest on it. Fixed.
3. "Assumption" carrier: document kind `assumption`, never approved → C `assumption`; no basis field. Fixed.
4. Order of label-share participations vs the sublabel half: Q11 with proposed answer and C treatment. Fixed.
5. `label_unmapped` for unknown strings (E15); A kept per source, account and month, "ours" per our label (E13). Fixed.
6. Migration of participants stored as split rows: M43, E16, §1 fact row. Fixed.
7. Layers 4/5/6 merged into one carve function with an ordered bucket list; off the top kept separate. Fixed.
8. M6 moved to the split layer. Fixed.
9. `sales_type` and gross kept out of the unit grain (gross: product finding that no letter needs it). Fixed.
10. Q10 reduced to scope `any`. Fixed.

Remaining (none blocks stage 1; stage 2 must answer them in 10_target_model.md):
1. **should-fix (stage 2).** Which module owns participations and label rules is not named. If participations
   live outside the splits module, the E16 refusal ("participant both a split row and a carve") is a cross-module
   check and belongs to the facade (`facade/context.ts`), not to either module. Simplest: participations in the
   splits module (same key ISRC, same validity periods), label rules in the labels module.
2. **should-fix (stage 2).** E15 says an unmapped imprint gives "C `label_unmapped`, ours 0", which reads as the
   whole unit in C, confirmed artist rows included. State it: either the whole unit net is C (like
   `unknown_pair`, simplest), or only "ours" waits and the rows keep their B/C. Pick one in a D-entry.
3. **note.** Adding `label_name` to the unit grain changes the ClickHouse `units` projection
   (`migrations/clickhouse/0002_units_projection.sql` groups by file, ISRC, UPC, months only): a new migration
   and a rebuild of the projection; account needs no grain change (it comes from the file).
4. **note (for the product member).** E5/E6: a sublabel ISRC with no split gets no sublabel half (D-029 ours),
   but with an all-zero split it gets half of 100. The asymmetry is consistent with the layer chain; confirm it is
   the intended money.
5. **note.** M52 changes data (legacy `valid_from` normalised to month start), not D-025. Stage 4 must log it as a
   data change with its own D-entry.

## Revision 1 (history, verdict was: no)

Object: `docs/agents/09_settlement_cases.md` (stage 1 "Изучение"). Angle: module boundaries, simplicity of modules and
of the layer chain, "closed by data, no new field". Read-only; facts checked against code and the live stack.

## Findings

1. **blocker. Section 6 keeps money computation inside modules.**
   Claim: "Publishing: M17 as is; M15/M16 rate by `operation_type`" and "Settlements: M19, M20, M27 as is".
   Evidence: `packages/backend/src/modules/publishing/service.ts:377` (`authorAmount = payable × percent / 100`) and
   `:403` (equal parts of our writers, D-087) compute money inside the publishing module; `calculation.ts:176-198`
   only relabels the result. `modules/settlements/recoup.ts:69-124` allocates recoupment inside the settlements
   module. The goal prompt fixes "модули денег не считают; расчёт в фасаде — цепочка слоёв".
   For "yes": section 6 must list the B17 author share (terms percent, equal parts, M15/M16 rate by type) as facade
   layers with the publishing module returning lines + terms only, and say where recoupment lives (a facade layer, or
   an explicit exception for stage 2 to justify in a D-entry). One paragraph; no new research needed.

2. **blocker. Recipient identity of the new layers is not stated, yet the "MVP data, no new field" claims depend on it.**
   Claim: M6, M7, M10, M28 are "MVP data" (money to an owner of kind label / assignee / buyer); M19
   participation-only scope = "the participation's ISRC list, owner = the participant" is "MVP data"; layers 2, 4,
   5, 6 pay participants and sublabels.
   Evidence: every master allocation hangs on an artist (`facade/calculation.ts:27` `artistId: string`); income
   items are keyed `m|artistId|isrc|month` (`facade/balance.ts:162`); master income recoups only positions of the
   same artist (`modules/settlements/recoup.ts:57-58`, `Position.artistId` required at `:31`); the payout snapshot
   is per artist (`facade/payouts.ts:164`). Consequences: (a) a sublabel or participant has no artist to hang on;
   (b) if a participant also holds a split row on the same ISRC, its participation income and split income merge
   into one income item, so a participation-only advance cannot be scoped by ISRC list (M19 claim fails).
   For "yes": section 6 states the convention, e.g. "every recipient of any layer is an artist id (pseudonym) of
   its owner; a company / label / buyer recipient gets its own pseudonym owned by an owner of kind `label`; a
   participation carries its own artist id, so its income is a separate income item" (or names the alternative:
   allocations and income items carry a rule id). Mark M19 participation-only as depending on it.

3. **should-fix. "Assumption" is called data but needs a marker.** M6 is "MVP data ... stays in C with reason
   assumption"; Q1, Q4, Q6 likewise. Splits carry only `document_id`, `origin`, `note`
   (`modules/splits/schema.ts:10-19`); nothing can distinguish "assumption" from `split_unconfirmed`. State the
   carrier (e.g. document kind `assumption`, never approved, mapped to C `assumption`) so it stays without a new
   field, or move M6 to "MVP layer".

4. **should-fix. Order of layers 5 and 6 has no source.** Owner decision 2 puts the sublabel after artists, MC,
   remixers; nothing in the catalogue says whether an A&R participation from the label share (M12) is taken
   before the sublabel half (from 0to8 + sublabel together) or after it (from the 0to8 half only). Mark it as an
   open question with a proposed answer and "assumption" treatment, like Q1…Q10.

5. **should-fix. Label of record: unmapped strings and the reconciliation contour are undefined.** Layer 1 maps
   `label_name` → our label | sublabel, but says nothing about a string not in the dictionary (default to the
   account's label? C reason `unknown_label`?). And "A = B + C + ours per source, month and our label": A is
   money received per Believe account; 222 k of `Echo8` lines sit in the 0to8 account (ClickHouse: `Echo8` lines
   from 2024-12, verified). Keep A per source/account and month; show "ours" split by label of record, otherwise
   A per label is not money anyone received. Also note: `label_name` is a classification attribute resolved by a
   dictionary, never a key of the unit (names-are-not-keys rule).

6. **should-fix. M3/M11 data migration is not mentioned.** Today MC and co-author participants are split rows
   with hand-computed absolute percents (M3 "Now"). The artist-pool layer means those rows must leave the split and
   become participations, or the label is diluted twice. Name it as stage 4 input (which rows, how identified).

7. **note. Layer chain can be smaller.** Layers 4, 5 and 6 are one mechanic: "take p % of base from bucket X
   (artist pool, one artist, label share) and give it to recipient R" (M43 already says so for 4/5; the sublabel
   half is the same with bucket = label share, p = 50). Stage 2 should implement one carve function applied in an
   ordered list (order in one place), with a test per ordered step, not three functions. Layer 2 (off the top) is
   genuinely different (it scales everything below) and layer 3 (split) is the base; keep those.

8. **note. Layer 6 lists M6 "pass-through as a split row".** By M6's own status it is a split row, i.e. layer 3.
   Move it to avoid stage 2 modelling a pass-through in the sublabel layer.

9. **note. `sales_type` in the unit grain is not needed.** M18 decides Believe = digital (no rate key); M26
   analysis is served by the existing breakdown view (`modules/sources/columnar.ts:263-273` already groups by
   `sales_type`). Adding it to the unit only multiplies units. Add `gross` and `label_name` to the unit (needed by
   M11 and M8), not `sales_type`.

10. **note. Q10 is over-specified.** If the NoGhost owner (kind label) earns only the sublabel share, scope `any`
    of that owner already means "from the NoGhost share only"; no imprint ISRC list is needed. Keep the ISRC list
    only if that owner also earns other income.

11. **note. Facts verified (all hold).**
    - Unit grain: `units()` reads `file_id, isrc, upc, reporting_month, sales_month, net` only
      (`modules/sources/columnar.ts:197-233`); the projection already sums `gross_revenue`
      (`migrations/clickhouse/0002_units_projection.sql`); `label_name` is not in the unit. Correct.
    - Decision index: D-025 in force, D-029 in force, D-035 ⚠, D-067 ⚠ sub-label (`docs/agents/03_decision_index.md:64,68,76,131`). Correct.
    - PostgreSQL: `settlements.operations` 0 rows; owners 1,114, all `person`; splits 13,610, shares 24,754, none
      above 100. Correct.
    - B17 `operation_type` stored (`modules/publishing/schema.ts:51`) and dropped by `aggregatedLines()` (GROUP BY
      period, writer, songwriters, work: `modules/publishing/repository.ts:119-142`); sums by type Mechanical
      1.34 M, Performance 0.54 M, Synchronization 0.29 M, Print 7 k. Correct. M16 is rightly "MVP layer" (a new
      optional key on `pub_terms`, `schema.ts:68-76`).
    - ClickHouse totals: 75,744,752 lines, net 16,338,476. Correct.

## What holds

Module boundaries elsewhere are respected: labels dictionary as its own reference module, perimeter changes as
split changes (not filters), no cross-account dedup, no accruals, payout snapshot only. MVP data claims for M9
partial, M14 (two of ours), M18, M20, M33, M37, M38, M40, M47 hold against the current schemas. Two blockers are
text fixes to section 6; no new research is required.
