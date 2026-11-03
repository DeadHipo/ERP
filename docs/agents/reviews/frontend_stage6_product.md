Verdict: yes

# Frontend goal, stage 6: product review of completeness and the final report (D-139 … D-152)

Product member of the stage 6 council, 2026-11-03, branch `feature/fable-001`, HEAD `12e6e08`. Read-only on the repo;
this file is the only one I wrote. Owners are named by id prefix and stage name only.

The workplace meets the "Готово" conditions from the operator's side:
- Every number I compared on screen equals the API, as a string.
- Every C reason and every signal has its control.
- Each of the 14 items of `15` §3 has its place on a screen.
- All 15 actions I performed through the UI moved the numbers exactly as `19` says.
- The three questions of the goal are answered on one screen each.

The verdict is **no** for one reason only: report `20` contains a false statement (finding 1). It is a one-line
correction. No screen, number or action blocks acceptance. Once that line is corrected, my verdict is yes.
Finding 2 (overlapping action buttons) is the one UI defect I would fix before the operator's first session.

## What I ran

- **Real data, read-only.** `npm run build -w @erp/frontend` rebuilt `dist` at HEAD. Nothing was listening on :3050
  when I started, so I started the API myself: `PORT=3050 npx tsx packages/backend/src/main.ts data/real` against
  the dev database `erp`. Startup writes nothing.
- **Playwright** (chromium, 1440×900) through throw-away scripts in the scratchpad. The operator field stayed empty.
  I opened no dialog and confirmed nothing. Every script recorded the non-GET requests it sent: 0 in all five runs.
- **The API side** came from `curl` on the same endpoints: 10 × `GET /tracks/<isrc>/money`, 10 ×
  `GET /owners/:id/balance`, `GET /owners/payables`.
  - My first run sent 10 track calls in parallel. That run killed the API with "JavaScript heap out of memory"
    (finding 4). I restarted the API on :3050 and ran the calls one after another.
  - :3050 is left running (my restart, same command).
- **My own stand.**
  - `seed.ts council6p`, then the API on :3160 with `PAYOUT_THRESHOLD_CENTS=0`, operator `council-product`.
  - A Playwright test file in the scratchpad that imports `e2e/helpers.ts` (`E2E_KEYS=…/e2e-keys-council6p.json`).
  - I performed 15 actions through the UI. Each one was checked before and after against `19`.
  - `GET /audit` afterwards: 24 records, all by `council-product`.
- **Clean-up.** The :3160 process was killed (port free). `drop.ts council6p` printed "dropped erp_council6p,
  believe_council6p, believe_council6p_stage". No `council6p` files remain under `data/test-tmp`. :3050 is still
  running.

## Checks

