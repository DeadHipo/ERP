# tests: notes for agents

- Run from the repo root: `REQUIRE_STACK=1 npm test`. Without `REQUIRE_STACK=1` the tests that need PostgreSQL /
  ClickHouse are skipped with a warning, and a green run proves less than it seems.
- Synthetic data only. Never put names, ISRCs or amounts from `context_data/` or `data/real` here. Test ISRCs look
  like `QZTST2600001`.
- Helpers (`helpers/`):
  - `fixtures.ts`: `await newFacade(threshold, { paymentService? })` (the private PostgreSQL database of the test file,
    module tables emptied, plus private sources; D-121), `confirmedOwner`, `approvedAppendix`,
    `approvedDoc`, `writeBelieve` / `believeCsv` (a Believe CSV in the real format; a row takes `labelName`, default
    `Test Label`), `writeB17` (a row takes `operationType`, default `Performance`), `labelOwner` (owner of kind `label`
    with one pseudonym: sublabel, company, buyer), `unconfirmedOwner` (pseudonyms, no contract), `assumptionDoc` (a
    document of kind `assumption`, never approved). `newFacade` seeds the two own labels, 0to8 (aliases `Test Label`,
    `0to8`) and Echo8, so synthetic Believe files map to 0to8 without setup; to test `label_unmapped` write a row
    with another `labelName`.
  - `test-sources.ts`: one private pair of PostgreSQL + ClickHouse databases per test file (all migrations, so the
    module schemas too), created on first use, emptied for each new facade, dropped after the file (`setup.ts`).
    `testQuery` reads ClickHouse directly; `testStack()` gives the PostgreSQL pool and `db`.
  - `writer.ts`: `writer(app)` is `request(app)` whose writes carry `X-Operator` (the API refuses a write without it, D-140);
    use it in every test that writes through supertest. `golden-case.ts`: the `Case` builder of `golden.test.ts`, shared with
    the e2e seed scenarios.
  - `sources-stack.ts` sits on `src/shared/private-stores.ts` (`createPrivateStores(name, { dropFirst })`: PostgreSQL
    `erp_<name>` + ClickHouse `believe_<name>` and `_stage`, all migrations; the e2e uses a fixed name).
  - **Organizations (D-170):** `createPrivateStores` writes `schema_migrations` and creates its test organization once
    (`stores.orgId`); `orgs` and `auth` are not module schemas, so a reset keeps them. `newFacade()` opens on
    `stores.orgId`. A second organization in the same store: create it with `createOrgsService(stack.db).createOrganization(...)`
    and open a second facade on it (`org-scope.test.ts`, `concurrency.test.ts`). `api-contract.test.ts` runs in two
    blocks: `off` (`createApp(f)`, `/orgs*` with `X-System-Key`, the route list) and `on` (`createServerApp`, a login,
    every operation with the cookie). `auth.test.ts`, `http-errors.test.ts` cover the login and the constant 500.
  - **Roles (D-171):** `helpers/manager-answers.ts` is the **frozen** answer of a label manager per organization
    operation (`L` only under its label, `R` the facade checks the record, `O` allowed, `x` 403), copied from the plan
    (`docs/идеи/лейбл_с_нуля/api/этап3_роли.md` §1); it is the oracle of `abilities.test.ts` and of the manager walk in
    `api-contract.test.ts`; never derive it from `RULES`, change it only with the plan (a new organization operation
    needs a line). The manager walk (the `on` block) calls every operation as a manager of label A with a stub
    body: under label A, without a label (400 `label_required` for L), under label B (403), plus record-level cases (an
    ad and a document of B). `abilities.test.ts` also pins the pure rule table and `operationOf` (`/Owners/merge`, a
    trailing `/`, an unknown path = 404). `auth.test.ts` (login with several memberships, `no_membership`, limits on its
    own app instance, Origin, the `__Host-` cookie app, the rehash and its race), `sessions.test.ts` (revocation),
    `viewer.test.ts` (the facade with `labelsViewer`: another label's record 404 / 403, the ISRC and document rules, the
    lists, `ALL_VIEWER` byte-identical); commit 4: `users.test.ts`, `support.test.ts`. The login limits are off in tests
    unless a test builds its own app with limits.
  - `tmp-root.ts`: every test file writes under its own `data/test-tmp/run-*`, removed after the file.
