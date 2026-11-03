# Frontend stage 4: walk on the real data (2026-11-03)

Walker: read-only agent, Playwright (chromium, 1440x900) against the built client on :3050, dev database `erp` (1,151 owners,
25,854 tracks on `/tracks`, 47 Believe files + 6 B17 files, 721,975 units). GET only; the operator field stayed empty (every
write control showed "укажите оператора" and was disabled), no dialog was opened or submitted. Owners are cited by id prefix
and stage name; no legal name is written here. Screenshots are in the session scratchpad (`.../scratchpad/stage4/`), not in the repo.
Screen values are read from the `title` of `[data-testid="money"]` (exact string) and compared as strings with the API.

**Result: 0 mismatches between screen and API** (10 tracks x 4 totals, 10 owners x 8 balance fields, all 1,151 rows of P9 x 6
columns, 54 overview rows x 7 cells, 6 queue totals, 11 signal counts, 14 open questions). 0 dead ends. 0 console errors on any page.
Three real defects (F1, F2, F3), one data-vs-doc note on `14` (F4), several UI remarks.

## A. Scenario walk of 16 section 2

Timing = time to first byte of the money request as measured in the browser (Playwright `timing().responseStart`); non-money
calls are 5-200 ms. Money pages show their card/table frame at once and fill after the call (`recalc-indicator`, headline "—").

