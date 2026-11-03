Verdict: yes

# Frontend stage 2 council: QA (2026-11-03)

Reviewer: QA member, independent, read-only. HEAD `7193e37` on `feature/fable-001`. Under review (untracked):
`docs/agents/17_frontend_model.md`, `18_frontend_plan.md`, `19_golden_screens.md`. The only file this review writes is
this one. The verdict uses synthetic pseudonyms, ISRC patterns and amounts only.

The design is close: the golden numbers I re-derived match 12, the ISRC/UPC/account patterns are valid, the money text
rule is implementable on strings, and the plan has the right guard tests in outline. Two blockers make specs fail by
design as written: the e2e API cannot read the private ClickHouse database (finding 1), and S08 asserts queue groups
that the N3 key merges with other scenarios through the shared NG label rule (finding 2). Both are short fixes in
17/18/19. The rest is should-fix: "second press" is not defined per action, the `npm run e2e` harness lacks several
concrete pieces, and page states have no scenario.

## What I ran

| Check | Result |
|---|---|
| `npm run typecheck` (backend, frontend, shared) | exit 0 |
| `npm run lint` | exit 0 |
| `npm run build:client` | exit 0 (315.86 kB JS, 2.66 kB CSS) |
| `git status --short` | ` M docs/agents/README.md`, `?? docs/agents/17_frontend_model.md`, `?? 18_frontend_plan.md`, `?? 19_golden_screens.md`, `?? .claude/` (pre-existing): **stage 2 is not committed** |
| Seeding paths read | `tests/golden.test.ts` (`Case`), `tests/helpers/{fixtures,sources-stack,test-sources}.ts`, `src/main.ts`, `src/connect-sources.ts`, `src/modules/sources/columnar.ts`, `scripts/migrate-clickhouse.ts`, `src/modules/publishing/b17-format.ts` |
| Rules read | `shared/identifiers.ts` (`assertIsrc`), `facade/payouts.ts` (gates), `facade/balance.ts` (`classifyOperation`, `blockingPayouts`), `modules/settlements/service.ts` (returns, deactivate, proof), `shared/money.ts` (`toJSON`) |
| Harness reference | `zero-erp/apps/frontend/playwright.config.ts` (read only); `packages/frontend/{package.json,vite.config.ts,tsconfig.json}`, root `package.json`, `eslint.config` |
| Privacy | grep of 17, 18, 19 for `/Users/`, e-mail patterns, capitalised name pairs |
| Not run | `npm test` (by instruction); no server |

## Checks

| # | Check | Result |
|---|---|---|
| 1 | ISRC `QZTST27<nn><k>0<j>` passes `assertIsrc` (`^[A-Z]{2}[A-Z0-9]{3}\d{7}$`) | yes (12 chars, 7 digits); also `QZTST2710209`, `QZTST2720109`, `QZTST2731k02` |
| 2 | UPC 13 digits, account 7 digits, apart from `golden.test.ts` (`QZTST26…`, 1052428) | yes |
| 3 | Every seed step exists as a facade/module call (`Case.person/company/split/part/sublabel/load`, `unconfirmedOwner`, `assumptionDoc`, migration payouts, `writeB17`) | yes, with notes 15, 16 |
| 4 | B17 statement loaded last, three quarters in one file | possible only with a file name that names no quarter or all three (finding 15) |
| 5 | Shared reference data never mutated | S16 adds an alias to shared `0to8` (harmless, finding 19); S08 shares the NG rule (finding 2) |
| 6 | Global aggregates "never asserted" list complete | no: misses queue groups keyed by a shared entity (finding 2) and b17 P1 rows (keyed by month, finding 18) |
| 7 | Before/after values are exact decimal strings | yes; API money is `toFixed()`, zero is `0`, never an exponent (`shared/money.ts` `toJSON`) |
| 8 | Money text rule implementable without `Number()` | yes (digit-string rounding); two edge cases unspecified (finding 17) |
| 9 | Second press defined for every irreversible action | no (finding 3) |
| 10 | Payout scenario numbers vs code | S22 right (unproved payout not counted, `blockingPayouts` rule); "Pay again" contradicts the disabled button (finding 3) |
| 11 | `npm run e2e` from the root in one command | not yet specified (findings 1, 4, 5, 6) |
| 12 | Page states defined and testable | rules in 17 §8, no scenario, testids only for grid rows (findings 7, 8) |
| 13 | Guard tests writable as specified | partly (finding 9); three tests missing (finding 10) |
| 14 | DoD at HEAD | typecheck, lint, build clean; stage 2 docs uncommitted |
| 15 | Privacy of 17, 18, 19 | clean: no `/Users/`, no e-mail, no legal name; `Duetti` (company) and accounts 1052428/1055956 already appear in `12` |

