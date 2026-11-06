-- Связь песни паблишинга v2 с записями (D-184): у песни обычно несколько ISRC (slowed, sped up). Решение оператора,
-- calculate() эту таблицу не читает.

CREATE TABLE IF NOT EXISTS links.song_isrc (
    org_id      text NOT NULL,
    song_id     text NOT NULL,
    isrc        text NOT NULL CHECK (isrc ~ '^[A-Z]{2}[A-Z0-9]{3}[0-9]{7}$'),
    -- recommended: ISRC был в списке кандидатов; manual: оператор ввёл его сам.
    source      text NOT NULL CHECK (source IN ('recommended', 'manual')),
    decided_by  text NOT NULL,
    decided_at  timestamptz NOT NULL,
    PRIMARY KEY (org_id, song_id, isrc)
);