| Job (16) | Page(s) opened | What the operator sees (real data) | Action control | Gate | Timing / states |
|---|---|---|---|---|---|
| 2.1 Inbox of what waits | `/` (P1), `/queue`, `/queue/<reason>` | P1: 54 rows (47 Believe + 7 B17 quarters), 6 queue chips, 11 signal chips; queue summary 6 rows by amount | chips link to `/queue/<reason>` and `/signals/<name>` | - | overview 11.8 s TTFB (curl 9.7 s); queue pages 7.4-7.7 s; no totals row |
| 2.1 A document arrived | `/documents` (1,397: 813 contract, 158 advance_basis, 158 payment_proof, 104 adjustment_basis, 63 appendix, 45 assumption not_approved, 37 other, 19 buyout), `/documents/:id` | document page shows "ждёт этого документа" (assumption doc a6702d9a: 4,840.35 waiting; contract b0d5d8b7: 0.00), splits/participations/label rules/contracts it carries | `action-confirm-split` "Подтвердить сплит этим документом", `action-create-contract`, `link-assumption-wizard`, `action-create-document`, `action-approve` | all disabled (no operator) | `/documents/:id/uses` 6.3-7.3 s (money call); list 15 ms |
| 2.1 Validate what was entered | `/documents` filter status=не утверждён, `/owners` | 45 not_approved = all `assumption` (no approvable document: `assumption-note`); 1,352 others approved; owners `waiting_documents` visible as gate `owner_not_confirmed` (730 of 1,151) | approve hidden for assumption | - | - |
| 2.1 Ambiguous pseudonym | `/artists/duplicates`, `/artists/:id`, `/questions` 15.3.3 | 20 groups; DJ VETA3 has 116 candidate ISRC, DSHZS 56, MC FLYXO 0 (page shows the same 20 groups as `GET /artists/duplicates`, 1.4 s) | `action-assign-owner`, `action-merge`, "Создать сплит" per candidate ISRC | disabled | empty state "Участий нет." on `/artists/:id` ok |
| 2.1 Payment request / why X | `/owners/:id` balance tab, `/tracks/:isrc` | formula earned - recouped - paid + returns + credits = payable; "по псевдонимам и ISRC", waiting by reason, by label | `action-pay` | enabled-by-gate in the data (`payout.allowed`), disabled only by the empty operator | balance 6.4-7.0 s |
| 2.2 Believe month | `/sources` (47 files, both accounts; 3,601,199 lines for 1052428 2026-08), `/sources/lines?account=1052428&month=2026-08`, `/` | table of files with status "загружен", lines and received; lines page: facets 77 ms, lines 2.3 s; `lines-totals` "считает API" | `field-upload-believe` + "Загрузить" (disabled: no operator and no file) | disabled | A = B + C + ours: discrepancy 0 and `fileDiscrepancy` 0 on all 47 Believe rows |
| 2.2 Completeness | `/` P1 | every Believe row shows Расхождение 0,00 and Расхождение с файлом 0,00; 7 B17 rows show "—" for the file discrepancy (API has none) | - | - | - |
| 2.2 New imprint strings | `/signals/labelUnmapped`, `/queue/label_unmapped`, `/labels` | 0 and 0 (empty state "Список пуст." / "По этой причине ничего не ждёт"); `/labels` has 17 labels with aliases and rule counts | `action-add-alias`, `action-set-rule` | - | empty state ok |
| 2.2 Pairs outside the catalogue | `/signals/unallocated`, `/queue/no_isrc` | 394 pairs, 2,364.33, all without ISRC; top pairs by UPC 3618024998363 276.75, 3618026398604 174.63, 3617392393992 121.24 | none: `read-only` "⚠ D-035 строка без ISRC: решение руководителя" on every row | - | - |
| 2.2 No-split ISRCs | `/signals/isrcsWithoutSplit` | 2,500 (shows first 500 by net: QZN882341449 93,484.09, QZN882398186 40,087.56) | `action-create-split` per row | disabled | list capped, see F2 |
| 2.2 Sanity of the month | `/sources/lines` filters (ISRC, UPC, platform, country, sort), `/tracks`, `/releases` | lines page works with API totals (FRX282403913: 38,158 keys, Net 101,759.08, = the track page net); `/tracks` 25,854 rows with B/C/ours; `/releases` 11,089 rows | - | - | `/tracks/summary` 8.2 s; `/releases` 14.8 s (no calculation expected, see F6) |
| 2.3 B17 quarter | `/sources` (B17 table, 6 files, "К выплате" per file), `/publishing` (47 writers/holders, terms list), `/queue/publishing_terms_unconfirmed`, `/queue/owner_unconfirmed` | 12 owner groups with 325,405.99 (afaed4c7 240,081.33, e6036e9e 32,314.28, 805595d8 18,411.47); owner_unconfirmed top group 8954bde7 313,055.41 (a B17 holder, 0 ISRC) | `field-upload-b17`, `action-publishing-terms`, `action-map-writer`, `action-resolve-writers`, `action-merge` | disabled | `/publishing/writers` 5 ms; the "Updated Q2 2026" refusal (D-041) cannot be walked without a write |
| 2.4 Contract entry | `/documents/:id`, `/queue/owner_unconfirmed` and `/queue/split_unconfirmed`, `/tracks/:isrc?tab=rules`, `/splits`, `/participations` | queue shows what the contract unblocks (owner groups with amount, ISRC count, months); track rules tab lists split rows with period/percent/document (24,107 splits, 283 participations on the lists) | `action-create-contract`, `action-confirm-split`, `action-create-split`, `action-change-split`, `action-buyout`, `action-create-participation` | disabled (no operator) | dialogs themselves not walked: unreachable read-only (covered by the e2e specs) |
| 2.5 Payout | `/owners?view=payouts` (201 candidates, 5 pages), `/owners/:id` | rows ordered by payable: first afaed4c7 682,348.35, then b4a0fa90 81,866.67, 1b2a7fdf 50,629.55, b5b6ded2 39,599.80; gate chips "можно выплатить / нечего выплачивать / владелец не подтверждён"; negative payable shows 0,00 plus a red note with the exact value | `action-pay` on the card | gate by API: `allowed` 201, `owner_not_confirmed` 730, `below_threshold` 92, `nothing_to_pay` 128 | payables 9.5 s; P9 grid 50 per page, 1,151 rows total |
| 2.5 Open questions | `/questions` | 14 items 15.3.1-15.3.14 with decision chips (D-083, D-123, D-041, D-087, D-045, D-096, D-029, D-043, D-138) | `question-link` "Перейти" | - | all 14 links open a rendered page |

Empty/long/error states seen: empty (4 zero reasons, 3 zero signal lists, artist without participations) are all worded; long
(2,500 / 785 / 507 lists) show "показаны первые 500 из N"; error state never occurred; a track with 702 month rows renders in 8.5 s.

## B. Ten tracks (`/tracks/<isrc>`, 14 section 3.2 rows 1-10)

Screen titles (net, B, C, ours) = `GET /tracks/<isrc>/money` totals: identical strings on all 10. "14 net" is the "ERP net" of `14` 3.2.
Money call TTFB 7.9-8.1 s on every track (page ready 8.5 s).

