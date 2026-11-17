# labels module

Knows our own labels (0to8, Echo8), the imprint strings Believe prints and which label each string is an alias of, the
Believe accounts of a label and the register of sublabels. Since D-232 there is no label kind, no own label of a
sublabel and no sublabel rule (table `label_rules` dropped, migration `0036_labels_own_only.sql`): a sublabel is the
register (`sublabels`) plus its terms in `links.sublabel_terms`, read by its report only. It validates shapes (unique
alias, unique name) and stores nothing about money. The facade asks it for the label of record of a unit
(`index().labelOf(string)` → `{ id, name }`).

Storage: PostgreSQL schema `labels` (`migrations/postgres/0006_labels.sql`, Drizzle in `schema.ts`); artist and
document ids are checked by the facade, there is no foreign key to other modules.

`label_accounts` (D-168, migration `0014_label_books.sql`): the Believe accounts registered under a label
(`addAccount`, 409 `account_taken`, `accounts` on the label view; `index().labelOfAccount`, `ownLabels`;
`removeAccount`, D-169). Since D-169 (R6, R7) the account **is** the label boundary for money: a Believe file is
uploaded under the label its account is registered under, and the book of its units is that label (the facade checks
it; this module knows nothing about files). An account has no period (owner, 2026-11-05). `removeAccount` is called
only by the facade's `removeLabelAccount`, which first refuses an account with files (409 `account_has_files`). The
label string of a unit still decides the label of record («ours» or `label_unmapped`); the units of an account whose
string leads to another own label stay in the account's book and are reported (`labelOutsideAccount`).

`sublabels` (D-217, migration `0033_sublabels.sql`): the register of sublabels, a name only (unique per organization without case, 409 `sublabel_name_taken`). The terms of a sublabel on a track live in `links.sublabel_terms`. Since D-229 / D-230 the money reads neither (the old sublabel labels' strings are aliases of their own label); D-232 removed the old model from the code.
