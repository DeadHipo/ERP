# Frontend goal, stage 1: the operator's jobs (2026-11-03, revision 2 after the council)

Input for the frontend goal (`notes/goal_prompt_frontend.md`): what the label's operator does, where the answer
comes from today, what the current API and pages answer, what is missing, what to take from zero-erp, and an audit
of the current pages on the real data. Written from three read-only studies (operator processes in
`context_data` and report-processor; the zero-erp frontend; the current pages and API on the dev database `erp`);
nothing was modified or run except GET calls against a side server. Revision 2 adds what the council asked for
(`reviews/frontend_stage1_{architect,product,qa}.md`): the tables "C reason → action" (§2.6) and "signal → action"
(§2.7), the ambiguous-pseudonym job, the map of the open items of `15` §3 to a place on the screen (§2.8), the
operator trace as an API gap, and corrected facts (394 UPC-only pairs, 54 reconciliation rows, 11 signal lists).
No personal data: stage names, ISRC/UPC, amounts, owner id prefixes only.

Evidence grading: **[D]** documented in a cited source; **[I]** inferred (no source states it).

## 1. The three questions and the operator

The system answers, per dollar: whose it is (split row, participation, sublabel rule, writer mapping), whether it is
confirmed (approved document; category B) or waiting (category C with one of ten reasons), and how much an owner can
be paid today (payable = earned B − recouped − paid with proof + returns + credits). The operator is the person who
turns a received report and a signed document into those answers and into a payout. Today that person works in
three places: `0to8 Main.xlsx` (the ledger of what was paid), report-processor (ad-hoc reports from the Believe
CSVs), and the ERP API (reconciliation, balances) read through SQL or curl. There is no screen where the three meet.

Roles [D: `docs/02_модель_данных.md` §"Валидация менеджерами"]: the operator enters records (owners, artists,
tracks, splits, documents); a manager validates them against the contract; a merge is decided by an operator or a
manager and journaled. Authorisation is out of the goal, so the screens keep the distinction as data only: every
action carries an "operator" field (who entered, who approved) and nothing is hidden by role.

The sources state only two rhythms [D]: monthly (a Believe file per account, payout month = accrual month + 2;
`report-processor/tasks/task_54_splits_normalize/README.md`, `13_completeness_check.md` §2.7) and quarterly (a B17
statement). Daily and weekly jobs below are [I]: they follow from the open items, not from a documented routine.

## 2. Operator jobs by cadence

"Today" = where the answer is produced now: **Main** (`0to8 Main.xlsx`), **RP** (a report-processor task), **ERP**
(the API or SQL on the dev database), **none**.

### 2.1 Every day or week [I]

| Job | Question | Inputs | Today | Action that follows |
|---|---|---|---|---|
| Inbox of what waits | What is in C, grouped by reason, sorted by money, and what unblocks it | reconciliation `C_breakdown`, balance `waitingBreakdown`, signals | none (the signals exist as API lists; `15_mvp_report.md` §3 is a hand-written list) | the action of the reason (§2.6) or of the signal (§2.7) |
| A document arrived (PandaDoc, mail) | Which split rows, rules or owners wait for it? | documents module, C items by owner / ISRC | none (the stage 4 loader read the PandaDoc index once, D-133) | create the document, attach the file, approve it, **link it**: confirm the split rows (`POST /splits/:id/confirm`), create the contract (`POST /contracts`), set the rule or terms |
| Validate what was entered [D `02`] | Which records were entered and not yet checked against the contract? | documents `not_approved`, splits without a document, owners `waiting_documents` | none | approve (manager) or correct |
| Resolve an ambiguous pseudonym [D `15` §3 item 3, `13` C14] | Two artists carry one pseudonym (DJ VETA3, DSHZS, MC FLYXO, !Nxght): which one is meant on which ISRC? | the artists, their owners, the ISRCs without a split (415 Echo8 ISRC), 25 Main rows (28,402.51) not loaded | none (the loader skipped them) | pick the artist per ISRC, create the split (`POST /splits`), assign the owner (`POST /artists/:id/owner`), or merge duplicates (`POST /owners/merge`); the owner decides which |
| A payment request from an artist or manager | How much is payable now, what waits and why, will an advance recoup? | owner balance | Main (`Pivot` balance per nickname) | pay (button), or record an advance with scope, or refuse with the reason |
| "Why is my amount X?" | Explain one owner's or one track's number | explain, balance per artist and ISRC | RP per-artist summary; Main `Pivot` | send the explanation |

### 2.2 When a Believe report arrives (monthly) [D]

