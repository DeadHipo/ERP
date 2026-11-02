-- Издательские условия по типу операции (D-128): процент автора может зависеть от operation type строки B17.
-- NULL = условия для любого типа операции; условие с типом выигрывает у условия без типа для строки этого типа.
-- Пересечение периодов проверяет сервис (в 0005 ограничения на пересечение нет): теперь по (owner_id, operation_type).

ALTER TABLE publishing.pub_terms ADD COLUMN IF NOT EXISTS operation_type text;
ALTER TABLE publishing.pub_terms DROP CONSTRAINT IF EXISTS pub_terms_operation_type_not_empty;
ALTER TABLE publishing.pub_terms
    ADD CONSTRAINT pub_terms_operation_type_not_empty CHECK (operation_type IS NULL OR operation_type <> '');
