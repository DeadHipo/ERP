# settlements module

Records operations (`in`/`out`, signed cents, a stored kind, optional artist, recoup scope, documents) and payout
snapshots, and validates their shape. Since D-173 the kind is stored (`operations.kind`, migration
`0019_operation_kinds.sql`; the history was filled by `settlements.kind_of` = the former `meaningOf`): `payout`,
`advance`, `deduction`, `credit`, `return`, `buyout`, `forgiveness`, `writeoff`, `adjustment` (the list and the allowed
document kinds per kind in `packages/shared/src/operation-kinds.ts`); the CHECK `operations_kind_rules` holds the
fields of each kind. `meaning` is an alias of `kind` for one stage with its old values (`advance` answers `recoupable_payout`, a
filter `meaning=recoupable_payout` reads `kind = 'advance'`). It computes no money: no earned amount, no balance, no recoupment. The recoupment algorithm lives in the facade
(`src/facade/layers/recoup.ts`, D-127), while the shapes it works on (`Scope`, `ScopeKind`, `IncomeItem`, `Position`,
`RecoupResult`) stay here in `recoup-types.ts`.

Every operation carries `label_id` (the own label it belongs to, D-168; migration `0014_label_books.sql`): the facade
requires it for a new operation (`label_required`) unless the operation is a migrated one, a return inherits the label
of its payout, `setLabel` marks the history (the operator through `PATCH /settlements/operations/:id`, or
`scripts/assign-operation-labels.ts`). `listOperations({ labelId })` filters by it (`null` = without a label).
`Position.labelId` / `IncomeItem.labelId` are the shapes of the recoup under a label.

**Kinds (D-173).** The service branches by `kind`, never by direction: blocking payouts = `kind IN ('payout','advance')`
(a `buyout` is out but never blocks; the same rule sits in `facade/balance.ts` and `facade/context.ts`), `deactivate`
refuses an advance with an active forgiveness (`409 has_forgiveness`) and a payout with an active return
(`has_returns`), a return must refer to a `kind = 'payout'`, `payout_sent` / `payout_paid` only for a payout,
`attachPaymentProof` / `setDeferred` for payout, advance, buyout. Columns of 0019: `label_source` (`one` / `default` /
`operator` / `payout`, NULL until `assign-operation-labels.ts --mark-source`; new operations `operator`, a return or a
forgiveness `payout`), `channel` (text), `area` (`master` | `publishing`, default `master`; a write-off is always
`publishing`), the index `operations_external_ref (org_id, external_ref)` for the duplicate search of the import.
`setLabel(id, labelId, 'operator')` is the `PATCH` with a reason (the reason lives in the audit only). The module still
computes nothing: the forgiveness capacity is in `facade/layers/recoup.ts` (`Position.forgiven`,
`RecoupResult.forgiven` in `recoup-types.ts`), the book fields and the import are the facade's.

**The admission (D-176, migration `0021_admission.sql`).** `settlements.payees` (one active per owner: `channel` tipalti | easystaff | other, `payee_ref` or null = by the payment history, `status`, `basis`, `valid_from`, `source`; `setPayee` replaces the active one with the reason «replaced», `deactivatePayee`), `settlements.holds` (`kind` decision | artist_request | question | dispute, `blocks`, `reason`, `release_when`, `amount_cents`, `period`, `review_on`, `since`, `label_id` or null = every book, `status` active | released; `createHold`, `releaseHold` with a reason), `settlements.payout_answers` (`due_cents` > 0, `decision` pay | pay_task, `why`, `about`, `answered_by`, `label_id`; `createAnswer`, `deactivateAnswer`). The module keeps the rows; the owner, the label and what they do to the gate are the facade's (`facade/admission.ts`, `payout-gate.ts`).

**Opening balances (D-174, `settlements.opening_balances`, migration `0020_opening_balances.sql`).** A row per pseudonym
and book: `kind` `start` (the cabinet snapshot of the cut: `master_cents`, `publishing_cents`, or `missing` = no
amount, not a zero) or `adjustment` (an approved correction with its `basis`, optionally `document_id` and
`operation_ref` = an advance before the cut kept alive after it); `cutoff_month` (the first day of the last report
month inside the start) and `synced_at` (the boundary of the movements); never edited, a soft rollback
(`deactivated_at` / `deactivated_reason`). `createOpeningBalance` keeps the shape (`kind_unknown`, `amount_invalid`,
`missing_with_amount`, `basis_required`, `synced_before_cutoff`, one active start per pseudonym, book and cut:
`409 start_exists`), `listOpeningBalances({ labelId, artistId, kind, active })` (oldest first), `getOpeningBalance`,
`deactivateOpeningBalance` (`409 already_inactive`, `reason_required`). The pseudonym, the document and the operation are
checked by the facade (`facade/start.ts`); what the rows do to the balance is `facade/balance.ts`.
