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
  - `tmp-root.ts`: every test file writes under its own `data/test-tmp/run-*`, removed after the file.
- Layer tests: `layers/*.test.ts` are pure (no stack) over the hand-built world in `layers/world.ts`; one file per
  layer, `index.test.ts` pins the order, `exactness.test.ts` is the seeded random exactness test (12 decimals).
  `golden.test.ts` runs the scenarios of `docs/agents/12_golden_cases.md` end to end (every expected number is a
  hand-computed string; each case also asserts A = B + C + ours, discrepancy 0 and explain summing to the unit).
  `api-reasons.test.ts` guards the C reason labels. Others: `labels.test.ts`, `participations.test.ts`,
  `publishing-terms.test.ts`, `recoup.test.ts`.
- Guard tests (do not weaken them to make a change pass; see `docs/agents/04_recipes.md` §1):
  `boundaries.test.ts`, `rules-coverage.test.ts` (README §5 + the `Number(` allow-list), `api-contract.test.ts`
  (every route in `operations.ts` and called in the scenario).
- `review-fixes`, `review-round2`, `review-round3`: regressions from independent reviews; each test names its D-entry.
- `Hook timed out in 10000ms` across many stack test files, with a run of minutes instead of seconds, means the
  Docker VM is starved for CPU (a busy host), not a code bug: check `docker stats` / `uptime` and rerun. Timed-out
  runs can leave `believe_t_*` databases in ClickHouse; they are test scratch.
- Everything is async: `await expect(f.method()).rejects.toThrow()` — not `expect(() => …).toThrow()` and not
  `expect(await f.method()).rejects` (that throws before expect). Two concurrent calls: `Promise.all([f.a(), f.b()])`
  without inner awaits. Lint (`no-floating-promises`) finds a missing await, not a wrong precedence:
  `(await f.x()).prop`.
