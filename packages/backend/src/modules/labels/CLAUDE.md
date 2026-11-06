# labels module

Knows our labels (0to8, Echo8), the imprint strings Believe prints and which label each string is an alias of, and the
sublabel rule of a label (a percent of the label share to a recipient pseudonym, for a period, by a document). It
validates shapes (unique alias, period, percent, no overlapping rule) and stores nothing about money. The facade asks
it for the label of record of a unit and the rule in force at a date (`index().labelOf(string, date)`).

Storage: PostgreSQL schema `labels` (`migrations/postgres/0006_labels.sql`, Drizzle in `schema.ts`); artist and
document ids are checked by the facade, there is no foreign key to other modules.

`label_accounts` (D-168, migration `0014_label_books.sql`): the Believe accounts registered under an own label
(`addAccount`, 409 `account_taken`, `accounts` on the label view; `index().labelOfAccount`, `ownLabels`;
`removeAccount`, D-169). Since D-169 (R6, R7) the account **is** the label boundary for money: a Believe file is
uploaded under the label its account is registered under, and the book of its units is that label (the facade checks
it; this module knows nothing about files). An account has no period (owner, 2026-11-05). `removeAccount` is called
only by the facade's `removeLabelAccount`, which first refuses an account with files (409 `account_has_files`). The
label string of a unit still decides the label of record and the sublabel rule; the units of an account whose string
leads to another own label stay in the account's book and are reported (`labelOutsideAccount`).
