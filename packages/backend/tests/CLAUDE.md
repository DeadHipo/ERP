# tests: notes for agents

- Run from the repo root: `REQUIRE_STACK=1 npm test`. Without `REQUIRE_STACK=1` the tests that need PostgreSQL /
  ClickHouse are skipped with a warning, and a green run proves less than it seems.
- Synthetic data only. Never put names, ISRCs or amounts from `context_data/` or `data/real` here. Test ISRCs look
  like `QZTST2600001`.
- Helpers (`helpers/`):
  - `fixtures.ts`: `newFacade(threshold)` (SQLite in memory + private sources), `confirmedOwner`, `approvedAppendix`,
    `approvedDoc`, `writeBelieve` / `believeCsv` (a Believe CSV in the real format), `writeB17`.
  - `test-sources.ts`: one private pair of PostgreSQL + ClickHouse databases per test file, created on first use,
    emptied for each new facade, dropped after the file (`setup.ts`). `testQuery` reads ClickHouse directly.
  - `tmp-root.ts`: every test file writes under its own `data/test-tmp/run-*`, removed after the file.
- Guard tests (do not weaken them to make a change pass; see `docs/agents/04_recipes.md` §1):
  `boundaries.test.ts`, `rules-coverage.test.ts` (README §5 + the `Number(` allow-list), `api-contract.test.ts`
  (every route in `operations.ts` and called in the scenario).
- `review-fixes`, `review-round2`, `review-round3`: regressions from independent reviews; each test names its D-entry.
- `Hook timed out in 10000ms` across many stack test files, with a run of minutes instead of seconds, means the
  Docker VM is starved for CPU (a busy host), not a code bug: check `docker stats` / `uptime` and rerun. Timed-out
  runs can leave `believe_t_*` databases in ClickHouse; they are test scratch.
- A facade method that became async: `await expect(f.method()).rejects.toThrow()`, not `expect(() => …).toThrow()`.
