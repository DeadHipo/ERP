Verdict: yes

# Frontend goal, stage 1: product review of `16_frontend_jobs.md`

Product member of the stage 1 council, 2026-11-03, branch `feature/fable-001` (HEAD `a00ea1a`, `16` untracked).
Read-only. The only file written is this one.

## What I ran and read

- Read: `notes/goal_prompt_frontend.md`; `docs/agents/16_frontend_jobs.md`; the study files in the session scratchpad
  (`stage1/operator_jobs.md`, `current_pages_audit.md`; the names only of `zero_erp_survey.md`); the owner answers
  of 02.11 (`context_data/ответы_разработчику_реестры_v5_2026_11_02.md`); `notes/settlement_landscape.md` §2, §5,
  §6, §7, MVP list; `15_mvp_report.md` §2–§4; `13_completeness_check.md` §3(c), (d); `docs/02_модель_данных.md`
  (validation by managers); `packages/shared/src/reasons.ts`, `signalsSchema` in `api-responses.ts`;
  `facade/layers/categorise.ts`; `modules/owners/service.ts` (`confirmedOwnerIds`); `api/operations.ts`.
- Report-processor READMEs sampled (read only): `task_103` (TASK.txt), `task_119`, `task_113`, `task_192`.
- Side API on port 3018 (`main.ts data/real`), GET only: `/owners`, `/artists`, `/documents`, `/labels`,
  `/participations`, `/settlements/operations`, `/splits?limit=1000`, `/tracks`, `/reconciliation`, `/signals`,
  `/owners/:id/balance` for 5 owners (2 with the most operations, 3 of kind label), one `/tracks/:isrc/explain`.
  **The side server is stopped** (pid on 3018 killed; `lsof -i :3018` shows nothing). Ports 3000 and 3017 untouched.

## Claims checked

| Claim in `16` | Result on the API | |
|---|---|---|
| Owners 1,151 (1,134 person, 17 label; 421 confirmed, 730 waiting) | 1,151; 1,134 / 17; `confirmed` 421, `waiting_documents` 730 | holds |
| Documents 1,397 by kind; 45 `assumption` `not_approved` | same counts; 45 `not_approved`, all `assumption`; **the other 1,352 are all `approved`** | holds, but see finding 1 |
| Tracks 26,305, 11,089 UPC, up to 60 per UPC; `?isrc` ignored | 26,305 / 11,089 / 60; `?isrc=XX` returns all rows (3.4 MB) | holds |
| Operations 2,662 (payout 2,400, recoupable 158, deduction 104 of which 55 inactive) | same | holds |
| Negative payable on both sampled paid owners | owner 0637477b: payable −141,428.96 (earned 225,652.97, recouped 47,900, paid 319,181.93), shown 0; owner 28b3b646: −1,584.10, shown 0 | holds |
| Every sublabel's money is in C | 77 Records (owner d9919aac): earned 0, waiting 14,326.87 `owner_unconfirmed` (= `15` §3.6); Bear 9.81 and CATCORE 1,143.42 `assumption` | holds |
| 45 assumptions; assumption money | 45 items (44 `document`, 1 `r1`), Σ 144,195.41 = `15` §4 | holds |
| Signals counts | isrcsWithoutSplit 2,500; unfunded 507; twoRowsOneOwner 785; tracksWithNote 11; sublabelWithoutRule 10 (all `lost`); participantsWithoutOwner 3; ruleRecipientIsRow 0; labelUnmapped 0; ambiguousWriters 0 | holds |
| "unallocated pairs 4", C `unknown_pair` | **wrong**: `unallocated.count` 394, total 2,364.33 = `withoutIsrc`; every pair has an empty ISRC and a known UPC with a title. C has no `unknown_pair` money; it is all `no_isrc` | finding 3 |
| Signals are "10 lists" (`limit` applies to 2 of 10) | `signalsSchema` has **11** lists; `ruleRecipientIsRow` is missing from §4.1 | finding 3 |
| Reconciliation 52 rows, 2024-01 … 2026-08, discrepancy 0 | **54 rows, 2023-11 … 2026-08** (34 + 13 Believe, 7 B17); discrepancy 0 on every row | minor |
| Timings: reconciliation 7.8–8.2 s, signals 8.4 s, balance 6.8–7.7 s, explain 4.8–15.6 MB | 7.3 s, 7.9 s, 6.1–6.7 s; explain of a random track 6.3 s and 2.8 MB | holds (explain range is for heavy tracks) |
| C by reason (not in `16`; from reconciliation) | owner_unconfirmed 1,114,884.25; split_unconfirmed 454,219.20; publishing_terms_unconfirmed 325,405.99; assumption 144,195.41; artist_without_owner 5,296.64; no_isrc 2,364.33; rule_unconfirmed, label_unmapped, unknown_pair, writer_unmapped 0 | finding 1 |