| # | ISRC | Title | Screen = API net | B | C | ours | 14 net | net - 14 | Month rows (screen = API) | Rule in force on the rules tab (= 14 column) |
|---|---|---|---|---|---|---|---:|---:|---:|---|
| 1 | FRX282403913 | Turu R9 | 101,759.08 | 48,827.60 | -1.64 | 52,933.12 | 101,760.72 | -1.64 | 205 | DJ Ikeraus 35 + MC FERNANDINHO FN 15 to 2025-12; DJ Ikeraus 0 + FN 15 to 2026-05; Duetti 100 from 2026-05 |
| 2 | FR96X2414092 | Apathy | 53,147.01 | 24,518.34 | -2.45 | 28,631.12 | 53,149.46 | -2.45 | 201 | Lxzt 50 to 2026-03; Lxzt 0 to 2026-06; Duetti 100 |
| 3 | DGA052458596 | TURU R9 | 54,033.35 | 26,004.11 | -2.70 | 28,031.94 | 54,036.05 | -2.70 | 187 | as 1 |
| 4 | DGA052458597 | TURU R9, Vol. 2 | 35,709.52 | 17,201.07 | -0.56 | 18,509.01 | 35,710.08 | -0.56 | 163 | DJ Ikeraus 50 / 0 / Duetti 100 |
| 5 | FRX282403914 | Turu R9 | 32,255.75 | 15,239.09 | -81.81 | 17,098.47 | 32,337.56 | -81.81 | 208 | as 1 |
| 6 | FRX452444855 | TURU R9, Vol. 2 | 27,356.06 | 13,200.08 | -0.65 | 14,156.64 | 27,356.71 | -0.65 | 187 | as 4 |
| 7 | FR2X42478250 | gedagedago | 36,693.69 | 18,346.85 | 0.00 | 18,346.85 | 36,693.69 | 0.00 | 702 | 2KE 50 from 2000-01 (D-pair fixed) |
| 8 | FRX872563577 | HEXST0RM | 17,094.40 | 5,673.84 | -128.10 | 11,548.66 | 17,222.50 | -128.10 | 46 | as 2 |
| 9 | FRX452444856 | TURU R9, Vol. 2 | 20,826.63 | 9,710.69 | -2.48 | 11,118.41 | 20,829.11 | -2.48 | 195 | as 4 |
| 10 | FRX872449088 | VEN NO TOMA TOMA | 20,429.25 | 9,619.71 | -1.09 | 10,810.64 | 20,430.34 | -1.09 | 171 | as 4 |

Reading: the percentages and periods on the rules tab equal the "ERP rule in force" column of 14 on all 10 (D-137/D-138 left these
ISRC unchanged; the Duetti buyer takes 100 % from the sale month, the bought-out row shows 0 %). The `ours` equals the "Sum diff
ERP - Annex" of 14 (Annex excludes the ISRC) on rows 1-6 and 8-10: 52,933.12, 28,631.12, 28,031.94, 18,509.01, 17,098.47, 14,156.64,
11,548.66, 11,118.41, 10,810.64. 14's "ERP net" equals B + ours (excludes C); the screen net = B + C + ours = the raw net of the
lines page (`/sources/lines?isrc=FRX282403913`: Net 101,759.08). The whole difference is C (F4). The C is the buyer Duetti's 100 % share
of negative lines after the sale (owner_unconfirmed, e.g. FRX872563577 -45.90, -39.59, -42.61 in 2026-01..03 sales months).

Expanded month (first `action-expand-month` click, `alloc-<ruleId>-<artistId>`): FRX282403913 report 2024-05 / UPC 3617386159610 net 327.33:
DJ Ikeraus 35 % = 114.565250981 (B, approved), MC FERNANDINHO FN 15 % = 49.099393278 (B) (titles equal the API allocation amounts to 12
decimals); FR96X2414092 Lxzt 50 % 27.472462436; DGA052458596 DJ Ikeraus 35 % 0.800407230; FR2X42478250 2KE 50 % 1,062.484168499; the other
ISRC likewise (every allocation title = API string). Header "Раскрыть" per row shows layers, shares, document chip "утверждён".

## C. Ten owners (`/owners/<id>`, 14 section 4.2 rows 1-10)

