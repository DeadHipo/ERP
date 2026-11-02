# MVP goal: final report (2026-11-03)

Goal (`notes/goal_prompt.md`): the ERP computes every case of the MVP scope of `notes/settlement_landscape.md`: whose
each dollar is, and how much an owner can be paid today. Seven stages, each accepted by a council of three
independent read-only reviewers (`docs/agents/reviews/`). Branch `feature/fable-001`, HEAD after D-137; nothing
pushed. This file says what is closed, what is open, and which assumptions the money depends on.

## 1. What was built (closed)

- **The flat hundred of the split is replaced by layers** with an explicit base and payer (D-123, D-127):
  label of record → perimeter → off the top → split → carves (artist pool, artist share, label share, sublabel) →
  categorise; publishing: writer parts → author share by owner, period and operation type → categorise; recoupment
  and the balance in the facade. Each layer is a pure function with its own test; the order is one list
  (`packages/backend/src/facade/layers/index.ts`). Modules compute no money.
- **New reference data**: the `labels` module (own labels 0to8 and Echo8, 25 imprint strings, 16 sublabel rules),
  participations in the `splits` module (percent of `net` or of the bucket, funded from `top` / `artist_pool` /
  `artist_share` / `label_share`), per-row documents on split shares, publishing terms by operation type, track
  notes, the document kind `assumption` (D-124 … D-126, D-128).
- **Exactness**: every amount is quantised to 12 decimals after its multiplication, remainders by subtraction,
  residues to the largest amount; A = B + C + ours holds to the cent on every unit, per source, account and month
  (D-127, D-130); a seeded random test with 10,000 units and the golden cases pin it.
- **Golden cases**: 46 master and 5 publishing scenarios with hand-computed answers (`12_golden_cases.md`), every
  one a test (`tests/golden.test.ts`, `tests/layers/*`); the suite is 32 files, 360 tests, green; typecheck, lint
  and the client build are clean.
- **API and pages** for labels, participations, terms by type, track notes; the reconciliation per account with
  ours per label; the signals for shortfalls, unmapped label strings, assumptions, notes, participants without an
  owner, a sublabel without a rule, a rule recipient that is also a row (D-129, D-136).
- **Data loaded** into the dev database through the facade (D-131 … D-135, D-137): the labels dictionary; the
  registered splits of Annex 14 (211 new, 80 changed, 3,504 confirmed by the owner's registry); 1,345 buy-outs
  checked (290 of 294 partial and 88 of 88 whole match; 196 "see the instrument" unchanged); 283 participations
  (remixers, the settlement, A&R and social participations, the Sleeping City Funk MCs, LUNAR MEDIA, the Main
  carve history); the Duetti sale (243 ISRC to the buyer from the sale month); 11 derivative notes; 8,986 tracks and
  9,772 splits of the Echo8 repertoire; 440 contract and 61 appendix documents from the PandaDoc index; the whole
  cash history of `0to8 Main.xlsx` (2,371 + 26 payouts, 158 advances with scope, 104 deductions; every expense row
  classified, the load reconciles to 8,045,246.75 minus the named exclusions); the administration terms 90 / 50;
  seven B17 quarters (2024-Q4 … 2026-Q2).
- **Verification** (`14_verification.md`): A = B + C + ours with discrepancy 0 on all 52 reconciliation rows of
  2024-01 … 2026-08; the label share equals Annex 14 within 0.01 on 92.37 % of receipts, and every remaining
  difference is assigned to a cause and a verdict (no layer error; the biggest, 348 k, is the Duetti catalogue that
  Annex leaves out for every month; then owner decisions 2–5 that Annex has not applied, and data gaps); owner
  balances vs Main: 640 of 802 differing owners explained within max(1.00, 2 %) by named causes, 162 not
  (Σ|residual| 346,014.05), listed with their first cause; four ERP errors found were data or loader errors, fixed
  in stage 6 with golden cases G45 and G46.
- **Completeness** (`13_completeness_check.md`): nine sources of map §8 walked element by element by agents that
  did not write the code; 40 uncovered items consolidated: 6 became cases (M53 … M58), 4 fixed by data steps, 16
  open for the owner, 14 consciously out; 19 partial items listed with what is missing.

MVP items of the map, status: 1–7, 9–15, 17–22, 24, 25, 29–32 computed by a layer or entered as data with a golden
test (see `09` §2 and `13` §2); 8 (Echo8 as a second own label: contour, aliases, rules) done, the Echo8 sublabels
under the Q12 assumption; 16 (perimeter exclusions) done for Duetti and withdrawn recordings, brand artist as a data
convention; 23, 26, 27, 28, 33, 34 later as the map says.

## 2. The money today (2024-01 … 2026-08, after D-137)

| | net | B confirmed | ours | C waiting |
|---|---:|---:|---:|---:|
| Account 1052428 (0to8) | 15,280,793.42 | 6,622,334.45 | 7,788,578.04 (0to8 7,656,729.75; Echo8 131,848.28) | 869,880.94 |
| Account 1055956 (Echo8) | 1,050,945.10 | 53,363.50 | 667,226.96 | 330,354.64 |
| B17 (7 quarters) | 2,496,581.91 | 682,348.36 | 968,243.31 | 845,990.25 |

C by reason (master): owner_unconfirmed 594,153; split_unconfirmed 454,217 (320,636 of it Echo8 repertoire without
documents); assumption 144,195; artist_without_owner 5,297; no_isrc 2,362. B17: owner_unconfirmed 520,584 (the
statement holders are separate owners from the stage-name owners, D-083 ⚠), publishing_terms_unconfirmed 325,406.
Not in C but worth a look: 596,725 of net on ISRC without any split is ours by rule D-029 (79 ISRC above 1,000:
495,276; the `isrcsWithoutSplit` signal lists them).

Performance: owner balance 6.6–6.9 s, reconciliation 7.3–7.8 s on 721,975 units (budget 10 s).

## 3. Open items (the owner's decisions or documents; nothing here is a code gap)

1. **B17 holders vs stage-name owners** (D-083 ⚠): 19 of 32 holders have no contract match; the author money of
   all holders waits in C until the holders are confirmed or merged (520,584 + 325,406).
2. **Documents the owner still owes** (answer 6): wixsp RSA, the LDRR assignment, the two Dj Svevsx documents, DJ
   M-A, Wool Music, the two Mc Gw licences (~387 k of recordings), XENO XID's Schedule A (its participation is not
   loaded), the clean MC ROBA CENA PDF (its 20 % row is C assumption).
