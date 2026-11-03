Verdict: yes

# Frontend goal, stage 3: product review of the operator's workplace (D-139 … D-149)

Product member of the stage 3 council, 2026-11-03, branch `feature/fable-001`, HEAD `d19027e`. Read-only on the repo.
I wrote only this file. I checked every golden number below myself, on screen, on my own seeded stand. I performed
every action through the UI, as an operator would, never through the API. No number on screen differs from 19, and
every action I tried works through the UI. Every C reason and every signal has its control. Every job of 16 §2 has a
screen, except the ones 16 already marks as not modelled. The findings below are UX should-fixes: raw ids, English
enum values and codes left in Russian screens, and truncated grid columns. None of them hides or misstates money.

## What I ran

- Stand `council3p`: `seed.ts council3p` (83 Believe files, 89 lines, 8 B17 lines, S01–S37). I built the client with
  `npm run build -w @erp/frontend` and served it with the API on :3140 (`PAYOUT_THRESHOLD_CENTS=0`).
- The browser was Playwright chromium, driven by throw-away scripts in the scratchpad: real clicks, fills, pickers and
  confirm dialogs. The operator was `council-product`. I read every number from the `title` of `money` and took
  screenshots of the pages.
- **Actions performed through the UI.**
  - Queue: S12 (document, approve, confirm split), S13 (replace the assumption from 2026-03), S14 (contract), S15
    (assign owner), S16 (alias), S17 (sublabel with a rule), S18 (terms of W3), S19 (map writer), S32 (approve the
    rule document).
  - Signals: S20 (register the track from `unallocated`), S21 (close and re-create the participation from
    `unfunded`), S35/4 (assign owner from `participantsWithoutOwner`), S35/3 (track note).
  - Track page: S25 (change the split from 2026-03-15, then a buy-out from 2026-05-10), S27 (close the
    participation at 2026-04-20).
  - Labels page: S37 (close the rule at 2026-04-01).
  - Owner page: S22 (Pay, then proof); S31/k4 (deduction 10, credit −5, deactivate, Pay 55, proof, return); S33
    (merge Y into X).
  - Sources page: S34 (upload; the same file again; the same bytes under another account).
  - Owners page: S36 («тот же», then «новый»).
- **Stand dropped.** I stopped the server (port 3140 is free) and ran `drop.ts council3p`: "dropped erp_council3p,
  believe_council3p, believe_council3p_stage". No `council3p` files are left under `data/test-tmp`.

## Golden screens: expected (19) vs seen

Every P1 row of the seed matched before any action. That is 87 rows; the after rows are listed per scenario. After
all my actions, `discrepancy` is `0` on all 87 rows (P1 identity, 19 §5.1).

