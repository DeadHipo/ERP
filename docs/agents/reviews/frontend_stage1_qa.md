Verdict: yes

# Frontend stage 1 council: QA (2026-11-03)

Reviewer: QA member, independent, read-only. HEAD `a00ea1a` on `feature/fable-001`, database `erp`. Under review:
`docs/agents/16_frontend_jobs.md` (untracked). The only file this review writes is this one. The verdict uses stage
names, ISRC, owner id prefixes and amounts only.

Stage 1 is accepted: the volumes, timings, ignored parameters and page defects that stage 2 will build on reproduce,
with one exception: the size of the "unallocated pairs" signal is wrong (finding 1). It is a one-line fix and must be
corrected before `17_frontend_model.md` designs the unallocated / `no_isrc` action. No legal name, e-mail or owner
alias is in the document or its three source reports. One absolute path with the OS user name is in the document
(finding 2).

## What I ran

| Check | Result |
|---|---|
| `npm run typecheck` (backend, frontend, shared) | exit 0 |
| `npm run lint` | exit 0 |
| `npm run build:client` | exit 0 (315.86 kB JS, 2.66 kB CSS) |
| `git status --short` | `?? .claude/` and `?? docs/agents/16_frontend_jobs.md` only (`.claude/` was untracked before this stage) |
| API on side port 3019 (`main.ts data/real`), GET only | 10 list endpoints, reconciliation ×2, signals (default, `limit=20`, `limit=1`), one balance, one explain, the ignored-parameter probes |
| Page audit | read all 14 `.tsx` files of `packages/frontend/src` and `api/client.ts`; grep for `slice(0`, `Number(`, `force`, `confirm`, `approve` |
| Golden seeding | read `tests/helpers/{sources-stack,fixtures,test-sources}.ts` and `tests/golden.test.ts` |
| Privacy | grep of the document and the three source reports for e-mails and user paths; every owner name and alias of `GET /owners` (≥ 5 characters, not equal to a pseudonym) and every surname-like token of them matched against the four files, output hashed |
| Side server | stopped (pid listening on 3019 killed; `lsof -i :3019` empty). `npm test` not run (by instruction) |

## Reproduced numbers (16 §4)

| Fact | Documented | Measured | Δ |
|---|---|---|---|
| Owners; person / label; confirmed / waiting | 1,151; 1,134 / 17; 421 / 730 | 1,151; 1,134 / 17; 421 / 730 | — |
| Artists; no owner / unconfirmed / confirmed | 2,134; 990 / 726 / 418 | same | — |
| Tracks; distinct UPC; max tracks per UPC | 26,305; 11,089; 60 | same | — |
| Splits (`total`); participations | 24,107; 283 | 24,107; 283 | — |
| Labels own / sublabel; aliases; rules | 2 / 15; 25; 16 | same | — |
| Documents by kind (8 kinds, assumption 45 all `not_approved`) | 813/158/158/104/63/45/37/19 | same | — |
| Operations; payout / recoupable / deduction (inactive) | 2,662; 2,400 / 158 / 104 (55) | same | — |
| Believe files (all `loaded`); lines; B17 statements | 47; 75.7 M; 6 | 47; 75,744,752; 6 | — |
| Writers | 47 | 47 | — |
| `operations.ts` entries | 51 | 51 (OpenAPI 51) | — |
| Reconciliation rows; time; size | 52; 7.8–8.2 s; 27 KB | 52; 7.67 s and 7.60 s; 27,341 B | — |
| `GET /signals?limit=20` time; size | 8.4 s; 221 KB | 8.44 s; 221,078 B | — |
| Signals counts (except below) | isrcsWithoutSplit 2,500; unfunded 507; twoRowsOneOwner 785; assumptions 45; tracksWithNote 11; sublabelWithoutRule 10; participantsWithoutOwner 3; labelUnmapped 0; ambiguousWriters 0 | same; plus `ruleRecipientIsRow` 0 (an 11th list) | note (7) |
| **Unallocated pairs** | **4** | **394** (`count`), all with an empty ISRC, net 2,364.33; 0 pairs with an ISRC | **finding 1** |
| `signals?limit=1` | limit caps 2 lists | `unallocated.pairs` 1, `isrcsWithoutSplit.items` 1; unfunded 507, twoRowsOneOwner 785 whole | — |
| `GET /owners/1253f57e…/balance` (owner with the most payouts) | 6.8–7.7 s; 5–48 KB | 6.39 s; 4,174 B | note (5) |
| `GET /tracks/AEA2L2172216/explain` (first ISRC of `/splits?limit=5`) | 6.9 s; 4.8–15.6 MB | 6.17 s; **251,200 B** (units 47 %, breakdown 53 %) | note (5) |
| `/splits?limit=5&offset=10` vs `offset=0` | offset ignored | identical 5 ids | — |
| `/participations?limit=5` | limit ignored | 283 items | — |
| `/tracks?isrc=X` | ignored, 3.4 MB | 26,305 rows, 3,436,005 B | — |
| List endpoints | 0.02–0.3 s | 0.002–0.23 s | — |
| C on real data by reason (2024-01…2026-08, both sources) | not stated | owner_unconfirmed 1,114,882.67; split_unconfirmed 454,219.01; publishing_terms_unconfirmed 325,405.99; assumption 144,195.41; artist_without_owner 5,296.64; no_isrc 2,362.68; the other 4 reasons 0 | note (8) |