Screen titles of `balance-earned|recouped|paid|returns|credits|payable|payableShown|waiting` = `GET /owners/:id/balance` `total` (identical on
10 x 8). P9 (`/owners` all view, 1,151 rows scrolled and read) = `GET /owners/payables` on every row; the three payable owners also sit in the
payouts view with the same amounts; the seven others are absent from the payouts view by design (filter `payout.allowed`).
Balance TTFB 6.4-7.0 s. "14" = "ERP payable" of 14 section 4.2 run 2 (before D-137/D-138); 14 section 10 gives after-figures only for the B of five
owners, not payable.

| # | Prefix | Stage name | Earned | Recouped | Paid | Returns / credits | Payable (API = screen) | Shown / gate | 14 payable (run 2) | Delta | Why |
|---|---|---|---:|---:|---:|---|---:|---|---:|---:|---|
| 1 | 68583cad | LDRR | 479,857.45 | 1,000.00 | 675,846.46 | 0 / 0 | -196,989.01 | 0,00 / nothing_to_pay | -326,645.18 | +129,656.17 | E1 137,982.02 removed (D-137) less the pro rata 8,325.86 (D-138); 14 is pre-change |
| 2 | 7c6a567e | settlement participant | 8,123.30 | 0.00 | 6,257.83 | 0 / 0 | 1,865.47 | 1 865,47 / allowed | 139,847.50 | -137,982.03 | E1 removed (D-137): 139,847.50 - 137,982.02; 14 is pre-change |
| 3 | 9670a62d | RD12 | 203,685.17 | 100.00 | 308,021.75 | 0 / 0 | -104,436.58 | 0,00 / nothing_to_pay | -104,573.15 | +136.57 | D-138 RD12 +136.56 (14 section 10), cent rounding |
| 4 | 14b5366d | UdieNnx | 728,788.60 | 13,000.00 | 781,200.27 | 0 / 0 | -65,411.67 | 0,00 / nothing_to_pay | -63,726.49 | -1,685.18 | D-137 carve take from rows (14 section 9.3); 14 pre-change |
| 5 | 0637477b | DJ DYLANFK | 225,652.97 | 47,900.00 | 319,181.93 | 0 / 0 | -141,428.96 | 0,00 / nothing_to_pay | -110,784.68 | -30,644.28 | the "carve take" -30,644 named for DJ DYLANFK in 14 section 9.2 |
| 6 | aba9837e | MC CODE (+7) | 33,223.64 | 0.00 | 124,582.45 | 0 / 0 | -91,358.81 | 0,00 / nothing_to_pay | -88,183.86 | -3,174.95 | C assumption now 91,031.21 waiting (D-137 carve participations) |
| 7 | 6d814d51 | DJ-JY12 | 0.00 | 0.00 | 80,174.52 | 0 / 0 | -80,174.52 | 0,00 / owner_not_confirmed | -80,174.52 | 0.00 | unchanged; 67,885.32 waits in C owner_unconfirmed |
| 8 | bcf3c25f | Lxzt | 62,004.31 | 0.00 | 49,410.65 | 0 / 0 | 12,593.66 | 12 593,66 / allowed | 12,593.66 | 0.00 | unchanged |
| 9 | 3fecfb7a | DJ MH | 56,686.37 | 12,315.81 | 93,035.40 | 0 / 0 | -48,664.84 | 0,00 / nothing_to_pay | -48,464.68 | -200.16 | E2 carve 200.12 (D-137) |
| 10 | 9272ef5f | qaraqshy | 54,207.92 | 23,257.21 | 4,182.08 | 0 / 0 | 26,768.63 | 26 768,63 / allowed | 26,768.63 | 0.00 | unchanged |

Rows 1, 2, 3 reconcile to the cent with the documented D-137/D-138 changes (129,656.17 = 137,982.02 - 8,325.86; 7c6a567e 139,847.50 - 137,982.02;
RD12 +136.56). Rows 4, 5, 6, 9 move by the D-137 carve (14 section 9.3 lists the effect, not a per-owner payable). Negative payables show 0,00
with a red banner "Сумма к выплате отрицательная: показан 0. Точное значение: ..." (`payable-negative`) and the row `= к выплате` in red.
`action-pay` exists on all 10 and is disabled only by the empty operator, including the three allowed owners (gate green "можно выплатить").

## D. C reasons and signals

Queue (`/queue`, `/queue/<reason>`): the screen total of each reason equals `GET /overview` `queue[]` amount (strings identical) and the P1 chip;
group counts equal the API (545 / 9,475 / 12 / 254 / 16 / 394). 16 section 2.6 / 15 section 2: 594,298 + 520,584 B17 = 1,114,882 for owner_unconfirmed (screen 1,114,884.25, API
1114884.254634151495); the others equal 16 to the cent.

