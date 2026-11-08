# Golden screens: what the operator sees, does, and the exact numbers (stage 2, 2026-11-03, revision 2)

Input: `17_frontend_model.md` (pages P1–P21, actions §6, endpoints N1–N18, harness §9), `12_golden_cases.md` (every
number below is copied from a golden case or derived with the layer rules of `10` §3 / the balance rule of `10` §5,
arithmetic in §7), `packages/backend/tests/golden.test.ts` (how each case is seeded through the facade),
`16_frontend_jobs.md` §2.6–2.8. Revision 2 applies the stage 2 council (`reviews/frontend_stage2_product.md`,
`_architect.md`, `_qa.md`). These scenarios are the Playwright specs of `packages/frontend/e2e/golden/`, seeded by
`packages/backend/scripts/e2e/seed.ts` on the private stores. No money rule is new here. Page names: P2 «Очередь
ожидания (C)», P3 «Решения руководителя», P4 = the owners page in its payouts view `/owners?view=payouts`, P21
«Сигналы» (`/signals`, `/signals/:name`).

## 1. Conventions

| Item | Rule |
|---|---|
| Data | synthetic only; no legal names, no real ISRC/UPC/accounts |
| Scenario / case ids | scenario `S<nn>` (01…37) plus the mocked group `SS1…SS7`; inside a scenario each golden case has an index `k` (1…8) |
| ISRC | `QZTST27<nn><k>0<j>` (j = 1…9), e.g. `QZTST2703101`. (`QZTSTE<nn>001` fails `assertIsrc` `^[A-Z]{2}[A-Z0-9]{3}\d{7}$`; `27` keeps the range apart from `golden.test.ts`'s `QZTST26…`) |
| UPC | `27<nn><k>0000000<j>` (13 digits), e.g. `2711100000002` |
| Account | `27<nn><k>0<a>` (7 digits, a = 1 for a second account). Not 1052428: P1 rows are keyed by account and month, so one shared account would sum every scenario |
| Report month, net | 2026-03, one unit of net `100`, label string `Test Label`, unless the case says otherwise |
| Pseudonyms, owners | the letter of 12 plus `-<nn><k>`: `A-011`, `M1-031`; owner `Owner A-011` (person, confirmed: approved contract). Tables write the bare letter. `Case.ordered` artists (S09) and the default approved appendix are created per scenario. Shared read-only: `NG` (owner `Company NG`, kind label) as recipient of `NoGhost Records`, `QQ` of `qaraqshy records`, brand pseudonym `0to8` |
| Labels (seeded once) | own `0to8` (aliases `Test Label`, `0to8`, `Ahh Music`), own `Echo8` (alias `Echo8`); sublabel `NoGhost Records` of 0to8, rule 50 → NG from 2020-01-01 (approved contract); sublabel `qaraqshy records` of Echo8, rule 50 → QQ under an `assumption` document. A case whose queue group, balance or action touches a sublabel has its own string and recipient: `NoGhost Records 08a/08b/08d` → `NG-081/082/084` (S08), `NoGhost Records 23` → `NG-231`, `Mystery Records` (S16), `Mystery Records B` (S17), `Ghost Label 35` (S35), `Close Label 37` (S37) |
| Shared mutations | the exact list of what a spec may change outside its own scenario (fresh stores per run); no spec asserts a list these touch (the alias list or sublabels of 0to8, the document list totals): (1) `20-queue` S16 adds the alias `Mystery Records` to 0to8; (2) `29-labels` creates the sublabel `Ref Spec Sublabel` under 0to8; (3) `14-documents` creates, attaches and approves the document `Ref spec doc` (no owner, nothing uses it); (4) `15-publishing` adds the terms `Print` 20 % from 2021-01-01 to W1 of S18 (an operation type the statement does not use, so no S18 number moves). Anything else a spec creates belongs to a scenario's own entities (the alias `Close Label 37 Alt` of S37, the second `Owner DUP-361` and artist `A-361` of S36) |
| B17 | one statement for the whole seed, loaded last (after every owner and alias) under the label 0to8 (D-169: its lines sit in the book 0to8, `statementsWithoutLabel` is empty), file name **without a quarter** (`0to8_e2e_Publishing_Statement.xlsx`: one quarter in the name is forced onto every row, `b17-format.ts`); periods per row: G26 1Q26 (b17 row 2026-03), G43 2Q26 (2026-06), S19 4Q25 (2025-12). b17 P1 rows are keyed by month only, so each month belongs to one scenario family |
| Isolation | every scenario owns its ISRCs, UPCs, accounts, owners, pseudonyms, documents. **Never asserted**: queue reason totals, signal counts, P1 totals, P3 items, queue groups keyed by a shared entity (the NoGhost rule, QQ rule, 0to8), and N3 has no `isrc` filter (a spec finds its group by key, `ownerId` or `month`) |
| Operator | `e2e-operator` in `localStorage` before every spec; every write sends `X-Operator: e2e-operator` |
| Payout threshold | `scripts/e2e/start.sh` sets `PAYOUT_THRESHOLD_CENTS=0` (default 5000 since D-175 → `below_threshold` for G27) |
| Pay gate | the balance (and N4) carries `payout: { allowed, reason, amountCents }` computed by the checks of `createPayout`; the button follows it and the spec asserts the field, never a client comparison |
| N13 figure | the approve dialog shows `waiting.amount` of `GET /documents/:id/uses` as «ждёт этого документа: X» (money waiting for this document), not "releases" |
| Money text | `title` = the exact API string, e.g. `19.125`, `-21.25`, `12.266666666666`. Text = `formatMoney`: `Intl.NumberFormat('ru-RU', { minimumFractionDigits: 2, maximumFractionDigits: 2, roundingMode: 'halfExpand', signDisplay: 'negative' }).format(decimalString)` on the string (no float). Specs normalise any no-break space (U+00A0 or U+202F) and U+2212 to `-` before comparing. Examples: `19.125` → `19,13`; `4.165` → `4,17`; `-21.25` → `-21,25` (red); `12.266666666666` → `12,27`; `1234.567` → `1 234,57`; `999.995` → `1 000,00`; `-0.004` → `0,00` (no sign) |

Notation: "A 50 B" = allocation of pseudonym A, amount `50`, category B; "L 20 C assumption" = C with that reason. P1
row = `A_received / B_notOurs / C_waiting / ourShare`, plus `C_breakdown`, `ourShareByLabel`, `ourShareNoSplit` when
not trivial; `discrepancy` is `0` on every row.

## 2. Test hooks (`data-testid` and attributes the specs rely on)

| Hook | Where |
|---|---|
| `page-state-empty`, `page-state-long`, `page-state-error` | `PageState` |
| `recalc-indicator` | header "идёт пересчёт"; `stale-badge` on a refetching page |
| `confirm-dialog`, `confirm-dialog-ok`, `confirm-dialog-cancel` | `ConfirmDialog` |
| toast with `data-code="<api code>"` (`data-code="ok"` on success) | `toast` |
| `money` elements with `title` = exact string | `Money` |
| AG Grid rows `[row-id="<key>"]` (`getRowId`: ISRC, UPC, id, `account|month`, group key) | `DataGrid` |
| `action-<name>` buttons (`action-approve`, `action-confirm-split`, `action-pay`, `action-merge`, …) | every action of 17 §6 |

## 3. Golden case → screen scenario

| Case | Page(s) | Scenario |
|---|---|---|
| G01 | P1, P6, P10 | S01 (bases of S14, S15, S32) |
| G02, G03a, G03c, G06, G07 | P6 rows as entered, P1 | S02 |
| G03b, G04, G11, G12, G32, G35, G36, G37 | P6 by layer/kind, P1; G37 in P21 `unfunded` | S03 |
| G45, G46, G47 | P6 two months each, P1 per month | S04 |
| G05a, G05b, G31, G41 | P6 NG allocation B, P1 | S05 (G05a again in S17) |
| G08a, G08b, G38 | P1 `ourShareByLabel`, P6 label string per month | S06 |
| G08c | P2 `label_unmapped`, P21 `labelUnmapped`, P17 | S16, S17 |
| G09 | P6 months 02/03/05, P15 dialogs | S25 |
| G10a, G10b | P2 `assumption`, P21 `assumptions`, P6 | S13 |
| G13, G17 | P6 months 05/06, P10 | S26 |
| G14 | P6 months 03/04, P16 close | S27 (label-rule analogue S37) |
| G15, G16 | P6 negative / zero, P1 | S07 |
| G18, G18b, G20, G21 | P2 `assumption` (⚠ Q11, R1 read-only), P6, P21 `isrcsWithoutSplit` (G21) | S08 |
| G19 | P2 `split_unconfirmed`, P6, P1 | S12 |
| G21b, G21c | P21 `sublabelWithoutRule`, `ruleRecipientIsRow`, `twoRowsOneOwner` | S35 |
| G22 | P21 `unfunded`, P6, P16 | S21 |
| G23 | P6 Правила errors | S29 |
| G24 | P8, P10 | S11 |
| G25 | P16 create, toast date | S28 |
| G26a–c, G26e | P10 Паблишинг, P1 b17 row | S18 |
| G26d | P2 `publishing_terms_unconfirmed`, P18 | S18 |
| G27, G27b | P10 payout, P4, P20, deferred | S22 |
| G28, G39 | P10 / P4 negative payable shown 0 | S24 |
| G29 | P10 sublabel advance | S23 |
| G30 | P2 `no_isrc` (read-only), `unknown_pair`; P21 `unallocated` | S20 |
| G33, G40 | P1 rows per account | S10 |
| G34, G44 | P6 exact strings in `title` | S09 |
| G42 | P6 brand pseudonym | S01 |
| G43 (i)–(iii) | P10 Операции | S31 |
| no golden id: `owner_unconfirmed`, `artist_without_owner`, `writer_unmapped`, `rule_unconfirmed`; merge; upload; duplicate dialog; notes; participants without owner | P2, P9, P10, P19, P21 | S14, S15, S19, S32, S33, S34, S36, S35 |

## 4. Scenarios

### Read-only (P1, P6, P10; every number from 12)

| S / k | Case | Seed (as in `golden.test.ts`) | P6 month 2026-03 (allocations; ours) | P1 row |
|---|---|---|---|---|
| S01/1 | G01 | row A 50 | A 50 B; ours 50 | 100 / 50 / 0 / 50 (0to8 50); P10 earned 50, payable 50 |
| S01/2 | G42 | brand `0to8` of the label owner linked to the track, no row; row A 50 | A 50 B (no `0to8` allocation); ours 50 | 100 / 50 / 0 / 50 |
| S02/1 | G02 | rows A, B, C 16.6 | each 16.6 B; ours 50.2 | 100 / 49.8 / 0 / 50.2 |
| S02/2 | G03a | rows A 33.333333, B 16.666667 | `33.333333` (33,33), `16.666667` (16,67); ours 50 | 100 / 50 / 0 / 50 |
| S02/3 | G03c | rows 29.761905, 10.119048, 10.119047 | as entered (29,76 / 10,12 / 10,12); ours 50 | 100 / 50 / 0 / 50 |
| S02/4 | G06 | row RX 66.6 (label-kind owner) | RX 66.6 B; ours 33.4 | 100 / 66.6 / 0 / 33.4 |
| S02/5 | G07 | row LL 25 (label-kind owner) | LL 25 B; ours 75 | 100 / 25 / 0 / 75 |
| S03/1 | G03b | rows A, B 25; M1, M2 13 (net, artist_pool) | M1 13, M2 13; A 12, B 12; ours 50 | 100 / 50 / 0 / 50 |
| S03/2 | G04 | rows A, B 25; R 15 (net, top) | R 15; A 21.25, B 21.25; ours 42.5 | 100 / 57.5 / 0 / 42.5 |
| S03/3 | G11 | row A 50; P 15 (bucket, label_share) | A 50, P 7.5; ours 42.5 | 100 / 57.5 / 0 / 42.5 |
| S03/4 | G12 | row A 50; E 10 (bucket, artist_share of A) | E 5, A 45; ours 50 | 100 / 50 / 0 / 50 |
| S03/5 | G32 | row A 100; R 15 (net, top) | R 15, A 85; ours 0 | 100 / 100 / 0 / 0 |
| S03/6 | G35 | row A 50; P1 10, P2 15 (bucket, label_share) | P1 5, P2 7.5; ours 37.5 | 100 / 62.5 / 0 / 37.5 |
| S03/7 | G36 | rows A, B 25; S 15 (net, label_share) | S 15; ours 35 | 100 / 65 / 0 / 35 |
| S03/8 | G37 | row A 50; P 70 (net, label_share) | P 50; ours 0; shortfall `20` | 100 / 100 / 0 / 0 |
| S04/1 | G45 | legacy A 35 S 15 to 2026-02-01; A 35 from 2026-02-01; S 15 (net, label_share) from 2026-02-01; change from 2026-01-01 to A 50 (doc `other`); units 01, 03 | 01: A 50; 03: A 35, S 15; ours 50 both | each month 100 / 50 / 0 / 50 |
| S04/2 | G46 | rows A, B 25; M1, M2 each 16.66 (bucket, artist_share) of A and of B from 2026-01-01; units 01, 03 | each month A 16.67, B 16.67, M1 8.33 (two allocations `4.165` = 4,17), M2 8.33; ours 50 | each month 100 / 50 / 0 / 50 |
| S04/3 | G47 | legacy A, B 17.5, S 15 to 2026-02-01; A, B 17.5 from 2026-02-01; S 15 (net, label_share) from 2026-02-01; change from 2026-01-01 to A 25 B 25; units 01, 02 | 01: A 25, B 25; 02: A 17.5, B 17.5, S 15; ours 50 | each month 100 / 50 / 0 / 50 |
| S05/1 | G05a | `NoGhost Records`; row A 50 | A 50, NG 25 B; ours 25 | 100 / 75 / 0 / 25 (0to8 25) |
| S05/2 | G05b | as S05/1, row A 70 | A 70, NG 15; ours 15 | 100 / 85 / 0 / 15 |
| S05/3 | G31 | row A 100; `NoGhost Records` | A 100, NG `0` (emitted); ours 0 | 100 / 100 / 0 / 0 |
| S05/4 | G41 | one row A 0; `NoGhost Records` | NG 50 **B**; ours 50 | 100 / 50 / 0 / 50 |
| S06/1 | G08a | string `Ahh Music`; row A 50 | A 50; label of record 0to8 | 100 / 50 / 0 / 50, {0to8: 50} |
| S06/2 | G08b | string `Echo8`; row A 50 | A 50; label of record Echo8 | 100 / 50 / 0 / 50, {Echo8: 50} |
| S06/3 | G38 | `NoGhost Records` in 03, `Test Label` in 04; row A 50 | 03: A 50, NG 25, ours 25; 04: A 50, ours 50 | 03: 100 / 75 / 0 / 25; 04: 100 / 50 / 0 / 50 |
| S07/1 | G15 | net `-100`; `NoGhost Records`; rows A, B 25; R 15 (net, top) | R -15, A -21.25, B -21.25, NG -21.25; ours -21.25 | -100 / -78.75 / 0 / -21.25 |
| S07/2 | G16 | net `0`; as S07/1 | R, A, B, NG `0` (emitted); ours 0 | 0 / 0 / 0 / 0 |
| S08/1 | G18 | `NoGhost Records 08a` (rule 50 → NG-081); rows A, B 25; R 15 (net, top), M 13 (net, artist_pool), P 10 (bucket, label_share) | R 15, A 14.75, B 14.75, M 13 B; P 4.25 C assumption (q11), NG `19.125` C (q11); ours `19.125` | 100 / 57.5 / 23.375 / 19.125 |
| S08/2 | G18b | `NoGhost Records 08b` → NG-082; as S08/1 plus E 10 (bucket, artist_share of A) | E `1.475` (1,48), A `13.275` (13,28); rest as S08/1 | 100 / 57.5 / 23.375 / 19.125 |
| S08/3 | G20 | `qaraqshy records`; row A 50 | A 50 B; QQ 25 C assumption (document); ours 25 (Echo8) | 100 / 50 / 25 / 25 (Echo8 25) |
| S08/4 | G21 | `NoGhost Records 08d` → NG-084; **no split** | no allocations: the whole label share 100 C `no_split` (D-175), no sublabel carve | 100 / 0 / 100 / 0, `ourShareNoSplit` 100 (the no-split part, in C); the queue group `pair` of the ISRC under `/queue/no_split` |
| S09/1 | G34 | rows A, B, C 16.6 (ids ascending, `Case.ordered`); M 13 (net, artist_pool) | A `12.266666666666`, B, C `12.266666666667` (12,27), M 13; ours 50.2 | 100 / 49.8 / 0 / 50.2 |
| S09/2 | G44 | row A 10; M1–M3 13 (net, artist_pool), ids ascending | M1 `3.333333333334`, M2, M3 `3.333333333333` (3,33), A `0`; shortfall `29` | 100 / 10 / 0 / 90 |

S08 in P2 `/queue/assumption`: S08/1 groups participation P `4.25` and label rule NG-081 `19.125` (basis q11,
read-only "⚠ Q11"); S08/2 groups P `4.25` and NG-082 `19.125`; S08/4 group label rule NG-084 `50` (basis r1, "⚠ R1").
The QQ rule (S08/3) is shared: its group is not asserted.

**S10 Overview per account (G33, G40)**, P1 month 2026-03.

| k | Seed | P1 rows |
|---|---|---|
| 1 G33 | ISRC j1 unit 100 `Test Label` in 2710100; ISRC j2 unit 50 `Echo8` in 2710101; row A 50 on both | 2710100: 100 / 50 / 0 / 50, {0to8: 50}; 2710101: 50 / 25 / 0 / 25, {Echo8: 25} |
| 2 G40 | one ISRC: unit 100 `Echo8` in 2710200; unit 50 `Echo8` plus unknown pair `QZTST2710209` net 7 in 2710201; row A 50 | 2710200: 100 / 50 / 0 / 50, {Echo8: 50}; 2710201: 57 / 25 / 7 / 25, {Echo8: 25}, {unknown_pair: 7}; P10 Owner A-102 earned 75 |

The C `7` cell opens `/queue/unknown_pair?month=2026-03` with the group `QZTST2710209` `7`.

**S11 Release by UPC (G24)**, P8. Seed: `QZTST2711101` under UPC1 `2711100000001` and UPC2 `2711100000002`; row A
50; P 10 (bucket, label_share); units UPC1 100, UPC2 50. P8 UPC1: net 100, B `55`, ours `45`; UPC2: net 50, B `27.5`,
ours `22.5`. P6: UPC1 A 50, P 5, ours 45; UPC2 A 25, P 2.5, ours 22.5. P1 2711100: 150 / 82.5 / 0 / 67.5. P10 A
earned `75`, P `7.5`.

### Action scenarios: the waiting queue

**S12 `split_unconfirmed` → document and confirm (G19).** Seed: row A 50 with no document; P 10 (bucket,
label_share) approved.

| State | P2 `/queue/split_unconfirmed` (key split) | P6 2026-03 | P1 2712100 |
|---|---|---|---|
| before | split of `QZTST2712101`, owner A, `50`, months 2026-03…2026-03 | A 50 C split_unconfirmed; P 5 B; ours 45 | 100 / 5 / 50 / 45 |
| after | gone | A 50 B; P 5 B; ours 45 | 100 / 55 / 0 / 45 |

Action: create document (kind appendix, title, file ref) → approve (dialog: «ждёт этого документа: 0», nothing links
it yet) → confirm split (dialog: ISRC, rows A 50, period 2020-01-01 → бессрочно, the document). P10 A: earned 0 →
`50`, payable `50`.

**S13 `assumption` on a row → replace by a document (G10a, G10b).** Seed: rows A 23, L 20 (own document of kind
`assumption` "Q1"), D 7 under an approved appendix from 2020-01-01; buy-out of A from 2026-05-01 (A 0, L 20 with Q1,
D 7); units 2026-03, 2026-05.

| State | P2 `/queue/assumption` (key split, document Q1) | P6 | P1 2713100 |
|---|---|---|---|
| before | split from 2020-01-01 `20` (month 03); buy-out split from 2026-05-01 `20` (month 05) | 03: A 23 B, L 20 C assumption, D 7 B, ours 50; 05: L 20 C, D 7 B, ours 73 | 03: 100 / 30 / 20 / 50; 05: 100 / 7 / 20 / 73 |
| after | first group gone; 05 group `20` stays | 03: A 23, L 20, D 7 all B, ours 50; 05 unchanged | 03: 100 / 50 / 0 / 50; 05 unchanged |

`confirmSplit` cannot do it (the row's own document wins, `10` §3 layer 6; another document on a confirmed split is
`split_document_set`). The wizard creates and approves an appendix, then `POST /splits/change` {from 2026-03-01, A 23,
L 20, D 7 without row documents, documentId = the new appendix}. Dialog: closes 2020-01-01…2026-03-01 (A 23, L 20
[допущение], D 7); new rows from 2026-03-01 up to the next split (2026-05-01, read from the split list). Q1's approve
button is hidden; a forced approve returns 422 `assumption_not_approvable`. P21 `assumptions`: Q1 `40` → `20`.

**S14 `owner_unconfirmed` → contract.** Seed: `unconfirmedOwner` "Owner A-141", pseudonym A; row A 50 (approved).

| State | P2 (key owner) | P6 | P1 2714100 | P10 / P4 |
|---|---|---|---|---|
| before | Owner A-141 `50` | A 50 C owner_unconfirmed | 100 / 0 / 50 / 50 | confirmed false, waiting `50`, payable `0`; `payout` {allowed false, reason owner_not_confirmed} |
| after | gone | A 50 B | 100 / 50 / 0 / 50 | confirmed true, earned `50`, payable `50`; `payout` {allowed true, amountCents 5000} |

Action (P10 Документы и договоры): create document kind contract with a file ref (`POST /documents`; without a file
approve is 422 `document_not_attached`, so the form attaches it, or `POST /documents/:id/attach`) → approve (dialog)
→ `POST /contracts` {owner, document, artistIds [A]} (dialog: "владелец становится подтверждённым").

**S15 `artist_without_owner` → assign.** Seed: artist A-151 without owner; row A 50; confirmed Owner A-151 (contract on
Z-151). Before: P2 (key artist) A-151 `50`; P6 A 50 C artist_without_owner; P1 2715100 100 / 0 / 50 / 50. Action
`POST /artists/:id/owner` (no dialog). After: group gone; A 50 B; P1 100 / 50 / 0 / 50; owner earned `50`.

**S16 `label_unmapped` → alias (G08c).** Seed: string `Mystery Records`; row A 50. Before: P2 (key label string)
`Mystery Records` `50`; P21 `labelUnmapped` `Mystery Records` net `100`; P6 A 50 B, label share 50 C label_unmapped,
ours 0; P1 2716100 100 / 50 / 50 / 0, {label_unmapped: 50}. Action `POST /labels/:id/aliases` (0to8). After: group
and signal row gone; ours 50 (0to8); P1 100 / 50 / 0 / 50, {0to8: 50}.

**S17 `label_unmapped` → sublabel and rule (G08c → G05a).** Seed: string `Mystery Records B`; row A 50; company
NG-171. Before: group `50`; P1 2717100 100 / 50 / 50 / 0. Action: `POST /labels` (sublabel of 0to8) → aliases (the
string) → rules (50 → NG-171 from 2020-01-01, approved contract). After: P17 shows the rule; P6 A 50, NG-171 25 B,
ours 25; P1 100 / 75 / 0 / 25.

**S18 Publishing (G26a–e), `publishing_terms_unconfirmed` → terms (G26d).** Seed as the G26 test: owners W1, W2, W3
with aliases; terms W1 50, W2 90 and 50 (Synchronization), approved; W3 none; lines T-A (W1, W2; Mechanical 100), T-B
(Synchronization 100), T-C (W1, X; 100), T-D (W3; 100), holder `HOLDER H`, period 1Q26.

| Page | before | after W3 terms |
|---|---|---|
| P2 `publishing_terms_unconfirmed` | owner W3 `50` | gone |
| P10 W1 Паблишинг | T-A 50 / 50 / 25 B; T-B 50 / 50 / 25 B; T-C 100 / 50 / 50 B; earnedPublishing `100` | unchanged |
| P10 W2 | T-A 50 / 90 / 45 B; T-B 50 / 50 / 25 B; `70` | unchanged |
| P10 W3 | T-D 100 / 50 / 50 C; waiting `50` | T-D B; earned `50`, payable `50` |
| P1 b17 / 2026-03 | 400 / 170 / 50 / 180 | 400 / 220 / 0 / 180 |

Action: `POST /publishing/terms` {W3, 50, validFrom 2020-01-01, approved contract of W3}; no dialog.

**S19 `writer_unmapped` → map the writer.** An unknown holder gets an auto-created owner and an unknown songwriter is
marked external, so the testable state is an **ambiguous** writer (or a label-kind owner). Seed: confirmed owners
W4a-191, W4b-191, both with alias `HOLDER W4`; W4a has approved terms 50; one line, holder `HOLDER W4`, no songwriters,
payable 100, period 4Q25. Before: P18 `HOLDER W4` ambiguous; P21 `ambiguousWriters` lists it; P2 (key writer)
`HOLDER W4` `100`; P1 b17 / 2025-12 100 / 0 / 100 / 0 {writer_unmapped: 100}. Action `POST /publishing/writers/:norm/map`
{ownerId W4a}. After: resolution manual; signal and group gone; P1 100 / 50 / 0 / 50; W4a earned `50`.

**S20 Perimeter (G30).** Seed: account 2720100, lines without ISRC (UPC `2720100000001`) net 2 and `QZTST2720109`
(unregistered) net 7. Before: P2 `no_isrc` pair `2` read-only "⚠ D-035"; `unknown_pair` `QZTST2720109` `7`, action
"создать трек"; P21 `unallocated` the same two pairs (the ISRC one with the action, the other read-only); P1 9 / 0 /
9 / 0 {no_isrc: 2, unknown_pair: 7}. Action `POST /tracks` {isrc, upc prefilled, title}. After: `unknown_pair` group and
its `unallocated` row gone; P6 status no_split, ours `7`; P21 `isrcsWithoutSplit` lists it with net `7`; P1 9 / 0 / 2
/ 7, `ourShareNoSplit` 7.

**S21 Unfunded carve (G22).** Seed: row A 10; P 20 (net, artist_pool) from 2020-01-01. Before: P21 `unfunded`
`QZTST2721101` missing `10`, why bucket_short; P6 A `0`, P `10`, ours 90; P1 100 / 10 / 0 / 90. Action (P16): close P
at 2026-03-01 (dialog) → create P 10 (net, artist_pool) from 2026-03-01. After: the shortfall is gone; A `0`, P `10`;
P1 unchanged.

**S32 `rule_unconfirmed` → approve the rule's document.** Seed: row A 50 (approved appendix); P 10 (bucket,
label_share) under a `contract` document with a file attached, not approved.