## Page audit (16 §4.3, §6)

| Claim | Evidence | Holds |
|---|---|---|
| Owners, Documents, Settlements cut at 300 | `OwnersPage.tsx:62`, `DocumentsPage.tsx:73`, `SettlementsPage.tsx:116` `.slice(0, 300)` | yes |
| Splits "first 100" | `SplitsPage.tsx:17` sends `limit: '100'` to the API: a server limit, not a client cut | yes, wording (finding 4) |
| Balance tracks first 50 | `OwnerBalancePage.tsx:119` (and publishing `:133`) `.slice(0, 50)` | yes |
| Pseudonym selects "of 2,000" | `LabelsPage.tsx:114`, `SplitsPage.tsx:75`, `ParticipationsPage.tsx:48` `.slice(0, 2000)` of 2,134 | yes, and it hides 134 pseudonyms (finding 4) |
| `Number` compare on money in two places | `OwnerBalancePage.tsx:79`, `:83` `Number(b.total.payable) < 0.01` | yes; more uses not listed (finding 3) |
| Percent arithmetic with `Number` | `SplitsPage.tsx:25` | yes |
| No confirmation anywhere | no `confirm`/dialog in `src`; payout (`OwnerBalancePage.tsx:79`), approve, close rule, close participation fire directly | yes |
| Approve shown for `assumption` | `DocumentsPage.tsx:91` shows Approve for every `not_approved`; all 45 assumption documents are `not_approved` | yes |
| `force: true` on artist creation | `OwnerPage.tsx:18` | yes (owner creation uses `force` only after the duplicate warning) |
| Blocking computed client-side | `SettlementsPage.tsx:51` | yes |
| "five stacked forms" on Labels | `LabelsPage.tsx:67, 87, 101, 142`: four forms | no, minor (finding 6) |
| 11 routes, 2,341 lines | `App.tsx` 11 routes; `src` 2,341 lines | yes |

## Findings

1. **should-fix (fix before stage 2 uses it): the unallocated signal is 394 UPC-only pairs, not 4 pairs.**
   `GET /signals` returns `unallocated.count` 394, `total` = `withoutIsrc` = 2,364.33, and every pair has
   `isrc: ''` (the route sets `count` from the full list, `routes/reports.ts:17-22`). There is no pair with an ISRC
   and C `unknown_pair` is 0 on the real data. 16 §2.2 maps `unallocated.pairs` to C `unknown_pair` with the action
   "add the track (ISRC + UPC)", which no real row can take: the money is C `no_isrc` (2,362.68). Stage 2 must define
   the `no_isrc` action (a UPC with no ISRC in the report; the 15 §3 items say what the owner decided, if anything)
   and size that list at ~400 rows with paging. Not a blocker because the fix is one line and §4.5 (b) already keys
   `unknown_pair / no_isrc` by pair; it is a blocker for stage 2 if left.