| Scenario | 19 expects | Seen on screen (`title`) | |
|---|---|---|---|
| S01–S04 P1 (01…04 rows) | 100/50/0/50; 100/49.8/0/50.2; 66.6/33.4; 25/75; 57.5/42.5; 100/0; 62.5/37.5; 65/35 | identical, per row | ok |
| S03/8 G37 P6 | P 50, ours 0, shortfall 20 | P-038 `50`, ours `0`, «Не хватило … bucket_short: 20,00»; P21 `unfunded` `20` | ok (finding 2) |
| S05 P1 / P6 | 75/25; 85/15; 100/0; 50/50 with NG 50 B | identical; S05/4 NG `50` B, no A row | ok |
| S06 by label | {0to8 50}, {Echo8 50}, 03 75/25, 04 50/50 | identical (`by-label-*`) | ok |
| S07 | −100 / −78.75 / 0 / −21.25; 0/0/0/0 | identical | ok |
| S08/1–2 | 100 / 57.5 / 23.375 / 19.125; E `1.475`, A `13.275`; P 4.25 and NG 19.125 C ⚠ Q11 | identical; P6 shows ⚠ Q11 on both C rows | ok |
| S08/3, S08/4 | 100/50/25/25 {Echo8 25}; 100/0/50/50, noSplit 50 | identical | ok |
| S09/1–2 | A `12.266666666666`, B, C `12.266666666667`; 100/10/0/90 | identical | ok |
| S10 | 2710100 100/50/0/50; 2710101 50/25/0/25; 2710201 57/25/7/25, unknown_pair 7 | identical | ok |
| S11 P1 | 150 / 82.5 / 0 / 67.5 | identical | ok |
| S12 | 100/5/50/45, group `50` 2026-03–2026-03 → gone, 100/55/0/45 | identical | ok |
| S13 | group `20`; 03 100/30/20/50 → 100/50/0/50; the 05 group `20` stays, 05 100/7/20/73 | identical; P6 03: A 23, L 20, D 7 all B | ok |
| S14 | group `50`, P10 payable 0, gate owner_not_confirmed → gone, 100/50/0/50, payable `50`, gate allowed | identical | ok |
| S15 | group `50` → gone, 100/50/0/50 | identical | ok |
| S16 | group `50`, P21 `Mystery Records` net 100 → gone, 100/50/0/50 | identical | ok |
| S17 | group `50` → gone; P6 A 50, NG-171 25 B; 100/75/0/25 | identical | ok |
| S18 | owner W3 `50` → gone; b17 03 400/170/50/180 → 400/220/0/180; W3 earned `50`, payable `50` | identical | ok |
| S19 | P21 `HOLDER W4`; group `100` → gone; b17 2025-12 100/0/100/0 → 100/50/0/50; W4a earned `50` | identical | ok |
| S20 | 9/0/9/0; after: 9/0/2/7, noSplit `7`; P21 `isrcsWithoutSplit` QZTST2720109 `7` | identical | ok |
| S21 | missing `10`; after: A `0`, P `10`, P1 unchanged 100/10/0/90, row gone | identical | ok |
| S22 | 15/10/0/5, allowed → Pay: payable 5, payout_blocked, blocking → proof: paid 5, payable 0, nothing_to_pay | identical; the dialog says «К выплате: 5,00 (будет отправлено 500 центов)» with the formula | ok |
| S25 | A earned 150 → 100 → 75; 02 50/50, 03 25/75, 05 —/100; stored 03-01, 05-01 | identical; the toasts give the stored dates | ok |
| S27 | P earned 15 → `7.5`; stored 2026-04-01; 04 100/50/0/50 | identical; period «2026-01-01 → 2026-04-01» | ok |
| S31/k4 | 50 → deduction 40 → credit 45 → deactivate 55 → pay 5500 + proof 0 → return 55 | identical at every step | ok |
| S32 | group `5` → gone; 100/50/5/45 → 100/55/0/45 | identical | ok |
| S33 | X 50 / Y waiting 50; 200/50/50/100 → X `100`, pseudonyms A-331, B-331; Y banner; 200/100/0/100 | identical; History of X shows `council-product` | ok |
| S34 | file loaded, 1 line, 100; 100/50/0/50; again 409 `duplicate_period`; other account 409 `duplicate_file` | identical | ok |
| S35/1, /2, /4 | `Ghost Label 35` 2026-03 `140`; R-351 2026-06; A-352 + A2-352; P-354 `5` → gone, 100/55/0/45 | identical | ok |
| S36 | 409 → the dialog lists Owner DUP-361; «тот же» opens it; «новый» creates the second owner | identical | ok |
| S37 | 03 unchanged; 04 100/50/0/50 without NG; P21 `Close Label 37` 2026-04 `100`; NG-371 earned 50 → `25` | identical | ok |

## The operator's jobs (16 §2): page and control

| Job | Page and control | Dead end? |
|---|---|---|
| Inbox of what waits (2.1) | P1 queue chips (sorted by money) → P2 `/queue`, `/queue/:reason` (an action per row) and P21 | no |
| A document arrived | P13 «Создать документ» → P14 «Подтвердить сплит этим документом», «Создать договор», the assumption wizard; or the document step inside every queue dialog | no |
| Validate what was entered | P13 `status=not_approved` + approve; P15 `status`; P9 status chip | no |
| Ambiguous pseudonym | `/artists/duplicates`: «Слить владельцев», «Привязать владельца», «Создать сплит» per ISRC | no |
| Payment request / "why X" | P10 Баланс (formula, waiting by reason, per pseudonym and ISRC → P6) | no |
| Load a Believe / B17 file | P19 upload (Believe and B17), `duplicate_period` / `duplicate_file` toasts | no |
| Completeness, new strings, pairs, no-split | P1 discrepancy; P2 `label_unmapped`, `unknown_pair`; P21 `unallocated`, `isrcsWithoutSplit` (create split) | no |
| Month sanity | `/sources/lines` facets and totals | no |
| Writers, terms (2.3) | P18 map, resolve, terms; P2 `writer_unmapped`, `publishing_terms_unconfirmed` | no |
| Contract mechanics (2.4) | P6 Правила (split, change, buy-out, confirm, participation create / close), P17 (alias, rule, close), P20 / P10 Операции (advance with scope, deduction, credit) | no |
| Payout time (2.5) | P9 `?view=payouts` → P10 Pay → proof on P20 / Операции | no |
| Label summary of the month | P1 `ourShareByLabel` per account and month; no total across accounts (by design) | partial (note 13) |
| Reports for artists, sublabels, authors; ads | balance per owner on screen, no export; ads not modelled (16 marks it) | known, out of scope |
| The B17 "Updated" statement, D-083 merges of holders | ⚠ decisions shown on P3 with their ids | owner's decision |

## C reasons and signals (16 §2.6–2.7)