| State | P2 `/queue/rule_unconfirmed` (key participation) | P6 | P1 2732100 |
|---|---|---|---|
| before | P on `QZTST2732101`, `5` | A 50 B; P 5 C rule_unconfirmed; ours 45 | 100 / 50 / 5 / 45 |
| after | gone | P 5 B | 100 / 55 / 0 / 45 |

Action (P14 or the group): approve (dialog: the document, confirms 1 participation, «ждёт этого документа: 5»).

### Action scenarios: owners, sources, duplicates

**S33 Merge owners.** The direction is fixed by `mergeOwners`: the merged owner must have no approved documents and
the target must be confirmed (else 422 `merge_direction`; different kinds 422 `merge_kind_mismatch`). Seed: confirmed
Owner X-331 (pseudonym A, row A 50 on ISRC j1); Owner Y-331 without contract (pseudonym B, row B 50 on ISRC j2); one
file, account 2733100.

| State | P10 X | P10 Y | P1 2733100 |
|---|---|---|---|
| before | earned `50`, pseudonyms A | earned 0, waiting `50` (owner_unconfirmed), pseudonyms B | 200 / 50 / 50 / 100 |
| after | earned `100`, pseudonyms A and B | hidden from P9; `/owners/:Y` says "объединён с X-331" | 200 / 100 / 0 / 100 |

