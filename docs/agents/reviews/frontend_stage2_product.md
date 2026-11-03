Verdict: yes

# Frontend goal, stage 2: product review of `17_frontend_model.md`, `18_frontend_plan.md`, `19_golden_screens.md`

Product member of the stage 2 council, 2026-11-03, branch `feature/fable-001` (HEAD `7193e37`; 17, 18, 19
untracked). Read-only. The only file written is this one. No server started: every claim was checked in the code.

Two blockers, both small to fix: the signal lists have no page (7 of the 11 signals are not named anywhere in 17,
18 or 19), and `rule_unconfirmed` has no golden screen. Every recomputed number in 19 is right. Four behaviour
claims about a repeated action are wrong, and a spec written from them would fail.

## What I read

- `notes/goal_prompt_frontend.md`; `16_frontend_jobs.md` (§2.1–2.8 in full); 17, 18 and 19 in full; `12_golden_cases.md`
  in full; `reviews/frontend_stage1_product.md` (style).
- Code: `facade/payouts.ts` (createOperation, createPayout, attachPaymentProof, returnPayout); `facade/balance.ts`
  (`classifyOperation`, the operation loop of `ownerBalance`); `facade/context.ts` (`blockingPayoutsOf`,
  `checkSplitDocument`); `facade/splits.ts` (floors, `closeParticipation`, `confirmSplit`, `buyout`);
  `modules/splits/service.ts` (`changeSplit`, `buyout`, `createParticipation`, `closeParticipation`, `confirmSplit`,
  `assertNoParticipation`); `modules/settlements/service.ts` (`createOperation`, `deactivate`, `recordPayout`,
  `blockingPayouts`) and `repository.ts` (`setPaymentProof`); `modules/owners/service.ts` (`createTrack`,
  `approveDocument`, `createContract`, `documentStatus`); `modules/labels/service.ts` (`addAlias`);
  `modules/publishing/service.ts` (`setTerms`, writers); `facade/sources.ts` (writer resolution);
  `facade/layers/categorise.ts`, `publishing-categorise.ts`; `main.ts` (threshold env); `shared/errors.ts`;
  `api-responses.ts` (balance fields).

## Numbers checked (documented in 19 vs recomputed from 12, 10 §3 and the balance rule of `classifyOperation`)

