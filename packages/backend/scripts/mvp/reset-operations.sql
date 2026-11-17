-- D-226: the reset of the operations before a reload from a later copy of 0to8 Main.xlsx (development stage, the
-- owner's word of 2026-11-17). A migration-only bypass of the facade, like the deletes of D-137: run by hand through
-- psql on a database with a fresh dump, then `mvp:load main --apply` over the new workbook.
-- Kept: the buyouts (the registry of 2026-11-03) and the ASCAP credits (the list of 2026-11-06): their source is not
-- the workbook. Gone: every other operation (the Main rows, the cut's adjustments and forgivenesses, the manual and
-- test rows, the deactivated ones) and the documents of the old workbook rows that nothing refers to any more.
-- The cuts stay as records with no operation attributed.
BEGIN;
DELETE FROM settlements.payout_snapshots s USING settlements.operations o
 WHERE s.operation_id = o.id
   AND NOT (o.kind = 'buyout' OR coalesce(o.external_ref, o.comment, '') LIKE 'ascap-2026-11-06%');
DELETE FROM settlements.operations o
 WHERE NOT (o.kind = 'buyout' OR coalesce(o.external_ref, o.comment, '') LIKE 'ascap-2026-11-06%');
DELETE FROM owners.documents d
 WHERE d.file_ref = 'mvp-load:main'
   AND NOT EXISTS (SELECT 1 FROM settlements.operations o WHERE o.document_id = d.id OR o.payment_proof_id = d.id)
   AND NOT EXISTS (SELECT 1 FROM owners.contracts c WHERE c.document_id = d.id)
   AND NOT EXISTS (SELECT 1 FROM splits.splits s WHERE s.document_id = d.id)
   AND NOT EXISTS (SELECT 1 FROM splits.split_shares s WHERE s.document_id = d.id)
   AND NOT EXISTS (SELECT 1 FROM splits.participations p WHERE p.document_id = d.id)
   AND NOT EXISTS (SELECT 1 FROM labels.label_rules r WHERE r.document_id = d.id)
   AND NOT EXISTS (SELECT 1 FROM settlements.opening_balances b WHERE b.document_id = d.id);
SELECT kind, count(*), sum(amount_cents) / 100 FROM settlements.operations GROUP BY 1 ORDER BY 1;
COMMIT;