| Reason | Screen = API amount | Groups | Top groups (key kind and id prefix: amount) | Action per row (all disabled: no operator) | Notes |
|---|---:|---:|---|---|---|
| owner_unconfirmed | 1,114,884.25 | 545 | owner 8954bde7: 313,055.41; owner 6d814d51 (DJ-JY12): 67,885.32; owner cd5c49ba: 56,048.95 | `action-create-contract` "Создать договор" + `action-merge` "Слить в другого владельца" | F1 clipped action cell |
| split_unconfirmed | 454,219.20 | 9,475 | split 724e896d DGA0P2434912: 18,955.64; FR59R2556825: 18,285.78; FRX762591326: 17,422.34 | `action-confirm-split` "Документ и подтвердить сплит" | rows are per split, not per owner, as the doc said ("owner -> artist -> ISRC") |
| publishing_terms_unconfirmed | 325,405.99 | 12 | owner afaed4c7: 240,081.33; e6036e9e: 32,314.28; 805595d8: 18,411.47 | `action-publishing-terms` "Условия паблишинга" | - |
| assumption | 144,195.41 | 254 | participation 81b5dbe5 MC Kenin CA5KR2544291: 15,510.51; 213a9ee2 MC CODE DGA0S2481329: 13,020.12 | `action-replace-assumption` "Заменить документом" | Q11/R1 groups read-only (`read-only` with basis) |
| artist_without_owner | 5,296.64 | 16 | artist b9af19a7 (Eiden XII) 4,328.45; kanajes 614.48; DJ N3LK0 79.21 | `action-assign-owner` "Привязать владельца" | - |
| no_isrc | 2,364.33 | 394 | pair 3618024998363: 276.75; 3618026398604: 174.63 | none: `read-only` "⚠ D-035 строка без ISRC: решение руководителя" on all rows; page subtitle "Действия нет..." | as required |
| label_unmapped, rule_unconfirmed, unknown_pair, writer_unmapped | 0 | 0 | - | - | empty state "По этой причине ничего не ждёт (с этими фильтрами)" (wording: no filter is set) |

Signals (`/signals`, `/signals/<name>`): index counts = `GET /signals` `counts` on all 11. The list sizes: the page reads `limit=500`.

| Signal | API count | Rows shown | Action found | Notes |
|---|---:|---:|---|---|
| unallocated | 394 | 394 | `read-only` "⚠ D-035" (all pairs have no ISRC) | - |
| isrcsWithoutSplit | 2,500 | 500 | `action-create-split` | "показаны первые 500 из 2500" (F2) |
| ambiguousWriters | 0 | 0 | (`action-map-writer` when rows exist) | empty state "Список пуст." |
| unfunded | 507 | 500 | `action-recreate-participation` "Закрыть участие и создать заново" | 7 shortfalls not reachable (F2) |
| labelUnmapped | 0 | 0 | (alias / rule dialogs) | empty |
| tracksWithNote | 11 | 11 | `action-edit-note`, `action-clear-note`, `action-add-note` | notes are English text, shown in full |
| participantsWithoutOwner | 3 | 3 | `action-assign-owner` | Eiden XII 4,328.45 plus two @era rows 0.00 |
| sublabelWithoutRule | 10 | 10 | `action-set-rule` + link "Лейблы" | label string `lost`, 10 months, 57.18 down to ~16 |
| ruleRecipientIsRow | 0 | 0 | (`action-close-rule`) | empty |
| twoRowsOneOwner | 785 | 500 | none: "только информация" + arrow link to the owner | 285 not reachable; owner cell is a bare arrow (F7) |
| assumptions | 45 | 45 | `action-replace-assumption` = a link to `/queue/assumption` (the only action control not disabled without operator; correct, it only navigates) | name column reads "Документ документ" (F8) |

`/questions`: 14 items, 9 with decision chips; every link opens a rendered page (`/queue/*`, `/artists/duplicates`, `/splits`, `/publishing`,
`/owners`, `/owners?view=payouts`, `/signals/isrcsWithoutSplit`).

## E. Operator jobs to actions table

