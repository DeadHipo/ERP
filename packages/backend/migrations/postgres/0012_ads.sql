-- Рекламные расходы (D-155, D-156): модуль ads. Каждый приход данных = новая запись; меняются только процент
-- возврата, область погашения и деактивация. artist_id ссылается на модуль owners: внешних ключей между модулями нет.

CREATE SCHEMA IF NOT EXISTS ads;

CREATE TABLE IF NOT EXISTS ads.expenses (
    id                 text PRIMARY KEY,
    isrc               text CHECK (isrc IS NULL OR isrc ~ '^[A-Z]{2}[A-Z0-9]{3}[0-9]{7}$'),
    -- Месяц расхода, первое число месяца.
    month              date NOT NULL CHECK (extract(day FROM month) = 1),
    amount_cents       bigint NOT NULL CHECK (amount_cents > 0),
    recovery_percent   numeric(5, 2) NOT NULL CHECK (recovery_percent >= 0 AND recovery_percent <= 100),
    scope              text NOT NULL CHECK (scope IN ('any', 'publishing', 'isrc')),
    -- Расход, уже распределённый на один псевдоним (история Main); иначе по сплиту ISRC.
    artist_id          text,
    external_ref       text UNIQUE,
    source             text NOT NULL CHECK (source <> ''),
    migration          boolean NOT NULL DEFAULT false,
    comment            text NOT NULL DEFAULT '',
    created_at         timestamptz NOT NULL DEFAULT now(),
    deactivated_at     timestamptz,
    deactivated_reason text,

    CONSTRAINT expenses_isrc_or_artist CHECK (isrc IS NOT NULL OR artist_id IS NOT NULL),
    CONSTRAINT expenses_isrc_scope CHECK (scope <> 'isrc' OR isrc IS NOT NULL)
);
CREATE INDEX IF NOT EXISTS expenses_isrc ON ads.expenses (isrc);
CREATE INDEX IF NOT EXISTS expenses_artist ON ads.expenses (artist_id);
CREATE INDEX IF NOT EXISTS expenses_month ON ads.expenses (month);