3. **Ambiguous pseudonyms** DJ VETA3, DSHZS, MC FLYXO, !Nxght (two artists each): 415 Echo8 ISRC without a split,
   25 Main rows (28,402.51) not loaded.
4. **The imprint list** (answer 3): the strings outside owner decision 2 (Enarma, VBR, PCR, Bear, odds, no job
   records, Hoboshrine, `lost` October 2025; the Echo8 sublabels qaraqshy, fate, CATCORE, SF) carry the half rule
   under an assumption; their sublabel half waits in C (11,297).
5. **Main carve pairs** (M43): 26 groups are participations under assumption documents (107,915 in C); 24 groups
   state no percent and stay deductions; groups 7, 17, 41 differ from Main's bookings (14 §9.2); two participants
   without a participation have a negative payable.
6. **NoGhost**: the contract to be re-signed under the half rule; the months before 2026-06 wait in C; the
   7,000 and 25,000 payments routed through an artist's account are not in the ledger (M50).
7. **Buy-outs**: 196 ISRC whose interest is only in the instrument (M51), 4 DJ TUUV rows whose seller is not in
   the split, the DJ VRK instrument date (2026-05 vs 2026-07).
8. **The Updated Q2 2026 B17 statement** (+184,828.17) refused per D-041 ⚠; writer shares from contracts (D-087 ⚠);
   publishing buy-outs by work (D-045 ⚠); company payees (D-096 ⚠).
9. **77 Records per-artist exception** (M58) is not expressible; the 779 coverage differences of the owner's
   registry are outside the ERP.
10. Owner balances that the named causes do not explain: 162 owners, Σ|residual| 346,014 (`14` §4.3 and §9.3).

## 4. Assumptions (council decisions without a source; the money depends on them and waits in C)

| # | Assumption | Money in C |
|---|---|---:|
| Q1 | sample letters are a percent of net; the "less other participants" clause is an assumption on the licensor's row | 19,169 |
| Q5 | conflicting documents: the registered split stands; the other document's rows carry an assumption | 270 |
| Q11 | label-share carves before the sublabel half; both marked assumption when they meet on one unit | 63 |
| Q12 | sublabel strings outside owner decision 2 get the half rule | 11,297 (incl. NoGhost before 2026-06 4,840) |
| R1 | a sublabel on a unit without a split takes half of the whole net | inside Q12 |
| M43 | the Main carve history read as pool participations of net per participant | 107,915 |
| LUNAR | the LUNAR MEDIA licence: cash base read as net, pool funding | 5,544 |
| M52 | rule dates floored to the month start (a convention; D-025 kept) | 0 (16.02 left vs Annex) |
| M33 | no participation before its start; a lump that is consideration for past uses is a document only | 0 |
| E15 | an unmapped label string holds back "ours" only | 0 (all strings mapped) |
| one balance per owner across both labels | shown per label of record | 0 |
| shortfall cap | a carve larger than its bucket takes the bucket (P08 §6.7(a) for the pool; an assumption for the label share and over-100 tops) | 0 (1,066 of shortfalls signalled) |

Decisions with a source are listed in D-123 §"Decisions with a source" (Q3 payment fact, Q4 contract, Q6 contract,
M18 digital channel, M29 note, owner decisions 2–6).

## 5. Where everything is

- Catalogue `09_settlement_cases.md`; design `10_target_model.md`; plan `11_plan.md`; golden cases
  `12_golden_cases.md`; completeness `13_completeness_check.md`; verification `14_verification.md`; verdicts
  `reviews/stage{1,2,3,7}_*.md`; decisions D-123 … D-137 in `docs/97_принятые_решения.md`, indexed in
  `03_decision_index.md`; the guides `01`, `02`, `04`, `05` and every `CLAUDE.md` refreshed.
- Loader and compares: `packages/backend/scripts/mvp/` (`load.ts <step> [--apply]`, `compare-annex.ts`,
  `compare-main.ts`); prepared data and logs in the git-ignored `data/mvp-load/`; a pre-load backup in
  `data/backup/`.
- Definition of done at HEAD: `npm run typecheck`, `npm run lint`, `REQUIRE_STACK=1 npm test` (360 tests),
  `npm run build:client`.