| Job / reason / signal | Page | Control found | Status |
|---|---|---|---|
| C owner_unconfirmed | `/queue/owner_unconfirmed` | `action-create-contract`, `action-merge` | ok |
| C split_unconfirmed | `/queue/split_unconfirmed` | `action-confirm-split` | ok |
| C publishing_terms_unconfirmed | `/queue/publishing_terms_unconfirmed` | `action-publishing-terms` | ok |
| C assumption | `/queue/assumption`, `/signals/assumptions` | `action-replace-assumption`, `link-assumption-wizard` (document page) | ok |
| C artist_without_owner | `/queue/artist_without_owner` | `action-assign-owner` | ok |
| C no_isrc | `/queue/no_isrc` | `read-only` D-035 | ok (information) |
| C label_unmapped / rule_unconfirmed / unknown_pair / writer_unmapped | `/queue/<reason>` | empty state only (0 on real data); dialogs per `REASON_ACTIONS` not observable | not walked (no rows) |
| Signal unallocated, isrcsWithoutSplit, unfunded, tracksWithNote, participantsWithoutOwner, sublabelWithoutRule, assumptions | `/signals/<name>` | see D | ok |
| Signal twoRowsOneOwner | `/signals/twoRowsOneOwner` | information | ok |
| Signal ambiguousWriters, labelUnmapped, ruleRecipientIsRow | `/signals/<name>` | empty state only | not walked (0 rows) |
| 2.1 inbox | `/`, `/queue` | chips, summary | ok |
| 2.1 document arrived | `/documents`, `/documents/:id` | create/attach/approve/confirm-split/create-contract | ok |
| 2.1 validate | `/documents` filters | approve (hidden for assumption) | ok |
| 2.1 ambiguous pseudonym | `/artists/duplicates` | assign owner, merge, create split per ISRC | ok |
| 2.1 payment request / explain | `/owners/:id`, `/tracks/:isrc` | `action-pay`, explain tabs | ok |
| 2.2 Believe load | `/sources` | `field-upload-believe` | ok (disabled) |
| 2.2 completeness | `/` | discrepancy columns | ok |
| 2.2 sanity of the month | `/sources/lines`, `/tracks` | filters, totals | ok |
| 2.3 B17 load, writers, terms | `/sources` B17, `/publishing` | `field-upload-b17`, `action-map-writer`, `action-set-terms` | ok |
| 2.4 contract, buy-out, participation, label rule | track rules tab, `/splits`, `/participations`, `/labels` | `action-create-split|change-split|buyout|create-participation`, `action-set-rule` | ok (dialogs not opened) |
| 2.4 advance with scope, one-off fee, deduction | `/operations` (2,662 rows), owner Операции tab | `action-create-operation`, `action-proof|deferred|return|deactivate|snapshot` | ok |
| 2.5 payout | `/owners?view=payouts`, `/owners/:id` | `action-pay` | ok (disabled by operator only) |
| 2.5 label summary, sublabel settlement | `/` ourShare columns | no ads column; sublabel money in owner_unconfirmed | as designed |
| Open questions 15.3.1-14 | `/questions` | links | ok |

## F. Findings

