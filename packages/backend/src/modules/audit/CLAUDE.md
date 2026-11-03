# audit module

Keeps the trail of the operator's writes: one row per successful write (who, when, method, route template, the ids of the
entities it touched and a summary of ids and amounts; never names or free text). It validates nothing about money and
knows no other module; the API hook (`api/audit.ts`) records through the facade and the entity pages read `GET /audit`.

Storage: PostgreSQL schema `audit` (`migrations/postgres/0011_audit_search.sql`, Drizzle in `schema.ts`). That migration also
creates the `pg_trgm` extension and the trigram indexes of the other modules used by the global search.
