# Frontend goal: final report (2026-11-03)

Goal (`notes/goal_prompt_frontend.md`): the operator's workplace at the level of zero-erp: every question of the label's
operator answered on a screen and every unblocking action taken there, without SQL or scripts; the numbers on the
screen equal the API to the cent. Six stages, each accepted by a council of three independent read-only reviewers
(`docs/agents/reviews/frontend_stage{1,2,3,6}_*.md`, the stage 4 walk in `frontend_stage4_walk.md`). Branch
`feature/fable-001`, HEAD after D-153; nothing pushed. This file says what is closed, what is open, and which
assumptions the screens depend on.

## 1. What was built (closed)

- **The design, before the code** (stage 1–2, D-139): the operator's jobs by cadence with every C reason and signal
  mapped to its action (`16_frontend_jobs.md`), the model of 21 pages in one sentence each with the rules R1–R8 and
  their machine checks (`17_frontend_model.md`), the plan (`18_frontend_plan.md`), and 37 golden screens with the
  exact numbers before and after each action, derived from the golden cases G01–G49 (`19_golden_screens.md`).
- **The stack** (D-139, D-144): React 19 + Vite 8 + TypeScript, HeroUI 3.2.7 on Tailwind 4.3.4, TanStack Query 5,
  AG Grid Community 36, Heroicons, Playwright 1.64; every version pinned exactly; no Refine, three.js, charts, i18next.
  The old pages (D-007, D-062) are removed.
- **The rules, checked by machine** (`17` §1): the frontend computes nothing (an eslint block bans every conversion
  and arithmetic on money; the one formatter is `lib/money.ts`; money sorts with `compareDecimal` on the strings);
  one money call per screen (`expectMoneyCalls(page, 1)` in the specs of every money page; no server-side cache,
  D-012 stands); keys are ISRC and UPC (`tests/routes-no-names.test.ts`); the backend decides (the payout gate is
  the field `balance.payout` computed by the same helper as the button, D-142); every write carries `X-Operator`
  and is recorded by the `audit` module (D-140; the history tabs show the trail); every response is parsed with its
  `@erp/shared` schema (`tests/no-dto.test.ts`); privacy (`tests/privacy.test.ts` over the sources, the specs and
  the seed).
- **The backend, only what the screens needed** (D-140 … D-143, D-150): the operator trace, the C queue as an
  aggregation of the same C items `reconcile()` counts (`GET /queue/:reason`), the overview in one calculation
  (`GET /overview`), the owners' payables with the gate (`GET /owners/payables`), the money of a track by month with
  the layer states and the breakdown of a month, the releases, the uses of a document, the search (`pg_trgm`), the
  duplicate pseudonyms, the list filters, the signals with counts and limits; 63 operations in `operations.ts`, each
  with a schema, a contract-test call and a D-entry; no money rule (D-123 … D-138) changed (the only change under
  `facade/layers/` is the shape of a shortfall signal, which gained `salesMonth` in D-152: no amount, condition or
  order; `ownerBalance()` and `reconcile()` are pinned by the golden tests, +G48, G49).
- **The 21 pages** (D-144 … D-149, D-151): Обзор, Очередь ожидания (C), Сигналы, Решения руководителя, Треки, Трек,
  Релизы, Релиз, Владельцы (with the payouts view), Владелец, Псевдонимы and Псевдоним, Документы and Документ,
  Сплиты, Участия, Лейблы, Паблишинг, Отчёты and the lines, Операции; one question per page
  (`packages/frontend/CLAUDE.md`), the same components everywhere, every irreversible action behind a confirmation
  that states what changes, Russian labels and API errors, the drill-down from an overview cell to the document.
- **Every operation has a screen or a refusal** (`src/api/coverage.ts`, `tests/coverage.test.ts`): 60 operations on
  a page, 3 refused with a reason (`GET /health` a liveness probe; `GET /reconciliation` superseded by `/overview`;
  `GET /tracks/:isrc/explain` superseded by `/money` and `/breakdown/:month`, kept for API users).
- **Every C reason and every signal has an action** (`action-table.ts`, `tests/actions-table.test.ts`; `16` §2.6–2.7):
  10 reasons (8 with a dialog, `no_isrc` read-only with ⚠ D-035, `assumption` with the replace wizard), 11 signal
  lists (10 with an action, `twoRowsOneOwner` information with links).
- **Every open item of `15` §3 is visible**: the 14 items are `OPEN_QUESTIONS` of `@erp/shared` (P3 Решения
  руководителя, each linked to the queue reason, the signal list or the owners that hold its money;
  `tests/open-questions.test.ts` pins the ids).
