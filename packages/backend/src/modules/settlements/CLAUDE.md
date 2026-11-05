# settlements module

Records operations (`in`/`out`, signed cents, optional artist, recoup scope, documents) and payout snapshots, and
validates their shape; the meaning of an operation (payout, advance, deduction, credit, return) is derived from its
fields. It computes no money: no earned amount, no balance, no recoupment. The recoupment algorithm lives in the facade
(`src/facade/layers/recoup.ts`, D-127), while the shapes it works on (`Scope`, `ScopeKind`, `IncomeItem`, `Position`,
`RecoupResult`) stay here in `recoup-types.ts`.

Every operation carries `label_id` (the own label it belongs to, D-168; migration `0014_label_books.sql`): the facade
requires it for a new operation (`label_required`) unless the operation is a migrated one, a return inherits the label
of its payout, `setLabel` marks the history (the operator through `PATCH /settlements/operations/:id`, or
`scripts/assign-operation-labels.ts`). `listOperations({ labelId })` filters by it (`null` = without a label).
`Position.labelId` / `IncomeItem.labelId` are the shapes of the recoup under a label.