## Findings

### Blockers

1. **The e2e API cannot see the private ClickHouse database.** 17 §9 starts the API "with `DB_DATABASE` /
   `CLICKHOUSE_DATABASE` set to the private names". But `connect-sources.ts:22` calls `createBelieveColumnar(ch)`
   without names, and `columnar.ts:111-113` defaults to the fully qualified `believe` / `believe_stage`; every query
   is `${DB}.rows`. `CLICKHOUSE_DATABASE` only sets the client's default database, and `migrate-clickhouse.ts` uses it
   only for `schema_migrations` (the SQL creates `believe.*`). The seed writes to `believe_<name>.rows` (through
   `createPrivateStores`). The API started by `main.ts` would read the dev `believe.rows` filtered by private file ids,
   so every Believe number on every page would be empty. If the seed used `connectSources`, it would write
   synthetic lines into the dev database. Fix in 18 step 3.1: `connectSources` builds the columnar from the
   environment (`CLICKHOUSE_DATABASE`, stage name `CLICKHOUSE_STAGE_DATABASE` or `<db>_stage`). Add a test that an
   API on a private pair reads only its own rows, and record it in D-140. This also corrects the D-121 claim, repeated
   in `CLAUDE.md`, that `CLICKHOUSE_DATABASE` switches the data set.
2. **S08 asserts queue groups that N3 merges.** G18 (S08/1), G18b (S08/2) and G21 (S08/4) all put C `assumption` on
   the one shared rule `NoGhost Records` → NG. N3 keys `assumption` on carves and sublabels by label rule, so
   `/queue/assumption` has one NG group of 19.125 + 19.125 + 50 = `88.25`. 19 asserts separate groups `19.125` and `50`
   "filter by ISRC", but N3 has no `isrc` parameter (`ownerId, month, limit, offset, q`), and `q` is not defined.
   Fix either way: (a) give S08/1, S08/2 and S08/4 their own sublabel string and recipient, as S23 does
   (`NoGhost Records 81` → `NG-081`, …); or (b) define `isrc` on N3 so it re-aggregates the groups over that ISRC's
   allocations. In both cases, add "queue groups whose key is a shared entity (NG, QQ rules, shared documents)" to
   the never-asserted list in 19 §1. S08/3 (QQ rule) is safe only while no other scenario uses `qaraqshy records`.
   State that.

### Should-fix

