-- D-229: the money of the sublabels stops following the Believe strings (the owner, 2026-11-18: «мы сделали
-- саблейблы и должны считать только на них»; a sublabel has no recipient, it gets its report on P37).
-- Data only, in one transaction; the code is unchanged, so the paths of the rules become dead until their removal:
--   1. every alias of a label of kind `sublabel` moves to the own label it sits under (the string stays «ours», never
--      `label_unmapped`);
--   2. every sublabel rule is deleted (no carve to a recipient any more: the label share stays the label's);
--   3. the labels of kind `sublabel` are deleted (the register `labels.sublabels` and the terms stay).
-- Before: nothing else references these ids (documents, operations, files, catalog, ads, users, audit: 0 rows), and
-- the recipients of the rules have no operation, payout, payee or split row.
--
--   docker exec -i royalty-erp-postgres-1 psql -U <user> -d <db> -v ON_ERROR_STOP=1 < switch-off-rules.sql
\set ON_ERROR_STOP on
BEGIN;
SELECT 'before' AS at, (SELECT count(*) FROM labels.labels WHERE kind = 'sublabel') AS sublabel_labels,
       (SELECT count(*) FROM labels.label_rules) AS rules,
       (SELECT count(*) FROM labels.label_aliases a JOIN labels.labels l ON l.id = a.label_id AND l.org_id = a.org_id
         WHERE l.kind = 'sublabel') AS sublabel_aliases,
       (SELECT count(*) FROM labels.sublabels) AS register;

UPDATE labels.label_aliases a
   SET label_id = l.own_label_id
  FROM labels.labels l
 WHERE l.id = a.label_id AND l.org_id = a.org_id AND l.kind = 'sublabel' AND l.own_label_id IS NOT NULL;

DELETE FROM labels.label_rules;
DELETE FROM labels.labels WHERE kind = 'sublabel';

SELECT 'after' AS at, (SELECT count(*) FROM labels.labels WHERE kind = 'sublabel') AS sublabel_labels,
       (SELECT count(*) FROM labels.label_rules) AS rules,
       (SELECT count(*) FROM labels.label_aliases) AS aliases,
       (SELECT count(*) FROM labels.sublabels) AS register,
       (SELECT count(*) FROM links.sublabel_terms) AS terms;
COMMIT;