| Job | Question | Today | ERP object / signal | Action |
|---|---|---|---|---|
| Load the CSV per account (1052428 = 0to8, 1055956 = Echo8) | Loaded? Duplicate month? | ERP upload (D-111); RP reads the same CSV | `source_files` status; `duplicate_period` | confirm `loaded`; a file that is not loaded never counts |
| Completeness | A = B + C + ours per account and month, discrepancy 0? | ERP `GET /reconciliation` | reconciliation rows | a non-zero discrepancy is a bug: stop; else look at C |
| New imprint strings | A `Label Name` not in the aliases? | RP `Label Reports/RULES.md`; ERP signal | `labelUnmapped`, C `label_unmapped` (0 today: all 25 strings mapped) | alias to an own label, or a sublabel with a rule (owner decides) |
| Pairs outside the catalogue | ISRC/UPC pairs not in `tracks`; lines without ISRC | ERP signal | `unallocated`: **394 pairs today, all with an empty ISRC and a known UPC**, 2,364.33, C `no_isrc`; C `unknown_pair` 0 (D-135 registered every pair of a known ISRC) | a pair **with** an ISRC: register the track (`POST /tracks`); a line **without** ISRC: no action, D-035 ⚠ (shown with the decision id) |
| No-split ISRCs | Which ISRCs earn with no split (ours by D-029)? | ERP signal; `15` §3 item 11 | `isrcsWithoutSplit` (2,500 ISRC, 622 k net; 81 above 1,000) | owner decides: split or a "fully ours" document |
| Sanity of the month | Top platforms, countries, tracks; month over month; negative lines | RP global month report (`task_113`, `task_128`, …) | source lines page (facets, totals) | investigate anomalies |
| Reports for artists, MCs, sublabels | See §3 | RP | balance per artist; participations; sublabel rules | send |
| Ads of the month | Which artist bears which promo cost? | RP `adv_expenses` tasks; Main `PROMO`, `Advertising Summary` | **not modelled** (M21, MVP item 33 later; `13` C27) | post to Main |

### 2.3 When a B17 statement arrives (quarterly) [D]

| Job | Question | Today | ERP | Action |
|---|---|---|---|---|
| Load the xlsx | New quarter? A second "Updated" statement for a loaded quarter? | ERP `load-b17.ts` / `POST /publishing/b17` | `duplicate_period`; D-041 ⚠ refuses a second statement (Q2 2026 Updated, +184,828.17) | owner decides replace or refuse |
| Writers and holders | Who is the payee (`rights-holder name`)? Which of our writers are in `songwriters`? | ERP resolution | writers list, `ambiguousWriters`; C `writer_unmapped` (0 today), `owner_unconfirmed` (19 of 32 holders unmatched, `15` §3 item 1) | map a writer to an owner, resolve, merge a holder owner (D-083 ⚠) or confirm it by a contract |
| Terms by operation type | Which percent for Mechanical / Performance / Sync? | ERP terms | C `publishing_terms_unconfirmed` (325 k) | add a term with its document |
| Author reports | What did each author earn? | RP `task_11_B17`, `task_38`, `task_185` | balance `publishing[]` | send |

### 2.4 When a contract, appendix, buy-out, settlement or sublabel deal is signed [D: `09_settlement_cases.md`]

| Mechanic | What the operator enters | Today | ERP object |
|---|---|---|---|
| Artist agreement, percent per ISRC (M1, M2) | split rows from a month, with the document | Annex 14 + Believe Backstage; RP splits CSV | split (+ per-row document) |
| MC or sample from the pool at a fixed label share (M3, M11) | participation `(net, artist_pool)` | RP MC Reports Hub | participation |
| Remixer off the top (M4) | participation `(net, top)` | RP tasks | participation |
| Sublabel half (M5), representative (M6, M7), imprint alias (M8) | rule per label string with recipient pseudonym and date; alias | RP Sublabels Reports, `RULES.md` | label rule; alias |
| Buy-out full or partial (M9), assignment (M10), sale (M28) | split change from a month with the buy-out document | Annex Sch3C; RP `task_184` audit | `splits/change`, `splits/buyout` |
| A&R, collaborator, share of the artist's share (M12, M13), settlement 15 % (M35) | participation with base and funding | Annex Sch3A | participation |
| Advance with scope (M19) | operation `out` with scope, basis document, payment proof | Main Expense/Advance; Annex Sch3B | operation (recoupable payout) |
| One-off fee, bonus, buy-out price (M20) | document only, or a non-recoupable payout | Main (30 rows, 282 k document only) | document; migration payout |
| Deduction of a participant's share paid elsewhere ("вычет доли", M43) | operation `in` with adjustment basis | Main carve rows | deduction, or a pool participation (D-137) |
| Overpayment (M27) | negative payable | RP `task_192` (per artist and release, counts paid cash only) | balance `payable` < 0, shown 0; no per-release debt view |
| Publishing terms (M15, M16), writer shares (M17) | term per owner, date, operation type | contracts | publishing terms |
| Term end (M25), derivative note (M29) | `valid_to`; a note on the track | Main `Contracts`, `Нет контрактов` | close rule / participation; `tracksWithNote` |

### 2.5 At payout time (monthly) [D: `13` §2.6, D-132]

| Job | Question | Today | ERP |
|---|---|---|---|
| Who is payable and how much | payable per owner | Main `Pivot` (Income − ads − expenses = Balance), `FINANCE`, `Для выплат (EXP)` | `GET /owners/:id/balance` per owner (7 s each; no list with money) |
| Who is not ready | no contract, not registered in the payment tool, held | Main `Tipalti`, `Contracts`, `PRO IMRO` | `confirmed`, `blockingPayouts`, `pendingOperations`; payment-tool readiness is outside the MVP (M23, M31; `13` C28) |
| Pay | one Expense row per nickname; Tipalti / EasyStaff / PayPal | Main | `POST /owners/:id/payouts`: pays the whole payable, stores a snapshot (D-051, D-053); the payment service is a stub |
| Prove | comment and screenshot | Main | `payment_proof` document on the operation (D-052) |
| Label summary of the month | revenue, ads, profit | Main `NEW СВОДКА` | reconciliation `ourShare`, `ourShareByLabel` (no ads) |
| Sublabel settlement | pay the sublabel its half | Main `выплаты саблейблам`; RP Sublabels Reports | sublabel pseudonym balance (all sublabel money is C today, `15` §3 item 6) |

