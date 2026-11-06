-- Связи между модулями (D-183): решения оператора, которые нельзя положить ни в один из модулей, потому что модули
-- не знают друг о друге. Пока одна таблица: автор паблишинга v2 -> владелец. calculate() её не читает.

CREATE SCHEMA IF NOT EXISTS links;

CREATE TABLE IF NOT EXISTS links.songwriter_owner (
    org_id          text NOT NULL,
    songwriter_id   text NOT NULL,
    owner_id        text NOT NULL,
    -- recommended: оператор подтвердил подсказку; manual: выбрал владельца сам.
    source          text NOT NULL CHECK (source IN ('recommended', 'manual')),
    decided_by      text NOT NULL,
    decided_at      timestamptz NOT NULL,
    PRIMARY KEY (org_id, songwriter_id)
);
