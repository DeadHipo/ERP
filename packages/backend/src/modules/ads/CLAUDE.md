# ads module

Records advertising expenses (D-155, D-156): ISRC (or an allocated pseudonym), month, amount in cents, recovery
percent 0–100, scope (`any` / `publishing` / `isrc`), external ref (a repeated ref is skipped), source, comment.
Every arrival of data is a new record; only the recovery percent, the scope and the deactivation change. No
document is needed. It computes no money: who bears an expense and what it recoups is `src/facade/ads.ts`,
recalculated from scratch inside `calculate()`. DDL `migrations/postgres/0012_ads.sql`, Drizzle `schema.ts`.
