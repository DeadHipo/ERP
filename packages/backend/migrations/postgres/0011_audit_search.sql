-- Журнал действий оператора (D-140): кто, когда и какой записью изменил данные. Модуль audit.
-- Имён и свободного текста здесь нет: только id сущностей и суммы/даты/статусы (summary).
-- Заодно: триграммные индексы для глобального поиска (GET /search): подстрока без учёта регистра.

CREATE SCHEMA IF NOT EXISTS audit;

CREATE TABLE IF NOT EXISTS audit.actions (
    id         text PRIMARY KEY,
    at         timestamptz NOT NULL DEFAULT now(),
    operator   text NOT NULL,
    method     text NOT NULL,
    -- Шаблон маршрута (/documents/:id/approve), не конкретный путь.
    route      text NOT NULL,
    entity_ids text[] NOT NULL DEFAULT '{}',
    summary    jsonb NOT NULL DEFAULT '{}'
);
CREATE INDEX IF NOT EXISTS actions_entity_ids ON audit.actions USING gin (entity_ids);
CREATE INDEX IF NOT EXISTS actions_at ON audit.actions (at);

CREATE EXTENSION IF NOT EXISTS pg_trgm;

CREATE INDEX IF NOT EXISTS owners_name_trgm ON owners.owners USING gin (lower(name) gin_trgm_ops);
CREATE INDEX IF NOT EXISTS owner_aliases_alias_trgm ON owners.owner_aliases USING gin (lower(alias) gin_trgm_ops);
CREATE INDEX IF NOT EXISTS artists_pseudonym_trgm ON owners.artists USING gin (lower(pseudonym) gin_trgm_ops);
CREATE INDEX IF NOT EXISTS tracks_title_trgm ON owners.tracks USING gin (lower(title) gin_trgm_ops);
CREATE INDEX IF NOT EXISTS tracks_isrc_trgm ON owners.tracks USING gin (lower(isrc) gin_trgm_ops);
CREATE INDEX IF NOT EXISTS tracks_upc_trgm ON owners.tracks USING gin (lower(upc) gin_trgm_ops);
CREATE INDEX IF NOT EXISTS documents_title_trgm ON owners.documents USING gin (lower(title) gin_trgm_ops);
CREATE INDEX IF NOT EXISTS labels_name_trgm ON labels.labels USING gin (lower(name) gin_trgm_ops);
CREATE INDEX IF NOT EXISTS label_aliases_alias_trgm ON labels.label_aliases USING gin (lower(alias) gin_trgm_ops);
