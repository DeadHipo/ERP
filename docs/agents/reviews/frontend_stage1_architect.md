Verdict: yes

# Frontend stage 1 review: architect (2026-11-03)

Scope: `docs/agents/16_frontend_jobs.md` (untracked, 280 lines) on `feature/fable-001` at `a00ea1a`, read against
`notes/goal_prompt_frontend.md`, the code it describes and D-007, D-012, D-062, D-119, D-125, D-129. Read-only: no
script, server or database was run; the only file written is this one. No personal data below.

## What I checked

| # | Check | Result |
|---|---|---|
| 1 | The idea: the frontend computes nothing, one client, types from `@erp/shared`, keys ISRC/UPC | Respected in §6, §7 and §8 (money as strings, `assumption` never approved, ⚠ decisions not decided by a screen). Two gaps in the audit: the hand-written response types and the operator trace (findings 1, 2). The meaning of "filters work on the loaded result" needs a rule (finding 3) |
| 2 | Ignored query params (§4.5, lines 192-194) | All five claims are true in the code. `/participations` drops `limit` (`routes/participations.ts:11-17`). `listQuery` has no `offset` field, so zod strips it (`shared/src/api-schemas.ts:160-165`; `routes/splits.ts:11-17`). `GET /tracks` takes no query (`routes/owners.ts:75`). `/signals` slices only `unallocated.pairs` and `isrcsWithoutSplit` (`routes/reports.ts:15-23`). Operations take only `ownerId` (`routes/settlements.ts:12`). `storedPath` is in `sourceFileSchema` (`api-responses.ts:219`) |
| 3 | Facade reuse claims (§4.5, lines 175-178) | True. `reconciliation`, `signals` and `explainTrack` each call `calculate()` (`reports.ts:12,50,210`); `balanceWithFiles` calls it once per owner (`context.ts:149`). The `allocationSchema` fields match the list (`api-responses.ts:485-497`). Gap (g) cost and gap (b) for publishing need more than "thin" (findings 4, 5) |
| 4 | "One money call per screen, no cache" vs D-012 | Consistent: D-012 forbids server caches (`97`: "No caches: every request recalculates from scratch"). The goal asks for the TanStack Query cache, which is a client response cache with invalidation, not an accrual. §7.1 should say "no server cache" (finding 6). The overview screen as listed needs two money calls (finding 7) |
| 5 | Coverage of `operations.ts` (§4.4) | Correct. I counted 51 operations (`grep -c "method: '"`). The client has 36 calls (`client.ts:158-208`). Pages use 35 of them; `setTrackNote` is unused (grep of `api.setTrackNote(` = 0). The 16 without a page match the list exactly |
| 6 | Stack (§5) and zero-erp verdicts | Sound and matching the goal. Checked against zero-erp `package.json`: `@heroui/react` and `@heroui/styles` are `rc`; Refine, three.js, i18next and ag-grid-enterprise are there and rightly not taken. `@ag-grid-community/locale` 35.3.1 has no Russian file (`uk-UA` yes, `ru` no). The confirmation dialog file exists. The Infinite Row Model is in community |
| 7 | Volumes, signals | Mostly right. The signals schema has **11** lists; §4.1 and §4.2 name 10 and omit `ruleRecipientIsRow` (finding 8) |
| 8 | Readiness for stage 2 | Enough to start: the jobs, the 9 endpoint gaps, the current-page audit and the open questions with assumptions are all there. Findings 1-7 are inputs to `17_frontend_model.md`, not reasons to redo stage 1 |

## Findings

