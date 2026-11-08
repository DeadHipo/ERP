-- Срезы (D-198): состояние книги лейбла на момент, накопительно. У среза название, дата и границы данных по
-- источникам — первое число первого месяца, который уже НЕ внутри (как valid_to, D-025): Believe — отчётные месяцы
-- < master_to, публишинг — месяцы отчёта < publishing_to, реклама — < ads_to; операции — с датой ≤ cut_date или
-- отнесённые к срезу (operations.cut_id). Расчёт и слои срез не читают: это вид на баланс плюс привязка операций.
-- Внешних ключей на другие модули нет (D-121): лейбл проверяет фасад.

CREATE TABLE IF NOT EXISTS settlements.cuts (
    org_id        text NOT NULL,
    id            text PRIMARY KEY,
    label_id      text NOT NULL,
    name          text NOT NULL,
    cut_date      date NOT NULL,
    master_to     date NOT NULL,
    publishing_to date NOT NULL,
    ads_to        date NOT NULL,
    comment       text NOT NULL DEFAULT '',
    created_at    timestamptz NOT NULL,
    created_by    text NOT NULL,
    CONSTRAINT cuts_bounds_month_start CHECK (
        extract(day FROM master_to) = 1 AND extract(day FROM publishing_to) = 1 AND extract(day FROM ads_to) = 1
    )
);
CREATE UNIQUE INDEX IF NOT EXISTS cuts_name ON settlements.cuts (org_id, label_id, name);
CREATE INDEX IF NOT EXISTS cuts_label ON settlements.cuts (org_id, label_id, cut_date);

-- «Отнесена к срезу»: операция входит в этот срез и во все следующие при любой своей дате.
ALTER TABLE settlements.operations ADD COLUMN IF NOT EXISTS cut_id text;
CREATE INDEX IF NOT EXISTS operations_cut ON settlements.operations (org_id, cut_id) WHERE cut_id IS NOT NULL;