| Scenario | 19 says | Recomputed | |
|---|---|---|---|
| S03/8 G37 | P 50, shortfall 20; P1 100 / 100 / 0 / 0 | label share 50 < 70: P 50, missing 20; B = A 50 + P 50 | holds |
| S07/1 G15 | B −78.75, ours −21.25 | R −15, A, B −21.25 each, label −42.5, NG −21.25 | holds |
| S08/1–2 G18, G18b | C 23.375, ours 19.125; E 1.475, A 13.275 | 4.25 + 19.125; 14.75 × 10 % | holds |
| S10/2 G40 | 2710201: 57 / 25 / 7 / 25; earned 75 | 50 + 7 unknown pair; A 50 + 25 | holds |
| S11 G24 | UPC1 B 55 ours 45; UPC2 27.5 / 22.5; P1 150 / 82.5 / 0 / 67.5; P earned 7.5 | 10 % of 50 and of 25 | holds |
| S12 G19 | before 100 / 5 / 50 / 45; after 100 / 55 / 0 / 45; Owner A earned 0 → 50 | the row has no document, so `split_unconfirmed`; after the split document is set: B | holds |
| S13 G10a/b | 03: 100 / 30 / 20 / 50 → 100 / 50 / 0 / 50; 05 stays 100 / 7 / 20 / 73; signal Q1 40 → 20 | `changeSplit` closes `[2020-01-01, 2026-05-01)` at 03-01, the new split runs to 05-01 (the existing `validTo`); the buy-out split keeps L's Q1 | holds |
| S14, S15 | 100 / 0 / 50 / 50 → 100 / 50 / 0 / 50; payable 0 → 50 | categorise steps 3 and 4 | holds |
| S16, S17 G08c | 100 / 50 / 50 / 0 → 100 / 50 / 0 / 50 and → 100 / 75 / 0 / 25 | alias makes the share ours; rule 50 % of 50 | holds |
| S18 G26 | b17 03: 400 / 170 / 50 / 180 → 400 / 220 / 0 / 180; W1 100, W2 70 | 25+45+25+25+50; T-D's label 50 is already ours | holds |
| S19 | 100 / 0 / 100 / 0 → 100 / 50 / 0 / 50 | ambiguous holder → owner null → `writer_unmapped`, author and label 0 | holds |
| S20 G30 | 9 / 0 / 9 / 0 → 9 / 0 / 2 / 7, `ourShareNoSplit` 7 | the registered pair has no split (D-029) | holds |
| S21 G22 | A 0, P 10, ours 90 before and after; shortfall gone | pool 10, target 10 | holds |
| S22 G27 | 15 − 10 = 5; after Pay payable stays 5 and `blockingPayouts` [payout]; after proof paid 5, payable 0; Pay again: `nothing_to_pay` | `recordPayout` sets `deferred: true`; `classifyOperation`: out without proof is not counted; `setPaymentProof` clears `deferred`; `cents <= 0` is checked before the threshold | holds |
| S22/k2 G27b | P1 04 −100 / −57.5 / 0 / −42.5; P-222 remaining 10, payable 0 | sign rule; G27b | holds |
| S23 G29 | NG earned 25, recouped 25, payable 0, `nothing_to_pay` | | holds |
| S24/2–3 G28, G39 | payable −20, −7.5, shown 0 | 50 − 70; 42.5 − 50 | holds |
| S25 G09 | earned 150 → 100 → 75; stored dates 03-01, 05-01 | floors in `facade/splits.ts` | holds |
| S27, S28 G14, G25 | P earned 15 → 7.5; P1 B 50 → 57.5 | | holds |
| S29 G23 | `double_participation` twice, `top_above_100` | `createParticipation` row check; `assertNoParticipation` in `changeSplit` (in the transaction, rolled back); 60 + 60 > 100 | holds |
| S31 k1–k3 G43 | without proof: payable 80, the advance is pending and blocking; with proof: recouped 30, payable 50; 80; 60 | `blockingPayoutsOf` includes an out operation with scope and no proof | holds |
| S31 k4 | 40 → 45 → 55 → 0 → 55 | deduction: in, scope defaults to `any`, a position; credit −5: `tCredits += −amount`; return −5500: `tReturns += −amount`, its `return_proof` has `requiresApproval: false`, so it counts as `approved` | holds |

## Findings

**1. Blocker: no page lists the signals.** P1 says "signal count → its list", but 17 §3 has no signal page or route,
and N1 returns only counts. `sublabelWithoutRule`, `ruleRecipientIsRow`, `twoRowsOneOwner`, `tracksWithNote`,
`participantsWithoutOwner`, `ambiguousWriters` and `unallocated` are not named anywhere in 17, 18 or 19. The 16 §2.7
actions for them (set the sublabel rule; change the split or close the rule; edit the note; assign an owner) have no
screen to start from. `unfunded` appears only as the API `/signals` in S03/8 and S21, not as a page. Fix: add a page
P21 «Сигналы» at `/signals/:name` (or a tab on P1). Each list should get its 16 §2.7 action, with "information only"
for `twoRowsOneOwner`, and a row should link to P6, P16 or P17. Add a golden check of one row before and after for
each signal the seed produces (S03/8, S13, S16, S19, S20, S21, S30 already create six of them). Also add one small
scenario for `sublabelWithoutRule` and one for `tracksWithNote`.

