-- Условия паблишинга v2 без типа операции и с отменой (D-188). В сводках отчётов типа операции нет, деление идёт
-- только по проценту владельца. Строки с типом не удаляются, а помечаются отменёнными; отменённая строка не считается.

ALTER TABLE links.publishing_terms ADD COLUMN IF NOT EXISTS cancelled_at timestamptz;
ALTER TABLE links.publishing_terms ADD COLUMN IF NOT EXISTS cancelled_by text;
ALTER TABLE links.publishing_terms ADD COLUMN IF NOT EXISTS cancel_reason text;

UPDATE links.publishing_terms
SET cancelled_at = now(), cancelled_by = 'migration', cancel_reason = 'the operation type is not used (D-188)'
WHERE operation_type IS NOT NULL AND cancelled_at IS NULL;

DROP INDEX IF EXISTS links.publishing_terms_start;
ALTER TABLE links.publishing_terms DROP COLUMN IF EXISTS operation_type;

CREATE UNIQUE INDEX IF NOT EXISTS publishing_terms_start
    ON links.publishing_terms (org_id, owner_id, valid_from) WHERE cancelled_at IS NULL;
