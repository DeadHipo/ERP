# settlements module

Records operations (`in`/`out`, signed cents, optional artist, recoup scope, documents) and payout snapshots, and
validates their shape; the meaning of an operation (payout, advance, deduction, credit, return) is derived from its
fields. It computes no money: no earned amount, no balance, no recoupment. The recoupment algorithm lives in the facade
(`src/facade/layers/recoup.ts`, D-127), while the shapes it works on (`Scope`, `ScopeKind`, `IncomeItem`, `Position`,
`RecoupResult`) stay here in `recoup-types.ts`.
