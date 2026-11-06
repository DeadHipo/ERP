-- Граница арендатора (этап 2, D-170): организация как ключ изоляции в одной базе.
-- Каждая таблица данных модулей и реестр файлов получают org_id NOT NULL; уникальные ключи пересобираются с org_id.
-- Внешних ключей на orgs.organizations нет (D-121): org_id это непрозрачный текст, фильтр ставят репозитории
-- (src/shared/org-scope.ts). Миграция идемпотентна: повторный запуск ничего не меняет.

-- 1. Организации.
CREATE SCHEMA IF NOT EXISTS orgs;
CREATE TABLE IF NOT EXISTS orgs.organizations (
    id          text PRIMARY KEY CHECK (id ~ '^[0-9a-f-]{36}$'),
    name        text NOT NULL CHECK (btrim(name) <> ''),
    created_at  timestamptz NOT NULL DEFAULT now(),
    created_by  text NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS organizations_name_key ON orgs.organizations (lower(name));

-- 2. Пользователи (минимальный вход, коммит 2 этапа; здесь только таблица). Логин хранится в нижнем регистре.
CREATE SCHEMA IF NOT EXISTS auth;
CREATE TABLE IF NOT EXISTS auth.users (
    id               text PRIMARY KEY,
    login            text NOT NULL CHECK (login ~ '^[a-z0-9._-]{3,64}$'),
    password_hash    text NOT NULL,
    org_id           text,
    is_system_admin  boolean NOT NULL DEFAULT false,
    created_at       timestamptz NOT NULL DEFAULT now(),
    created_by       text NOT NULL,
    disabled_at      timestamptz,
    CONSTRAINT users_org CHECK (is_system_admin OR org_id IS NOT NULL)
);
CREATE UNIQUE INDEX IF NOT EXISTS users_login_key ON auth.users (login);
CREATE INDEX IF NOT EXISTS users_org ON auth.users (org_id);

-- 3, 4. Организация №1 (постоянный id) создаётся, только если в базе есть строки без организации; затем каждая из
-- 26 таблиц получает org_id: колонка, проставление №1 строкам без организации, NOT NULL (без DEFAULT: забытый org_id
-- при вставке падает сразу), индекс <таблица>_org. На чистой базе организаций нет: первую создаёт POST /orgs.
DO $$
DECLARE
    first_org constant text := '00000000-0000-4000-8000-000000000001';
    tables constant text[] := ARRAY[
        'public.source_files',
        'owners.owners', 'owners.owner_aliases', 'owners.artists', 'owners.tracks', 'owners.artist_tracks',
        'owners.documents', 'owners.contracts', 'owners.contract_artists', 'owners.merges',
        'splits.splits', 'splits.split_shares', 'splits.participations',
        'labels.labels', 'labels.label_aliases', 'labels.label_rules', 'labels.label_accounts',
        'settlements.operations', 'settlements.payout_snapshots',
        'publishing.pub_statements', 'publishing.pub_statement_periods', 'publishing.pub_lines',
        'publishing.pub_writers', 'publishing.pub_terms',
        'audit.actions',
        'ads.expenses'];
    t text;
    has_column boolean;
    orphan boolean;
    need_first boolean := false;
BEGIN
    FOREACH t IN ARRAY tables LOOP
        SELECT EXISTS (
            SELECT 1 FROM pg_attribute
            WHERE attrelid = t::regclass AND attname = 'org_id' AND NOT attisdropped
        ) INTO has_column;
        IF has_column THEN
            EXECUTE format('SELECT EXISTS (SELECT 1 FROM %s WHERE org_id IS NULL)', t) INTO orphan;
        ELSE
            EXECUTE format('SELECT EXISTS (SELECT 1 FROM %s)', t) INTO orphan;
        END IF;
        need_first := need_first OR orphan;
    END LOOP;

    IF need_first THEN
        INSERT INTO orgs.organizations (id, name, created_by)
        VALUES (first_org, 'Организация №1', 'migration 0016')
        ON CONFLICT (id) DO NOTHING;
    END IF;

    FOREACH t IN ARRAY tables LOOP
        EXECUTE format('ALTER TABLE %s ADD COLUMN IF NOT EXISTS org_id text', t);
        EXECUTE format('UPDATE %s SET org_id = %L WHERE org_id IS NULL', t, first_org);
        EXECUTE format('ALTER TABLE %s ALTER COLUMN org_id SET NOT NULL', t);
        EXECUTE format('CREATE INDEX IF NOT EXISTS %I ON %s (org_id)', split_part(t, '.', 2) || '_org', t);
    END LOOP;
END
$$;

-- 5. Уникальные ключи внутри организации (O5). Имена индексов реестра прежние: registry.ts переводит 23505 в
-- duplicate_period / duplicate_file по имени ограничения.
DROP INDEX IF EXISTS public.source_files_scope;
CREATE UNIQUE INDEX source_files_scope
    ON public.source_files (org_id, source, account, reporting_month)
    WHERE status IN ('loading', 'loaded');
DROP INDEX IF EXISTS public.source_files_sha;
CREATE UNIQUE INDEX source_files_sha
    ON public.source_files (org_id, sha256)
    WHERE status IN ('loading', 'loaded');

ALTER TABLE publishing.pub_statements DROP CONSTRAINT IF EXISTS pub_statements_sha256_key;
ALTER TABLE publishing.pub_statements DROP CONSTRAINT IF EXISTS pub_statements_org_sha256_key;
ALTER TABLE publishing.pub_statements ADD CONSTRAINT pub_statements_org_sha256_key UNIQUE (org_id, sha256);

ALTER TABLE publishing.pub_statement_periods DROP CONSTRAINT IF EXISTS pub_statement_periods_pkey;
ALTER TABLE publishing.pub_statement_periods
    ADD CONSTRAINT pub_statement_periods_pkey PRIMARY KEY (org_id, source, period);

ALTER TABLE publishing.pub_writers DROP CONSTRAINT IF EXISTS pub_writers_pkey;
ALTER TABLE publishing.pub_writers ADD CONSTRAINT pub_writers_pkey PRIMARY KEY (org_id, writer_norm);

ALTER TABLE labels.labels DROP CONSTRAINT IF EXISTS labels_org_name;
ALTER TABLE labels.labels ADD CONSTRAINT labels_org_name UNIQUE (org_id, name);

ALTER TABLE labels.label_aliases DROP CONSTRAINT IF EXISTS label_aliases_pkey;
ALTER TABLE labels.label_aliases ADD CONSTRAINT label_aliases_pkey PRIMARY KEY (org_id, alias_norm);

ALTER TABLE labels.label_accounts DROP CONSTRAINT IF EXISTS label_accounts_pkey;
ALTER TABLE labels.label_accounts ADD CONSTRAINT label_accounts_pkey PRIMARY KEY (org_id, account);

DROP INDEX IF EXISTS owners.tracks_isrc_upc;
DROP INDEX IF EXISTS owners.tracks_org_isrc_upc;
CREATE UNIQUE INDEX tracks_org_isrc_upc ON owners.tracks (org_id, isrc, upc);

ALTER TABLE splits.splits DROP CONSTRAINT IF EXISTS splits_no_overlap;
ALTER TABLE splits.splits
    ADD CONSTRAINT splits_no_overlap EXCLUDE USING gist (
        org_id WITH =,
        isrc WITH =,
        daterange(valid_from, valid_to, '[)') WITH &&
    );

ALTER TABLE splits.participations DROP CONSTRAINT IF EXISTS participations_no_overlap;
ALTER TABLE splits.participations
    ADD CONSTRAINT participations_no_overlap EXCLUDE USING gist (
        org_id WITH =,
        isrc WITH =,
        artist_id WITH =,
        funded_from WITH =,
        (coalesce(from_artist_id, '')) WITH =,
        daterange(valid_from, valid_to, '[)') WITH &&
    );

ALTER TABLE ads.expenses DROP CONSTRAINT IF EXISTS expenses_external_ref_key;
ALTER TABLE ads.expenses DROP CONSTRAINT IF EXISTS expenses_org_external_ref_key;
ALTER TABLE ads.expenses ADD CONSTRAINT expenses_org_external_ref_key UNIQUE (org_id, external_ref);

-- 6. Сгруппированные строки B17 (0013, 0015) несут организацию первой: квартал определяет выписку только внутри
-- организации, без org_id в группировке два арендатора с одним кварталом слились бы. Порядок строк тот же.
DROP MATERIALIZED VIEW IF EXISTS publishing.pub_lines_by_key;
CREATE MATERIALIZED VIEW publishing.pub_lines_by_key AS
SELECT s.org_id,
       l.period,
       l.writer_norm,
       MIN(l.writer_name COLLATE "C") AS writer_name,
       l.work_title,
       l.songwriters,
       l.operation_type,
       s.label_id,
       SUM(l.payable_pico) AS payable_pico
FROM publishing.pub_lines l
JOIN publishing.pub_statements s ON s.id = l.statement_id
WHERE s.status = 'loaded'
GROUP BY s.org_id, l.period, l.writer_norm, l.songwriters, l.work_title, l.operation_type, s.label_id;

CREATE INDEX IF NOT EXISTS pub_lines_by_key_order
    ON publishing.pub_lines_by_key (org_id, period COLLATE "C", writer_norm COLLATE "C", songwriters COLLATE "C",
                                    work_title COLLATE "C", operation_type COLLATE "C");

REFRESH MATERIALIZED VIEW publishing.pub_lines_by_key;

-- 7. ClickHouse не меняется (O4): чтения начинаются с loaded-файлов реестра организации → file_id IN (...).
