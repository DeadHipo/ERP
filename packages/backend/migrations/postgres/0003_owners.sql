-- Модуль 1 (D-121): владельцы, их псевдонимы (артисты), треки, документы и договоры.
-- Реестр документов живёт здесь; другие модули ссылаются на документы и владельцев по id без внешних ключей
-- (связи между модулями проверяет фасад).
-- Записи не удаляются: дубль объединяется в оригинал (merged_into), ссылки на него разрешаются в оригинал.

CREATE SCHEMA IF NOT EXISTS owners;

CREATE TABLE IF NOT EXISTS owners.owners (
    id           text PRIMARY KEY,
    name         text NOT NULL CHECK (btrim(name) <> ''),
    -- Нормализованное имя (normalizeName): только для подсказок о возможных дублях, деньги по нему не решаются.
    name_norm    text NOT NULL,
    -- Публишинг платится только человеку (person), лейбл в кандидаты автора не попадает.
    kind         text NOT NULL CHECK (kind IN ('label', 'person')),
    ipi          text,
    -- Запись объединена в другого владельца (тот подтверждён документами). NULL = живая запись.
    merged_into  text CHECK (merged_into IS NULL OR merged_into <> id)
                 REFERENCES owners.owners (id) DEFERRABLE INITIALLY DEFERRED,
    created_at   timestamptz NOT NULL DEFAULT now(),
    -- Откуда запись: manual, publishing, legacy-erp:..., ...
    origin       text NOT NULL CHECK (origin <> '')
);
CREATE INDEX IF NOT EXISTS owners_name_norm ON owners.owners (name_norm);

-- Другие написания имени владельца (в т. ч. само имя): по ним авторы публишинга сопоставляются с владельцами.
CREATE TABLE IF NOT EXISTS owners.owner_aliases (
    owner_id    text NOT NULL REFERENCES owners.owners (id),
    alias       text NOT NULL,
    alias_norm  text NOT NULL,
    PRIMARY KEY (alias_norm, owner_id)
);
CREATE INDEX IF NOT EXISTS owner_aliases_owner ON owners.owner_aliases (owner_id);

-- Артист = псевдоним владельца. Один артист принадлежит ровно одному владельцу; NULL = владелец ещё неизвестен
-- (артист создан из сплита и ждёт документов).
CREATE TABLE IF NOT EXISTS owners.artists (
    id              text PRIMARY KEY,
    pseudonym       text NOT NULL CHECK (btrim(pseudonym) <> ''),
    pseudonym_norm  text NOT NULL,
    owner_id        text REFERENCES owners.owners (id),
    merged_into     text CHECK (merged_into IS NULL OR merged_into <> id)
                    REFERENCES owners.artists (id) DEFERRABLE INITIALLY DEFERRED,
    created_at      timestamptz NOT NULL DEFAULT now(),
    origin          text NOT NULL CHECK (origin <> '')
);
CREATE INDEX IF NOT EXISTS artists_owner ON owners.artists (owner_id);
CREATE INDEX IF NOT EXISTS artists_pseudonym_norm ON owners.artists (pseudonym_norm);

-- Трек может появиться до релиза без ISRC/UPC. Пара (ISRC, UPC) уникальна; NULL с NULL не совпадают.
CREATE TABLE IF NOT EXISTS owners.tracks (
    id          text PRIMARY KEY,
    -- Нормализованный ISRC (без дефисов, верхний регистр).
    isrc        text CHECK (isrc IS NULL OR isrc ~ '^[A-Z]{2}[A-Z0-9]{3}[0-9]{7}$'),
    -- UPC/EAN, только цифры.
    upc         text CHECK (upc IS NULL OR upc ~ '^[0-9]+$'),
    title       text NOT NULL,
    created_at  timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS tracks_isrc_upc ON owners.tracks (isrc, upc);
CREATE INDEX IF NOT EXISTS tracks_isrc ON owners.tracks (isrc);

-- Справочная связь артист — трек: показывает, чей трек. Кому платить, решает только сплит.
CREATE TABLE IF NOT EXISTS owners.artist_tracks (
    artist_id  text NOT NULL REFERENCES owners.artists (id),
    track_id   text NOT NULL REFERENCES owners.tracks (id),
    PRIMARY KEY (artist_id, track_id)
);
CREATE INDEX IF NOT EXISTS artist_tracks_track ON owners.artist_tracks (track_id);

-- Документ: договор, приложение, выкуп, основания аванса и корректировки, подтверждения платежа и возврата.
-- Статус вычисляется: нет файла = not_attached; нужен апрув и его нет = not_approved; иначе approved.
CREATE TABLE IF NOT EXISTS owners.documents (
    id                 text PRIMARY KEY,
    kind               text NOT NULL CHECK (kind IN ('contract', 'appendix', 'buyout', 'advance_basis',
                                                     'adjustment_basis', 'payment_proof', 'return_proof', 'other')),
    title              text NOT NULL,
    -- Ссылка на файл (путь или CDN). NULL = файл не приложен.
    file_ref           text,
    owner_id           text REFERENCES owners.owners (id),
    -- Нужен ли апрув менеджера. Без апрува документ действует, как только приложен файл.
    requires_approval  boolean NOT NULL,
    -- Апрув менеджера: когда и кем. Новый файл сбрасывает апрув; без файла апрува не бывает.
    approved_at        timestamptz,
    approved_by        text,
    -- Срок, до которого должен быть загружен файл (справочно).
    upload_deadline    date,
    -- Документ заведён при переносе из старой ERP.
    migration          boolean NOT NULL DEFAULT false,
    created_at         timestamptz NOT NULL DEFAULT now(),
    CHECK ((approved_at IS NULL) = (approved_by IS NULL)),
    CHECK (approved_at IS NULL OR file_ref IS NOT NULL)
);
CREATE INDEX IF NOT EXISTS documents_owner ON owners.documents (owner_id);

-- Договор с владельцем. Подтверждённый (документ approved) договор подтверждает владельца и перечисленных артистов.
CREATE TABLE IF NOT EXISTS owners.contracts (
    id           text PRIMARY KEY,
    owner_id     text NOT NULL REFERENCES owners.owners (id),
    -- Документ вида contract (проверяет сервис).
    document_id  text NOT NULL REFERENCES owners.documents (id),
    number       text,
    created_at   timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS contracts_owner ON owners.contracts (owner_id);
CREATE INDEX IF NOT EXISTS contracts_document ON owners.contracts (document_id);

-- Артисты (псевдонимы), перечисленные в договоре.
CREATE TABLE IF NOT EXISTS owners.contract_artists (
    contract_id  text NOT NULL REFERENCES owners.contracts (id),
    artist_id    text NOT NULL REFERENCES owners.artists (id),
    PRIMARY KEY (contract_id, artist_id)
);
CREATE INDEX IF NOT EXISTS contract_artists_artist ON owners.contract_artists (artist_id);

-- Журнал объединений. from_id / into_id указывают на owners или artists в зависимости от entity.
CREATE TABLE IF NOT EXISTS owners.merges (
    id       text PRIMARY KEY,
    entity   text NOT NULL CHECK (entity IN ('owner', 'artist')),
    from_id  text NOT NULL,
    into_id  text NOT NULL CHECK (into_id <> from_id),
    reason   text NOT NULL,
    at       timestamptz NOT NULL DEFAULT now()
);
