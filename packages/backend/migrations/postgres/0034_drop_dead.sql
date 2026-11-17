-- D-225: two dead items removed (the modules council, stage 1, by the owner's word of 2026-11-18).
-- settlements.opening_balances: the archive of the start of 15.10.2026 (D-174); every row inactive since D-205, no
-- reader or writer (the start is the cut «Кабинет 15.10», D-203…D-205). A dump of the live rows is kept outside the repo.
-- owners.documents.upload_deadline: never filled (0 of every document), shown only, nothing acted on it.
DROP TABLE IF EXISTS settlements.opening_balances;
ALTER TABLE owners.documents DROP COLUMN IF EXISTS upload_deadline;
