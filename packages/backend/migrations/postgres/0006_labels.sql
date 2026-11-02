-- Модуль лейблов (D-125): наши лейблы (own), строки-импринты Believe как алиасы и правило сублейбла.
-- Денег здесь нет: модуль проверяет формы (уникальный алиас, период, процент). artist_id и document_id ссылаются на
-- другие модули: внешних ключей между модулями нет (проверяет фасад).

CREATE SCHEMA IF NOT EXISTS labels;
CREATE EXTENSION IF NOT EXISTS btree_gist;

CREATE TABLE IF NOT EXISTS labels.labels (
    id            text PRIMARY KEY,
    name          text NOT NULL CHECK (name <> ''),
    kind          text NOT NULL CHECK (kind IN ('own', 'sublabel')),
    -- Сублейбл: наш лейбл, которому принадлежат его деньги. Для own пусто.
    own_label_id  text REFERENCES labels.labels (id),
    created_at    timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT labels_own_label CHECK (
        (kind = 'own' AND own_label_id IS NULL) OR (kind = 'sublabel' AND own_label_id IS NOT NULL)
    )
);

CREATE TABLE IF NOT EXISTS labels.label_aliases (
    -- Нормализованная строка (NFKC, нижний регистр, пробелы схлопнуты).
    alias_norm  text PRIMARY KEY,
    alias       text NOT NULL,
    label_id    text NOT NULL REFERENCES labels.labels (id)
);
CREATE INDEX IF NOT EXISTS label_aliases_label ON labels.label_aliases (label_id);

CREATE TABLE IF NOT EXISTS labels.label_rules (
    id                   text PRIMARY KEY,
    label_id             text NOT NULL REFERENCES labels.labels (id),
    -- Процент доли лейбла, который получает получатель.
    percent              numeric(9, 6) NOT NULL CHECK (percent >= 0 AND percent <= 100),
    recipient_artist_id  text NOT NULL,
    valid_from           date NOT NULL,
    -- valid_to не включается; NULL = без конца.
    valid_to             date CHECK (valid_to IS NULL OR valid_to >= valid_from),
    document_id          text,
    note                 text,
    created_at           timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT label_rules_no_overlap EXCLUDE USING gist (
        label_id WITH =,
        daterange(valid_from, valid_to, '[)') WITH &&
    )
);