3. **"Second press" is not defined per action, and 19 §4.5 is false as written.** It says "every irreversible
   button is pressed twice; the second press is a no-op or a refusal toast". The code says otherwise:
   - deduction and credit: a second submission creates a second operation (no guard in `settlements.createOperation`);
   - an advance after its proof: a second advance is legitimate;
   - Pay: 17 §6 disables the button when blocked or payable ≤ 0, so S22 "Pay again → `payout_blocked` toast" and
     "→ `nothing_to_pay` toast", and S23 "Pay → `nothing_to_pay`", cannot be produced by a click.
   - return: refused by the module ("Returns cannot exceed the payout", `settlements/service.ts`), so 19 §7.9
     "no guard seen" is outdated;
   - deactivate: refused (`ConflictError`, already inactive);
   - proof: refused (`proof_exists`).

   Merge owners, close label rule, the duplicate dialog of owner/artist, report upload with duplicate refusal and
   `deferred` have **no scenario at all**. Fix: add a table in 19 §4, one row per action of 17 §6, with three
   columns:
   - **UI double press**: the button is disabled in flight; one request is sent (checked with a delayed `page.route`
     and a request counter);
   - **backend second request**: sent with Playwright's `request` fixture; the expected code or no-op;
   - **create-type actions**: "a second submission is a second operation, guarded only by the dialog".

   For a disabled Pay, assert the disabled state and its reason; then check the API refusal with `request`. Add
   scenarios for merge, close rule (e.g. S17 closes its NG-171 rule at 2026-04-01), the duplicate dialog, and upload.
4. **The `npm run e2e` harness misses concrete pieces.** These are needed for one command from the root:
   - a root script `"e2e": "npm run e2e -w @erp/frontend"` and a frontend script `"e2e": "playwright test"`;
   - a browser install step (`npx playwright install chromium`, as `e2e:install` or documented in `CLAUDE.md`);
   - a stack check in `start.sh` that fails fast when Docker is down;
   - `webServer.timeout` ≥ 300 s: the PG and CH migrations plus about 60 Believe ingests and a B17 load, against the
     default of 60 s;
   - test `timeout` about 120 s: S31/k4 has five actions, each waiting up to 20 s, against the default of 30 s;
   - `expect.timeout` 20 s;
   - `retries: 0` and `fullyParallel: false`: an action spec retried sees its post-action state, so its "before"
     assertions fail;
   - `reuseExistingServer: false`;
   - a temp data dir argument for `main.ts`, for `files/sources` and `tmp`;
   - fixed store names (`erp_e2e`, `believe_e2e`, `believe_e2e_stage`), dropped if they exist at start, so a killed
     run recovers;
   - dropping in a Playwright `globalTeardown` rather than in a shell `trap`: Playwright stops the `webServer`
     process tree without running the trap unless `gracefulShutdown: { signal: 'SIGTERM' }` is set;
   - `test-results/` and `playwright-report/` git-ignored.

   Spell these out in 18 step 3.4.
5. **The Vite port and proxy are hard-coded.** `vite.config.ts` has port 5173 and proxies `/api` to `:3000`. 17 §9
   needs 5174 → 3100, and this change is not in the 3.4 file list. Simpler: run the e2e against the built client that
   `main.ts` already serves from `packages/frontend/dist` on `:3100`. That gives one server and no proxy, and
   `build:client` is already in the DoD. If Vite stays, the proxy target and port come from the environment, with
   `strictPort`.
6. **Frontend vitest will pick up the Playwright specs.** `packages/frontend` runs `vitest run`, whose default
   include matches `e2e/golden/*.spec.ts`; importing `@playwright/test` there fails root `npm test`. Exclude `e2e/**`
   in the vitest config. `tsconfig.json` includes only `src` and `vite.config.ts`, so the specs, `playwright.config.ts`
   and the seed are not typechecked: add a `tsconfig.e2e.json` to `npm run typecheck`.
7. **Page states have no scenario.** 17 §8 states the rules, but 19 tests only one empty state (S29). The e2e
   database is never empty, and on small data the calculation is too fast to observe "long". Add an `S-states` spec
   that uses `page.route` for each page type (list P5, card P6/P10, queue P2, form):
   - empty response → the empty sentence and its action;
   - a 3 s delay → the "идёт пересчёт" panel, with the sidebar still navigable;
   - 500 with `code` → the code, the message and a retry;
   - a body that breaks the schema → "ответ API не соответствует контракту";
   - a refetch after a mutation → the "устарело" badge with the old numbers.

   Large list: add a mocked 30,000-row `/owners/payables` (client pagination 50/100/500) and a mocked
   `/tracks/summary` total of 26,000 (server paging requests `offset`). Check that no picker renders more than
   50 options.
