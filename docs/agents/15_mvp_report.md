# MVP goal: final report (2026-11-03)

Goal (`notes/goal_prompt.md`): the ERP computes every case of the MVP scope of `notes/settlement_landscape.md`: whose
each dollar is, and how much an owner can be paid today. Seven stages, each accepted by a council of three
independent read-only reviewers (`docs/agents/reviews/`). Branch `feature/fable-001`, HEAD after D-138; nothing
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
- **Golden cases**: 47 master and 5 publishing scenarios with hand-computed answers (`12_golden_cases.md`), every
  one a test (`tests/golden.test.ts`, `tests/layers/*`); the suite is 32 files, 361 tests, green; typecheck, lint
  and the client build are clean.
- **API and pages** for labels, participations, terms by type, track notes; the reconciliation per account with
  ours per label; the signals for shortfalls, unmapped label strings, assumptions, notes, participants without an
  owner, a sublabel without a rule, a rule recipient that is also a row (D-129, D-136).
- **Data loaded** into the dev database through the facade (D-131 … D-135, D-137, D-138): the labels dictionary; the
  registered splits of Annex 14 (211 new, 80 changed, 3,504 confirmed by the owner's registry); 1,345 buy-outs
  checked (290 of 294 partial and 88 of 88 whole match; 196 "see the instrument" unchanged); 283 participations
  (remixers, the settlement (its share before 2026-02 spread pro rata over the co-artists' legacy rows, D-138), A&R and social participations, the Sleeping City Funk MCs, LUNAR MEDIA, the Main
  carve history); the Duetti sale (243 ISRC to the buyer from the sale month); 11 derivative notes; 8,986 tracks and
  9,772 splits of the Echo8 repertoire; 440 contract and 61 appendix documents from the PandaDoc index; the whole
  cash history of `0to8 Main.xlsx` (2,371 + 26 payouts, 158 advances with scope, 104 deductions; every expense row
  classified, the load reconciles to 8,045,246.75 minus the named exclusions); the administration terms 90 / 50;
  seven B17 quarters (2024-Q4 … 2026-Q2).
- **Verification** (`14_verification.md`): A = B + C + ours with discrepancy 0 on all 52 reconciliation rows of
  2024-01 … 2026-08; the label share equals Annex 14 within 0.01 on 92.37 % of receipts, and every remaining
  difference is assigned to a cause and a verdict (no layer error; the biggest, 348 k, is the Duetti catalogue that
  Annex leaves out for every month; then owner decisions 2–5 that Annex has not applied, and data gaps); owner
  balances vs Main: 641 of 802 differing owners explained within max(1.00, 2 %) by named causes, 161 not
  (Σ|residual| 337,982.01; `scripts/mvp/decompose-main.ts`), listed with their first cause; four ERP errors found
  were data or loader errors, fixed in stage 6 with golden cases G45 and G46; the stage 7 council found the E1 fix
  gave the co-artists' part to one artist, corrected by D-138 with golden case G47 (`14` §10).
- **Completeness** (`13_completeness_check.md`): nine sources of map §8 walked element by element by agents that
  did not write the code; 40 uncovered items consolidated: 6 became cases (M53 … M58), 4 fixed by data steps, 16
  open for the owner, 14 consciously out; 19 partial items listed with what is missing.

MVP items of the map, status: 1–7, 9–15, 17–22, 24, 25, 29–32 computed by a layer or entered as data with a golden
test (see `09` §2 and `13` §2); 8 (Echo8 as a second own label: contour, aliases, rules) done, the Echo8 sublabels
under the Q12 assumption; 16 (perimeter exclusions) done for Duetti and withdrawn recordings, brand artist as a data
convention; 23, 26, 27, 28, 33, 34 later as the map says.

## 2. The money today (2024-01 … 2026-08, after D-138)

| | net | B confirmed | ours | C waiting |
|---|---:|---:|---:|---:|
| Account 1052428 (0to8) | 15,280,793.42 | 6,622,032.09 | 7,788,743.83 (0to8 7,656,895.54; Echo8 131,848.28) | 870,017.51 |
| Account 1055956 (Echo8) | 1,050,945.10 | 53,363.50 | 667,226.96 | 330,354.64 |
| B17 (7 quarters) | 2,496,581.91 | 682,348.36 | 968,243.31 | 845,990.25 |

C by reason (master, both accounts, from the reconciliation rows): owner_unconfirmed 594,298 (591,528 + 2,770);
split_unconfirmed 454,219 (320,636 of it Echo8 repertoire without documents); assumption 144,195 (138,273 + 5,923);
artist_without_owner 5,297; no_isrc 2,363. B17: owner_unconfirmed 520,584 (the
statement holders are separate owners from the stage-name owners, D-083 ⚠), publishing_terms_unconfirmed 325,406.
Not in C but worth a look: 622,048 of net on 2,500 ISRC without any split is ours by rule D-029 (ours 620,566 =
the reconciliation's `ourShareNoSplit` 469,643 + 150,923; the rest is the R1 sublabel half in C); 81 ISRC above
1,000 hold 519,883; the `isrcsWithoutSplit` signal lists them (item 11 below).

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
   under an assumption; their sublabel half waits in C (470 in the 0to8 account, 5,923 in Echo8).
5. **Main carve pairs** (M43): 26 groups are participations under assumption documents (107,915 in C); 24 groups
   state no percent and stay deductions; groups 7, 17, 41 differ from Main's bookings (14 §9.2); two participants
   without a participation have a negative payable.
6. **All sublabel money waits in C today** (the sublabel B is 0.00): NoGhost from 2026-06 19,133.97
   `owner_unconfirmed`, because its approved contract ("NoGhost Exclusive Sublabel Agreement") is attached to the
   label rule, not to the NoGhost owner (plus 63.30 under Q11); 77 Records 14,326.87 and R2R PRODUCTION 471.08
   `owner_unconfirmed`, because they have no written contract (owner answer 2; their basis, the approved "Owner
   decision 2", cannot confirm an owner); NoGhost before 2026-06 4,840.35 `assumption` (Q12). The owner to say
   whether owner decision 2 confirms 77 Records and R2R; the NoGhost contract to be linked to its owner only
   together with the payments routed through artists' accounts (C22: Sch3B 7,000; the Main sheet 15,000 + 25,000
   through one artist's Tipalti account; 10 routed payouts 10,560.91; not in the ledger, M50), else its payable is
   overstated; the contract to be re-signed under the half rule.
7. **Buy-outs**: 196 ISRC whose interest is only in the instrument (M51), 4 DJ TUUV rows whose seller is not in
   the split, the DJ VRK instrument date (2026-05 vs 2026-07).
8. **The Updated Q2 2026 B17 statement** (+184,828.17) refused per D-041 ⚠; writer shares from contracts (D-087 ⚠);
   publishing buy-outs by work (D-045 ⚠); company payees (D-096 ⚠).
9. **77 Records per-artist exception** (M58) is not expressible; the 779 coverage differences of the owner's
   registry are outside the ERP.
10. Owner balances that the named causes do not explain: 161 owners, Σ|residual| 337,982 (`14` §4.3, §10). Most are
   Main practice against the owner's registry (Main paid MC shares to the main artist and caught up later) or single
   Main credits without a report. **Zachz Winner** (owner 4e37a283): 21,225.40 of its +21,353.95 is UPC
   3617396033894 in 2025-05…12, which Main did not pay (Main pays it from 2026-01): money the label owes the artist.
11. **C11 no-split money**: 622,048 of net on 2,500 ISRC without a split is ours by D-029 (81 ISRC above 1,000:
   519,883); at least 23 Echo8 ISRC and several 0to8 ISRC with outside performers look like third-party repertoire.
   The owner to say which of them are someone else's.
12. **C26 administration terms 90 / 50** start 2026-01-01: the 2024-Q4 … 2025-Q4 quarters of holder afaed4c7 sit at
   the default 50 % in C `publishing_terms_unconfirmed` (author part 240,081.34 of payable 480,162.66; at most
   192,065 more if the 90 % reached back to every non-Sync line).
13. **C25 licensor terms**: the MC ROBA CENA 20 % row on FUNK DO SURPRISE (C assumption, Q1) is a row, not a
   redirection to the licensor; the ACIDO III licence says 23 % where 25 % is registered (not measured).
14. **E1 after the DJ Ikeraus buy-out** (D-138): in 2025-12 … 2026-01 the bought-out row's pro rata part of the
   settlement share (165.80) is ours, as Main's LDRR credit at 25 % implies; Annex 14 keeps it off the label (16
   cells, `14` §10). The owner to confirm.

## 4. Assumptions (council decisions without a source; the money depends on them and waits in C)

| # | Assumption | Money in C |
|---|---|---:|
| Q1 | sample letters are a percent of net; the "less other participants" clause is an assumption on the licensor's row | 19,169 |
| Q5 | conflicting documents: the registered split stands; the other document's rows carry an assumption | 270 |
| Q11 | label-share carves before the sublabel half; both marked assumption when they meet on one unit | 63 |
| Q12 | sublabel strings outside owner decision 2 get the half rule | 11,234 (incl. NoGhost before 2026-06 4,840; Q11's 63 not included) |
| R1 | a sublabel on a unit without a split takes half of the whole net | inside Q12 |
| M43 | the Main carve history read as pool participations of net per participant | 107,915 |
| LUNAR | the LUNAR MEDIA licence: cash base read as net, pool funding | 5,544 |
| M52 | rule dates floored to the month start (a convention; D-025 kept) | 0 (16.02 left vs Annex) |
| M33 | no participation before its start; a lump that is consideration for past uses is a document only | 0 |
| E15 | an unmapped label string holds back "ours" only | 0 (all strings mapped) |
| one balance per owner across both labels | shown per label of record | 0 |
| shortfall cap | a carve larger than its bucket takes the bucket (P08 §6.7(a) for the pool; an assumption for the label share and over-100 tops) | 0 (1,066 of shortfalls signalled) |

Σ of the table: 144,195 = C `assumption` of the reconciliation (138,273 + 5,923).

Decisions with a source are listed in D-123 §"Decisions with a source" (Q3 payment fact, Q4 contract, Q6 contract,
M18 digital channel, M29 note, owner decisions 2–6). **E1 pro rata (D-138) is decided on the payment fact (Main),
not an assumption**: owner decision 6 says the participant's legacy 15 % before 2026-02 belongs neither to the
participant nor to the label; Main, the only record of who received it, paid it pro rata to the co-artists' rows
(DJ Ikeraus' monthly deficit was 7.5 / 17.5 of his settlement-ISRC earnings; LDRR's excess equalled the pro rata
candidate). Its money is B under the approved document "Owner decision 6 …" (DJ Ikeraus +7,886.93, RD12 +136.56,
LDRR −8,325.86 against the D-137 reading; DJ MRCL's +136.56 is C `owner_unconfirmed` because of its owner); only
the post-buy-out remainder of 165.80 is an owner check (§3 item 14).

## 5. Where everything is

- Catalogue `09_settlement_cases.md`; design `10_target_model.md`; plan `11_plan.md`; golden cases
  `12_golden_cases.md`; completeness `13_completeness_check.md`; verification `14_verification.md`; verdicts
  `reviews/stage{1,2,3,7}_*.md`; decisions D-123 … D-138 in `docs/97_принятые_решения.md`, indexed in
  `03_decision_index.md`; the guides `01`, `02`, `04`, `05` and every `CLAUDE.md` refreshed.
- Loader and compares: `packages/backend/scripts/mvp/` (`load.ts <step> [--apply]`, `compare-annex.ts`,
  `compare-main.ts`, `decompose-main.ts`; the Python extractors, recipe 9); prepared data and logs in the git-ignored `data/mvp-load/`; a pre-load backup in
  `data/backup/`.
- Definition of done at HEAD: `npm run typecheck`, `npm run lint`, `REQUIRE_STACK=1 npm test` (361 tests),
  `npm run build:client`.
