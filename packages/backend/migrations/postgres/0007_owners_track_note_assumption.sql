-- D-125: заметка трека (ничего не двигает, показывается на странице сигналов) и вид документа assumption.
ALTER TABLE owners.tracks ADD COLUMN IF NOT EXISTS note text;

ALTER TABLE owners.documents DROP CONSTRAINT IF EXISTS documents_kind_check;
ALTER TABLE owners.documents ADD CONSTRAINT documents_kind_check CHECK (kind IN (
    'contract', 'appendix', 'buyout', 'advance_basis', 'adjustment_basis', 'payment_proof', 'return_proof',
    'other', 'assumption'));