**2. Blocker: `rule_unconfirmed` (C reason 8 of 10) has no golden screen.** 16 §2.6 says it can be tested only on
synthetic data. 19 has no scenario for it, and 17 §6 has no line "attach a document to a rule". Fix: add S32. Seed a
row A 50 and P 10 `(bucket, label_share)` whose document is a `contract` with a file that is not approved. Before:
P 5 C `rule_unconfirmed`, P1 100 / 50 / 5 / 45, and the P2 group keyed `participation`. Action: approve the
document; its dialog shows "releases 5" from N13. After: P 5 B, P1 100 / 55 / 0 / 45. Also add a variant on a label
rule. The second action of 16 (close and re-create with a new document) can share S21's dialog.

**3. Should-fix (wrong behaviour claim). S21 "second close of the closed participation: refused".** The facade floors
2026-03-01 to the same date. `closeParticipation` refuses only `validTo <= validFrom` or `validTo > p.validTo`, and
an equal date is neither. The second close therefore returns 200 and changes nothing. The spec should expect a
success no-op, not an error toast.

**4. Should-fix (wrong claim). S18 "Repeat: a new term closes the previous one".** A repeat with the same `validFrom`
is refused with `terms_overlap` (409), because `existing.some(t => t.validFrom >= validFrom)` matches. Numbers stay
unchanged. 16 §2.6 says the same thing ("a new term closes the previous one"), which holds only for a later date.

**5. Should-fix (wrong claim and a product gap). S13 / S25 / 17 §6: "a second identical split change is refused or a
no-op".** It is neither. `changeSplit` finds the new split covering `from`, sets its `validTo` to `from` (an empty
period `[03-01, 03-01)`), and inserts another identical split. Money is unchanged, but the Правила tab gains an
empty-period history row on every double press. 19 §4 check 5 presses every irreversible button twice, so the spec
will see it. Pin the real behaviour, or add an idempotency refusal (`split_unchanged`) in stage 3 with a D-entry. I
prefer the refusal, because the operator reads the history.

**6. Should-fix (wrong note). 19 §7 item 9: "a second `returnPayout` … no guard seen".** The guard is in
`settlements.createOperation`: `Returns cannot exceed the payout` (`validation_error`, 400). The other repeats, as
the code behaves: a second deactivate gives a 409 `Operation is already inactive`. A second alias gives a 409
`alias_taken`. A second contract on one document is accepted: a second contract row, harmless, and the money is
unchanged. Approving twice keeps the first approval. Write these exact outcomes into the specs instead of "refused
or no-op".

**7. Should-fix: the pay button's gate is a money comparison in the client.** 17 §6 disables Pay "when not confirmed,
blocked or payable ≤ 0", and 17 §1 rule 4 forbids the client a rule of its own. The balance response has
`confirmed`, `blockingPayouts` and `payable`, but no gate field and no threshold, so "≤ 0" and `below_threshold`
would be client arithmetic. Add `payout: { allowed: boolean, reason: 'owner_not_confirmed' | 'payout_blocked' |
'nothing_to_pay' | 'below_threshold' | null, amountCents }` to the balance and to N4, computed with the same checks
as `createPayout`. An unproved payout also blocks a new advance (`createOperation` out gate), so the Операции tab
should say so as well.

**8. Should-fix: drill-down is not complete.** P1's C cells go to the queue and the month goes to source lines. B and
"ours" per account and month have no target, and N5 has no `month` or `account` filter, so the chain «сверка →
месяц → трек» breaks for B. Add `month` and `account` to N5 and link the B and ours cells of P1 to
`/tracks?month=&account=`. Also link P10 "paid" and "recouped" to P20 filtered by owner and meaning, and P17
`ourShareByLabel` to P5 filtered by label. The rest of the chain is enough: P2 → P6 → allocation → rule → P14, and
the layers in N7.

**9. Should-fix: no golden screen for merge or upload.** Merge (irreversible, named in the goal prompt) and the first
step of the Believe month job (P19 upload, a duplicate refused) have actions in 17 but no scenario. Add S33: merge
two owners, with both P10 balances before and the survivor's after, and pseudonyms and documents moved. Add S34:
upload a CSV, the P1 row appears, and a second upload is refused with its code.