Main's shape, for the operations screen [D]: `INCOME / EXPENSE` (~19 k rows: Comment, Date, Nickname, Type
Income/Expense, Category, Amount, flags for posted ads and "no recoup"); Expense categories: plain royalties payout
(2,355 rows), Advance (145), publishing advance (17), "вычет доли" (104), "ноу рекап" (17: a payout that does not
recoup), buy-out prices (24, document only), routed payouts "send to …" (10, recipient only in the comment), held
payouts (3). ERP equivalents: payout (button only), recoupable payout with scope, deduction, credit, return;
`migration: true` for the loaded history (2,371 + 26 payouts, 158 advances, 104 deductions, reconciled to
8,045,246.75 minus the named exclusions).

### 2.6 Every C reason: today's money, the acting entity, the action (the C queue)

Amounts from `GET /reconciliation` on the dev database on 2026-11-03 (master both accounts + B17). The entity is what
the queue groups by; the operation is the API call the action ends in; ⚠ marks an action that is the owner's
decision (the screen shows the item and the decision id, and offers no action). Real-data fact that shapes the design:
**all 1,352 non-assumption documents are already approved**, so "approve" is not the operator's main action today;
the main action is **"create the document and link it"** to the split rows or to the owner's contract.

| Reason | Today | Acting entity (queue key) | Action on the screen | Operation | Irreversible |
|---|---:|---|---|---|---|
| `owner_unconfirmed` | 1,114,884.25 (master 594,298 + B17 520,584) | owner | create the contract for the owner and its artists with an approved document (`confirmedOwnerIds` = owners with an approved contract); for B17 holders: merge the holder owner into the stage-name owner (D-083 ⚠) or give it a contract; NoGhost: link its contract to the owner (C22, `15` §3 item 6) | `POST /documents` + `POST /documents/:id/approve` + `POST /contracts`; `POST /owners/merge` | approve, merge |
| `split_unconfirmed` | 454,219.20 (320,636 Echo8 repertoire) | owner → artist → ISRC (the rows have **no document**: 538 of 1,000 sampled splits have `documentId: null`) | create the document (RSA, appendix) and confirm the split with it; or confirm with an existing approved document | `POST /documents` (+ approve) + `POST /splits/:id/confirm` | approve |
| `publishing_terms_unconfirmed` | 325,405.99 | owner (the result carries no operation type) | set the terms of the owner from a date with their document (the default 50 % is C) | `POST /publishing/terms` | no (a new term closes the previous one) |
| `assumption` | 144,195.41 (45 documents, 44 by document + 1 R1) | assumption document (or Q11 / R1 basis) | **replace** the assumption by a real document: confirm the rows or rule with the new approved document (an `assumption` document is never approved, D-125); R1 and Q11: the owner's decision ⚠ | `POST /documents` + approve + `POST /splits/:id/confirm` / new rule or participation | approve |
| `artist_without_owner` | 5,296.64 | artist (pseudonym) | assign an existing owner or create one | `POST /artists/:id/owner`; `POST /owners` | no |
| `no_isrc` | 2,364.33 (394 UPC-only pairs) | pair (UPC, report title) | none: D-035 ⚠ (fold into the UPC's tracks waits for the owner); shown read-only with the decision id | — | — |
| `label_unmapped` | 0 (all 25 strings mapped) | Believe label string | add the string as an alias of an own label, or create the sublabel and its rule | `POST /labels/:id/aliases`; `POST /labels` + `POST /labels/:id/rules` | no |
| `rule_unconfirmed` | 0 | participation or label rule | attach an approved document to the rule (close and re-create with the document; or approve the document it has) | `POST /documents/:id/approve`; close + create | approve, close |
| `unknown_pair` | 0 (D-135 registered every pair) | pair (ISRC, UPC) | register the track with this ISRC and UPC | `POST /tracks`, `PATCH /tracks/:id` | no |
| `writer_unmapped` | 0 | B17 writer | link the writer to an owner (or create one), then resolve | `POST /publishing/writers/:norm/map`; `POST /publishing/writers/resolve` | no |

Six of the ten reasons carry money on the real data; the other four (`label_unmapped`, `rule_unconfirmed`,
`unknown_pair`, `writer_unmapped`) can only be tested on synthetic golden data (G08c, G19 variants, G30, G26).

### 2.7 Every signal: today's count and the action

| Signal (`signalsSchema`) | Today | Action on the screen | Operation |
|---|---:|---|---|
| `unallocated` (pairs, `withoutIsrc`) | 394 pairs, 2,364.33, all without ISRC | with ISRC: register the track; without: read-only, D-035 ⚠ | `POST /tracks` |
| `isrcsWithoutSplit` | 2,500 ISRC (81 above 1,000) | create the split from the contract, or a "fully ours" document ⚠ (owner decides per ISRC, `15` §3 item 11) | `POST /splits` |
| `ambiguousWriters` | 0 | map the writer | `POST /publishing/writers/:norm/map` |
| `unfunded` (bucket_short / no_source_row / top_above_100) | 507 shortfalls | check the participation's base and percent: close it and re-create it correctly; information when the contract really says so (10 §3 shortfall rule) | `POST /participations/:id/close` + `POST /participations` |
| `labelUnmapped` | 0 | alias or sublabel rule | `POST /labels/:id/aliases`, `POST /labels/:id/rules` |
| `sublabelWithoutRule` | 10 (`lost`) | set the rule of the sublabel (or alias the string to an own label) | `POST /labels/:id/rules` |
| `ruleRecipientIsRow` | 0 | decide row or participation (D-126): change the split or close the rule | `POST /splits/change`, `POST /labels/rules/:id/close` |
| `twoRowsOneOwner` | 785 ISRC-months | information only (one owner may hold two pseudonyms); link to the split | — |
| `tracksWithNote` | 11 | information (M29); edit or clear the note | `PATCH /tracks/:id` |
| `participantsWithoutOwner` | 3 | assign an owner to the pseudonym | `POST /artists/:id/owner` |
| `assumptions` | 45 | replace by a document (§2.6 `assumption`) | see §2.6 |

### 2.8 The open items of `15` §3: where the operator sees each

| Item | Where on the screen |
|---|---|
| 1 B17 holders vs stage-name owners | C queue `owner_unconfirmed`, holder owners; merge ⚠ D-083 |
| 2 documents the owner owes | C queue `split_unconfirmed` / `assumption` grouped by owner; the owner-question list |
| 3 ambiguous pseudonyms | the pseudonym job (§2.1): artists with a duplicate pseudonym and the ISRCs without a split; not C |
| 4 imprint list (Q12 strings) | C queue `assumption` (rule documents of kind assumption); labels page |
| 5 Main carve pairs | C queue `assumption` (participation documents); the owner-question list for the 24 groups without a percent |
| 6 sublabel money in C | C queue `owner_unconfirmed` (sublabel owners) and `assumption` (NoGhost before 2026-06) |
| 7 buy-outs (M51, DJ TUUV, DJ VRK) | the owner-question list (B or ours today, not C) |
| 8 Updated Q2 2026 statement, D-087, D-045, D-096 | the owner-question list (⚠ decisions) |
| 9 77 Records exception (M58) | the owner-question list (not expressible) |
| 10 161 unexplained owner balances; money owed | owners list with payable and the negative payable warning; the owner-question list |
| 11 no-split money (C11) | signal `isrcsWithoutSplit` with the ISRC's net; owner decides |
| 12 administration terms from 2026-01 | C queue `publishing_terms_unconfirmed` by owner and period |
| 13 licensor terms (MC ROBA CENA row) | C queue `assumption` (that row's document) |
| 14 the 165.80 after the buy-out | the owner-question list |

Items 3, 7, 8, 9, 10 (part), 14 are not C: the screens need a read-only **owner-question list** (the open items with
their decision ids and amounts) beside the C queue, so every item of `15` §3 has a place.

## 3. Report shapes the operator produces today (report-processor) and what the ERP can give

| Shape | Structure [D] | ERP today |
|---|---|---|
| Per-artist summary (`task_119`: three variants, artist share / label share / both; `task_139`, …) | rows = track / ISRC / UPC / artist percent, columns = months, grand total; a second sheet of ad expenses | income side: balance `artists[].tracks[]` (net, amount, waiting) but not by month; ads: no |
| Per-UPC percent for an MC or participant (`task_103`: 13 UPC, 15 %, months) | one summary row + rows by ISRC and month; a control report of the full net of the same UPCs | as a participation of a percent of net per ISRC; no UPC screen, no month columns in the API |
| Sublabel report (12 sublabels) | profit split label / sublabel / artists per model; ad expenses; splits check | the half rule (owner decision 2) and the sublabel pseudonym's balance; `ruleRecipientIsRow`, `twoRowsOneOwner` are the "splits check"; ads: no |
| Global month report (`task_113`) | totals, top 10 platforms / countries / tracks, month over month, ads recoup | reconciliation per month; source lines with facets (platform, country) and totals; ads: no |
| Ads / expenses (`task_101`, …) | promo expenses allocated to artists via splits | no (M21 later) |
| "Who owes us" (`task_192`) | per artist and release: months and amount overpaid, paid cash only | payable < 0 per owner only |
| B17 per author | lines by writer and operation type | balance `publishing[]` |
| SoundOn, ASCAP, taxes | other sources | no (map items 26, 28; out of scope) |

Not producible without a new source or rule: ads, SoundOn, ASCAP, payment fees, taxes.

## 4. What the API and the pages answer today (audit on the real data, GET only)

### 4.1 Volumes the screens must handle

| Entity | Count |
|---|---|
| Owners | 1,151 (1,134 person, 17 label; 421 confirmed, 730 waiting documents) |
| Artists (pseudonyms) | 2,134 (990 without an owner, 726 unconfirmed, 418 confirmed) |
| Tracks | 26,305 (11,089 distinct UPC; up to 60 tracks per UPC) |
| Splits | 24,107; participations 283 |
| Labels | 17 (2 own, 15 sublabels; 25 alias strings, 16 rules) |
| Documents | 1,397 (contract 813, advance_basis 158, payment_proof 158, adjustment_basis 104, appendix 63, assumption 45, other 37, buyout 19); 1,352 approved, 45 `not_approved` (all assumptions); no `uploadDeadline` set |
| Operations | 2,662 (payout 2,400, recoupable payout 158, deduction 104 of which 55 inactive) |
| Believe files | 47 (75.7 M lines, 721,975 units); B17 statements 6 (7 quarters) |
| Writers | 47 |
| Reconciliation rows | 54 (Believe 2023-11 … 2026-08: 34 + 13; B17 7), discrepancy 0 on every row; 52 for 2024-01 … 2026-08 |
| Signals (11 lists) | isrcsWithoutSplit 2,500; twoRowsOneOwner 785; unfunded 507; unallocated 394 pairs (all without ISRC); assumptions 45; tracksWithNote 11; sublabelWithoutRule 10; participantsWithoutOwner 3; ruleRecipientIsRow 0; labelUnmapped 0; ambiguousWriters 0 |

### 4.2 Timings and sizes

| Call | Time | Size | Note |
|---|---|---|---|
| `GET /reconciliation` | 7.3–8.2 s | 27 KB | one `calculate()` over 721,975 units (ClickHouse 1.1 s, reference data 1.4 s of which publishing 1.1 s, layer fold in JS 3.9–4.3 s) |
| `GET /owners/:id/balance` | 6.1–7.7 s | 4–48 KB | the same `calculate()`; a period filter does not make it cheaper |
| `GET /tracks/:isrc/explain` | 6.2–6.9 s | 0.25 MB (one split, few months) to **15.6 MB** (493 units) | 70–95 % of a big one is `breakdown` (platform × country × month rows); `units` with the per-layer trace is at most 1.1 MB |
| `GET /signals` | 7.9–8.4 s | 221 KB | `limit` applies to 2 of 11 lists |
| three parallel money calls | 21 s | | no parallel gain: the layer fold is a synchronous 4 s loop that blocks the Node event loop for every other request |
| `/owners`, `/artists`, `/documents`, `/labels`, `/splits`, `/participations`, `/settlements/operations` | 0.02–0.3 s | 9 KB – 1.3 MB | no amounts on any list |
| `GET /tracks` | 0.15 s | 3.4 MB | all 26,305 rows; `?isrc` ignored |
| `GET /sources/lines` one file | 4.0 s | | all 47 files sorted by net: 51 s; with `isrc` or `upc`: 0.2 s |

Every number that depends on money costs one full recalculation of about 7 s (D-012: no server-side cache; the goal
prompt calls 7–10 s per recalculation the norm). The current default page `/sources` fires reconciliation and
signals together: first paint about 16–20 s. No list endpoint carries money: "who do we pay this month" would be
1,151 balance calls.

### 4.3 The current pages (11 routes, 2,341 lines, plain CSS, no UI kit, no tests)

| Page | Question it answers | Missing for an operator |
|---|---|---|
| Owners | find an owner by name | no money or payable column; filter on name only (no alias or pseudonym); first 300 of 1,151; no merge |
| Owner | artists with tracks, documents, contracts, terms | no money; no assign-owner; a new artist is created with `force: true` (skips the duplicate check); no split or participation view per artist |
| Owner balance | earned, waiting, payable; the payout button | 7 s on every filter change; no confirmation before the payout; a waiting reason is a label and an amount, not a link to what blocks it; tracks are the first 50 in API order; no link to explain |
| Documents | which documents need a file or approval | first 300 of 1,397; the Approve button shows for the 45 `assumption` documents (the backend refuses, D-125); no "what money does this unblock"; owner select of 1,151 names |
| Splits | splits of an ISRC; create, change | the server's first 100 of 24,107 in arbitrary order (`offset` ignored by the API); pseudonym selects cut at 2,000 of 2,134 (134 pseudonyms cannot be chosen); percent arithmetic with `Number` in the form; no buy-out, no confirm |
| Participations | carves of an ISRC; create, close | filter by ISRC only; the same cut selects |
| Labels | own labels, aliases, rules | four stacked forms before the table; no money per label; no shortcut from an unmapped string |
| Sources | files loaded, A = B + C + ours, all signal lists | 2 × 7 s on first paint; no month or account filter; C breakdown as muted text; signals are a dump of 8 tables (507 and 785 rows in full) without actions |
| Source lines | raw lines of chosen files | well built (server paging, totals, facets); no link from ISRC to its track |
| Settlements | operations and missing proofs | first 300 of 2,662; owner select of 1,151; `deferred`, `deactivate`, `return`, snapshot not exposed; blocking computed client-side by a rule that differs from the facade's (`context.ts` `blockingPayoutsOf`) |
| Shell | redirect to `/sources` | no landing "what needs attention", no global search, no breadcrumbs, no confirmation dialogs anywhere |

Money arithmetic in the current pages (the rule says the frontend does none): `Number(payable)` comparisons
(`OwnerBalancePage.tsx`), `amountCents / 100` (`SettlementsPage.tsx`, `OwnerBalancePage.tsx`), `Number(v).toFixed(2)`
(`SourcesPage.tsx`), `Number(...)` inside the `Money` component, a percent sum in the splits form. The client also
hand-writes seven response types (`Artist`, `SplitView`, `SourceFile`, `BelieveFileRef`, `SourceLine`,
`SourceLinesPage`, `SourceFacets` in `api/client.ts`) that `@erp/shared/api-responses` already defines (against
D-119 and `packages/frontend/CLAUDE.md`).

### 4.4 Coverage of `operations.ts` (51 operations)

Exposed by a page today: 35. **No page (16):** `POST /owners/merge`; `GET /artists/:id`; `POST /artists/:id/owner`
(every "artist without owner" fix is API-only); `GET /tracks`; `PATCH /tracks/:id` (the client has the call, no page
uses it); `GET /tracks/:isrc/explain`; `POST /splits/buyout`; `POST /splits/:id/confirm`; `GET /publishing/writers`;
`POST /publishing/writers/:norm/map`; `POST /publishing/writers/resolve`; `POST /settlements/operations/:id/deferred`,
`/deactivate`, `/return`; `GET /settlements/operations/:id/snapshot`; `GET /health` (not needed on a page).

### 4.5 Endpoint gaps for the planned screens (what exists in the facade, what is new)

Reusable: `calculate()` (`facade/calculation.ts`) returns units with allocations (artist, owner, layer, kind, rule id,
document id, percent, amount, category, reason, assumption) and the per-unit label share; `reconcile()`,
`ownerBalance()` (`balance.ts`), `balanceWithFiles()` (`context.ts`), `signals()` and `explainTrack()`
(`reports.ts`). Each starts with one `calculate()`. Every new endpoint needs an `operations.ts` entry, a response
schema in `@erp/shared` (the payout snapshot is free-form today and needs one too), a call in the contract test
scenario and a D-entry (D-119).

| Gap | Today | New work (thin unless said) |
|---|---|---|
| (a) light explain of a track by month | 0.25–15.6 MB, `breakdown` dominates | a summary variant: units grouped by report month (net, B, C by reason, ours, allocations with layer and rule), no `breakdown`; a month drill with the units and layer states of that month; `breakdown` only on request and filtered by month; a response schema |
| (b) C queue grouped by reason with the acting entity | counts only (`C_breakdown`, `waitingBreakdown`) | an aggregation over the allocations keyed by (reason, entity): owner for `owner_unconfirmed`; `documentId ?? ruleId` (the split) for `split_unconfirmed` / `rule_unconfirmed` / `assumption`, with owner, artist and ISRC for grouping; artist for `artist_without_owner`; label string for `label_unmapped`; pair for `unknown_pair` / `no_isrc`; writer for `writer_unmapped`; owner for `publishing_terms_unconfirmed` (the publishing result has no operation type); sum, ISRC count, months; paging per group |
| (c) global search (ISRC, UPC, pseudonym, owner, document title) | client-side `includes()` on owners | one `GET /search?q=` over owners (name, aliases), artists, tracks (ISRC, UPC, title), documents (title), labels (name, alias) in PostgreSQL; typed results `{kind, id, label}` |
| (d) release by UPC | tracks carry `upc`; ClickHouse has release titles per pair | tracks of the UPC with the UPC's money from the units (net, B, C, ours) |
| (e) history of an entity and the operator trace | no audit table; `created_at`, `origin`, `approved_at` / `approved_by` (`approveBody.by`, hard-coded `'manager'` by the client), `deactivated_at` exist; no other action records who did it | **not thin**: an append-only `audit_log` table written by the facade (entity, action, operator, timestamp, summary), the operator taken from one request header set by the client; a timeline endpoint per entity merging it with the existing columns; migration + D-entry |
| (f) tracks with money (26 k) | `GET /tracks` all rows, no money | paged track list (search by ISRC, UPC, title) joined with one aggregation of the units by ISRC (net, B, C, ours, months); a net-only variant is a ClickHouse `GROUP BY isrc` in 0.1–0.3 s without `calculate()` |
| (g) owners with payable | balance per owner only | **not thin**: `ownerBalance()` scans every allocation per owner, so 1,151 owners need one grouping pass of the allocations by owner, bulk reads of operations and proofs, and the recoup per owner only where operations exist; returns earned, waiting (by reason), recouped, paid, payable, payableShown, confirmed, blocking; one `calculate()` |
| (h) documents by status, kind, title | `ownerId` only | `status`, `kind`, `q`, paging in the repository; "which unapproved documents hold how much" comes from (b) |
| (i) operations by owner, meaning, date, proof | `ownerId` only | `meaning`, `direction`, `from`, `to`, `active`, `needsProof`, paging and total in the repository |
| (j) overview in one call | reconciliation + signals = two `calculate()` (16 s) | one overview endpoint: reconciliation rows, C by reason with counts, signal counts, from one `calculate()` |
| (k) the event loop | the 4 s layer fold is synchronous: every other request waits | measure in stage 2; either accept it in a D-entry (one operator, 7–10 s is the norm) or yield every N units / move the fold to a worker thread (no money rule changes) |

Parameters the API ignores today (fix when building the screens): `/participations?limit`, `/splits?offset`,
`/tracks?isrc`, `/signals?limit` on 9 of 11 lists, `/settlements/operations` filters by `ownerId` only,
`/sources/lines` without `fileId` silently picks the newest month; `/sources/files` exposes `storedPath` (never show
or log it).

Real-data facts the screens must show rather than hide: owners with a long payout history can have a **negative
payable** (−141,428.96 and −1,584.10 on two sampled owners: migrated payments exceed earned; `payableShown` is 0;
the owner with the most payouts is at +884.08, so it is not the typical case); 45 `assumption` documents are
`not_approved` and can never be approved (D-125): the action is "replace by a document"; every sublabel's money is
in C (`15` §3 item 6).

## 5. The zero-erp frontend: what to take and what not

zero-erp (`../zero-erp/apps/frontend`, a sibling of this repository) is read for ideas only. It resolves `@heroui/react`
and `@heroui/styles` 3.0.0-rc.1 (declared as the floating tag `rc`), tailwindcss 4.2.1 with `@tailwindcss/vite`,
ag-grid-community and ag-grid-react 35.3.1 (enterprise too), `@tanstack/react-query` 5.90, `@playwright/test` 1.58,
`@heroicons/react` 2.2, react 19.2. On npm today HeroUI 3 is stable (`@heroui/react` and `@heroui/styles` 3.2.7;
peers react ≥ 19, tailwindcss ≥ 4, react-aria-components 1.22), AG Grid is 36.2.0, Tailwind 4.3.4, TanStack Query
5.105, Playwright 1.64; a sandbox build of a HeroUI button, a Tabs and an AG Grid table with this repository's Vite 8
and `@vitejs/plugin-react` 6 succeeds. Stage 2 pins exact versions (the two HeroUI packages together).

| Item | Verdict | Why |
|---|---|---|
| Shell: sidebar + header + content column, CSS-variable offsets, collapse state in session storage | take as idea | solid and small; drop the four themes, the label selector, auth, pinned header |
| Sidebar from one config (id, label, icon, children, badge) | take as idea | the same config feeds breadcrumbs and page titles |
| Breadcrumbs derived from the nav config | take as idea; add the entity name on detail pages | zero-erp shows a generic "Detail" |
| Global search | absent in zero-erp | design our own: one modal (Cmd+K) over one search endpoint, results grouped by entity |
| Tabs (`Tabs.List / Tab / Indicator / Panel`) | take; add `?tab=` URL sync | zero-erp keeps the tab in state and loses it on reload |
| Confirmation dialog (`danger-confirm-alert-dialog.tsx`, 60 lines, with the `HiddenRacDialogAnchor` fix) | take nearly verbatim | small and correct; a controlled dialog without a trigger needs the anchor to avoid a react-aria warning |
| Toasts (`<Toast.Provider />` once; `toast.success / danger`) | take | |
| Forms (one wrapper over `TextField / Label / Input / FieldError`; no form library) | take as idea; validate with the shared zod schemas | |
| Status chips (45 one-off files) | one generic `StatusChip` with an enum → label/colour table | |
| AG Grid: one `themeQuartz.withParams` theme from HeroUI CSS variables, a defaults module, a Russian `localeText` (the AG locale package has no ru), a viewport wrapper, a cell-align class | take | light and dark need no second theme |
| AG Grid: enterprise server-side row model, toolbar, server-saved layouts, filter pipeline | do not take | community only: client-side rows with pagination for lists up to tens of thousands; the infinite row model for server paging |
| Money formatting | do not take | number-based and scattered; ours formats decimal strings without `Number` |
| Dates | take the fixed `DD.MM.YYYY` idea | |
| TanStack Query: key factories, `queryOptions`, `invalidateQueries` after a mutation | take | zero-erp's hand-rolled fetch cache and the Refine data provider: no; we add our own `QueryClientProvider` |
| Queue pages (grid, KPI strip of counts that filters the grid, per-row actions, side detail) | take as idea | fits the C queue |
| E2E: `webServer` script, constants file, role and text selectors; `waitForTimeout` and `networkidle` | take the setup idea; no sleeps, `data-testid` on rows and actions | |
| i18next | do not take | one typed Russian dictionary (`ru.ts` as const) and two helpers (plural, template) |
| Refine, three.js, charts, dnd-kit, xlsx, framer-motion, label context, auth | not applicable | excluded by the goal or by having one label and no roles |

Pitfalls noted: HeroUI v3 uses react-aria props (`onPress`, `isDisabled`, `isPending`, `isOpen / onOpenChange`) and
compound parts; never split react into its own Rollup chunk (React 19 fails at load); AG Grid is modular
(`ModuleRegistry.registerModules([AllCommunityModule])` once); zero-erp patches `@tailwindcss/node` 4.2.1 for an
esm-cache-loader issue with Vite dynamic imports (the sandbox build with 4.3.4 and Vite 8 did not need it).

## 6. What the current pages lack as a workplace (summary of the audit)

- No landing page of what needs attention; no global search; no breadcrumbs; no drill-down from a money figure to its
  cause (track → layer → rule → document); no confirmation before an irreversible action; no toasts; no empty, long or
  error states beyond a line of text; no operator trace on any action except `approve` (hard-coded `'manager'`).
- Lists are cut (300 / 100 / 50) with no paging, sorting or filters beyond one field; selects of 1,151 owners or
  2,000 of 2,134 pseudonyms.
- Every money screen recalculates on every filter change and shows a spinner for 7 s; the default page costs 16–20 s.
- 16 operations have no page; the operationally important ones are assign owner, confirm split, buy-out, writer
  mapping, explain, operation rollback / return / deferred, snapshot.
- Money arithmetic and hand-written response types in the client (§4.3).
- Legal names: `GET /owners` carries every owner's aliases (legal names) to the client; the operator's screen may
  show owner names (that is the product), but tests, fixtures, screenshots in the repo and logs must not;
  `storedPath` of `/sources/files` is a server path and must not be shown.

## 7. Consequences for the design (stage 2)

1. **One money call per screen, no server-side cache.** A screen that shows money asks one aggregate endpoint once
   and shows a "calculating" state that does not block navigation; filters, tabs and sorting work on the loaded
   result in the TanStack Query client cache (invalidated after every action). The client never sums, subtracts or
   compares amounts: every total, remainder and gate is a field of the API; a frontend rule test greps for `Number(`
   and arithmetic on money. New endpoints: overview (j), C queue (b), owners with payable (g), tracks with money (f),
   light explain (a), release by UPC (d), search (c), audit log and timeline (e), filters on documents (h) and
   operations (i); the event loop question (k) is measured and decided. D-012 stands; the goal prompt accepts 7–10 s
   per recalculation.
2. **Every C reason and every signal has exactly one action** (§2.6, §2.7); the main action on today's data is
   "create the document and link it" (confirm split rows, create the contract), not "approve"; `assumption` is
   replaced, never approved; ⚠ items are shown read-only with their decision id; the open items that are not C live
   in an owner-question list (§2.8).
3. **Irreversible actions behind a confirmation dialog** that states what changes: approve a document, merge owners,
   pay (snapshot), close a rule or participation, deactivate or return an operation, a buy-out, a split change from
   a date. Every action sends the operator field.
4. **The payout screen shows why** the payable is what it is (earned B, waiting C by reason, advances recouped,
   paid, returns, credits, per label of record) and the negative payable as a warning, because Main and the ERP
   still disagree on 161 owners.
5. **Reference books get real lists**: server paging, sorting, filters, search; pseudonym and owner pickers are
   typed searches over the search endpoint, not selects of 2,000 options; every page defines its empty, long
   (calculating) and error state.
6. **The current pages are replaced, not patched**: a new shell (HeroUI 3 + Tailwind 4), AG Grid tables, TanStack
   Query, one typed API client whose every type comes from `@erp/shared` (`schema.parse` on responses), Playwright
   e2e on a private test database. The golden cases cannot seed one shared database as written (every case starts
   from an empty facade and reuses the same ISRCs), so the e2e harness seeds **one private PostgreSQL + ClickHouse
   pair per run through a shared seed module** (the `createIsolatedSources()` approach of the tests with fixed
   database names, `main.ts` started with `DB_DATABASE` / `CLICKHOUSE_DATABASE`), one golden case per scenario.
7. A D-entry supersedes D-007 / D-062 (minimal frontend without a UI kit); `packages/frontend/CLAUDE.md` is rewritten.

## 8. Open questions and what the design assumes

| # | Question | Source found | Assumption for the design |
|---|---|---|---|
| 1 | Who the operators are and who approves | `docs/02_модель_данных.md`: the operator enters, a manager validates; no login is in scope | one role on the screen; every action records an "operator" field; "entered by" and "approved by" shown apart |
| 2 | The payout sequence: does the owner approve a payout list first; which tool pays whom | open (Main `Tipalti`, `FINANCE` show the flags, no rule written) | the button pays one owner; an owners-with-payable list shows the candidates; the payment service stays a stub |
| 3 | Threshold 100 USD, carry-over, holds, minors, W-8BEN | answered: outside the MVP (`notes/settlement_landscape.md` MVP list; `13` C28) | the screen shows `payableShown` and the backend's blocking reasons only |
| 4 | Ads (M21) | answered: MVP item 33, later | not shown |
| 5 | Artist statements by mail (Main `Mailing`) | open | not in the goal; the balance per artist and ISRC is the data |
| 6 | Daily and weekly cadence | open (inferred) | the inbox (C queue, signals, owner-question list) is designed for it |
| 7 | Whether the sublabels still receive Google Sheets reports | open | outside the goal |
| 8 | Which decisions wait for the owner | `03_decision_index.md`: D-018, D-032, D-035, D-041, D-043, D-045, D-049, D-068, D-083, D-087, D-096 (D-067 is closed by D-123 / D-127) | the screen shows the item with the ⚠ id and offers no action that would decide for the owner |
| 9 | One balance per owner across both labels | `15` §4 (assumption of the MVP) | kept; B and C per label of record shown |
| 10 | Platform and country analytics | report-processor keeps them | source lines page (facets) only |