| Reason or signal | Control on the screen | Exercised |
|---|---|---|
| `split_unconfirmed` | «Документ и подтвердить сплит» | S12 |
| `owner_unconfirmed` | «Договор» + «Слить» (⚠ D-083 in the subtitle) | S14 |
| `publishing_terms_unconfirmed` | terms dialog | S18 |
| `assumption` | «Заменить документом»; Q11 / R1 are read-only «⚠ Q11 решение руководителя» | S13; Q11, R1 seen |
| `artist_without_owner` | «Привязать владельца» | S15 |
| `no_isrc` | read-only «⚠ D-035 строка без ISRC: решение руководителя» | seen |
| `label_unmapped` | «Алиас лейбла» / «Саблейбл с правилом» | S16, S17 |
| `rule_unconfirmed` | «Утвердить» | S32 |
| `unknown_pair` | «Зарегистрировать трек» | seen; S20 acted via P21 |
| `writer_unmapped` | «Привязать автора» | S19 |
| `unallocated` | «Зарегистрировать трек»; a pair without ISRC is read-only ⚠ D-035 | S20 |
| `isrcsWithoutSplit` | «Создать сплит» (ISRC prefilled) | form opened |
| `ambiguousWriters` | «Привязать автора» | via S19 |
| `unfunded` | «Закрыть участие и создать заново» | S21 |
| `labelUnmapped` | alias / sublabel with a rule | via S16 |
| `sublabelWithoutRule` | «Задать правило» + link «Лейблы» | seen |
| `ruleRecipientIsRow` | «Правила трека» + «Закрыть правило» | seen |
| `twoRowsOneOwner` | «только информация» + links to the track and the owner | seen |
| `tracksWithNote` | «Изменить заметку», «Убрать заметку» | S35/3 |
| `participantsWithoutOwner` | «Привязать владельца» | S35/4 |
| `assumptions` | «Заменить документом»; Q11 / R1 read-only | seen |

## The three questions

Each is answered on one screen.
- **Whose is each dollar:** P6. The months expand into the allocations (pseudonym, owner, layer, kind, %, amount,
  category, C reason, document, basis) and the layer table.
- **What waits in C and why:** P1 (C by reason per account and month) and P2. P2 lists the reasons with their
  sentence; a reason's groups give the action.
- **How much can be paid today:** P9 `?view=payouts`, and P10 with the formula, the gate and the button.

The drill-down of 17 §2 is clickable end to end. I followed it on S13 05: P1 C `20` → `/queue/assumption?account=2713100&month=2026-05`
(1 group, `20`, equal to the cell) → `/tracks/QZTST2713101` → the expanded month → the allocation → «строка» (the
Правила tab) → the document `/documents/c55f…` («ждёт этого документа 20,00»). Two more P1 links work: B and ours go
to `/tracks?account&month`, and the account goes to `/sources/lines`. The signal chips are links to `/signals/:name`.
I found no dead link. No console error came from the product (one 500 is explained in note 15).

## Findings

**1. Should-fix: the approve dialog of the document step changes its numbers under the operator's finger.** Where:
P2, any queue dialog with the document step (`actions/DocumentStep.tsx`, `approve-lines.ts`, `i18n/ru/work.ts:197`).
The dialog opens with «ждёт в этой группе: 20,00» (the group amount). About a second later
`GET /documents/:id/uses` answers, and the dialog then reads «ждёт этого документа: 0,00 · подтверждает: сплитов 0,
строк 0, участий 0, правил 0, договоров 0». I saw this on S13 at t=0 and t=2.5 s, and in S12 / S14 / S32 the
confirm went through on the first text. For a fresh document both texts are true, but together they contradict each
other. Fix: keep OK disabled until `uses` answers. For a new document, say what the next step will confirm, e.g.
«после подтверждения уйдёт из C: 20,00».

**2. Should-fix: raw ids and English codes on money screens.**
- P6 shortfall: «Не хватило по правилу 688e7614: bucket_short: 20,00» (`i18n/ru/catalog.ts:71`). It should name the
  participant and say «корзины не хватает», as P21 already does.
- P10 Баланс: «Блокирующие выплаты: 248095ad-…» and «Операции, которые ещё не учтены 248095ad-…: no payment proof
  yet». These should show the operation (date, amount, kind) and a Russian reason.
- S21 recreate confirm: «Документ: 98b3f5a5-d283-…» (`dialogs.tsx:856` passes `p.documentId`). Show the document
  title.
- P14 «Строки только по этому документу»: the pseudonym column shows the artist UUID.
- P18 Сопоставление shows `matched` and `created_waiting_documents`. The API values are not in
  `ru.publishing.resolution` (that has auto, manual, ambiguous, external, created, unresolved), and
  `resolutionLabel` falls back to the raw value.