8. **data-testid conventions cover grid rows only.** 17 §5 defines `row-<key>` only. Specs need fixed hooks:
   - `PageState`: `state-empty`, `state-loading`, `state-error`;
   - the global indicator: `recalc`;
   - `ConfirmDialog`: `confirm-dialog`, `confirm-ok`, `confirm-cancel`, `confirm-change-<i>`;
   - toasts: `toast` with `data-code`;
   - `Money`: `money-<field>`, with the exact string in `title`;
   - `StatusChip`: `data-value`.

   19 §4.6 waits on the Russian text "идёт пересчёт"; use the testid instead. AG Grid does not put arbitrary
   attributes on rows: use `getRowId` and select `[row-id="<key>"]`, define row keys (P1 `believe:<account>:<month>`,
   P2 `<reason>:<kind>:<id>`), and remember that virtualised rows are absent until scrolled or filtered.
9. **Guard tests need precise specifications.**
   - **money-rule**: TypeScript already rejects `- * /` on strings, so the test is a syntactic ban list over `src`:
     `Number(`, `parseFloat(`, `parseInt(`, unary `+`, `Math.` on any value, any import of `decimal.js`, and
     `toFixed(` outside `lib/money.ts`. Exceptions go in a fixed list with reasons (URL `offset`/`limit`), as in the
     backend's `rules-coverage.test.ts`.
   - **open-questions**: "asserts the 14 items" is a tautology unless the test reads the ids `15.3.1…15.3.14` from
     `15_mvp_report.md` §3 and compares them with `open-questions.ts`.
   - **coverage**: also assert that the mapped route exists in the router and that the page module calls the client
     method.
   - **contract**: the contract scenario must send `X-Operator` on one write and read the row back through `GET /audit`.
10. **Missing guard tests.**
    - (a) A table test over `C_REASONS` and the signal names: each has an action component or "information only"
      with its D/⚠ id. 18 step 3.9 mentions this; make it a named file.
    - (b) A route test: every page route parameter is one of `:isrc :upc :id :reason :month`, never a name.
    - (c) A privacy test over `scripts/e2e/**` and `packages/frontend/e2e/**`: every owner name, pseudonym and
      holder matches the synthetic patterns of 19 §1 (`^(Owner |Company )?[A-Z0-9]+-\d{3}$`, `HOLDER …`, the
      seeded labels).
    - (d) Vitest cases for `formatMoney`: `4.165`, `-4.165` → `-4,17`, `-0.004` → `0,00`, `0.005` → `0,01`,
      `999.995` → `1 000,00` (a carry across a group), `50` → `50,00`, `1234567.891` → `1 234 567,89`, the
      separator byte U+202F.
11. **The payout gate reason is not an API field.** The balance gives `confirmed`, `blockingPayouts` and
    `payableShown`, but no gate code. To show "disabled with the backend's reason" (17 §1.4, S14, S22, S23), the
    client would re-implement the gate order (confirmed → blocked → `nothing_to_pay` → `below_threshold`). Add
    `payoutGate: null | code` to N4 and the balance, computed by the same helper as `createPayout`.
12. **The audit `path` can carry a legal name.** `POST /publishing/writers/:norm/map` has the normalised B17 writer
    name in the path. N16 stores `path` while promising "never names". Store the route template plus `entityIds`
    instead.
13. **17 §9 still says ISRC range `QZTSTE<nn>…`**. 19 §1 shows that this pattern fails `assertIsrc`. Align 17 on
    `QZTST27<nn><k>0<j>`.
14. **18's scenario names do not map to 19's numbers.** 18 uses S-queue, S-track, S-smoke, S-sources, S-labels,
    S-documents and S-splits. Several have no 19 scenario (smoke, sources, close rule, documents list, splits list).
    Add a mapping column to 18 §2.

### Notes