2. **should-fix (privacy hygiene): an absolute path with the OS user name in a repo document.** 16 §5 line 202 names
   `/Users/<user>/Desktop/0to8/zero-erp/apps/frontend`. No other file under `docs/` carries a `/Users/` path. Write it
   as `../zero-erp/apps/frontend` (sibling of the repo). The source reports carry such paths too, but they stay in the
   scratchpad. Separately, `GET /sources/files` sends `storedPath` with the same absolute path to the client
   (16 §4.5 mentions it); the new screens must not show or log it.
3. **note: money arithmetic in the current pages is wider than 16 §6 says.** Beyond the two `Number` compares:
   `(o.amountCents / 100).toFixed(2)` in `SettlementsPage.tsx:122` and `OwnerBalancePage.tsx:20`; `Number(v).toFixed(2)`
   on C amounts in `SourcesPage.tsx:96, 119`; the `Money` component itself parses with `Number` (`ui.tsx:47`,
   `SourceLinesPage.tsx:47`). The pages are to be replaced (§7.5), so this only matters as a rule for stage 2: a lint
   rule or test that bans `Number(`, `parseFloat` and `/ 100` on money fields in `packages/frontend` (the backend has
   `rules-coverage.test.ts`; the frontend has nothing).
4. **note: the list cuts.** The Splits 100 is a server `limit` (the API honours `limit`, ignores `offset`), so the
   client-side cuts are 300 / 50 / 2,000. The 2,000 cut on pseudonym selects is a functional bug, not only a size
   problem: 134 pseudonyms cannot be chosen in the Labels, Splits and Participations forms.
5. **note: explain and balance sizes are ranges of heavy samples.** A one-split ISRC explain is 0.25 MB in 6.2 s; the
   4.8–15.6 MB range is for heavy tracks (the sample in the audit report). The balance of the owner with the most
   payouts is 4.2 KB with payable **+884.08**, so "both sampled owners have a negative payable" (§4.5) must not be read
   as the typical case. Both facts still support §7.1: the cost is the 7 s recalculation, not the size.
6. **note: Labels has four forms, not five** (create label, alias, rule, close rule).
7. **note: signals have 11 lists, not 10.** `ruleRecipientIsRow` (0 on the real data) is missing from §4.1, and
   `limit` leaves 9 of 11 lists whole (default limit 100). Stage 2's "every signal has an action" list must include it
   (G21b covers it in the golden suite).
8. **note (testability): what 16 gives stage 2 and what it does not.** It gives the volumes (§4.1), the timings
   (§4.2), the jobs per cadence with the object or signal per job (§2), the gaps (§4.5) and the operations without a
   page (§4.4). It does not give, and stage 2 must: (a) one table *C reason → acting entity → action → endpoint →
   confirmation?* for all 10 reasons, and *signal → action* for all 11 signals (§7.2 is a sentence; `unfunded`,
   `twoRowsOneOwner`, `tracksWithNote`, `ruleRecipientIsRow` have no action anywhere in 16); (b) which reasons exist
   on the real data (6 of 10, table above): `label_unmapped`, `unknown_pair`, `writer_unmapped`, `rule_unconfirmed`
   can only be tested on synthetic golden data, so the real-data pass of stage 4 cannot close them; (c) the list of
   irreversible actions that get a confirmation dialog, named per endpoint (approve, payout, close rule, close
   participation, merge owners, buy-out, deactivate / return operation, writer resolve); (d) the empty / long / error
   state per page.
9. **note (golden screens): the golden cases cannot seed one shared e2e database as written.** Every case starts
   with `newFacade()`, which truncates every module table and empties the sources (`fixtures.ts:152-172`,
   `test-sources.ts`). The cases reuse the same ISRC (`I(1)` 205 times), UPC and months, and part of the seeding goes
   through `f.modules.*` directly (create artist, track, labels, aliases, publishing terms, track note), not the API.
   The helpers import vitest-only setup (`./stack`, `TMP`). What works: `createIsolatedSources()` already builds a
   private PostgreSQL database and private ClickHouse databases with the real migrations, and the API takes
   `DB_DATABASE` / `CLICKHOUSE_DATABASE` from the environment. So a golden screen can be: create a private database
   pair, seed **one** case with the `Case` code moved to a shared seed module, start `main.ts` on it, run the
   Playwright scenario, drop it; or a seed endpoint/script that resets and seeds one case between scenarios.
   ClickHouse needs both the main and the `_stage` database renamed, as `sources-stack.ts` does.