## Findings

1. **Blocker: the C reason → action mapping is missing from the document and wrong for the real data.** The goal
   (stage 6) requires every C reason to close by an action on the screen, and the C queue is the central screen.
   `16` never gives the ten reasons with their actions; §7.2 points at "`D` tables of the study", which live only in
   the session scratchpad (`operator_jobs.md` lines 105–116), not in the repo. What `16` does say leads the design
   the wrong way:
   - §2.1 and §7.2 make "approve a document" the main unblocking action, and §4.5(b) keys `split_unconfirmed` and
     `rule_unconfirmed` by document. On the real data **there is no document to approve**: all 1,352
     non-assumption documents are `approved`. `categorise.ts` gives `split_unconfirmed` when the row's document is
     not approved, including when it is `null`; in a `/splits?limit=1000` sample 538 of 1,000 splits have
     `documentId: null`. The 454,219 of `split_unconfirmed` are therefore splits **without a document**: the action
     is "create the document, then `POST /splits/:id/confirm`" (an operation `16` lists as having no page), grouped
     by owner or artist and ISRC, not by document.
   - `owner_unconfirmed` is the largest bucket (1,114,884 = master 594,298 + B17 520,584), and `16` names no action
     for it except "confirm it" for B17 holders. An owner is confirmed by a contract with an approved document
     (`confirmedOwnerIds`), so the action is "create a contract for the owner and its artists" (`POST /contracts`),
     or merge a holder owner into a confirmed one (`POST /owners/merge`, D-083 ⚠ for the holders), or link the
     NoGhost contract to its owner (blocked by C22, `15` §3.6).
   - `no_isrc` (2,364.33, 394 UPC-only pairs) is mapped to "add the track (ISRC + UPC)". The lines have no ISRC, so
     adding a track does nothing; D-035 ⚠ waits for the owner. The action is "show, no action, ⚠ D-035"
     (report-processor `task_103` resolves such lines by a UPC fallback, which is the owner's decision to make).
   Fix: add to `16` a table of the 10 reasons with today's amount, the acting entity, the action and its operation,
   and the ⚠ when the action is the owner's.
2. **Blocker: "resolve a pseudonym" is a job named by the goal and absent from `16`.** The goal lists
   "разрешает псевдоним"; `15` §3 item 3 (and `13` C14) names the ambiguous pseudonyms DJ VETA3, DSHZS, MC FLYXO,
   !Nxght: 415 Echo8 ISRC without a split or owner and 25 Main rows (28,402.51) not loaded. `16` mentions only
   `ambiguousWriters` (B17 writers, 0 today) and a generic "merge". The job (which of two same-named artists is
   meant, split the ISRC between them, then create the splits) needs a screen and probably an endpoint; stage 2
   cannot design it if stage 1 does not state it. Add it to §2.1 or §2.2 with its data and the available operations
   (`POST /artists/:id/owner`, `POST /owners/merge`, splits).
3. **Should-fix: the signal facts and actions.** Signals are 11 lists, not 10; `ruleRecipientIsRow` is absent from
   §4.1. "unallocated pairs 4" is wrong (394 UPC-only pairs, see table). No action is named for `unfunded` (507,
   a carve larger than its bucket: fix the participation's base or percent), `ruleRecipientIsRow` and
   `twoRowsOneOwner` (decide row or participation, D-126; the latter is information only by its schema),
   `tracksWithNote` (M29: show, no money action), `participantsWithoutOwner` (assign an owner to the pseudonym).
   Add a table of the 11 lists with count, action or "information only".
4. **Should-fix: open question 1 is partly answered.** `docs/02_модель_данных.md` §"Валидация менеджерами" says
   the operator enters records and a manager validates them against the contract; a new release or artist goes to
   the managers for validation; a merge is decided by operator or manager and journaled. That is a job missing from
   §2 (a validation queue: what the operator entered and nobody has checked) and a source for §8.1. The assumption
   "one role, an operator field" is acceptable while roles are out of scope, but the document should cite `02` and
   keep the enter / validate distinction visible (who entered, who approved).
5. **Should-fix: open question 3 is answered.** The MVP list of `notes/settlement_landscape.md` says the payout
   side (threshold USD 100, currencies, minors, W-8BEN, disputes) is outside the MVP; `13` C28 lists the same.
   Cite them instead of "open". Questions 4 (ads: MVP item 33 ◻ later), 8 (⚠ list = landscape §7 item 6; add
   D-067) and 9 (`15` §4 assumption) also have sources. Questions 2, 5, 6, 7, 10 are genuinely open; their
   assumptions are acceptable for an operator. The owner answers of 02.11 do not touch operator workflow.
6. **Should-fix: `15` §3 open items are not mapped to where the operator sees them.** The goal requires each of the
   14 items to be visible in the C queue. Several are not C at all: item 3 (no split, no owner), 7 (M51 buy-outs,
   B or ours), 9 (M58 not expressible), 10 (161 owner residuals, Zachz Winner 21,225.40 owed), 11 (622,048 ours by
   D-029), 14 (165.80 ours). `16` should list the 14 items with "C reason / signal / needs an owner-check list" so
   stage 2 designs a place for the non-C ones (a watch list of owner questions).
7. **Note: report shapes (§3) hold on the sample.** `task_119` produces three variants per artist (artist share,
   label share, label + artist) by month; `16` names only the artist one. `task_192` is per artist and release for
   a corrected split and counts only money already paid out (Main Expense), which `payable < 0` per owner does not
   show by release. `task_103` and `task_113` match.
8. **Note:** `uploadDeadline` exists on documents but none is set (0 of 1,397); a "documents past deadline" job is
   not needed now. Reconciliation starts in 2023-11, not 2024-01.

Would an operator recognise the work? Mostly yes: the cadences, the Believe and B17 load steps, the contract
mechanics table and the payout steps read like Main and report-processor. What they would not recognise is the
inbox: their real queue is "1.1 M waits for owner contracts, 0.45 M for split documents, 0.33 M for publishing
terms, 0.14 M on assumptions", and "approve" is not a button they will ever press on today's data.

## Recommendations for stage 2

1. Put the reason table (finding 1) and the signal table (finding 3) into `16` before `17`; design the C queue
   from them: group `split_unconfirmed` by owner / artist / ISRC, `owner_unconfirmed` by owner with the contract
   form, show `no_isrc` and ⚠ items read-only with their decision id.
2. Design the "create document and link it" flow (document → contract or split confirm) as one action, since that
   is the operator's main job; keep approve for documents entered by the operator and validated by the manager.
3. Add the ambiguous-pseudonym screen and the owner-question watch list (findings 2, 6).
4. In the golden screens (`19`), include a split without a document, an owner without a contract and a
   negative-payable owner, with numbers before and after the action.

## Revision 2

Re-read `16_frontend_jobs.md` revision 2 (2026-11-03) read-only. I made no new API calls: every number it adds is one
I measured above (C by reason, 1,352 approved documents, 538 of 1,000 splits without a document, 394 UPC-only
pairs, 54 reconciliation rows from 2023-11, 11 signal lists). The side server is still stopped.

- **Finding 1 (blocker) is resolved.** §2.6 now has all 10 reasons. For each it gives today's amount, the queue key,
  the action, the operation and whether the action is irreversible. It states that "create the document and link it"
  is the main action, not "approve":
  - `split_unconfirmed` is keyed by owner → artist → ISRC, with `POST /splits/:id/confirm`;
  - `owner_unconfirmed` closes through `POST /contracts` or a merge (D-083 ⚠);
  - `no_isrc` is read-only under D-035 ⚠.
  The four reasons with no money today are tied to the golden cases.
- **Finding 2 (blocker) is resolved.** §2.1 adds "resolve an ambiguous pseudonym" with the four pseudonyms, the 415
  Echo8 ISRC, the 25 Main rows and the available operations. §2.8 places it outside C.
- **Finding 3 is resolved.** §2.7 has the 11 signals with counts and actions, and §4.1 is corrected.
- **Finding 4 is resolved.** §1 and §8.1 cite `docs/02`. §2.1 adds "validate what was entered". "Entered by" and
  "approved by" are shown apart.
- **Finding 5 is resolved.** §8 is a table with sources; questions 3, 4 and 9 cite theirs. My request to add D-067
  was wrong: the index shows it closed by D-123 / D-127, as revision 2 says.
- **Finding 6 is resolved.** §2.8 maps all 14 items of `15` §3. The items that are not C go to a read-only
  owner-question list.
- **Note 7 is resolved** (`task_119` variants, `task_192` paid cash only). **Note 8 stands as a note.**

Remaining for stage 2, none blocking:
- the owner-question list needs a source of truth: a data table, or `15` §3 rendered. `17` has to choose one.
- the "validate what was entered" queue has no data today (no `not_approved` documents except the assumptions).
  Golden screens should create one.

Product accepts stage 1.