| Condition | Evidence | Met |
|---|---|---|
| Tracks: screen = API (rows 1–10 of `14` §3.2) | 6 of 10 opened (FRX282403913, FR96X2414092, DGA052458596, FRX282403914, FR2X42478250, FRX872563577). The `title` of net / B / C / ours equals `/money` `totals` exactly. The API figures of all 10 equal the table in `20` §2 | yes |
| Track months | 205 / 201 / 187 / 208 / 702 / 46 rows, as in `20`. Expanding one row opens exactly one detail (F3 fixed) | yes |
| Owners: screen = API (rows 1–10 of `14` §4.2) | 8 of 10 opened (68583cad, 7c6a567e, 9670a62d, 14b5366d, 0637477b, aba9837e, bcf3c25f, 9272ef5f). 8 balance fields each are equal, and the gate equals `payout.reason`. The API figures of all 10 equal `20` §2 | yes |
| Owners list P9 = `GET /owners/payables` | 599 of 1,151 rows read from the grid (6 money columns): 0 mismatches. Payouts view: 201 candidates, the gate counts are 201 / 730 / 128 / 92 as in stage 4 | yes |
| Queue and signals = API | 6 reason totals on the P2 pages equal the `overview` strings (1,114,884.25 / 454,219.20 / 325,405.99 / 144,195.41 / 5,296.64 / 2,364.33). The 11 signal counts equal `20` §2. The four zero reasons and three zero lists show their empty state | yes |
| Every C reason and every signal leads to its control (real data) | Every control is present and disabled with «укажите оператора». `no_isrc` and `unallocated` are read-only ⚠ D-035; `twoRowsOneOwner` is information. `assumptions` links to the queue | yes |
| ≥10 actions on my stand = `19` | 15 actions, every P1 row and owner figure before and after as in `19`: S12, S13, S32, S14, S15, S16, S18, S19 (queue); S20, S21, S35/4 (signals); S37 (labels); S27 (track rules); S22 pay + proof (owner / operations); S33 merge | yes |
| `15` §3 items visible | P3 lists 15.3.1–15.3.14 with the ⚠ decision chips. The links go to the queue groups for 1, 2, 4, 5, 6, 12, 13, to the signal for 11 and to `/artists/duplicates` for 3; all open | yes |
| Jobs of `16` §2 have a screen | Stage 4 table re-walked on the pages it names; the same controls are present | yes |
| Q1 "whose is every dollar": P6 | Months by account, UPC, report month, sales month and label string. Expanding a month shows the allocations (pseudonym, owner, layer, kind, %, amount, category, C reason, document) and the layer table | yes |
| Q2 "what waits and why": P1, P2 | The P1 C cell → `/queue/<reason>?account&month` (group = cell, 0.365301035094) → track → expanded month → Правила tab. The stage 3 stand followed the chain to the document | yes |
| Q3 "how much today": P9, P10 | P9 payouts view sorted by payable with the gate chip. P10: the formula, «К выплате (показано)», the negative banner (68583cad: «показан 0. Точное значение: −196 989,01»), the gate, the button | yes |
| Report `20` faithful | The counts I checked hold (63 operations = OpenAPI paths, 60 + 3, 20 spec files, the figures of §2, the `/releases` time of 1.3 s). One claim is false: finding 1 | **no** |

## My stage 3 findings and the stage 4 should-fixes at HEAD

| Item | Status | Seen at HEAD |
|---|---|---|
| S3-1 approve dialog numbers change under the finger | fixed | At t=0 OK is disabled and no amount is shown. At 2.5 s: «ждёт этого документа: 0,00 · подтверждает: …», OK enabled. One remainder in note 7 |
| S3-2 raw ids and English codes | fixed | Shortfall: «Не хватило участнику P-038: корзины не хватает: 20,00». Blocking and pending: «2026-11-03 · выплата · 5,00: нет подтверждения выплаты». The S21 confirmation names «Appendix 211». P18: «сопоставлен по имени», «создан владелец (ждёт документов)». History: «03.11.2026 09:12 · council-product · выплата (кнопка)». P1: «Расчёт: 03.11.2026 09:06» |
| S3-3 truncated grids | partly | Money cells are fine everywhere. Still cut at 1440 px: P2 «Месяцы» («2025-06 – 2026-…»); the P21 `unfunded` ISRC, UPC, «Из чего», «Почему»; P9 owner names; P9 «Выплачено» off the right edge; the P10 Операции «Отменить» clipped; the P2 «Слить в другого владельца» clipped. See finding 2 for the overlap |
| S3-4 `unfunded` rows look like duplicates | fixed | The rows show the pseudonym (M1-092, M2-092, M3-092), the funding, the reason and «Месяц продаж» |
| S3-5 the dialog states the unfloored date | partly (by design) | S27 still says «действует до 2026-04-20 (не включая)». It now adds «сохранённая дата придёт в уведомлении», and the toast says «с 2026-04-01». S13 now states «новые строки действуют до 2026-05-01» (my note 8 fixed) |
| S3-6 money missing from irreversible dialogs | partly | Fixed for the merge («Переходят деньги: заработано 0,00, ждёт 50,00, к выплате 0,00») and the contract («ждёт подтверждения владельца (очередь): 50,00»). Still missing for the confirm-split (S12), the rule close (S37) and the participation close (S27) |
| F1 queue action cell | partly | One hint per page now. With the operator set, the two buttons of an owner row overlap the next row (finding 2) |
| F2 signal lists capped at 500 | fixed | `limit=5000` with client paging: «Записей: 507 / 2500 / 785», every row reachable |
| F3 twin month expansion | fixed | 205 rows; one expand gives one detail |
| F6 `/releases` 14.8 s | fixed | 1.32 s in the browser |

