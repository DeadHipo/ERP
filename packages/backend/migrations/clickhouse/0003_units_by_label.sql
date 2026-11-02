-- Единица расчёта несёт строку лейбла (D-124): проекция units заменена на units_by_label.
-- Ключ: файл + ISRC + UPC + месяц отчёта + месяц продаж + label_name. Одна и та же пара ISRC/UPC за месяц
-- с разными строками лейбла даёт две единицы, лейбл записи выбирается выше по цепочке расчёта.
-- Представление believe.units читается из проекции само, запрос не меняется. Стадия загрузки создаётся
-- как CREATE TABLE ... AS believe.rows и наследует проекцию, агрегат строится при записи куска.

ALTER TABLE believe.rows DROP PROJECTION IF EXISTS units;

ALTER TABLE believe.rows ADD PROJECTION IF NOT EXISTS units_by_label
(
    SELECT
        file_id, isrc, upc, reporting_month, sales_month, label_name,
        sum(quantity), sum(gross_revenue), sum(net_revenue)
    GROUP BY file_id, isrc, upc, reporting_month, sales_month, label_name
);

-- Построить проекцию для уже загруженных файлов и дождаться конца (повторный запуск просто перестраивает её)
ALTER TABLE believe.rows MATERIALIZE PROJECTION units_by_label SETTINGS mutations_sync = 1;

CREATE OR REPLACE VIEW believe.units AS
SELECT
    file_id, isrc, upc, reporting_month, sales_month, label_name,
    sum(quantity)      AS quantity,
    sum(gross_revenue) AS gross_revenue,
    sum(net_revenue)   AS net_revenue
FROM believe.rows
GROUP BY file_id, isrc, upc, reporting_month, sales_month, label_name;
