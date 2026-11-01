-- Агрегатная проекция единиц расчёта в believe.rows (D-122).
-- Суммы ключа ISRC + UPC + месяц отчёта + месяц продаж по файлу хранятся внутри каждого куска таблицы.
-- Представление believe.units ClickHouse читает из неё сам, запрос не меняется, сырые строки остаются как есть.
-- Проекция часть куска: ATTACH PARTITION переносит её вместе с данными, DROP PARTITION удаляет вместе с ними.
-- Стадия загрузки создаётся как CREATE TABLE ... AS believe.rows и наследует проекцию, агрегат строится при записи.

ALTER TABLE believe.rows ADD PROJECTION IF NOT EXISTS units
(
    SELECT
        file_id, isrc, upc, reporting_month, sales_month,
        sum(quantity), sum(gross_revenue), sum(net_revenue)
    GROUP BY file_id, isrc, upc, reporting_month, sales_month
);

-- Построить проекцию для уже загруженных файлов и дождаться конца (повторный запуск просто перестраивает её)
ALTER TABLE believe.rows MATERIALIZE PROJECTION units SETTINGS mutations_sync = 1;