15. B17 "one statement for the whole seed": `quartersFromFileName` forces a single quarter named in the file name
    onto every row, and a differing `Period` cell is refused (`b17-format.ts:178-183`). Name the file without a
    quarter (or with all three), and remember `periodTaken` blocks any later statement for 4Q25, 1Q26 and 2Q26.
16. `Case.ordered` and `approvedAppendix` must be per scenario in the seed. Suffix `Owner ordered i` / `Ordered i`
    with `-<nn><k>`, otherwise P11 duplicate groups and owner search collide. Use one appendix per case so that N13
    `waiting` and P14 stay per scenario.
17. Money text: specify that a negative that rounds to zero is `0,00` with no sign and not red, and that the sign
    and colour follow the rounded text. Rounded parts need not add up visually (S04/2: 4,17 + 4,17 next to 8.33), so
    specs assert `title` only, as 19 §1 already says.
18. b17 P1 rows are keyed by month, not by account. 2025-12 (S19) and 2026-03 (S18) each belong to one scenario;
    2026-06 mixes S31 k1–k3 and is not asserted. Say so in the isolation row.
19. S16 adds the alias to the shared label `0to8`. Only S16's lines carry the string, so this is harmless, but it
    contradicts "shared reference data is never mutated" literally. Reword as "never changed in a way that moves
    another scenario's money".
20. The payout derivations check out against the code: an unproved payout is not counted (`classifyOperation`);
    `blockingPayouts` includes unproved advances (S31/k1); `recordPayout` is deferred and the proof clears it; a
    migration payout counts at once (S24, S31/k3); a deduction needs an artist and gets scope `any` (S31/k4).

## What QA needs from stage 3

- Findings 1 and 2 fixed in 17/18/19 before step 3.1 starts. Findings 3–14 folded into 17/18/19 (or into the D-140
  and D-144 entries) before step 3.4 starts.
- Commit the stage 2 documents and `docs/agents/README.md`; the D-139 entry with the stack.
- Each stage 3 step reports, besides the DoD: the `npm run e2e` exit code, spec count, duration and retries (must
  be 0); `git status` showing no `test-results/` or `playwright-report/`; and, after the run, the absence of the
  `erp_e2e` / `believe_e2e*` databases.
- QA at stage 3 will run: typecheck, lint, `REQUIRE_STACK=1 npm test`, `build:client`, `npm run e2e` twice in a row
  (idempotent seed), one run with Docker stopped (fast, clear failure), the states spec, and a double-press audit of
  every row of the finding 3 table.

## Revision 2 (2026-11-03)

Verdict changed to **yes**. I re-read 17 (214 lines), 18 (101) and 19 (474) of revision 2 against the code.
HEAD is still `7193e37`; only documents changed, so the typecheck, lint and build results above stand. The stage 2
documents are still uncommitted.

