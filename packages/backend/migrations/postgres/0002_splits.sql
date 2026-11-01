-- Модуль сплитов (D-121): сплиты по ISRC с периодами действия и доли артистов внутри сплита.
-- Хранятся только доли артистов и MC, наша доля = 100 минус сумма долей, её нет в таблицах.
-- artist_id и document_id ссылаются на модуль владельцев: внешних ключей между модулями нет (проверяет фасад).

CREATE SCHEMA IF NOT EXISTS splits;
CREATE EXTENSION IF NOT EXISTS btree_gist;

CREATE TABLE IF NOT EXISTS splits.splits (
    id           text PRIMARY KEY,
    -- Нормализованный ISRC (без дефисов, верхний регистр). Один сплит действует для всех релизов с этим ISRC.
    isrc         text NOT NULL CHECK (isrc ~ '^[A-Z]{2}[A-Z0-9]{3}[0-9]{7}$'),
    -- valid_from включается, valid_to не включается (D-025); NULL = без конца.
    -- Пустой период [d, d) остаётся в истории, когда сплит заменён с первого дня.
    valid_from   date NOT NULL,
    valid_to     date CHECK (valid_to IS NULL OR valid_to >= valid_from),
    -- Документ-подтверждение (приложение, договор, выкуп). NULL = не подтверждён, деньги ждут (категория C).
    document_id  text,
    -- Откуда сплит: manual, legacy-erp, buyout, ...
    origin       text NOT NULL CHECK (origin <> ''),
    note         text,
    created_at   timestamptz NOT NULL DEFAULT now(),

    -- Периоды одного ISRC не пересекаются, даже при гонке двух записей. Пустые периоды ни с чем не пересекаются.
    CONSTRAINT splits_no_overlap EXCLUDE USING gist (
        isrc WITH =,
        daterange(valid_from, valid_to, '[)') WITH &&
    )
);
CREATE INDEX IF NOT EXISTS splits_isrc ON splits.splits (isrc, valid_from);

CREATE TABLE IF NOT EXISTS splits.split_shares (
    split_id   text NOT NULL REFERENCES splits.splits (id),
    artist_id  text NOT NULL,
    -- Процент 0..100, до 6 знаков после запятой (сумма по сплиту не больше 100 проверяет сервис).
    percent    numeric(9, 6) NOT NULL CHECK (percent >= 0 AND percent <= 100),
    PRIMARY KEY (split_id, artist_id)
);
CREATE INDEX IF NOT EXISTS split_shares_artist ON splits.split_shares (artist_id);
