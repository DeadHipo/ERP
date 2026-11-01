# tests: notes for agents

- Run from the repo root: `REQUIRE_STACK=1 npm test`. Without `REQUIRE_STACK=1` the tests that need PostgreSQL /
  ClickHouse are skipped with a warning, and a green run proves less than it seems.
- Synthetic data only. Never put names, ISRCs or amounts from `context_data/` or `data/real` here. Test ISRCs look
  like `QZTST2600001`.
- Helpers (`helpers/`):
  - `fixtures.ts`: `await newFacade(threshold, { paymentService? })` (the private PostgreSQL database of the test file,
    module tables emptied, plus private sources; D-121), `confirmedOwner`, `approvedAppendix`,
    `approvedDoc`, `writeBelieve` / `believeCsv` (a Believe CSV in the real format), `writeB17`.
  - `test-sources.ts`: one private pair of PostgreSQL + ClickHouse databases per test file (all migrations, so the
    module schemas too), created on first use, emptied for each new facade, dropped after the file (`setup.ts`).
    `testQuery` reads ClickHouse directly; `testStack()` gives the PostgreSQL pool and `db`.
  - `tmp-root.ts`: every test file writes under its own `data/test-tmp/run-*`, removed after the file.
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