**10. Should-fix: names.** «Вопросы владельцу» sits next to «Владельцы» and «Владелец», where the word means the
rights holder. In this one it means the label's owner, and an operator will read "questions to the rights holder".
Rename it to «Решения руководителя» (or «Открытые вопросы»). «Очередь C» relies on the internal letter: use «Ждёт
разбора» with C in the subtitle. P4 «Выплаты» and P9 «Владельцы» ask nearly one question on one endpoint. Keep P4 as
a filtered view (payable > 0 or blocked, server-side flag) and say so in its sentence. The other pages answer one
question each.

**11. Note: S14 approval needs a file.** `approveDocument` refuses `document_not_attached`. S14 says "create document
kind contract → approve" and should state the file ref, as S12 does.

**12. Note: 17 §6 explains `split_document_set` imprecisely.** The refusal fires because the split already has a
different document. `confirmSplit` never touches a row's own document. The 19 S13 wording is right; align 17 §6
with it.

**13. Note: N17 has no amount field.** 16 §2.8 promises "the open items with their decision ids and amounts". Add
`amount?` and a `link` per item (the place exists, so this is not a blocker).

**14. Note: track note.** 17 §6 has "set identifiers / note" (`PATCH /tracks/:id`), but no page lists it among its
actions. Put it on the P6 header (it is the `tracksWithNote` action of finding 1).

## Jobs of 16 §2 walked on 17 §3

Every job has a page. The exception is the signal-driven jobs (finding 1).

| Job | Page and action |
|---|---|
| Daily inbox; document arrived; validate entries | P1 → P2 by reason; P13 / P14 (create, attach, approve, confirm split, contract); P15 `status=unconfirmed`; P9 status filter |
| Ambiguous pseudonym; payment request; "why is my amount X" | P11 duplicates → assign owner / P6 create split; P10; P10 → P6 |
| Believe month: load, completeness, imprint strings, pairs, no-split ISRCs, sanity | P19 upload; P1; P2 `label_unmapped` / P17; P2 `unknown_pair`, `no_isrc` ⚠; P5 `hasSplit=false`; P19 lines facets |
| B17 quarter: load, writers, terms, author reports | P19; P18 map / resolve; P2 `publishing_terms_unconfirmed` / P18 set terms; P10 Паблишинг |
| New contract: rows, carves, sublabel, buy-out, advance, deduction, term end | P6 / P15 / P16 / P17; P10 Операции; P16 / P17 close |
| Payout: who, who is blocked, pay, prove, label summary, sublabel | P4; P10 (button, snapshot); P20 proof; P1 `ourShareByLabel`; P10 of the sublabel owner |
| Signal lists (`sublabelWithoutRule`, `ruleRecipientIsRow`, `tracksWithNote`, `participantsWithoutOwner`, `unfunded` list, `twoRowsOneOwner`) | **no page** (finding 1) |

Coverage: 10 C reasons, 9 with a golden screen (`rule_unconfirmed` missing, finding 2). 11 signals, 4 shown on a
page (`assumptions`, `labelUnmapped`, `isrcsWithoutSplit` via P5 / P11, `unallocated` via P2). The open items of 15
§3: all 14 have a place (P2 or P3 via N17; finding 13 is cosmetic).

## Assumptions of 18 §6

All acceptable for the operator, with two conditions. A3 (hand-kept question list): the test should compare the item
ids with `15` §3, so the list drifts visibly. A5 (the dialog shows the held balance and the backend recalculates):
the success toast must show `amountCents` from the response, because the paid amount can differ from the dialog.
A2, A4, A6, A7 and A8 are fine. A8's per-case accounts are needed for P1 to show exactly the golden rows.

## Recommendations for stage 3

