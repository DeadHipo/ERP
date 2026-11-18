-- D-235: the schema of publishing v1 goes (the owner, 2026-11-18, «Yes, drop it»). Since D-234 no code reads it: the money
-- of publishing comes from the report summaries (`pubv2`) and the links. The live store held 6 statements, about 1.16M
-- lines, 47 writers and 100 terms; a dump of the schema is kept outside the repo.
DROP SCHEMA IF EXISTS publishing CASCADE;
