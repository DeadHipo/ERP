# labels module

Knows our labels (0to8, Echo8), the imprint strings Believe prints and which label each string is an alias of, and the
sublabel rule of a label (a percent of the label share to a recipient pseudonym, for a period, by a document). It
validates shapes (unique alias, period, percent, no overlapping rule) and stores nothing about money. The facade asks
it for the label of record of a unit and the rule in force at a date (`index().labelOf(string, date)`).

Storage: PostgreSQL schema `labels` (`migrations/postgres/0006_labels.sql`, Drizzle in `schema.ts`); artist and
document ids are checked by the facade, there is no foreign key to other modules.

`label_accounts` (D-168, migration `0014_label_books.sql`): the Believe accounts registered under an own label
(`addAccount`, 409 `account_taken`, `accounts` on the label view; `index().labelOfAccount`, `ownLabels`). An account
is never a label boundary for money (the unit's label string is): the facade only reports the units of an account that
lead to another own label (`labelOutsideAccount`).