- S36 duplicate dialog: «совпало по: name, alias».
- History tabs show «2026-11-03T03:52:31.173Z council-product POST /owners/merge {"body":{"reason":…}}». The time,
  the method and the JSON body are not operator language. P1 also shows «Расчёт: 2026-11-03T03:47:47.747Z».

**3. Should-fix: truncated grids.**
- P10 / P20 Операции: «Смысл» is cut to «выплата от …» and «Состояние» to «подтв.: нет · отлож.: да · а…». The
  action buttons overflow the column (the fifth, «Снимок», is off the edge at 1440 px).
- P2: «Владелец» is cut to «Company …» and «Месяцы» to «2026-03 –…».
- P4: the two headers «К выпла…» (shown vs real payable) cannot be told apart, and «Последн…» is cut.

Money itself is never truncated: amounts fit everywhere I looked.

**4. Should-fix: P21 `unfunded` rows of one ISRC look like duplicates.** S09/2 shows QZTST2709201 2026-03 9,67 three
times: three pool participations M1–M3, 29 in total. The row has no participant or rule column, so the operator
cannot tell which «Закрыть участие и создать заново» belongs to which participation. Add the pseudonym.

**5. Note: the dialogs state the unfloored date, and the toast states the stored one.**
- S27: «действует до 2026-04-20 (не включая)», then the toast «Участие закрыто с 2026-04-01».
- S25: «Новые строки с 2026-03-15».

This is what 19 §8 point 5 decided (no client flooring, the rule stated in words). But for S27 the dialog says the
participation still runs to 04-20, while the money of the whole April moves. A dry-run field from the API (open point
5) would make the confirmation exact.

**6. Note: some irreversible dialogs do not state money.**
- Merge (S33): «Из, В, Переходят псевдонимы: B-331, документы: 0, необратимо», without Y's waiting 50 that becomes
  X's B.
- Close rule (S37), close participation (S27): no amount that moves.
- Contract (S14): «владелец становится подтверждённым», without the 50.

The goal says the dialogs state "what changes". The payout dialog is the model to follow: formula, per pseudonym,
cents.

**7. Note: on P14 of an `assumption` document, «Подтвердить сплит этим документом» and «Создать договор с этим
документом» are enabled.** The backend accepts an assumption as a split document (`SPLIT_DOCUMENT_KINDS`). That is
legitimate for recording a council decision, but next to «допущение заменяется документом» it reads as a way out of
C. The text should say that the money stays in C `assumption`.

**8. Note: S13 dialog.** «новые строки с 2026-03-01» does not say that they end at the next split (2026-05-01), which 19
§4 describes. The created document gets the generic title «Документ QZTST2713101».

**9. Note: P2 has two page-size controls.** The toolbar `limit` select shows «50», and the grid footer shows «500».

**10. Note: P10 header.** «написаний: 1» (the alias count) is unclear; «вариантов имени» reads better. P10 has no page
title above the card, unlike the other pages.

**11. Note: API error toasts are the English messages.** For example «duplicate_period: A Believe report for account
2734100, month 2026-03 is already loaded …». This is R4 (shown as they are), but a Russian sentence per code would
help an operator.

**12. Note: the test files are not named as in 19 §6.** `e2e/golden/` has `queue`, `signals`, `rules`, `payout`,
`merge`, … instead of `queue-documents`, `queue-owners`, … Update 19 §6 or the agent guide (doc drift).

**13. Note: no label total for the month across accounts.** P1 has no totals row by design (R1). The 2.5 job
"label summary of the month" needs `ourShareByLabel` summed by the API for the period.

**14. Note: P5 `hasSplit=false` and P21 `isrcsWithoutSplit` count different things.** P5 shows 7 rows, P21 shows 3.
P5 also counts tracks without income. Say so in the subtitle or align the two.

**15. Note (environment, not a product defect).** One page load returned 500: `ENOENT …/packages/frontend/dist/index.html`.
The QA member's concurrent `npm run e2e` rebuilt the shared `dist` at 07:50, while my stand served from it. A rerun
passed. Parallel council stands share one `dist`; a separate `outDir` per stand would avoid this.

## Recommendations for stages 4–6

1. Stage 4 (real data): fix findings 2 and 3 before the walk. On real data the UUIDs and the truncated operations rows
   will appear on every page (2,371 payouts, 507 shortfalls).
2. Fix finding 1: OK disabled until `uses` answers. Turn finding 6 into one rule: every confirmation of an action that
   moves money states the amount, from the API.
3. Add the participant to the P21 `unfunded` rows (finding 4), and the missing resolution labels to P18. A
   dictionary test against the shared resolution enum would keep them in step.
4. Render the history tab as «когда (local time) · кто · что сделано» from the method and path, with the body fields
   translated.
5. Stage 6: decide open point 5 (a dry-run date in the dialogs) and the label month total (finding 13). Update 19 §6
   file names.
