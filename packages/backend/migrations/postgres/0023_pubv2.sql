-- Паблишинг v2 (D-182): отдельный модуль рядом со старым publishing. Хранит только то, что написано в сводках отчётов:
-- файлы, авторов, песни и начисления. Про владельцев и ISRC модуль не знает, calculate() эти таблицы не читает.

CREATE SCHEMA IF NOT EXISTS pubv2;

CREATE TABLE IF NOT EXISTS pubv2.files (
    org_id                  text NOT NULL,
    id                      text PRIMARY KEY,
    label_id                text NOT NULL,
    file_name               text NOT NULL,
    sha256                  text NOT NULL,
    source                  text NOT NULL CHECK (source IN ('b17')),
    -- Какой разбор прочитал файл: periods, blocks, flat.
    format                  text NOT NULL,
    periods                 text[] NOT NULL,
    status                  text NOT NULL CHECK (status IN ('loaded', 'superseded')),
    replaced_by             text,
    row_count               integer NOT NULL,
    payable_pico            bigint NOT NULL,
    -- Итог, который заявлен в самом файле; null, если файл итога не называет.
    declared_payable_pico   bigint,
    stored_path             text NOT NULL,
    uploaded_at             timestamptz NOT NULL,
    UNIQUE (org_id, sha256)
);

CREATE TABLE IF NOT EXISTS pubv2.songwriters (
    org_id      text NOT NULL,
    id          text PRIMARY KEY,
    name        text NOT NULL,
    created_at  timestamptz NOT NULL
);

CREATE TABLE IF NOT EXISTS pubv2.songwriter_aliases (
    org_id          text NOT NULL,
    id              text PRIMARY KEY,
    songwriter_id   text NOT NULL REFERENCES pubv2.songwriters (id),
    name            text NOT NULL,
    name_norm       text NOT NULL,
    UNIQUE (org_id, name_norm)
);

CREATE TABLE IF NOT EXISTS pubv2.songs (
    org_id          text NOT NULL,
    id              text PRIMARY KEY,
    songwriter_id   text NOT NULL REFERENCES pubv2.songwriters (id),
    title           text NOT NULL,
    title_norm      text NOT NULL,
    UNIQUE (org_id, songwriter_id, title_norm)
);

CREATE TABLE IF NOT EXISTS pubv2.song_aliases (
    org_id      text NOT NULL,
    id          text PRIMARY KEY,
    song_id     text NOT NULL REFERENCES pubv2.songs (id),
    title       text NOT NULL,
    title_norm  text NOT NULL,
    UNIQUE (org_id, song_id, title_norm)
);

CREATE TABLE IF NOT EXISTS pubv2.accruals (
    org_id              text NOT NULL,
    id                  text PRIMARY KEY,
    file_id             text NOT NULL REFERENCES pubv2.files (id),
    songwriter_id       text NOT NULL REFERENCES pubv2.songwriters (id),
    song_id             text NOT NULL REFERENCES pubv2.songs (id),
    -- Квартал вида 2026-Q2.
    period              text NOT NULL CHECK (period ~ '^[0-9]{4}-Q[1-4]$'),
    gross_pico          bigint,
    withholding_pico    bigint,
    payable_pico        bigint NOT NULL
);

CREATE INDEX IF NOT EXISTS accruals_file ON pubv2.accruals (org_id, file_id);
CREATE INDEX IF NOT EXISTS accruals_songwriter ON pubv2.accruals (org_id, songwriter_id);