1. Add P21 «Сигналы» (finding 1) and S32 `rule_unconfirmed` (finding 2). Then this verdict turns to yes.
2. Correct S13, S18, S21 and §7 item 9 to the code's real outcomes (findings 3–6). Decide `split_unchanged` in the
   D-entry of step 3.5 or 3.6.
3. Add the payout gate field (finding 7) in step 3.3a with N4, before the P10 page is built.
4. Add `month` and `account` on N5 and the P1 B / ours links (finding 8); add S33 merge and S34 upload (finding 9).
5. Fix the page names in `i18n/ru.ts` from the start (finding 10).

## Revision 2 (re-review, 2026-11-03)

I re-read 17, 18 and 19 (revision 2) and checked the new claims in the code. The error codes `owner_merged`,
`merge_direction`, `merge_kind_mismatch`, `artist_owner_fixed`, `duplicate_period`, `duplicate_file`,
`duplicate_track` and `rule_overlap` all exist in `packages/backend/src`. `sublabelWithoutRule` is keyed by sublabel
and month in `facade/reports.ts`. **Both blockers are resolved, so the verdict changes to yes.**

Resolved:
- **Blocker 1:** P21 «Сигналы» (`/signals`, `/signals/:name`) is in 17 §3, with the 16 §2.7 action for every list. It
  is in 18 step 3.5 and D-145. In 19, S35 adds `sublabelWithoutRule`, `ruleRecipientIsRow`, `twoRowsOneOwner`,
  `tracksWithNote` and `participantsWithoutOwner`, and P21 rows are listed for the other six lists from S03/8, S08,
  S13, S16–S21, S30 and S37. S35/4 recomputes: P 10 % of 50 = 5, C `artist_without_owner` → B; P1 100 / 50 / 5 / 45 →
  100 / 55 / 0 / 45.
- **Blocker 2:** S32 `rule_unconfirmed` gives 100 / 50 / 5 / 45 → 100 / 55 / 0 / 45, keyed by participation, and the
  dialog says «ждёт этого документа: 5». These numbers hold.
- **Findings 3–6:** the second requests are now recorded per action (17 §6, 19 §5 table): close the same date → 200
  no-op; terms → 409 `terms_overlap`; identical change → 201 with an empty period plus an identical split (open
  point 1); return → 400; deactivate → 409; alias → 409 `alias_taken`; a second contract → 201, harmless. These match
  the code I read.
- **Finding 7:** the pay gate is now an API field, `PayoutGate` (N19), built by one helper that `createPayout` also
  uses. S22 asserts it, including the deferred-with-proof state: counted but blocking, which matches `classifyOperation`
  plus `blockingPayoutsOf`.
- **Finding 8:** the B and ours cells of P1 now go to `/tracks?account&month`, and N3 and N5 carry the filters.
- **Finding 9:** S33 merge adds up: P1 200 / 50 / 50 / 100 → 200 / 100 / 0 / 100, and X earned 50 → 100. S34 upload
  gets `duplicate_period` / `duplicate_file`.
- **Findings 10–14:** «Очередь ожидания (C)» and «Решения руководителя»; P4 folded into `/owners?view=payouts`; S14
  attaches the file before approving; the track note is on the P6 header; the open questions are a static
  `OPEN_QUESTIONS` with a test on the 14 ids.

Remaining (should-fix or note, not blocking):
- Open point 1, `split_unchanged`: I still prefer a refusal. Decide it in the D-entry of step 3.5 or 3.6.
- The S32 variant on a sublabel rule was not added. Acceptable, because `rule_unconfirmed` is keyed and categorised
  the same way for every rule kind (`categorise.ts` step 2).
- The S35/1 seed text ("units 03 and 06 (100 and 40 on that string)") does not say clearly which unit and month give
  the `140` row. Spell it out when writing the spec.
- 19 §5 lists codes still to verify in 3.x: map writer twice, create track twice, the HTTP status of
  `top_above_100`. The code answers the create-track case: `duplicate_track` (409, `ConflictError`).
