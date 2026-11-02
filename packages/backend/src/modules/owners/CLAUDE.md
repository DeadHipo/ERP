# owners module (module 1)

Knows owners (`person` or `label`), their pseudonyms (artists), tracks (ISRC + UPC, with an optional note), documents
and contracts, and which owner is confirmed. Every recipient of money is a pseudonym: a company, sublabel,
representative, buyer or participant gets its own pseudonym under an owner of kind `label` (or `person`). The document
kind `assumption` is a council decision recorded as a document that is never approved; the module computes no money.

Storage: PostgreSQL schema `owners` (`migrations/postgres/0003_owners.sql`, `0007_owners_track_note_assumption.sql`,
Drizzle in `schema.ts`); merges of owners and artists are recorded here and resolved by the facade.
