-- Этап 4 «Онбординг» (D-172): вид документа «решение лейбла» и две таблицы каталога модуля owners.
-- История лейбла ISRC и реестр релизов это навигация, не деньги (README §1 п. 8): расчёт их не читает.
-- Миграция идемпотентна: повторный запуск ничего не меняет. Внешних ключей нет (D-121): label_id это id own-лейбла
-- модуля labels, его проверяет фасад.

-- 1. Вид документа label_decision (0007 пересобирала то же ограничение).
ALTER TABLE owners.documents DROP CONSTRAINT IF EXISTS documents_kind_check;
ALTER TABLE owners.documents ADD CONSTRAINT documents_kind_check CHECK (kind IN (
    'contract', 'appendix', 'buyout', 'advance_basis', 'adjustment_basis', 'payment_proof', 'return_proof',
    'other', 'assumption', 'label_decision'));

-- 2. История лейбла ISRC: интервалы [valid_from, valid_to) с первого числа месяца (M52), без пересечений внутри
-- организации. source: files = выведено из файлов, operator = правка оператора, import = зарезервировано.
-- Автора нет (README §2): он в аудите.
CREATE TABLE IF NOT EXISTS owners.track_labels (
    org_id      text NOT NULL,
    id          text PRIMARY KEY,
    isrc        text NOT NULL CHECK (isrc ~ '^[A-Z]{2}[A-Z0-9]{3}[0-9]{7}$'),
    label_id    text NOT NULL,
    valid_from  date NOT NULL CHECK (extract(day FROM valid_from) = 1),
    valid_to    date CHECK (valid_to IS NULL OR (extract(day FROM valid_to) = 1 AND valid_to > valid_from)),
    source      text NOT NULL CHECK (source IN ('files', 'operator', 'import')),
    note        text,
    created_at  timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT track_labels_no_overlap EXCLUDE USING gist (
        org_id WITH =,
        isrc WITH =,
        daterange(valid_from, valid_to, '[)') WITH &&)
);
CREATE INDEX IF NOT EXISTS track_labels_org ON owners.track_labels (org_id);
CREATE INDEX IF NOT EXISTS track_labels_open ON owners.track_labels (org_id, label_id) WHERE valid_to IS NULL;

-- 3. Реестр релизов из экспорта Believe: по лейблу (UPC переехавшего релиза бывает в экспортах двух лейблов).
CREATE TABLE IF NOT EXISTS owners.releases (
    org_id          text NOT NULL,
    label_id        text NOT NULL,
    upc             text NOT NULL CHECK (upc ~ '^[0-9]+$'),
    title           text NOT NULL,
    version         text,
    artist_string   text,
    label_string    text,
    release_date    date,
    track_count     integer CHECK (track_count >= 0),
    catalog_number  text,
    territories     integer,
    stores          integer,
    source          text NOT NULL CHECK (source = 'believe_export'),
    file_sha256     text NOT NULL,
    imported_at     timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (org_id, label_id, upc)
);
CREATE INDEX IF NOT EXISTS releases_org_upc ON owners.releases (org_id, upc);
