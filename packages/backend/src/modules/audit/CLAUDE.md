# audit module

Keeps the trail of the operator's writes: one row per successful write (who, when, method, route template, the ids of the
entities it touched and a summary of ids and amounts; never names or free text). It validates nothing about money and
knows no other module; the API hook (`api/audit.ts`) records through the facade and the entity pages read `GET /audit`.

Storage: PostgreSQL schema `audit` (`migrations/postgres/0011_audit_search.sql`, Drizzle in `schema.ts`). That migration also
creates the `pg_trgm` extension and the trigram indexes of the other modules used by the global search.

`actions.label_id` (D-169, R11, migration `0015_label_books_2.sql`): the own label of the write, stored as given
(`record({ labelId })`); the hook `api/audit.ts` (`labelOfWrite`) chooses it: `?label=` → `labelId` of the body → the one
label of `items[]` → the response's `labelId` for the routes of `RESPONSE_LABEL_ROUTES` → empty. `listRecent(limit,
labelId?)` / `listByEntity(id, limit, labelId?)` filter strictly `label_id = L`. The history is never back-filled.