Action (P10 of Y, "объединить в…"): `POST /owners/merge` {fromId Y, intoId X, reason}; dialog: from → into,
pseudonym B and documents that move, "необратимо". History of X shows the audit row with `e2e-operator`.

**S34 Upload a Believe file (P19), under a label (D-169).** Fixture: `9900001_2734100_2026-03-01_2026-03-01.csv`, built in
the spec (synthetic, one line `QZTST2734101`, UPC `2734100000001`, net 100, `Test Label`); seed: the track and row A 50, no
file, account 2734100 registered under no label. Before: P19 has no file of account 2734100, P1 has no row. Under «Все»
`action-upload-believe` and `action-upload-b17` are disabled, `upload-closed-reason` «выберите лейбл в шапке…». Under 0to8
the upload answers 422 `account_unregistered`: `register-account-dialog` opens («Зарегистрировать счёт 2734100 за лейблом
0to8», `field-label-account` prefilled) → `action-account-submit` registers it and the upload repeats → file `loaded`,
lineCount 1, `file-label` (`data-col="label"`) «0to8»; P1 2734100 / 2026-03: 100 / 50 / 0 / 50. Same file again under
0to8: 409 `duplicate_period` (the loader checks account + month before the hash). The same file under Echo8: the file
is not listed there, the toast `account_of_other_label` says «Счёт 2734100 принадлежит лейблу 0to8» (not
`duplicate_period`: the account is checked first). The same bytes renamed to account 2734101 (`9900002_2734101_…csv`,
registered under 0to8 by the spec): 409 `duplicate_file`. P17 (spec 29): an account added to 0to8 and removed again
(`action-remove-account-<n>`, `ConfirmDialog`); `account_has_files` is the backend test's.