- **The e2e harness** (D-144, D-151): `npm run e2e` creates private PostgreSQL and ClickHouse stores, seeds the 37
  scenarios through the facade (`scripts/e2e/seed.ts`, self-checked by `verify-seed.ts`: 131 PASS), builds and serves
  the client with the API on `:3100`, runs 20 spec files in a fixed order and drops the stores: **132 tests, 0 skipped,
  about 2.7 minutes**, identical on two consecutive runs (the stage 6 QA verdict; the stage 3 QA measured 130 with 1 skipped before the stage 5 rework). The dev database `erp` is never touched.
- **Verification on the real data** (stage 4, `reviews/frontend_stage4_walk.md`, GET only): 0 mismatches between the
  screen and the API on 10 tracks × 4 totals, 10 owners × 8 balance fields, all 1,151 rows of the owners list, 54
  overview rows × 7 cells, 6 queue totals, 11 signal counts, 14 open questions; 0 dead ends; 0 console errors; every
  job of `16` §2 has its page and control.

## 2. The numbers on the real data (stage 4)

**Tracks** (`/tracks/<isrc>`, the 10 of `14` §3.2; the screen's `title` = `GET /tracks/<isrc>/money`):

| ISRC | Screen = API: net | B | C | ours | `14` ERP net | Why they differ |
|---|---:|---:|---:|---:|---:|---|
| FRX282403913 | 101,759.08 | 48,827.60 | −1.64 | 52,933.12 | 101,760.72 | `14`'s "ERP net" is B + ours; the screen net includes C (the Duetti buyer's share of negative lines after the sale, `owner_unconfirmed`) |
| FR96X2414092 | 53,147.01 | 24,518.34 | −2.45 | 28,631.12 | 53,149.46 | same |
| DGA052458596 | 54,033.35 | 26,004.11 | −2.70 | 28,031.94 | 54,036.05 | same |
| DGA052458597 | 35,709.52 | 17,201.07 | −0.56 | 18,509.01 | 35,710.08 | same |
| FRX282403914 | 32,255.75 | 15,239.09 | −81.81 | 17,098.47 | 32,337.56 | same |
| FRX452444855 | 27,356.06 | 13,200.08 | −0.65 | 14,156.64 | 27,356.71 | same |
| FR2X42478250 | 36,693.69 | 18,346.85 | 0.00 | 18,346.85 | 36,693.69 | equal |
| FRX872563577 | 17,094.40 | 5,673.84 | −128.10 | 11,548.66 | 17,222.50 | same as the first |
| FRX452444856 | 20,826.63 | 9,710.69 | −2.48 | 11,118.41 | 20,829.11 | same |
| FRX872449088 | 20,429.25 | 9,619.71 | −1.09 | 10,810.64 | 20,430.34 | same |

`ours` equals the "Σ diff ERP − Annex" of `14` §3.2 on 9 of the 10 (Annex excludes the Duetti ISRC); the rules tab
shows the same rows and periods as the "ERP rule in force" column on all 10; an expanded month shows every
allocation to 12 decimals equal to the API.