## Findings

**1. Blocker (report): `20` §1 states "the diff of `facade/layers/` is empty". It is not.** D-152 added `salesMonth`
to `Shortfall` in `facade/layers/{types,carve,off-the-top}.ts`. `git diff a00ea1a HEAD -- packages/backend/src/facade/layers`
shows 5 added lines. The change is additive: a diagnostic field, no money rule changed, and the golden tests still
pin `reconcile()` and `ownerBalance()`. So the substance ("no money rule changed") is true. The proof offered for
it is false, though, and the goal makes "денежные правила не трогать" a hard rule. A product owner reading the
report would believe the layer code is byte-identical.
- Fix: replace the parenthesis with "the only diff of `facade/layers/` is the additive `Shortfall.salesMonth` of
  D-152; no allocation changed".
- Optionally, D-152 should say the same in its decision text.

**2. Should-fix: grid rows do not re-measure when a cell's buttons change, so action buttons of two rows overlap.**
- Where:
  - P2 `/queue/owner_unconfirmed`, right after the operator field is filled. Row 1's «Слить в другого владельца»
    lies under row 2's «Создать договор».
  - The P10 Операции tab right after a payout. The payout row's second line («Возврат», «Отменить») lies under the
    advance row's «Отложить», «Отменить».
- On a fresh page load both grids lay out correctly. The real operator always has the field set and acts in place,
  so he will meet this state on every session.
- Two of the overlapped controls start irreversible flows (merge, deactivate). Their confirmations name the owner
  and the operation, so wrong money cannot move silently. Still, the wrong row's button is under the cursor.
- Fix: re-measure row heights when the operator or the row data changes (`resetRowHeights` or a fixed two-line
  action cell), and give the action column its full width.

**3. Should-fix (UI): key columns are still truncated where the page has room.**
- On P21 `unfunded`, ISRC and UPC are cut to «QZTST270…» and «27092000…». The ISRC is the key the operator copies.
- P2 «Месяцы» is cut, and «Что разблокирует» repeats the «Владелец» text on owner rows.
- In the P9 payouts view, «Выплачено» needs a horizontal scroll at 1440 px.

**4. Should-fix (robustness, missing from `20` §4): concurrent money calls can kill the API.**
- 10 parallel `GET /tracks/:isrc/money` on the real data (721,975 units) crashed the process with "Ineffective
  mark-compacts near heap limit … JavaScript heap out of memory". 10 balance calls in parallel before that
  survived.
- A2 says the fold "serialises concurrent money calls". That is true for the CPU but not for memory: each request
  holds its own snapshot.
- One operator with a few tabs is safe. A second user, a script or a burst of tabs is not, and the process does not
  restart itself.
- Fix: say it in `20` §4 and A2, and either cap concurrent calculations (a queue of one or two) or document
  `--max-old-space-size` in the run recipe.

**5. Note: the ordering of long money pages.**
- P1 lists 54 rows oldest first (2023-11 at the top).
- P6 of FRX282403913 starts with a 0,01 row of 2024-03.
- An operator's question is usually about the latest month or the largest amount. Default to the newest month on
  P1 and P6, or offer a sort by «Получено» on P6.