**S30 Duplicate pseudonyms (P11).** Seed: artist `DUP-301` of confirmed Owner DUP-301; a second artist `DUP-301`
without owner; `QZTST2730101` registered, Believe artist name `DUP-301`, net 100, no split. Before: P11 group (2
artists; isrcsWithoutSplit `QZTST2730101` `100`); P6 no_split, C `no_split` 100 (D-175); P1 2730100 100 / 0 / 100 / 0. Assign owner
to the second artist: numbers unchanged. Create split DUP-301 (first) 50 with an approved appendix: isrcsWithoutSplit
empty; P6 DUP 50 B, ours 50; P1 100 / 50 / 0 / 50.

**S36 Duplicate dialog.** Seed: Owner DUP-361 and artist `A-361`. `POST /owners` {name "Owner DUP-361"} → 409
`possible_duplicate` with `similar` → dialog lists Owner DUP-361; "тот же" opens its P10 (nothing created); "новый"
repeats with `force: true` → 201, P9 shows two owners of that name. The same for `POST /artists` {pseudonym `A-361`}.

### Action scenarios: payouts and operations

**S22 Payout (G27, G27b) and the deferred flag.** Seed (2722100): row A 50, P 15 (bucket, label_share); units
2026-03, 2026-04 net 100; advance 10 on P (scope any, 2026-03-01, approved basis, proof). k2 (2722200): the same with
the 04 unit `-100`.

| Step | P10 Owner P-221 | `payout` | P20 |
|---|---|---|---|
| before | earned `15`, recouped `10`, position remaining `0`, payable `5` | allowed true, amountCents 500 | the advance |
| Pay (dialog: payable `5`, formula fields, P 5, "снимок будет сохранён") | payable stays `5` (an unproved payout is not counted), pendingOperations [no payment proof yet], blockingPayouts [payout]; P4 blockingPayouts 1 | allowed false, payout_blocked | payout, amountCents 500, deferred true |
| attach proof | paid `5`, payable `0`, blockingPayouts [] | allowed false, nothing_to_pay | proof, deferred false |
| set deferred (P20) | paid `5` (still counted), blockingPayouts [payout] | allowed false, nothing_to_pay (D-176: payable 0 is reported before the blocked payout; the payout stays listed as blocking) | deferred true |
| unset deferred | blockingPayouts [] | allowed false, nothing_to_pay | deferred false |

An unproved payout also blocks a new advance (`createOperation` out gate); the Операции tab says so. k2 read-only:
P-222 earned `0`, recouped `0`, remaining `10`, payable `0`. P1: 2722100 03 and 04 100 / 57.5 / 0 / 42.5; 2722200 03
same, 04 -100 / -57.5 / 0 / -42.5.

**S23 Sublabel advance (G29).** Seed: `NoGhost Records 23` (rule 50 → NG-231); row A 50; advance 50 on NG-231 (scope
any, proved). P10 NG-231: earned `25`, recouped `25`, remaining `25`, payable `0`, `payout` {allowed false,
nothing_to_pay}. P1 2723100: 100 / 75 / 0 / 25.

**S24 Negative payable shown as 0 (G28, G39).**

| k | Seed / action | P10 `total` | `payout` / P4 |
|---|---|---|---|
| 1 G28 | row A 50; migration payout 30 | paid `30`, payable `20` | allowed true, 2000 / 20 |
| 2 G28 | migration payouts 30 and 40 | paid `70`, payable `-20`, payableShown `0`, warning with `-20` in `title` | allowed false, nothing_to_pay / 0 + warning |
| 3 G39 before | row A 50; migration payout 50 | earned 50, paid 50, payable `0` | nothing_to_pay |
| 3 G39 after | P16: create R 15 (net, top) from 2026-01-01 | earned `42.5`, payable `-7.5`, payableShown `0`, warning | nothing_to_pay / 0 + warning |

S24/3 after: P6 R 15, A 42.5, ours 42.5; P1 2724300 100 / 50 / 0 / 50 → 100 / 57.5 / 0 / 42.5.

**S31 Operations (G43; deduction, credit, deactivate, return).** k1–k3 seed: Owner A (row A 50, unit 100; B17 holder
line `OWNER, A-31k` payable 60 in 2Q26; terms 50 approved; second track `QZTST2731k02` without income): earned `80`,
payable `80`.

| k | Action (dialog: direction, amount, pseudonym, scope, basis) | without proof | after proof |
|---|---|---|---|
| 1 (i) | advance 40, scope publishing, 2026-01-01 | payable `80`, pending + blocking [advance] | recouped `30`, remaining `10`, payable `50` |
| 2 (ii) | advance 40, scope isrcs [`QZTST2731202`] | payable `80` | recouped `0`, remaining `40`, payable `80` |
| 3 (iii) | read-only: seeded migration payout 20 | — | paid `20`, payable `60` |

k4 (G01 base, Owner A-314 payable 50): deduction 10 (in, artist A, approved adjustment_basis, 2026-03-01) → recouped
`10`, payable `40`; credit 5 (in, amount `-5`, approved basis) → credits `5`, payable `45`; deactivate the deduction
(reason, "необратимо") → recouped `0`, payable `55`; Pay (`payout` amountCents 5500) and proof → paid `55`, payable
`0`; return the payout (file, date = payout date; "необратимо") → operation meaning return, amountCents -5500, returns
`55`, payable `55`. Without a scope and not migration the API refuses `use_payout_button`; the form has no such choice.

### Action scenarios: rules and dates

**S25 Buy-out (G09).** Seed: row A 50 from 2020-01-01; units 02, 03, 05; approved `buyout` document.

| State | P6 A; ours (02 / 03 / 05) | P1 2725100 B / ours | P10 A earned |
|---|---|---|---|
| before | 50;50 / 50;50 / 50;50 | 50/50, 50/50, 50/50 | `150` |
| change from 2026-03-15 → A 25 | 50;50 / 25;75 / 25;75 | 50/50, 25/75, 25/75 | `100` |
| buy-out from 2026-05-10 | 50;50 / 25;75 / —;100 | 50/50, 25/75, 0/100 | `75` |

Dialogs carry "даты правил начинаются с первого числа месяца"; the toast shows the stored date (2026-03-01, 2026-05-01).

**S26 Assignment (G13; G17 read-only).** k1: row A 50, units 05, 06; change from 2026-06-01 to A2 50 (doc `other`).
Before: A 50 both months; A earned `100`, A2 `0`. After: 05 A 50, 06 A2 50, ours 50; A `50`, A2 `50`. k2 (G17): 05 A
50, ours 50; 06 DU 100, ours 0.

**S27 Close a participation (G14).** Row A 50; P 15 (bucket, label_share) from 2026-01-01; units 03, 04. Before: both
P 7.5, ours 42.5. Close at 2026-04-01 (dialog). After: 04 A 50, ours 50; P1 2727100 04 100 / 50 / 0 / 50; P earned 15
→ `7.5`. A close entered 2026-04-20 floors to 2026-04-01.

**S37 Close a label rule (G14 analogue).** Seed: `Close Label 37` (sublabel of 0to8, rule 50 → NG-371 from 2020-01-01);
row A 50; units 03, 04 on that string. Before: both months A 50, NG-371 25, ours 25; P1 2737100 100 / 75 / 0 / 25.
Close the rule at 2026-04-01 (`POST /labels/rules/:id/close`, dialog: the rule, the month). After: 03 unchanged; 04 A
50, ours 50, no NG; P1 04 100 / 50 / 0 / 50; P21 `sublabelWithoutRule` [`Close Label 37`, 2026-04, `100`]; NG-371
earned 50 → `25`.

**S38 The label as a book (G50, D-168, D-169).** Seed: owner A with rows A 50 on j1 (`Test Label` → 0to8, unit 100) in
the file of account 0 (loaded under 0to8) and j2 (`Echo8`, unit 60) in the file of account 1 (loaded under Echo8), one
month; the numbers are those of one file. P1 (D-169): each account's row sits in one book, the label of its file
(`overview-row-*[data-book]`, the cell `[data-col="book"]` with one `book-<name>`): account 0 `100 / 50 / 0 / 50` book
0to8, account 1 `60 / 30 / 0 / 30` book Echo8; P21 `filesWithoutLabel` empty. A migrated advance 40 without a label (`extra['advance-unlabelled']`,
recouped from any income in month order: 0to8 first) and an advance 10 under Echo8 (`extra['advance-echo8']`, its
income only); `labels['0to8']`, `labels.Echo8`. P10 under «Все»: earned `80`, recouped `50`, payable `30`; the books
(`by-label-<name>`, cols `earned|waiting|recouped|adsCharged|paid|returns|credits|payable`): 0to8 `50 / 40 / 10`,
Echo8 `30 / 10 / 20`; both positions listed; `action-pay` disabled with «выберите лейбл». The switch (`label-switch`,
`data-label`; the select `field-label`) under Echo8: `balance-tab[data-label]`, earned `30`, recouped `10`, payable
`20`, the Echo8 book alone, the Echo8 advance alone, the URL carries `label=`, a reload keeps the stored switch, a link
with `?label=` wins. The payout under 0to8: the dialog says «Лейбл: 0to8», `amountCents` 1000 with `labelId`; without a
label the API answers 400 `label_required`; after the proof 0to8 paid `10`, payable `0`; «Все» payable `20`. P20
(`[data-col="label"]`): the payout «0to8», the Echo8 advance under Echo8, the old advance «без лейбла». P21
`operationsWithoutLabel`: the old advance (`40.00`), `action-set-label` → `field-op-label` → `action-set-label-submit`
→ the row goes; the books are unchanged (its only income is 0to8). P9 under Echo8 lists the owner with payable `20`;
P11 under Echo8 the pseudonym with earned `30`; P5 under Echo8 the j2 track only.