| Finding | Status in revision 2 | Evidence |
|---|---|---|
| 1 ClickHouse name | fixed | 17 N20, 18 step 3.1 (`connect-sources.ts` passes `CLICKHOUSE_DATABASE` and `<name>_stage`, with a test), D-140 corrects D-121 and `CLAUDE.md` |
| 2 S08 shared NG rule | fixed | 19 §1 gives each case its own string and recipient (`NoGhost Records 08a/08b/08d` → `NG-081/082/084`); "queue groups keyed by a shared entity" is in the never-asserted list; no spec uses an `isrc` filter on N3 |
| 3 second press | fixed | 19 §5 table and 17 §6 column. I checked every cited code in `src`: `alias_taken`, `rule_overlap`, `terms_overlap`, `duplicate_file`, `duplicate_period`, `owner_merged`, `artist_owner_fixed`, `participation_overlap`, `double_participation`, `split_document_set`, `top_above_100`, "Returns cannot exceed the payout", "already inactive". `operator_required` is new in 3.1. New scenarios: merge S33, close rule S37, duplicate dialog S36, upload S34, deferred in S22 |
| 4 harness | fixed | 17 §9: one command, Docker check, timeouts 300 s / 120 s, retries 0, no server reuse, temp data dir, fixed `e2e` stores dropped at start and in `globalTeardown`, gitignore, browser install named in `CLAUDE.md` |
| 5 Vite | fixed | the built client is served by `main.ts` on :3100 |
| 6 vitest / tsconfig | fixed | vitest `include` limited to `tests/`; `e2e/tsconfig.json` |
| 7 states | fixed | SS1–SS7 with `page.route`; large lists covered (SS6 26 k server paging, SS7 picker) |
| 8 test hooks | fixed | 17 §5 hooks: `page-state-*`, `stale-badge`, `recalc-indicator`, `confirm-dialog(-ok)`, `toast[data-code]`, `action-<name>`, `[row-id]` |
| 9, 10 guard tests | fixed | 17 §1 R1–R8 "checked by": eslint ban list with an allow-list, `no-dto`, `routes-no-names`, the privacy pattern test, `formatMoney` cases, the coverage test checks the route exists, `OPEN_QUESTIONS` compared with 15 §3, the audit row and the refusal without the header asserted in the contract scenario |
| 11 payout gate | fixed | N19 `PayoutGate`; one `payoutGate()` helper shared with `createPayout` |
| 12 audit path | fixed | the stored route is the template, not the concrete path |
| 13 ISRC in 17 §9 | fixed | `QZTST27<nn><k>0<j>` |
| 14 scenario names | partly | 18 still writes S-queue, S-track and so on, and 19 does not define these group names. The 19 §6 spec-file table is the usable mapping (note R2-3) |
| 15–19 notes | fixed | B17 file name has no quarter; `Case.ordered` and the appendix are per scenario; b17 month rule stated; S16 shared mutation stated |

**The money text rule, verified.** 19 §1 now formats with
`Intl.NumberFormat('ru-RU', { …, roundingMode: 'halfExpand', signDisplay: 'negative' }).format(decimalString)`.
Node 24 formats the string exactly (Intl.NumberFormat v3; no float):

| Input | Output |
|---|---|
| `19.125` | `19,13` |
| `4.165` | `4,17` |
| `-4.165` | `-4,17` |
| `999.995` | `1 000,00` |
| `-0.004` | `0,00` |
| `0.005` | `0,01` |
| `1234.567` | `1 234,57` |
| `123456789012345.125` | `123 456 789 012 345,13` |

Specs normalise U+00A0 and U+202F, so the separator byte does not matter.

### New in revision 2

R2-1 (must fix before `perimeter-signals.spec.ts` is written; it is an expected-number error, not a seeding or
isolation flaw). 19 §3 "P21 rows from other scenarios" asserts `assumptions` "q11 `23.375`" for S08/1. The signal
is keyed by `documentId|basis` (`facade/reports.ts:131`). In S08/1 the q11 money is under two documents: the
participation P (its appendix) and the NG-081 rule (its contract). So the signal has two rows, `4.25` and `19.125`,
not one row of `23.375`. Both rows are per scenario, because the documents are per scenario. Assert the two rows by
document id.

R2-2 (should-fix, step 3.1 scope). The 400 `operator_required` refusal affects writes that do not send `X-Operator`:
- the writes of `tests/api.test.ts` (11 calls) and of `tests/api-contract.test.ts`;
- the legacy pages under `/legacy/*`, which keep working until 3.9, so the client in use must send the header from
  3.1 on.

Name both in 18 step 3.1, so that DoD stays green at that step.

R2-3 (note). Either define the S-group names of 18 (S-queue, S-track, S-signals, S-merge, …) as lists of 19
scenario numbers, or replace them with the 19 §6 spec file names.

R2-4 (note). Several second-request rows say "code to verify in 3.x": map writer, create track, and the status
code of `top_above_100`. The step that writes those specs records the observed code in 19. A double effect found
there is a stage 3 finding, not a spec change.

What QA needs from stage 3 is unchanged from above, plus R2-1 and R2-2.
