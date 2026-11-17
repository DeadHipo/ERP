-- D-232: the labels are own labels only. Since D-229 / D-230 a sublabel is the register (`labels.sublabels`) and its
-- terms (`links.sublabel_terms`); the money reads no sublabel rule. The kind, the own label of a sublabel and the
-- rules leave the schema. A store that still has sublabel labels (a test store before its seed) gets the move of
-- D-229 first: their aliases to the own label, then the rows go.
UPDATE labels.label_aliases a
   SET label_id = l.own_label_id
  FROM labels.labels l
 WHERE l.id = a.label_id AND l.org_id = a.org_id AND l.kind = 'sublabel' AND l.own_label_id IS NOT NULL;
DROP TABLE IF EXISTS labels.label_rules;
DELETE FROM labels.labels WHERE kind = 'sublabel';
ALTER TABLE labels.labels DROP CONSTRAINT IF EXISTS labels_own_label;
ALTER TABLE labels.labels DROP COLUMN IF EXISTS own_label_id;
ALTER TABLE labels.labels DROP COLUMN IF EXISTS kind;