## What QA needs from stage 2

1. Finding 1 corrected in 16, and the `no_isrc` action defined in 17.
2. In 17: the reason → action and signal → action tables of finding 8 (a), the confirmation list (c), and the
   empty / long / error states (d) per page, including the 7–10 s "calculating" state that keeps navigation alive.
3. In 18: the e2e harness (finding 9): private database pair per run, one golden case per scenario, API started on
   it with `DB_DATABASE` / `CLICKHOUSE_DATABASE`, no sleeps, `data-testid` on rows and actions; a frontend money rule
   test (finding 3); a pseudonym and owner picker test with more than 2,000 entries (finding 4).
4. In 19: for each golden screen the case id (G01–G47, G26a–e), the expected numbers before and after the action as
   decimal strings from `12_golden_cases.md`, and the repeated-action expectation (a second approve, a second payout
   with payable 0, a close of a closed rule: the backend error shown, nothing changed).
5. Large-list scenarios on the real data: splits 24,107, tracks 26,305, operations 2,662, unallocated 394,
   twoRowsOneOwner 785, with server paging (offset fixed on `/splits`, limit on `/participations`, `isrc` on `/tracks`).

## Revision 2

I re-read revision 2 of `16_frontend_jobs.md` (380 lines), read-only and without the side server. **The verdict
stays yes.** Every finding is addressed:

| Finding | Where in revision 2 | Status |
|---|---|---|
| 1 unallocated = 394 UPC-only pairs, C `no_isrc` | §2.2, §2.6 (`no_isrc`: read-only, D-035 ⚠ with the decision id), §2.7, §4.1 | closed; D-035 is indeed ⚠ "lines without ISRC" in `03_decision_index.md` |
| 2 absolute user path; `storedPath` | §5 uses `../zero-erp/apps/frontend`; §4.5 and §6 say never show or log `storedPath` | closed: no `/Users/` and no user name left in the document |
| 3 money arithmetic | §4.3 lists `Number` compares, `amountCents / 100`, `toFixed`; §7.1 requires a frontend money rule test | closed |
| 4 list cuts | §4.3: Splits 100 is the server limit; selects cut at 2,000 of 2,134 | closed |
| 5 explain and balance ranges | §4.2: explain 0.25–15.6 MB, balance 4–48 KB; §4.5: +884.08 is the typical payable | closed |
| 6 Labels forms | four | closed |
| 7 11 signal lists incl. `ruleRecipientIsRow` | §4.1, §4.2, §2.7 | closed |
| 8 reason → action, signal → action, confirmations, states | §2.6 (10 reasons, 6 with money, 4 synthetic only), §2.7 (11 signals), §7.3, §7.5 | closed; 17 must still give the per-page states |
| 9 e2e seeding | §7.6: one private PostgreSQL + ClickHouse pair per run, shared seed module, one golden case per scenario | closed; 18 must still give the harness |

New facts in revision 2, checked against my measurements:
- 54 reconciliation rows for the full range and 52 for 2024-01…2026-08. My 52 matches the second figure.
- The C amounts in §2.6 are for the full range: `owner_unconfirmed` 1,114,884.25 and `split_unconfirmed` 454,219.20. They differ from my 2024-01…2026-08 sums (1,114,882.67; 454,219.01) by the 2023-11/12 months. That is consistent, but I did not re-measure them on the full range.
- The other four amounts with money in §2.6 match my sums: `publishing_terms_unconfirmed` 325,405.99, `assumption` 144,195.41, `artist_without_owner` 5,296.64 and `no_isrc` 2,364.33 (the signal total).

Privacy re-check of revision 2:
- 0 owner names or aliases from `GET /owners` appear in the document.
- No e-mail and no user path.
- The surname-like token matches are common words ("owner", "records", "seven", …) or pseudonyms already in the document as stage names (FLYXO, VETA3).

The side server on 3019 is still stopped; `lsof -i :3019` was empty at the end of the first pass.
