# labels module

Knows our labels (0to8, Echo8), the imprint strings Believe prints and which label each string is an alias of, and the
sublabel rule of a label (a percent of the label share to a recipient pseudonym, for a period, by a document). It
validates shapes (unique alias, period, percent, no overlapping rule) and stores nothing about money. The facade asks
it for the label of record of a unit and the rule in force at a date (`index().labelOf(string, date)`).

Storage: PostgreSQL schema `labels` (`migrations/postgres/0006_labels.sql`, Drizzle in `schema.ts`); artist and
document ids are checked by the facade, there is no foreign key to other modules.
