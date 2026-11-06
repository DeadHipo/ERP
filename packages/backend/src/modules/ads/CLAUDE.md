# ads module

Records advertising expenses (D-155, D-156): ISRC (or an allocated pseudonym), month, amount in cents, recovery
percent 0–100, scope (`any` / `publishing` / `isrc`), external ref (a repeated ref is skipped), source, comment.
Every arrival of data is a new record; only the recovery percent, the scope, the payer label and the deactivation
change. No document is needed. It computes no money: who bears an expense and what it recoups is `src/facade/ads.ts`,
recalculated from scratch inside `calculate()`. DDL `migrations/postgres/0012_ads.sql`, Drizzle `schema.ts`.
`labelId` is the payer (D-169, R9): the own label whose book the expense charges. Every new record needs it
(`label_required`) except a migrated one with an ISRC (the stage 4 loader); `assignLabel` (only a NULL label) is for the
script `assign-label-books --step ads`. `list({ labelId })` filters by the payer (`null` = without a label). The ISRC's
label string decides only the sublabel rule (who bears the unrecovered part), in the facade.