1. **should-fix: the audit misses that `client.ts` still hand-writes response types.** `packages/frontend/src/api/client.ts:72-153`
   declares its own `Artist`, `SplitView`, `SourceFile`, `BelieveFileRef`, `SourceLine`, `SourceLinesPage` and
   `SourceFacets`. The shared package already exports schemas for all of them (`api-responses.ts:69` `artistSchema`,
   `:194` `splitListItemSchema`, `:212` `sourceFileSchema`, `:257` `sourceLineSchema`, `:278`, `:294`).
   This breaks D-119 ("instead of hand-written interfaces"), `packages/frontend/CLAUDE.md` ("never redefine them
   here") and the goal ("types only from @erp/shared"). §4.3 / §6 should list it. Stage 2 should require the new
   client to import every type from the shared package.
2. **should-fix: the operator trace is not stated as an API gap.** The goal requires every action to record who and
   when ("поле «оператор» в форме"). Today only `approveBody` has `by`, with default `'manager'`
   (`api-schemas.ts:77`), and the client hard-codes it (`client.ts:171`). No other write body carries an operator.
   §4.5 (e) offers the `audit_log` only as an option for "who changed what", and §8 q1 assumes an operator field.
   Stage 2 must pick one mechanism. My recommendation: one append-only audit table, written by the facade inside
   the write transaction, with the operator taken from one request header that the single client sets. That avoids
   adding `by` to about 25 body schemas.
3. **should-fix: "filters and tabs work on the loaded result" (§7.1, line 251) needs a rule.** A client filter may hide
   or show rows. Any total of a filtered set (C by label, a month subtotal, a period-filtered balance) must come
   from the API, because summing on the client is frontend arithmetic on money. The current pages already slip:
   `OwnerBalancePage.tsx:79,83` compare `Number(payable)`, `SplitsPage.tsx:25` sums percents, and
   `SettlementsPage.tsx:51` recomputes "blocking" with a rule that differs from the backend. The backend also drops
   migrated payouts and requires an approved proof (`context.ts:65-76`). The model should say: every displayed sum
   and every gate is an API field; the client never reduces amounts.
4. **should-fix: gap (g) "owners with payable" is not thin as written.** `ownerBalance()` scans every unit's
   allocations for one owner (`balance.ts:152-164`). Called 1,151 times on one `calculate()`, that is about 1,151 ×
   722 k unit passes. `blockingPayoutsOf` costs two queries per owner (`context.ts:65-76`).
   The endpoint needs a single pass that groups allocations and publishing results by owner, plus one bulk read of
   operations and proof statuses. It must pass `opDocIds()` to `calculate()` as `balanceWithFiles` does
   (`context.ts:144-149`). The test must assert that the list equals the per-owner balance for a few owners.
5. **note: gap (b) for `publishing_terms_unconfirmed` cannot key by operation type yet.** `PublishingResult` has no
   operation type and no statement id (`calculation.ts:61-73`). The queue needs that non-money field carried through.
   For `split_unconfirmed` with no document (`documentId` null), the acting entity is the split (`ruleId`), not a
   document. The key should be `documentId ?? ruleId`.
6. **note: §7.1 "No cache: D-012 stands" (line 253).** It should say "no server-side cache or stored result". The goal
   explicitly asks for TanStack Query (cache, invalidation after an action, a recalculation indicator). Without that
   wording, the design could wrongly forbid the client cache.
7. **should-fix: the overview breaks "one money call per screen".** The goal's overview shows A / B / C / ours, C by
   reason and signals. That is `reconciliation` plus `signals`: two `calculate()` calls, about 16 s, and §4.2 already
   measures the current default page at 20 s. The new-endpoint list (§7.1) has no overview aggregate. Stage 2 should
   add one: reconciliation rows, C totals per reason and the signal counts, all from one `calculate()`, with the signal
   lists paged behind it.
8. **note: signals are 11 lists, not 10.** `signalsSchema` (`api-responses.ts:339-409`) includes `ruleRecipientIsRow`,
   which §4.1 (line 129) and §4.2 (line 138) omit. §3 mentions it only as a "splits check". Stage 6 requires an action
   for every signal, so the model's signal → action table must have 11 rows.
9. **should-fix (stage 2 must state it): a recalculation blocks the API.** The layer fold is a synchronous loop
   (`calculation.ts:185-214`, 3.9-4.3 s per §4.2). While it runs, the Node event loop serves nothing else, including
   the 20 ms lists and search. The frontend can keep navigation responsive; the server cannot. That conflicts with
   the goal's "не блокирует навигацию" when two operators, or two tabs of one operator, load money screens.
   The model should measure it and either accept it in a D-entry or plan a non-money backend change: yield every N
   units, or a worker thread. Neither is a cache, so D-012 is untouched.
10. **note: new response schemas.** The explain endpoint has a schema (`explainSchema`). The payout snapshot is
    `free(...)` (`operations.ts:455-461`), and D-119 lists the snapshot as free-form. The payout history screen needs
    a schema for it, and the light explain needs its own. Per D-119, every endpoint from gaps (a)-(i) needs an
    `operations.ts` entry, a schema and a call in the contract scenario. The goal states this; §4.5 could say it once.
11. **note: the stack D-entry.** §7.5 says the pages are replaced. Stage 2's plan must name the D-entry that
    supersedes D-007 / D-062 and the update of `packages/frontend/CLAUDE.md`, which still says "plain CSS, no UI kit"
    and "No frontend tests exist". It must also pin HeroUI `@heroui/react` and `@heroui/styles` to one exact rc
    version (§5, line 203).

Nothing is over-engineered. The `audit_log` and the release-by-UPC page are the most optional items; both are
asked for by the goal. Gap (f)'s net-only ClickHouse variant is fine because net is source data, not an allocation.
It must be labelled "net", never "B" or "payable".

## Recommendations for stage 2

- `17_frontend_model.md`:
  - a table of screens × the one endpoint each calls, including the overview aggregate (finding 7);
  - a table of the 10 C reasons and 11 signals × the acting entity, the action, the endpoint and the confirmation dialog (findings 5, 8);
  - the rule "no client reduction of amounts; gates are API fields" (finding 3);
  - the operator-trace mechanism (finding 2).
- `18_frontend_plan.md`:
  - backend steps first: overview, C queue, owners with payable (single pass, finding 4), tracks with money, light explain, search, filters and paging fixes for §4.5;
  - each step with its schema, its `operations.ts` entry, the contract call and a D-entry;
  - then the shell and the components, with all client types imported from `@erp/shared` (finding 1);
  - one D-entry for the stack, superseding D-007 / D-062.
- `19_golden_screens.md`: for each golden case, the screen number and the API field it equals. A test then compares
  the field and the screen text, not a value recomputed in the test.
- State the event-loop blocking (finding 9) as a measured fact with a decision.

## Revision 2 (re-read 2026-11-03)

Verdict unchanged: **yes**. I re-read revision 2 of `16_frontend_jobs.md` (380 lines), read-only.

Resolved:

| Finding | Where in revision 2 |
|---|---|
| 1 hand-written client types | §4.3 lists the seven types and the money arithmetic; §7.6 says every client type comes from `@erp/shared` |
| 2 operator trace | §4.5 (e) is marked not thin: an append-only `audit_log` written by the facade, with the operator taken from one request header; §1 adds the operator / manager roles from `docs/02` |
| 3 no client reduction of amounts | §7.1: the client never sums, subtracts or compares amounts, and a frontend rule test enforces it |
| 4 owners with payable | §4.5 (g) is marked not thin: one grouping pass, bulk reads of operations and proofs |
| 5 C queue keys | §4.5 (b) uses `documentId ?? ruleId`, and publishing terms are keyed by owner only (the result has no operation type) |
| 6 no server-side cache | §4.2 and §7.1 say "no server-side cache", with the TanStack client cache invalidated after every action |
| 7 overview in one call | new gap (j) |
| 8 11 signal lists | §4.1, §4.2 (`limit` on 2 of 11) and the table in §2.7 |
| 9 event loop | new gap (k), to be measured and decided in stage 2 |
| 10 schemas and D-119 | stated before the gap table; the snapshot schema and the light-explain schema are named |
| 11 stack D-entry and pins | §7.7 (supersedes D-007 / D-062, `packages/frontend/CLAUDE.md` rewritten); §5 has exact versions (HeroUI 3.2.7 stable, AG Grid 36.2.0), checked by a sandbox build with Vite 8 |

The new tables are what the model needs: §2.6 maps the 10 C reasons to an entity, an action, an operation and whether it is irreversible; §2.7 maps the 11 signals to actions; §2.8 maps the items of `15` §3 to a place on screen, plus the owner-question list. They agree with the code: the operations named exist in `operations.ts`, and the ⚠ items are offered no action.

Remaining (notes for stage 2, not blockers):
- §7.6 plans `schema.parse` on responses in the client. D-119 calls the schemas non-strict and unused at run time. The parse is a sound choice but a new one: record it in the stack D-entry, and make a parse failure an error state, not a silent pass.
- The decision for (k) and the shape of the overview endpoint (j) belong in `17_frontend_model.md` with numbers.
- For `rule_unconfirmed` on a label rule, the only action is close and re-create, because there is no "attach document to rule" route. The model should say whether that is enough or whether a confirm-rule route is a needed endpoint.