**Owners** (`/owners/<id>`, the 10 of `14` §4.2 by id prefix; the screen's `title` = `GET /owners/:id/balance`):

| Owner | Stage name | Payable (screen = API) | Shown / gate | `14` payable (run 2) | Δ and why |
|---|---|---:|---|---:|---|
| 68583cad | LDRR | −196,989.01 | 0,00 / nothing_to_pay | −326,645.18 | +129,656.17 = 137,982.02 (D-137) − 8,325.86 (D-138) |
| 7c6a567e | settlement participant | 1,865.47 | 1 865,47 / allowed | 139,847.50 | −137,982.03 (D-137) |
| 9670a62d | RD12 | −104,436.58 | 0,00 / nothing_to_pay | −104,573.15 | +136.57 (D-138) |
| 14b5366d | UdieNnx | −65,411.67 | 0,00 / nothing_to_pay | −63,726.49 | −1,685.18 (D-137 carve take, `14` §9.3) |
| 0637477b | DJ DYLANFK | −141,428.96 | 0,00 / nothing_to_pay | −110,784.68 | −30,644.28 (the carve take named in `14` §9.2) |
| aba9837e | MC CODE (+7) | −91,358.81 | 0,00 / nothing_to_pay | −88,183.86 | −3,174.95 (D-137 carve participations in C) |
| 6d814d51 | DJ-JY12 | −80,174.52 | 0,00 / owner_not_confirmed | −80,174.52 | 0 |
| bcf3c25f | Lxzt | 12,593.66 | 12 593,66 / allowed | 12,593.66 | 0 |
| 3fecfb7a | DJ MH | −48,664.84 | 0,00 / nothing_to_pay | −48,464.68 | −200.16 (E2 carve, D-137) |
| 9272ef5f | qaraqshy | 26,768.63 | 26 768,63 / allowed | 26,768.63 | 0 |

`14` §4.2 was measured before D-137 / D-138; the three changed figures reconcile to the cent with the documented
changes. A negative payable shows 0,00 with the red banner and the exact value in `title`.

**The queue and the signals** (screen = `GET /overview` and `GET /signals`): owner_unconfirmed 1,114,884.25 (545
groups), split_unconfirmed 454,219.20, publishing_terms_unconfirmed 325,405.99, assumption 144,195.41,
artist_without_owner 5,296.64, no_isrc 2,364.33; signals isrcsWithoutSplit 2,500, twoRowsOneOwner 785, unfunded 507,
unallocated 394 (all without ISRC), assumptions 45, tracksWithNote 11, sublabelWithoutRule 10,
participantsWithoutOwner 3, the other three 0. The four reasons and three signal lists that are 0 on the real data
(`label_unmapped`, `rule_unconfirmed`, `unknown_pair`, `writer_unmapped`; `labelUnmapped`, `ruleRecipientIsRow`,
`ambiguousWriters`) are exercised only by the golden screens (S16, S17, S20, S32, S19, S35).

## 3. Performance (real data, 721,975 units, one operator)

| Page | Money call | Time to first byte |
|---|---|---|
| Обзор | `GET /overview` | 9.7–11.8 s (one calculation instead of two: the old page cost 16–20 s, `16` §4.2) |
| Очередь, Сигналы | `GET /queue/:reason`, `GET /signals` | 7.4–8.5 s |
| Владелец | `GET /owners/:id/balance` | 6.4–7.0 s |
| Владельцы | `GET /owners/payables` | 9.5 s (1,151 balances from one calculation) |
| Трек | `GET /tracks/:isrc/money` | about 8 s; a track with 702 month rows renders in 8.5 s |
| Релизы | `GET /releases` | 1.2 s (15 s before D-150; no calculation) |
| Reference pages, search, lines by ISRC | lists | 5–200 ms |

The goal accepts 7–10 s per recalculation; every money page shows "идёт пересчёт" without blocking the shell, keeps
the previous numbers with a stale badge while refetching, and asks the API once per load. The synchronous layer fold
(about 4 s) still serialises concurrent money calls (D-139 assumption A2; a `setImmediate` yield every 50,000 units
is in place at no cost, D-142).

## 4. Open (not code gaps; for the product owner or a later goal)

1. **What the screens cannot decide for the owner**: the ⚠ decisions (D-035 lines without ISRC, D-041 a second B17
   statement, D-083 holder merge, D-087 writer shares, D-045, D-096) are shown read-only with their id on the queue,
   the signals and Решения руководителя; the 14 items of `15` §3 stay open there.
2. **Not modelled, as the goal says**: ads (M21), the payout side (threshold rules beyond the one gate, fees, taxes,
   payment-tool readiness, M23 / M30 / M31), artist statements by mail, analytics beyond the lines facets, charts,
   authentication and roles (the operator field is a trace, not a login: anyone with the URL can write).
3. **A second identical split change is accepted** by the backend (an empty-period split plus an identical one; the
   money is unchanged); a `split_unchanged` refusal is a product decision (A9 of `18` §6).
4. **Two dialogs exist twice** (map writer in the queue and on Паблишинг; attach file on Документы and the owner
   card) because their fields and follow-ups differ; `GET /owners` and `GET /tracks` are still pulled whole for
   name lookups (26 k tracks for the note dialog); `/dev/states` ships in the bundle (the e2e state checks run on it).
5. **The dev server** (`vite.config.ts`, from the initial commit) exposes `host: true` and an external host name:
   with no authentication the write API is reachable through it; the owner should know before a real-data session
   runs through that host.
6. **Documentation figures**: `14` §3.2 "ERP net" means B + ours; the screen's net is the raw net (§2).
7. **Memory under concurrent money calls** (stage 6 product verdict): ten track-money calls fired at once on the
   real data crashed the API with "JavaScript heap out of memory"; the assumption A2 (one operator, calls serialised
   by the CPU) holds for time, not for memory. Before a second operator or a script hammers the API: cap the
   concurrent calculations in the server (a queue of one) or raise the Node heap; a decision for the next goal.
8. **UI polish left** (stage 6 product and QA notes; the row re-measure the product asked for is done after the
   verdict: `DataGrid` resets the row heights when the operator name or the rows change): ISRC/UPC on the unfunded list, «Месяцы» on the queue and «Выплачено» on the
   payouts view can still truncate at narrow widths; the confirm-split and close dialogs state no amount; the
   overview and the track months are listed oldest first; no extra mark on a very large payout.

## 5. Assumptions the screens depend on (each marked "допущение" in its D-entry; the ones first recorded without the mark in D-143, D-146, D-147 and D-150 are marked by D-153)

| # | Assumption | D-entry |
|---|---|---|
| A1 | One operator role; the trace is a typed name sent as `X-Operator`, required on every write | D-140 |
| A2 | The synchronous 4 s fold is accepted; `calculatedAt` and "идёт пересчёт" make it visible | D-139, D-142 |
| A3 | The open-question list is data in `@erp/shared` kept by hand from `15` §3, with a test on the ids | D-143 |
| A4 | Every list is client-side in AG Grid (the largest is 26 k tracks, loaded once); only the source lines page on the server | D-144 |
| A5 | The payout confirmation shows the balance the page holds and its gate; the backend recalculates at the press | D-147 |
| A6 | `/documents` and `/settlements/operations` keep their array shape with filters | D-143 |
| A7 | Money text: `Intl.NumberFormat('ru-RU')` on the decimal string, two decimals half-expand, the exact string in `title` | D-144 |
| A8 | The e2e seed gives every golden case its own Believe account and ISRC range; `PAYOUT_THRESHOLD_CENTS=0` on the e2e stand | D-144 |
| A9 | An identical split change is accepted by the backend today | D-146 |
| A10 | An audit record that fails after a committed write is logged and the write answers 2xx with `X-Audit: failed`; the client shows a warning toast | D-150, D-153 |

## 6. The definition of done at HEAD

`npm run typecheck`, `npm run lint` (the widened R1 rules, `no-floating-promises`), `REQUIRE_STACK=1 npm test`
(406 backend tests in 38 files; 65 frontend vitest tests: the guards and the helpers), `npm run build:client`, `npm run e2e` (132 passed,
0 skipped). Decisions D-139 … D-153 in `docs/97_принятые_решения.md`, indexed in `03_decision_index.md`; the
guides `01`, `04`, `05`, the README of `docs/agents`, root `CLAUDE.md` and `packages/frontend/CLAUDE.md` refreshed.

## 7. Where everything is

- Design and plan: `16_frontend_jobs.md`, `17_frontend_model.md`, `18_frontend_plan.md`, `19_golden_screens.md`.
- Code: `packages/frontend/src/{pages,components,api,i18n,lib,routes}`; the backend additions in
  `packages/backend/src/{modules/audit,facade/{queue,aggregates,payout-gate,search,audit,period}.ts,api/audit.ts}`;
  the seed `packages/backend/scripts/e2e/`; the specs `packages/frontend/e2e/`.
- Verdicts: `reviews/frontend_stage{1,2,3,6}_{architect,product,qa}.md`, the walk `reviews/frontend_stage4_walk.md`.
- Decisions: D-139 … D-153.

## 8. Evidence: every C reason, every signal and every item of `15` §3 closed by an action on the screen

The actions below are performed THROUGH THE INTERFACE by the Playwright specs on the seeded golden screens (the test
names are the `test(...)` titles of `packages/frontend/e2e/golden/`), and the numbers before and after each one are
asserted as exact strings. On the real data the same controls exist (stage 4 walk §E); they are not pressed there
because the dev database is read-only for agents.

| C reason | Action on the screen | Spec test | Before → after |
|---|---|---|---|
| `owner_unconfirmed` | create and approve a contract document, create the contract | `20-queue` "S14 owner_unconfirmed → contract with a new approved document" | C 50 → B 50, gate allowed |
| `split_unconfirmed` | create and approve a document, confirm the split | `20-queue` "S12 split_unconfirmed → create and approve a document, confirm the split" | 100/50/5/45 → 100/55/0/45 |
| `publishing_terms_unconfirmed` | set the terms of the owner | `20-queue` "S18 publishing_terms_unconfirmed → terms of W3 from 2020-01-01" | W3 C 50 → B 50 |
| `assumption` | replace the row's assumption document by a real one (split change from a month) | `20-queue` "S13 assumption on a row → replace by a document from 2026-03" | L 20 C → B from 2026-03 |
| `artist_without_owner` | assign an owner to the pseudonym | `20-queue` "S15 artist_without_owner → assign the owner" | C 50 → B 50 |
| `label_unmapped` | alias of an own label; or a sublabel with a rule | `20-queue` "S16 label_unmapped → alias of 0to8", "S17 … sublabel of 0to8 with a rule 50 → NG-171" | ours C 50 → ours 50; → NG 25 |
| `rule_unconfirmed` | approve the rule's document | `20-queue` "S32 rule_unconfirmed → approve the rule document" | P 5 C → B |
| `unknown_pair` | register the track (ISRC + UPC) | `21-signals` "S20 unallocated: the pair with ISRC → register the track" | C 7 → ours 7 |
| `writer_unmapped` | map the writer to an owner | `20-queue` "S19 writer_unmapped → map the ambiguous holder to W4a" | b17 C 100 → B 50, ours 50 |
| `no_isrc` | none: read-only with ⚠ D-035 (the owner's decision) | `20-queue` "S20 perimeter: … no_isrc is read-only (⚠ D-035)" | stays C 2 |

| Signal | Action on the screen | Spec test |
|---|---|---|
| `unallocated` | register the track / read-only without ISRC | `21-signals` S20 |
| `isrcsWithoutSplit` | create the split | `22-duplicates` "S30 create the split DUP-301 50 % from the candidate" (the same dialog as the list's `action-create-split`) |
| `ambiguousWriters` | map the writer | `20-queue` S19 (the P18 dialog: `15-publishing` "the map dialog opens…") |
| `unfunded` | close the participation and re-create it | `21-signals` "S21 unfunded → close the participation at 2026-03 and re-create it at 10 %" |
| `labelUnmapped` | alias or sublabel rule | `20-queue` S16, S17 |
| `sublabelWithoutRule` | set the rule | `29-labels` S37 (the rule dialog) and `21-signals` S35/1 (the row and the action) |
| `ruleRecipientIsRow` | change the split or close the rule | `21-signals` S35/1 (the row), `29-labels` "S37 close the rule at 2026-04-01" |
| `twoRowsOneOwner` | information with links | `21-signals` S35/2 |
| `tracksWithNote` | set / clear the note | `21-signals` "S35/3 a track note: set it, clear it" |
| `participantsWithoutOwner` | assign an owner | `21-signals` "S35/4 a participant without an owner → assign Owner P-354" |
| `assumptions` | replace by a document | `20-queue` S13 (the wizard), `14-documents` "P14 an assumption document: the note, the wizard link" |

| `15` §3 item | On the screen | Closed by |
|---|---|---|
| 1 B17 holders vs stage-name owners | queue `owner_unconfirmed` (holder owners), P3 15.3.1 | the contract or merge action (S14, S33); the merge of a holder into a legacy owner is ⚠ D-083 |
| 2 documents the owner owes | queue `split_unconfirmed` / `assumption` by owner, P3 15.3.2 | document + confirm split (S12), replace (S13) |
| 3 ambiguous pseudonyms | Псевдонимы → дубликаты, P3 15.3.3 | assign owner, create the split per ISRC (S30) |
| 4 imprint list (Q12) | queue `assumption` (rule documents), Лейблы, P3 15.3.4 | replace the rule's document (close + re-create) or alias (S16, S17) |
| 5 Main carve pairs | queue `assumption` (participation documents), P3 15.3.5 | replace (close + re-create the participation with the document) |
| 6 sublabel money in C | queue `owner_unconfirmed` (sublabel owners), `assumption`, P3 15.3.6 | contract for the sublabel owner (S14 pattern), replace |
| 7 buy-outs (M51 …) | P3 15.3.7, the rules tab of the tracks | an owner's decision: entered as a split change / buy-out when it comes (S25) |
| 8 Updated Q2 statement, D-087, D-045, D-096 | P3 15.3.8 (⚠) | the owner's decisions; no screen action by design |
| 9 77 Records exception (M58) | P3 15.3.9 (⚠) | not expressible; no screen action by design |
| 10 unexplained owner balances | Владельцы with payable, the negative-payable banner, P3 15.3.10 | operations (deduction / credit / return, S31) when the owner decides |
| 11 no-split money (C11) | signal `isrcsWithoutSplit`, P3 15.3.11 | create the split (S30) or a "fully ours" decision ⚠ |
| 12 administration terms from 2026-01 | queue `publishing_terms_unconfirmed`, P3 15.3.12 | set the terms (S18) |
| 13 licensor terms (MC ROBA CENA row) | queue `assumption` (that row's document), P3 15.3.13 | replace (S13) |
| 14 the 165.80 after the buy-out | P3 15.3.14 | the owner's check; no screen action by design |

Items 7, 8, 9 and 14 wait for the owner's decision and show their decision id; every other item has its action.