- Layer tests: `layers/*.test.ts` are pure (no stack) over the hand-built world in `layers/world.ts`; one file per
  layer, `index.test.ts` pins the order, `exactness.test.ts` is the seeded random exactness test (12 decimals).
  `golden.test.ts` runs the scenarios of `docs/agents/12_golden_cases.md` end to end (every expected number is a
  hand-computed string; each case also asserts A = B + C + ours, discrepancy 0 and explain summing to the unit).
  `api-reasons.test.ts` guards the C reason labels. Others: `labels.test.ts`, `participations.test.ts`,
  `publishing-terms.test.ts`, `recoup.test.ts`.
- Guard tests (do not weaken them to make a change pass; see `docs/agents/04_recipes.md` §1):
  `boundaries.test.ts`, `rules-coverage.test.ts` (README §5 + the `Number(` allow-list), `api-contract.test.ts`
  (every route in `operations.ts` with `access` and `ability`, called in the scenario).
- `review-fixes`, `review-round2`, `review-round3`: regressions from independent reviews; each test names its D-entry.
- `Hook timed out in 10000ms` across many stack test files, with a run of minutes instead of seconds, means the
  Docker VM is starved for CPU (a busy host), not a code bug: check `docker stats` / `uptime` and rerun. Timed-out
  runs can leave `believe_t_*` databases in ClickHouse; they are test scratch.
- On a loaded machine run the suite serially: `REQUIRE_STACK=1 npx vitest run --no-file-parallelism
  --testTimeout=300000 --hookTimeout=120000` (in `packages/backend`).
- Everything is async: `await expect(f.method()).rejects.toThrow()` — not `expect(() => …).toThrow()` and not
  `expect(await f.method()).rejects` (that throws before expect). Two concurrent calls: `Promise.all([f.a(), f.b()])`
  without inner awaits. Lint (`no-floating-promises`) finds a missing await, not a wrong precedence:
  `(await f.x()).prop`.
- **Stage 4 / onboarding (D-172):** `catalog.test.ts` holds **the money pin** of the catalog: `text(calculate())` plus
  `GET /overview` without `signals` and `calculatedAt` must be byte for byte the same before and after the history
  derivation, an operator interval, a replacement, a release import; the signals are asserted separately (they change on
  purpose). Any new catalog feature (history, registry) adds its edit to that pin. `split-import-loader.test.ts` is the
  **loader-equivalence test**: a synthetic `annex/splits_diff.json` loaded by the stage 4 `stepSplits --apply` in one
  store and by `scripts/mvp/splits-diff-to-csv.ts` + `POST /splits/import` in another give the same `listSplits()` text;
  it sets `MVP_LOAD_DIR` before the dynamic `await import` of the loader (static imports read `LOAD_DIR` first) and
  fails with the cause if the step logs `split_error` / `unresolved_name`. `split-import.test.ts` (every row class, all
  or nothing, the audit from the response, the 5 000-row timing with one `artistIndex` read), `assume.test.ts`,
  `releases.test.ts` (synthetic export csv only), `onboarding.test.ts`; G61 in `golden.test.ts` (`label_decision` =
  `contract` in money). A new organization operation still needs its line in `helpers/manager-answers.ts`.
- **Payroll stage (D-173):** the forgiveness is tested in a new `describe` of `recoup.test.ts` (the file is not under
  `tests/layers/`); the existing recoup cases, `layers/exactness.test.ts` and the golden cases before G57 are never
  edited to make it pass (without a forgiveness the result must be byte for byte the old one). G57–G60 (buyout,
  forgiveness incl. G58b late income, write-off, adjustment) and `Case.verify()` check Σ books of `buyouts`,
  `forgiven`, `writtenOff`, `adjustments`, the `payable` identity per book, `amount = recouped + forgiven + remaining`
  per position and Σ `byArea` = book. `operation-kinds.test.ts` (kind derivation = `meaningOf`, each kind's refusals in
  order, raw-INSERT CHECK refusals, three blocking places equal), `payroll.test.ts` (json = csv, Σ rows = total, `bookB
  = reconciliationB`, manager 200 / 403 / 400), `operation-import.test.ts` (classes, all or nothing, a repeat =
  `unchanged`, `external_ref_required`, no audit row on the preview), `b17-replace.test.ts` (a payout snapshot before the
  replacement byte for byte, an old snapshot still parses). `scope.test.ts` pins the balance at `asOf` = the full
  balance of a world without later files and operations. Tests where the button pays publishing pass `area: 'all'`.
  `rules-coverage.test.ts` now says «the kind is stored and fits its fields (D-173)». (after the stage: 61 files / 648 tests)