**The book on P1 and P6 for every scenario (D-169).** Every seed file is loaded under the label of its account
(`account(0)` of a case 0to8, `account(1)` Echo8, `scripts/e2e/lib.ts`), so every Believe row of P1 has exactly one
book (`data-book`, never `?`): the label string does not move it. S06/2, S08/3 and S10/2 (account 0) carry the string
`Echo8` in a 0to8 file: book 0to8, while `by-label-Echo8` (`ourShareByLabel`, by the string) keeps their ours; S10
account 1 rows are book Echo8. P6 shows both per month row: `month-book` / `data-book` (the file's label, «Книга») and
`data-label` → `label-of-record` → sublabel (the string). S06/2 on P6: `data-book="0to8"`, `data-label="Echo8"`,
`label-of-record` Echo8. P21 `filesWithoutLabel` (`signal-list-filesWithoutLabel`, rows
`signal-row-filesWithoutLabel-<fileId>`) is empty on the seed; `verify-seed.ts` checks the book of every expected P1 row
and one named book on every Believe row.

**S39 (G51, D-169): not seeded yet** (commit 3 of stage 1): a dedicated case, row A 50, unit 100 with the string
`Echo8` in `account(0)`: P1 `by-label-0to8` A 100, B 50, ours 50, no Echo8 book; P6 `data-book="0to8"`,
`data-label="Echo8"`; P21 `labelOutsideAccount` 1; P10 under Echo8 earned `0`. Until then S06/2 covers the P1 and P6
parts (above).

**S41 (G54, D-169): not seeded, covered by G54** (`tests/golden.test.ts`): the seed posts no advertising, so no record
is paid by one label on an ISRC whose income sits in the other account's book (the seed stays stable). The screen parts
are acted in `32-ads` on S31/3 (book 0to8): both records are written with the payer 0to8 (`field-ad-label`,
`field-ad-batch-label`, the confirmation line «Плательщик: 0to8»); under «Все» `action-create-ad` and
`action-create-ads-batch` are closed and `POST /ads` without `labelId` is 400 `label_required`; the 15 moved to the
payer Echo8 shows `ad-label` Echo8 and `ad-income-book` 0to8 and is the one `signal-row-adOutsideBook-<adId>`
(`data-col="payer"` Echo8, `data-col="book"` 0to8), whose `action-set-payer` (`EditAdByIdDialog`) sets it back; the
balance numbers of S31/3 are those under «Все» (the sum of the books). `adsWithoutLabel` and `adOutsideBook` are 0 in
`21-signals`; `33-artist` posts its record with the payer 0to8.

**S43 (G56, D-169): not seeded, built in `26-payout` by API** on an owner of its own (`Owner S43 e2e`, pseudonym
`P-431`, no income, so no seeded owner changes): a contract whose document has the label 0to8. P10 under Echo8:
`payout-gate` `gate-no_contract_for_label` «нет договора с этим лейблом», `action-pay` disabled, `POST
/owners/:id/payouts` with Echo8 → 422 `no_contract_for_label`; under 0to8 `gate-nothing_to_pay`. P14
`action-set-document-label` → «любой лейбл» (`PATCH /documents/:id { labelId: null }`): under Echo8 and 0to8
`gate-nothing_to_pay` (the document without a label opens both). The documents part is in `14-documents` (`Label spec
doc A/B/C`): created under 0to8 (`field-document-label` defaults to the switch, the `document-label` cell 0to8), set to
«любой» and then Echo8 on P14 (`document-label` of the header); under 0to8 the list shows B (0to8) and C (no label,
«любой»), under Echo8 A and C, under «Все» all three. `32-ads` asserts the audit column (`ad-audit` `[data-col="label"]`:
`POST /ads` 0to8, `PATCH /ads/:id` Echo8).

**S42 (G55, D-169): not seeded, covered by G55** (`tests/golden.test.ts`): a statement under Echo8 with a contract of
0to8 only needs a second B17 file, and the e2e specs have no reusable synthetic B17 workbook (the seed builds its one
statement in `scripts/e2e/lib.ts` `loadB17`, under 0to8). The screens assert the R8 side of the seed instead: every B17
line is in the book 0to8 and no book «без лейбла» is left. `15-publishing` (reads): the P1 b17 rows 2025-12, 2026-03,
2026-06 have `data-book="0to8"` (`book-0to8`), no `overview-label-?`; P19 `statement-label` 0to8; P10 S18 W1 under «Все»
`by-label-0to8` earned `100`, no `by-label-?`; under 0to8 earned `100`, payable `100`, three `publishing-line` rows
(T-A, T-B, T-C); under Echo8 earned `0`, no `publishing-line`. `21-signals`: `statementsWithoutLabel` `0`, the list
renders empty. `26-payout`: S31/1 (read only, `27-operations` acts on it) under «Все» `by-label-0to8` earned `80`, no
`by-label-?`; under 0to8 earned `80`, payable `80`, one `publishing-line` `30`, the Pay dialog «К выплате: 80,00 (будет
отправлено 8000 центов)» (master 50 + publishing 30), cancelled; S18 W1 under Echo8 `POST /owners/:id/payouts` → 422
`nothing_to_pay`, under 0to8 the payout of `10000` cents with `labelId` 0to8, after the proof paid `100`, payable `0`
(`by-label-0to8` paid `100`). `35-label-switch`: P9 payouts view, S18 W2 listed under 0to8 with payable `70`, absent
under Echo8.

**S28 M52 (G25).** Row A 50; unit 03. Create P 15 (bucket, label_share) with `validFrom` 2026-03-15: response
`validFrom` 2026-03-01; toast "начало округлено до 2026-03-01" (dates compared, no money). P6 A 50, ours 50 → A 50, P
7.5, ours 42.5; P1 2728100 B 50 → 57.5.

**S29 Refusals (G23).** No Believe unit; row A 50; P 10 (bucket, label_share); R1 60 (net, top). Participation A (net,
top 10) → 422 `double_participation`; change split from 2026-06-01 to A 50 + P 10 → 422 `double_participation`; R2 60
(net, top) → 422 `top_above_100` (status to verify in 3.x). The money tab shows `page-state-empty` "нет строк отчётов".

**S35 Signals without a golden number (G21b, G21c, notes, participants without owner).** P1 identity only.

| k | Seed | P21 before | Action | after |
|---|---|---|---|---|
| 1 G21b | `Ghost Label 35` (sublabel of 0to8), rule 50 → R from 2026-06-01; ISRC j1 rows A 40, R 10; j2 row A 50; units 03 and 06 (100 and 40 on that string) | `sublabelWithoutRule` [`Ghost Label 35`, 2026-03, `140`]; `ruleRecipientIsRow` [j1, R, 2026-06] | none (links to P17 / P15) | — |
| 2 G21c | rows A 30, A2 20 (one owner); unit 03 | `twoRowsOneOwner` [j1, 2026-03, [A, A2]] (information only) | none | — |
| 3 | row A 50; unit 03 | no `tracksWithNote` row | P6 header: set note "производная вне разрешения" (`PATCH /tracks/:id`) | row with the note; clearing it removes the row; money unchanged |
| 4 | row A 50; P 10 (bucket, label_share) to pseudonym P-354 without owner; unit 03 | `participantsWithoutOwner` [j1, P-354, label_share, `5`]; P6 P 5 C artist_without_owner; P1 100 / 50 / 5 / 45 | assign Owner P-354 (confirmed) | row gone; P 5 B; P1 100 / 55 / 0 / 45 |

P21 rows from other scenarios: S03/8 `unfunded` `20`; S21 `unfunded` `10`; S16/S17 `labelUnmapped`; S20 `unallocated`
and `isrcsWithoutSplit` (`7`); S08/4 `isrcsWithoutSplit` `QZTST2708401` `100`; S30 `isrcsWithoutSplit` `100`; S13
`assumptions` Q1 `40` → `20`; S08/1 `assumptions` q11 as two rows keyed by document (`facade/reports.ts`: `documentId|basis`): `4.25` (the participation's appendix) and `19.125` (the NG-081 rule's contract), asserted by document id, S08/4 r1 `50`; S19 `ambiguousWriters`; S37
`sublabelWithoutRule`.

### Stage 4 (D-172): the split import, the assumption, the checklist, the label history, the release registry

None is seeded: each spec builds its synthetic data (files in the spec, writes by `apiPost`) on keys of its own.

**S44 (P28, `38-split-import`; keys nn=44 because S38 is seeded)** under 0to8, ISRCs `QZTST2744101` / `QZTST2744102` (no report lines). The bad file
(`Import Artist 38A` 60 % from 2026-01-15 with `Import Owner 38A`, `Import Artist 38B` 50 % from 2026-01-01) = rows 2,
groups 1, errors > 0; `import-row-2` `data-action="blocked"`, `data-group="QZTST2744101|2026-01-01"`, chips
`issue-split_sum_above_100` (error), `issue-date_floored` (info, the «С» cell shows 2026-01-01), `issue-new_pseudonym`
(warning); `action-split-import-apply` closed with `import-blocked-reason`. The fixed file (38A 60 %, 38B 20 %; 38A 100 %
on the second ISRC from 2026-02-01) = errors 0, create 2, artistsNew 2, ownersNew 1, `issue-our_share` 20; the apply
answers «сплитов 2; новых псевдонимов 2; новых владельцев 1», two `link-import-splits`; the same file again = unchanged 2,
the apply closed; P15 `?isrc=QZTST2744101` one row «Import Artist 38A 60 %, Import Artist 38B 20 %». Under «Все» the
form is closed (`upload-closed-reason`); the template downloads `split-import-template.csv`.

**S45 (P15 assumption, `38-split-import`)** the P15 row of that split: `action-assume-<id>` → `assume-preview`
`data-count="1"`, label 0to8, reason → «Допущение принято: сплитов 1, пропущено 0», the row button closed; the API again
= 422 `nothing_to_assume`. (The money: no report lines, so P1 does not move; G-cases of `tests/assume.test.ts` own it.)

**S46 (P1 checklist, `39-onboarding`)** a new own label `Onboard e2e`: `onboarding-step-label` done, `accounts` / `files`
todo, `publishing` info, `[data-col="accounts"]` 0, `onboarding-link-accounts` → `/labels/<id>`. With account `2746100` and
one report (March 2026, net 10, label string `Onboard Label 39` without an alias): `accounts` and `files` done (files 1,
`onboarding-account-2746100` «2026-03 – 2026-03»), `unmapped` todo with `[data-col="unmapped"]` 1 and the string,
`splits` todo; the link goes to `/signals/labelUnmapped`. «Свернуть» (`action-onboarding-collapse`, `data-collapsed`)
survives a reload. Under «Все» the administrator's `org-checklist`: `org-step-labels` and `org-step-users` done.

**S47 (P6 / P5 label history, `40-catalog`)** `QZTST2747101` (no report lines): `track-catalog-label` «—», the dialog
`track-labels` empty; «Задать лейбл» 0to8 from 2026-01-15 → row `track-label-2026-01-01` (`data-source="operator"`);
the replacement from the same month (`action-replace-track-label-2026-01-01`) with Echo8 keeps one row; the same again =
409 `catalog_same_label`; the header names Echo8; P5 `action-catalog-current` (`?catalog=current`) lists the ISRC with
`[data-col="catalogLabel"]` Echo8.

**S48 (P7 / P8 release registry, `40-catalog`)** account `2748100` added to 0to8 and one report (March 2026, net 10,
UPC `2748100000001`, one ISRC) uploaded on P19 and its track registered by API (P7 lists the UPCs of registered tracks); then the export of 0to8 with that UPC and «# of track» 2: `release-import-result` rows 1, inserted 1; again unchanged 1; P7 under 0to8
`[data-col="registered"]` `data-value="true"`, `[data-col="registryTrackCount"]` 2; `?view=registry` row
`registry-<0to8>-2748100000001` with `isrcsInUnits` 1; P8 `release-registry-<0to8>` with `release-incomplete` «1 из 2».

### Stage 5 (D-173): the kinds of an operation, the forgiveness, the relabel, the payroll, the import, the B17 replacement

**S49 (P10 «Операция», `41-operation-kinds`)** S24/1 owner A under 0to8 before: earned 50, paid 30, payable 20, buyouts 0,
adjustments 0. `action-create-operation` → `field-op-kind` «выкуп» (no `field-op-artist`: an owner kind), 15, 2026-05-01,
the basis document created and approved: confirmation «Вид: выкуп», «Сумма: 15,00», «Владелец: Owner A-241», «Область
книги: мастер»; the row `[data-col="kind"]` `data-kind="buyout"`, no `operations-blocked` (a buyout never blocks); after
`action-proof` `balance-buyouts` 15, payable still 20. Then «корректировка» with `field-op-sign` «в пользу владельца»,
5 → «Сумма: -5,00»; `balance-adjustments` 5, payable 25; `balance-area-master` buyouts 15, payable 25,
`balance-area-publishing` payable 0; `by-label-0to8 [data-col="adjustments"]` 5; the history tab has two rows
`[data-route="POST /settlements/operations"]`; P20 `?kind=buyout` lists one row.

**S50 (P20 forgiveness, `41-operation-kinds`)** the seeded advance 10 of S22/2 (proved, remaining 10): its row
`action-forgive-<id>` → `forgive-position [data-col="remaining"]` 10; 20 from 2026-05-01 with a new basis document →
toast `forgiveness_exceeds`; 4 → 201 `kind` forgiveness, 400 cents, toast «Аванс прощён: 4,00»; P10 `balance-forgiven` 4,
payable 0, `position-<advance>` forgiven 4, remaining 6. Second press: 7 → 422 `forgiveness_exceeds`; the deactivation of
the advance → 409 `has_forgiveness`.

**S51 (P20 relabel, `41-operation-kinds`)** the S49 buyout under «Все»: `action-relabel` → `op-label-current` 0to8,
Echo8, the submit closed until `field-op-label-reason` is filled; toast «Лейбл операции: 0to8 → Echo8», the row label
Echo8, `[data-col="labelSource"]` `data-value="operator"`; a PATCH without a reason → 400 `reason_required`; the audit row
of the PATCH carries `summary.body.reason`, `fromLabelId` = 0to8 and the label Echo8; the book 0to8 of the owner:
buyouts 0, adjustments 5, payable 25.

**S52 (P9 payroll and `asOf`, `42-payroll`, read only)** S31/3 owner A under 0to8 as 32-ads leaves it (P9 row filtered
by name): earned 80, paid 20, advertising 5 (2026-01), payable 55 = the csv `payroll_0to8_all_all_payroll.csv`
(`action-payroll-export` → `field-payroll-area` «мастер и паблишинг», `field-payroll-sheet` «ведомость»,
`action-payroll-download`) total row 80 / 20 / 5 / 55 (pseudonym row earned 50) = the json `GET /owners/payroll?area=all`,
`bookBMatches` true; area master: `payroll_0to8_all_master_payroll.csv` total earned 50, payable 25; the control sheet has
discrepancy 0 on every row. Under «Все» the export is closed («выберите лейбл»). `field-as-of` 2026-03 (URL `asOf`): the
P9 row earned 50, paid 0, payable 45, the csv `payroll_0to8_2026-03_all_payroll.csv` the same; P10 `?asOf=2026-03` the
same facts and `action-pay` closed («уберите срез»).

**S53 (P29 operation import, `43-operation-import`)** an owner of its own (`Owner S53 e2e`, by API). Under «Все» P29
(from P20 `action-import-operations`) is closed. Under 0to8 a file of 4 rows: line 2 `create`, line 3 (a payout without
external_id) `issue-external_ref_required` error, line 4 `issue-kind_not_importable`, line 5 `issue-owner_not_found`;
the apply closed with `import-blocked-reason`. The corrected file (two payouts 10.00 and 2.50 with external ids): create 2
→ apply 201 (two operation ids), `operation-import-result`; the same file again: unchanged 2, create 0,
`issue-unchanged` (info), the apply closed «применять нечего»; P20 `?kind=payout` two rows; P10 paid 12.5.

**S55 (P30 opening balances, `45-start`)** an owner of its own (`Owner S55 e2e` with the pseudonym `S55 Start e2e`,
by API, no income). Under «Все» P30 (the sidebar `nav-start`) lists every book and the import is closed. Under 0to8 the
cut 2026-06 / 2026-07-01T00:00:00Z / «e2e snapshot»: a file of 2 rows: line 2 `create`, line 3 (an unknown pseudonym)
`issue-pseudonym_not_found` error, the apply closed with `import-blocked-reason`. The corrected file (one start 12.5 / 0):
create 1, starts 1 → apply 201 (one row id), `start-import-result`, the row `start-row-<id>` with `data-kind` start and
`data-artist-id`, `start-totals` starts 1; the same file again: unchanged 1, `issue-unchanged` (info), the apply closed.
P10 of the owner: `balance-start` 12.5, earned 0, payable 12.5, `start-cut-0to8` `data-cutoff` 2026-06, the row in
`start-rows`, `by-label-0to8` `[data-col=start]` 12.5. The deactivation with the reason «e2e rollback»: the row leaves the
active list, `field-start-show-inactive` shows it with `data-active` false; P10 payable 0 and no `balance-start`.

**S56 (P10 admission, `46-admission`)** an owner of its own (`Owner S56 e2e`, the pseudonym `S56 Admit e2e`, an approved
contract, a start of 12.5 under 0to8 by the API, no income). The tab «Допуск»: `admission-tab` `data-active` false,
`admission-inactive`, the gate `data-reason` '' (allowed), `payee-none`, `holds-none`. The first payee of the
organization (`PayeeDialog`: tipalti, ref `e2e-56`): `data-active` true, `payee-<id>` `data-channel` tipalti, the gate
`needs_answer`; the answer dialog pre-fills `12.50`; after the answer the gate is ''. A hold (`HoldDialog`, decision):
the gate `hold` on the tab and on the balance tab (`payout-gate` `data-reason`); released with a reason: `hold-<id>`
`data-status` released, the gate ''. The threshold 2000 (`ThresholdDialog`): `admission-threshold-value` `data-cents`
2000, the gate `below_threshold`; empty: ''. The payee deactivated with a reason: `payee-none`, the gate `no_payee`.
The admission of the e2e organization stays on after this file (the seed's own payouts ran before it).

**S57 (P34 / P35 cuts, `48-cuts`, D-198…D-200)** an owner of its own (`Owner S57 e2e`, the pseudonym `S57 Cut e2e`, an
adjustment of −10 dated 2026-05-01 under 0to8 on an approved `adjustment_basis` by the API: the position +10). P34 from
`nav-cuts`: `action-create-cut` «S57 срез» on 2026-06-15 (the answer's `masterTo` 2026-06-01); P35 `cut-position-<owner>-<artist>`
`[data-col=balance]` `data-value` 10. «Перенести» with a new document (`field-cut-transfer-document`): the row leaves the
default list, with `field-cut-show-all` its balance is 0; P10 `?tab=cuts`: `owner-cut-positions-<cut>-<artist>` 0, one
`owner-cut-op-*`, `owner-cuts-after-positions-<label>-<artist>` 10. P20: `action-op-cut-<adjustment>` → `field-op-cut`
«S57 срез · 2026-06-15» → the row's `[data-col=cut]` `data-cut-id`; the delete of the cut answers the toast `cut_in_use`.
The cut stays in the e2e organization (its signal `cutsUnsettled` counts the seeded positions of 0to8).

**S54 (P19 B17 replacement, `44-b17-replace`)** the e2e seed has one statement and no xlsx writer reusable by the specs:
the replacement itself (superseded + `replacedBy`, the lines kept, the quarters moved, `periods_differ`,
`replace_label_differs`, `replace_not_loaded`) is covered by `packages/backend/tests/b17-replace.test.ts`. Here the seeded
statement row: `chip-loaded`, `action-replace-statement-<id>`, no `statement-replaced-by-<id>`; the dialog under «Все» is
closed («выберите лейбл»); under 0to8 a file that is not a statement is refused (an error toast) and the row stays loaded.

### SS: page states (one spec, `page.route` mocks, no seed dependency)

| Id | Mock | Expected |
|---|---|---|
| SS1 | `/sources/files` and `/overview` empty | P1 `page-state-empty` "отчёты не загружены" with the upload link |
| SS2 | `/overview` delayed 8 s | `page-state-long` and `recalc-indicator`; the sidebar navigates to P13 meanwhile |
| SS3 | `/owners/:id/balance` → 500 `{error: {code: "internal", message}}` | `page-state-error` with the code and message; retry refetches |
| SS4 | `/tracks/:isrc/money` with a field of the wrong type | error state "ответ API не соответствует контракту" |
| SS5 | after an action the money refetch is delayed | old numbers stay with `stale-badge` until the response |
| SS6 | `/tracks/summary` total 26,000, infinite rows | the grid pages through server pages; row `[row-id]` of page 3 reachable |
| SS7 | `/search?kinds=owners` backed by 2,100 synthetic owners | the picker shows ≤ 10 matches per typed query, never a full list |

## 5. Checks every scenario asserts

1. After every action and once per read-only case: the scenario's P1 rows satisfy `A_received` = `B_notOurs` +
   `C_waiting` + `ourShare`, `discrepancy` `0` (the spec sums the `title` strings with decimal.js; the page never sums).
2. P6 month rows: Σ allocations + the unit's label share = the unit net.
3. P10 of every scenario owner: `total.earned` = Σ of its B allocations (+ B publishing author amounts in S18, S19,
   S31); `total.waiting` = Σ of its C allocations.
4. The History tab of the changed entity shows the action with `e2e-operator`.
5. Every money page waits up to 20 s for `recalc-indicator` to hide (`toBeHidden({ timeout: 20000 })`), never
   `waitForTimeout`; a zod parse failure fails the spec.
6. Second press: in the UI the button is disabled while its request is in flight (a double click sends one request);
   the second request is then sent directly with the Playwright `request` fixture and asserted per the table below.

| Action | Second request | Expected |
|---|---|---|
| approve a document | same id | 200, the first `approvedAt` / `approvedBy` kept |
| confirm split | same document / another | 200 no-op / 409 `split_document_set` |
| contract on the same document | same body | 201, a second contract row; money unchanged |
| merge owners | same from → into | 422 `owner_merged` |
| assign owner | same owner / another | 200 idempotent / 422 `artist_owner_fixed` |
| change split from a date, identical | same body | 201: the first new split gets an empty period, an identical split is inserted; money unchanged, the Правила history grows (open point 1) |
| buy-out | same seller, same date | 200/201 with an empty list (the seller is already 0 in every affected split); no change |
| create participation | same | 409 `participation_overlap` (a split row: 422 `double_participation`) |
| close participation | same date | 200, no change (refused only for ≤ `validFrom` or an extension) |
| add label alias | same string | 409 `alias_taken` |
| set label rule | overlapping period | 409 `rule_overlap` |
| close label rule | same date | 200, no change |
| set publishing terms | same `validFrom` | 409 `terms_overlap` |
| map writer | same owner | 200 expected; to verify in 3.x (`addOwnerAlias` of an existing alias) |
| pay | button disabled (`payout.allowed` false) | direct: 422 `payout_blocked` or `nothing_to_pay` |
| advance / deduction / credit | same body | 201: a second operation (assert two in P20; the second advance is refused 422 `payout_blocked` while the first has no proof) |
| payment proof | same operation | 400 "This operation cannot take a payment proof" (facade check; module 409 `proof_exists`) |
| deferred | same value | 200, unchanged |
| deactivate | same | 409 "Operation is already inactive" |
| return | same payout | 400 "Returns cannot exceed the payout" |
| create track | same ISRC + UPC | refused; code to verify in 3.x |
| upload Believe | same file | 409 `duplicate_period`; same bytes under another account: 409 `duplicate_file` |

## 6. Spec files (`packages/frontend/e2e/golden/`) and the file order

Playwright runs the files of one worker (`workers: 1`) in alphabetical order of their path: `e2e/golden/*` first, then
`e2e/smoke.spec.ts` and `e2e/states.spec.ts`. The golden files carry an order number so the order is the name, and
**the order is part of the design**: a spec that acts on a scenario is the only one that asserts its after state, and
every spec that reads such a scenario runs before it and asserts the before state only (no spec reads the state and
branches). Within a file the tests run in order (`serial` where they share state).

| Order | File | Scenarios | Role |
|---|---|---|---|
| 10 | `10-overview.spec.ts` | S01–S11 on P1 (with the book of every row, D-169); SS1–SS3 on the real P1 | reads |
| 11 | `11-release.spec.ts` | S11 (P7, P8; the pseudonym links to P12, D-166) | reads |
| 12 | `12-track.spec.ts` | S01–S11 on P6 (the book of S06/2 and S10/2, D-169), G36, S13 month 05, S16 **before**, P5 (the pseudonym links to P12, D-166) | reads |
| 13 | `13-splits.spec.ts` | P15 / P16, S12 split **before** (unconfirmed), S32 | reads |
| 14 | `14-documents.spec.ts` | P13 / P14, S13 Q1, S32 document **before**; the label of a document (S43 documents part, D-169); `action-create-document` closed under «Все» («выберите лейбл»), `Ref spec doc` created under 0to8 as «любой лейбл» | reads (creates `Ref spec doc`, `Label spec doc A/B/C`) |
| 15 | `15-publishing.spec.ts` | P18, S18 terms, S19 holder **before** (ambiguous); D-169 the B17 lines in the book 0to8 (P1 b17 rows, P19 `statement-label`, P10 W1 under «Все» / 0to8 / Echo8, S42 part) | reads (adds W1 terms `Print`) |
| 20 | `20-queue.spec.ts` | S12–S19, S32 before and after (P1, the owner's balance, the P21 rows); S20 before; S08 read-only | acts |
| 21 | `21-signals.spec.ts` | S20 action, S21, S35, the P21 rows of S03/8, S08, S30; the 24 lists (D-172: +4; D-173: +3, `operationsDefaultLabel` and `operationsRelabelled` 0), `filesWithoutLabel`, `statementsWithoutLabel`, `adsWithoutLabel`, `adOutsideBook` 0 | acts |
| 22 | `22-duplicates.spec.ts` | S30 (assign owner, create split from the candidate) | acts |
| 23 | `23-duplicate-dialog.spec.ts` | S36 owners and artists | acts |
| 24 | `24-owner.spec.ts` | S23, S24, S36 contract, P9 / P10 tabs | reads, S24/3 by API |
| 25 | `25-merge.spec.ts` | S33 | acts |
| 26 | `26-payout.spec.ts` | S22; S43 (a 0to8 contract does not open Echo8, built by API on its own owner); D-169 S31/1 Pay dialog (D-173: master 50 by default, «мастер и паблишинг» 80; read, cancelled), S18 W1 paid under 0to8 (D-173: the master area is refused in the dialog, «паблишинг» pays 100) | acts |
| 27 | `27-operations.spec.ts` | S31 (the owner card under 0to8: every S31 book is 0to8); `action-create-operation` closed under «Все» (D-169) | acts |
| 28 | `28-rules.spec.ts` | S25–S29, S13 **after**, S21 (read) | acts |
| 29 | `29-labels.spec.ts` | S37 (and P17) | acts |
| 30 | `30-sources.spec.ts` | S34 | acts |
| 31 | `31-questions.spec.ts` | the 14 open items | reads |
| 32 | `32-ads.spec.ts` | S31/3 advertising (P22, P6 tab, P10 `balance-adsCharged`); D-169: payer 0to8, «Все» closed, `label_required`, payer Echo8 → `adOutsideBook` row → set back from P21; the audit «Лейбл» column | acts |
| 33 | `33-artist.spec.ts` | S24/1 and S23 on P12 (reads), S24/2 **after** (an expense of 10 on its ISRC by API) | acts |
| 34 | `34-artists.spec.ts` | S24/1 and S23 on P11 (the list, the search, the links to P12 and P10, the money of the visible rows, «Посчитать все») | reads |
| 35 | `35-label-switch.spec.ts` | S38 (D-168, D-169): the two P1 rows with their books, `filesWithoutLabel` empty, the label switch, the books on P10, the view under a label, the payout under 0to8, the operation without a label on P21 (set to 0to8), P9 / P11 / P5 under Echo8, the link with `?label=`; D-169 P9 payouts view S18 W2 under 0to8, not under Echo8 | acts |
| 36 | `36-orgs.spec.ts` | D-170 «Граница арендатора» and D-171 support, no scenario of its own: the seed's users (`e2e-operator`, `e2e-sysadmin`, `e2e-b`, `e2e-multi`, `e2e-manager`) and organization B («Org B e2e»: own label `Label B e2e`, owner `Owner B e2e`). Own contexts without the session: `/` → `/login`, `invalid_credentials` sentence, `?next=` back; the system administrator on P24 (A users 3; B labels 1, files 0, statements 0, owners 1, users 2), creates `Org C e2e` and user `e2e-c` on P25 (a label manager is not offered: the labels of C are an organization read, `user-labels-unavailable` = the `support_required` sentence); «Работать в организации» closed (`org-support` `data-active="false"`, the API 403 `support_required`) until `e2e-c` (empty P1) grants support (`POST /support`, `e2e-sysadmin`, +1 h, `write: true`; its audit row under `e2e-c`); then the enter → the shell names C with «поддержка» and `support-banner` (`data-write="true"`), `/labels` empty, C's audit by entity C = `POST /orgs`, `POST /orgs/:id/users`, `POST /orgs/:id/support/enter` under `e2e-sysadmin`, «Выйти из организации»; `e2e-b`: the switch offers «Все» and `Label B e2e` only, B's owner opens, A's `owner:0to8` → `not_found`, `/system/orgs` → `forbidden`, a write's audit operator is the login (not `X-Operator`), «Выйти» | acts (B: owner `Owner B2 e2e`; C and its grant) |
| 37 | `37-roles.spec.ts` | D-171 roles, no scenario of its own: `e2e-manager` (label manager of A with 0to8) lands on P21 (no `nav-overview`, `nav-queue`, `nav-users`), the switch offers 0to8 only and pulls a link under Echo8 back to 0to8; creates the document `Roles doc e2e` under 0to8 on P13 (201), its `action-approve` is closed «нет права», P17 `action-create-label` too; the API: approve 403 `forbidden`, a document under Echo8 403 `label_forbidden`, `/owners?label=Echo8` 403 `label_forbidden`, `/owners` 400 `label_required`, `/overview` 403. `e2e-multi`: the second login step (`login-org-step`, `field-login-org`, `action-login-org`) into B, B's owner opens. `e2e-operator` on P26: creates the manager `e2e-roles-mgr` with 0to8 (`field-user-label-<id>`), it signs in; suspends it (`field-user-active`): its next request is 401; on «Поддержка» grants `e2e-sysadmin` read-only and revokes it (`support-<id>` `data-state` active → revoked) | acts (A: the document `Roles doc e2e`, the user `e2e-roles-mgr`, one revoked grant) |
| 38 | `38-split-import.spec.ts` | S44 (P28 preview, blocked file, apply, replay), S45 (the P15 assumption) | acts (A: two splits on `QZTST27441xx`, pseudonyms `Import Artist 38A/B`, owner `Import Owner 38A`, one assumption document) |
| 39 | `39-onboarding.spec.ts` | S46 (the label checklist from an empty label; the organization checklist under «Все») | acts (A: the own label `Onboard e2e`, account `2746100`, one report) |
| 40 | `40-catalog.spec.ts` | S47 (the label history on P6, the P5 column and filter), S48 (the release registry: import, P7, the registry view, P8) | acts (A: one operator interval on `QZTST2747101`; account `2748100` of 0to8 with one report; the registry row of 0to8) |
| 41 | `41-operation-kinds.spec.ts` | S49 (a buyout and an adjustment from the dialog, S24/1), S50 (the forgiveness of the S22/2 advance), S51 (the relabel with a reason and its audit) | acts (S24/1: a buyout under Echo8, an adjustment; S22/2: a forgiveness) |
| 42 | `42-payroll.spec.ts` | S52 (the payroll csv and json of 0to8, the area, `asOf` on P9 / P10) | reads |
| 43 | `43-operation-import.spec.ts` | S53 (P29: classes, apply, replay) | acts (A: `Owner S53 e2e` with two migrated payouts) |
| 44 | `44-b17-replace.spec.ts` | S54 (the replace action of the seeded statement; a refused file) | reads (a refused upload only) |
| 45 | `45-start.spec.ts` | S55 (P30: the list, the preview classes, the apply, P10 with the start, the deactivation) | acts (A: `Owner S55 e2e` with one start row, deactivated at the end) |
| 46 | `46-admission.spec.ts` | S56 (P10 «Допуск»: the payee turns the admission on, the answer, the hold, the threshold, no payee) | acts (A: `Owner S56 e2e`; the first payee row of the organization: the admission is on from here) |
| 48 | `48-cuts.spec.ts` | S57 (P34 / P35: a cut, the transfer, the owner's tab «Срезы», an operation attributed from its row, the delete refused) | acts (A: `Owner S57 e2e` with an adjustment and a transfer; one cut of 0to8 stays) |
| – | `smoke.spec.ts` | the shell (the sidebar = `navFor` of `me.abilities`: an `org_admin` sees every section and «Организация»), the user menu (`e2e-operator`, organization A), the operator field with the login off (mocked `/auth/me`), every route renders (also `/users`) | reads |
| – | `states.spec.ts` | SS1–SS7 on `/dev/states` with mocks (`/auth/me` mocked as the login off, D-170) | no seed |

The dependencies the numbers encode: 12, 13, 14, 15 before 20 (the before states of S12, S13, S16, S19, S32); 20 before
21 (S20 is asserted before in the queue and acted on in the signals page); 21 before 22 (the S30 candidate is in
`isrcsWithoutSplit` until 22 creates the split); 20 before 28 (S13 after); 23 before 24 (the S36 owner is confirmed in
24); 24 before 33 (24 reads the before state of S24/2, which 33 changes with an advertising expense); 36 touches only
organizations B and C, so it may run anywhere after the seed; 37 writes in A only a document of its own title, a user
and a grant no other spec reads (36 counts the users of A before 37 adds one). The login (D-170): `scripts/e2e/start.sh` serves with
`AUTH_MODE=on` (a random `AUTH_SECRET` and `SYSTEM_ADMIN_KEY` per run, environment only); `e2e/global-setup.ts` signs in
once as `e2e-operator` (the password from the keys file, `users`) and writes `data/test-tmp/e2e-state.json`, the
`use.storageState` of every spec, so `page` and the `request` fixture (`apiPost`) carry the session and the golden specs
are unchanged. 41 follows 24 and 26 (they read S24/1 and S22/2 before 41 acts on them); 42 reads S31/3 after 32-ads (the advertising stays),
no spec after changes it; 43 and 44 own their data. Adding a spec: pick a number between the files it must follow and precede, and say so here.

Request counts (17 R2): `openAs` restarts a per-page count of the money endpoints (overview, reconciliation, signals,
queue, balance, owners/payables, tracks/summary, tracks/:isrc/money, releases/:upc, documents/:id/uses);
`expectMoneyCalls(page, 1)` after `settled` is asserted for P1 (10), the queue (20), P21 (21), the owner card and the
owners list (24), the pseudonym card (33), the track card and the track list (12), the release card (11) and the document card (14).

## 7. Derivation notes (numbers not stated in 12)

- S03/8 (G37): label share 50 < 70 → P 50, missing 20 (`why` bucket_short). S07/1: B = -15 − 21.25 × 3 = -78.75.
- S08/2: E = 14.75 × 10 % = 1.475; A = 13.275; B unchanged 57.5.
- S10/2 2710201: A = 50 + 7. S11: B per UPC = A + P (55, 27.5); P earned 5 + 2.5.
- S12 / S32 after: B = A 50 + P 5 = 55; ours 45 unchanged.
- S13: the 05 unit runs the buy-out split (G10b); the change ends at that split; Q1 = 20 + 20 before.
- S18 after: B = 170 + 50; ours = Σ label amounts, unchanged 180.
- S19: holder-only line → one part 100; ambiguous → owner null → author and label 0, C 100; after: terms 50.
- S20 after: known pair, no split → label share = net 7 ours (D-029).
- S21 after: pool A 10, target 10 → A 0, P 10, no shortfall.
- S22: payable = earned − recouped − paid + returns + credits (10 §5); an unproved payout is not counted
  (`classifyOperation`); a deferred payout with a proof is counted but blocks (`blockingPayouts`). k2 04: A -50, P -7.5.
- S24/3: R 15 + A 42.5 = 57.5. S25: earned 150 → 50 + 25 + 25 → 50 + 25 + 0.
- S27: P 15 → 7.5. S28: 15 % of 50. S31/k2: nothing in scope → remaining 40.
- S31/k4: a deduction is a position recouped from income in scope any: 50 − 10 = 40; credit -5 adds 5; deactivation
  → 55; payout 55 → 0; return -5500 adds 55.
- S33: before X 50 B, Y's B 50 C owner_unconfirmed; after the merge B's owner is X (confirmed) → B. P1 A 200, ours 100.
- S35/4: P 10 % of the label share 50 = 5 (the D-130 test in `golden.test.ts`); C artist_without_owner until assigned.
- S37: without a rule in force the sublabel carve does not run (10 §3 layer 5); the label share 50 is ours.
- S30 after the split: 50 of 100, ours 50.

## 8. Open points (for `18_frontend_plan.md` and the stage 3 D-entries)

1. `split_unchanged`: a second identical split change is accepted and adds an empty-period split plus an identical
   one (S13, S25 dialogs, §5 table). Pin it, or refuse it with `split_unchanged` in stage 3 (product prefers the
   refusal); decide with a D-entry.
2. Deduction, credit, deactivate, return (S31/k4), the after-payout and deferred states (S22), S33, S35/4 and S37 are
   derived from the balance and layer rules; propose adding them to 12 as G48 (operations) and G49 (merge, rule close).
3. N6 allocations carry ids only (`allocationSchema`); P6 needs pseudonym and owner labels in the N6 response.
4. N13 `waiting` for a contract document (S14): define it as the `owner_unconfirmed` money of the contract's
   pseudonyms, or the dialog shows «ждёт этого документа: 0».
5. M52 in dialogs: the client may not floor dates; the dialog states the rule, the toast shows the stored date. A
   pre-confirm floored date needs a dry-run field from the API.
6. To verify in 3.x: map writer twice, create track twice, the HTTP status of `top_above_100`; `payout` field and P21
   are new endpoints of 17 (N4 / balance, N18 `/signals`).
7. G45 / G47 are seeded with the changed split, as the golden test does, not by the loader step.
8. The council asked for a label-rule variant of S32 (`rule_unconfirmed` on a sublabel rule); not added, the same
   approve dialog covers it.