| # | Sev | Page and hook | Finding |
|---|---|---|---|
| F1 | should-fix | `/queue/owner_unconfirmed`, `queue-group-owner-*`, `action-create-contract` + `action-merge` | In the action column the two buttons plus the "укажите оператора" hint of each row are stacked into a fixed-height row: "Слить в другого владельца" overlaps the "Создать договор" of the next row and the hints are clipped (screenshot `queue_owner_unconfirmed.png`). The owner picture may differ once an operator is set (hints disappear) but two buttons in one cell still need the row height or a side-by-side layout. The same hint is repeated 50 times per page; one per page would do. |
| F2 | should-fix | `/signals/isrcsWithoutSplit`, `/signals/unfunded`, `/signals/twoRowsOneOwner` | The page reads `GET /signals?limit=500`: 2,000 of 2,500 ISRC without a split (below the top 500 by net), 7 of 507 shortfalls and 285 of 785 two-row months are not reachable on any screen. The text "показаны первые 500 из N" is honest, but the 7 shortfalls and the whole list are in the money-relevant set. Needs paging or a higher limit (the API cap per list). |
| F3 | should-fix | `/tracks/:isrc` money tab, `month-<account>-<upc>-<reportingMonth>`, `action-expand-month` | `monthKey` = account-upc-reportingMonth without sales month or label: on FRX282403913 205 rows share 29 distinct keys (duplicate `data-testid`, duplicate React key). Clicking "Раскрыть" on one row opens its twin too (verified: 2 buttons "Свернуть", 2 `month-detail-*` with the same id). Add salesMonth (and label string) to the key. FR2X42478250: 702 rows, 93 keys. |
| F4 | note (doc) | `14` 3.2 column "ERP net" | The column is B + ours, not net: all 9 tracks with C differ from the screen net by exactly C (-1.64 ... -128.10). Screen net = B + C + ours = raw lines net. Not a screen defect; `14` 3.2 needs "ERP net excl. C" or the right figure. |
| F5 | note (data) | track header C of 9 Duetti-sale ISRC | C is negative (-1.64 ... -128.10, reason owner_unconfirmed): the buyer Duetti's 100 % share of negative lines after the sale, owner not confirmed, so a negative "waiting" appears in red. Correct by the rules, but an operator may read it as an error: either hint "отрицательные строки после выкупа" or surface it in the queue (the queue shows only positive reasons). |
| F6 | should-fix (perf) | `/releases` | `GET /releases` 14.8 s TTFB although the page promises "no calculation" (`17`); `/tracks/summary` 8.2 s, `/documents/:id/uses` 6.3-7.3 s, `/owners/payables` 9.5 s, `/overview` 9.7-11.8 s. Money calls are 6.4-10 s as in `14` 7; `/releases` is the outlier and should be 1-2 s. |
| F7 | note (UI) | `/signals/twoRowsOneOwner` `signal-row-*` | The "Владелец" column shows only an arrow link, no label; "только информация" is top-aligned while other cells are centered. |
| F8 | note (UI) | `/signals/assumptions` | The name column reads "Документ документ" (kind label repeated as name). The `action-replace-assumption` here is a link to `/queue/assumption` while in the queue it is a disabled dialog button: consistent but the label looks like an action. |
| F9 | note (UI) | P9 `/owners`, `/owners?view=payouts` | Columns "К выпла...", "Заработ...", "Удержа..." and amounts ("682 348...", "179 567...", "150 385...") are truncated with an ellipsis at 1440 px; the big numbers are exactly the ones the operator needs. Widen money columns or drop the duplicate "К выплате (показ)" next to "К выплате". Also the first page is one scroll box inside the page (545 px high grid, 50 rows). The payouts subtitle says "кто заблокирован", but the view lists only the 201 `allowed` owners. |
| F10 | note (UI) | `/queue/*`, `/` | Empty filter fields ("Счёт", "Месяц", "Поиск") render as bare white boxes with no placeholder; the P1 section "Счёт" shows an empty box. The queue has two paginations (server offset select "Страница (смещение) 1...50" and the grid pager "Страница 1 из N"); with 9,475 split groups the offset list has 190 entries. The empty-state text "(с этими фильтрами)" appears with no filter set. |
| F11 | note (UI) | `/sources` | B17 file status is shown as the raw "loaded" (Believe shows "загружен"); line counts have no thousands separator (3601199) while money has; native file inputs show the English browser text "Choose File No file chosen". |
| F12 | note (UI) | `/tracks/:isrc` | 205-702 month rows with no paging or grouping by reporting month (the sales month is the second column, row per sales month); readable but long. Header net label is "Получено" (correct), C reasons listed under the C figure (good). |
| F13 | note (product) | P9 payouts view, `/owners/afaed4c7-...` | The first payout candidate is afaed4c7: payable 682,348.35 (also 240,081.33 of publishing terms in C), payable by one click. No amount-based warning or second confirmation was observed in the gate field (only `below_threshold`); consider a visible "large amount" mark. |
| F14 | note (walk limit) | all write dialogs | With the operator empty every dialog button is disabled, so dialog contents (create-contract, confirm-split, pay) could not be opened and were not verified here; the e2e specs (`e2e/golden/`) are the evidence for them. |
| F15 | note | `/questions` | 15.3.9, 15.3.10 and 15.3.14 link to the generic `/owners` or `/owners?view=payouts`, not to a filtered view of the owners concerned; 15.3.7 links to `/splits` without a filter. Acceptable, weak. |

Summary counts: screen-vs-API mismatches 0; dead ends 0; blockers 0; should-fix 4 (F1, F2, F3, F6); notes 11. The three golden-screen candidates
for stage 5 are F3 (twin expansion, with a unit test on `monthKey`), F2 (limit) and F1 (action cell layout).
