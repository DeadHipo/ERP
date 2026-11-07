-- Условия паблишинга в links (D-185): процент автора на владельца с периодом и документом. Смена условия закрывает
-- текущую строку и открывает новую. Перенос из publishing.pub_terms один к одному, старая таблица пока остаётся.

CREATE TABLE IF NOT EXISTS links.publishing_terms (
    org_id          text NOT NULL,
    id              text PRIMARY KEY,
    owner_id        text NOT NULL,
    -- Процент автора, 0..100: 50 обычно, 90 особый случай, 0 выкуп.
    percent         numeric NOT NULL CHECK (percent >= 0 AND percent <= 100),
    -- valid_from включается, valid_to нет (D-025); NULL = без конца.
    valid_from      date NOT NULL,
    valid_to        date CHECK (valid_to IS NULL OR valid_to > valid_from),
    document_id     text,
    -- NULL = любой тип операции; условие с типом важнее для строки этого типа (D-128).
    operation_type  text CHECK (operation_type IS NULL OR operation_type <> ''),
    decided_by      text NOT NULL,
    created_at      timestamptz NOT NULL
);

CREATE INDEX IF NOT EXISTS publishing_terms_owner ON links.publishing_terms (org_id, owner_id);

CREATE UNIQUE INDEX IF NOT EXISTS publishing_terms_start
    ON links.publishing_terms (org_id, owner_id, COALESCE(operation_type, ''), valid_from);

INSERT INTO links.publishing_terms
    (org_id, id, owner_id, percent, valid_from, valid_to, document_id, operation_type, decided_by, created_at)
SELECT org_id, id, owner_id, percent, valid_from, valid_to, document_id, operation_type, 'migration', created_at
FROM publishing.pub_terms
ON CONFLICT (id) DO NOTHING;