**6. Note: the layer table of P6 says "(B)" in the split layer for a share that the categorise layer turns into C.**
QZNWQ2295156 2023-12 shows «сплит … Skorde: 0,00 (B)» and «категории … Skorde: 0,00 (C)». This is correct per
layer, but an operator reads it as a contradiction. Label the split-layer mark as "по сплиту" rather than the
category.

**7. Note: inside a queue dialog, the approval of a freshly created document says «ждёт этого документа: 0,00 ·
подтверждает: … 0».**
- This is true, since nothing references the new document yet.
- The next confirmation (confirm split, S12) does not state the 50,00 that leaves C either.
- The contract dialog already states the queue amount; the confirm-split dialog should do the same.

**8. Note (stage 4 F13, F15 unchanged).**
- The first payout candidate pays 682,348.36 with one confirmation and no large-amount mark.
- P3 items 15.3.9, 15.3.10 and 15.3.14 open the unfiltered owner lists.
- Item 15.3.10 links to the payouts view, but the owner it names is one the label owes. A filter by owner id would
  make these items actionable.

**9. Note (walk environment).** The brief said :3050 was running; it was not. I started it with the documented
command.

## The report `20` as a product owner reads it

- **Faithful:** the stage 4 figures, the explanations of the three changed owner payables (D-137 / D-138), the
  "ERP net = B + ours" correction of `14`, the C-negative Duetti lines, the open list (⚠ decisions, not modelled,
  A9, the duplicated dialogs, the `host: true` dev server), the assumptions A1–A9.
- **Not faithful:** finding 1.
- **Missing from the open list:** findings 2 and 4.

Nothing in the report misstates money.

## Handover notes for the operator's first session

1. Fill the operator field before opening a work page, or reload the page after filling it (finding 2), until the
   row heights are fixed.
2. Open one money page at a time; wait for «идёт пересчёт» to clear. Each money call takes 7–12 s. Several parallel
   calculations can stop the server (finding 4).
3. The payable shown is 0,00 for a negative balance. The exact value is in the red banner and in the tooltip.
4. Read C by reason on P1 or P2 and act from the group row. `no_isrc` and the Q11 / R1 assumptions wait for the
   owner (⚠ D-035, D-123); P3 lists those decisions.
5. Every write is in the History tab of the entity, with the operator name. Nothing can be undone from the screen
   except the operation flags (deferred, return, deactivate).

## Revision 2 (HEAD `b426d6a`, after D-153)

I re-read `20` §1 and §4 at HEAD:
- **Finding 1 is fixed.** §1 now reads "the only change under `facade/layers/` is the shape of a shortfall signal,
  which gained `salesMonth` in D-152: no amount, condition or order". `git diff a00ea1a HEAD --stat --
  packages/backend/src/facade/layers` still shows only those 5 added lines in `types.ts`, `carve.ts` and
  `off-the-top.ts`, so the statement is now true.
- **Finding 4 is recorded** as open item 7 of §4. The item covers the out-of-memory crash under ten concurrent
  track-money calls and says that A2 holds for time, not memory. The cap or heap size is left as a decision for the
  next goal.
- **Findings 2, 3, 5 (ordering), 7 and 8 (large payout) are recorded** as open item 8 of §4. That covers the row
  re-measure, the truncated key columns, the dialogs without amounts, the oldest-first order and the large-payout
  mark. Each is described accurately.
- Findings 6 (the "(B)" mark of the split layer) and 9 (environment) are not in the report. Both are notes and do
  not affect acceptance.

I did not re-run the stands for this revision. D-153 changed the report, the assumption marks and a warning toast,
and no screen number I checked depends on them. The real-data and stand evidence above stands.

No "Готово" condition is unmet and report `20` makes no false claim, so my verdict is **yes**. Before the operator's
first session I still recommend fixing finding 2 (the grid row re-measure), since it puts the wrong row's button
under the cursor.
