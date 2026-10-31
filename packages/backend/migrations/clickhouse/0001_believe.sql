-- Модуль источников (Believe): таблица строк отчёта и представления.
-- Правила: каждая команда идемпотентна, команды разделены точкой с запятой, в комментариях её нет.
-- Применённый файл не менять, изменения только новым файлом.

CREATE DATABASE IF NOT EXISTS believe;

-- Временные таблицы одной загрузки (believe_stage.rows_<file_id>), удаляются после подмены партиции
CREATE DATABASE IF NOT EXISTS believe_stage;

-- Строки отчёта как в файле. Названия колонок = названия колонок отчёта.
-- isrc и upc нормализованы (ISRC без дефисов, в верхнем регистре), в CSV остаётся как было.
-- Одинаковые ключи не склеиваются в хранилище, их суммируют представления ниже.
CREATE TABLE IF NOT EXISTS believe.rows
(
    file_id                       UUID,
    reporting_month               Date,
    sales_month                   Date,
    platform                      LowCardinality(String),
    country_region                LowCardinality(String),
    label_name                    LowCardinality(String),
    artist_name                   LowCardinality(String),
    release_title                 LowCardinality(String),
    track_title                   LowCardinality(String),
    upc                           LowCardinality(String),
    isrc                          LowCardinality(String),
    release_catalog_number        LowCardinality(String),
    streaming_subscription_type   LowCardinality(String),
    release_type                  LowCardinality(String),
    sales_type                    LowCardinality(String),
    quantity                      Int64,
    client_payment_currency       LowCardinality(String),
    unit_price                    Decimal(38, 12),
    mechanical_fee                Decimal(38, 12),
    gross_revenue                 Decimal(38, 12),
    client_share_rate             Decimal(18, 8),
    net_revenue                   Decimal(38, 12)
)
ENGINE = MergeTree
PARTITION BY (toYYYYMM(reporting_month), file_id)
ORDER BY (isrc, upc, reporting_month, sales_month, platform, country_region,
          streaming_subscription_type, sales_type, release_type, client_payment_currency);

-- Запись по ключу из документа 06 (решения 2 и 11): строки одного файла с одним ключом склеены
CREATE OR REPLACE VIEW believe.lines AS
SELECT
    file_id, reporting_month, sales_month, platform, country_region, isrc, upc,
    client_payment_currency, streaming_subscription_type, sales_type, release_type,
    sum(quantity)      AS quantity,
    sum(gross_revenue) AS gross_revenue,
    sum(net_revenue)   AS net_revenue,
    count()            AS merged_lines
FROM believe.rows
GROUP BY
    file_id, reporting_month, sales_month, platform, country_region, isrc, upc,
    client_payment_currency, streaming_subscription_type, sales_type, release_type;

-- Единица расчёта: ISRC + UPC + месяц отчёта + месяц продаж (06, решение 3). Аккаунт берётся по file_id из реестра.
CREATE OR REPLACE VIEW believe.units AS
SELECT
    file_id, isrc, upc, reporting_month, sales_month,
    sum(quantity)      AS quantity,
    sum(gross_revenue) AS gross_revenue,
    sum(net_revenue)   AS net_revenue
FROM believe.rows
GROUP BY file_id, isrc, upc, reporting_month, sales_month;

-- «Откуда эта сумма» по одному ISRC: SELECT * FROM believe.breakdown(isrc = 'QZZ662302992')
CREATE OR REPLACE VIEW believe.breakdown AS
SELECT
    reporting_month, sales_month, platform, country_region,
    streaming_subscription_type, sales_type, upc,
    sum(quantity)    AS quantity,
    sum(net_revenue) AS net_revenue
FROM believe.rows
WHERE isrc = {isrc:String}
GROUP BY
    reporting_month, sales_month, platform, country_region,
    streaming_subscription_type, sales_type, upc;

-- Контрольные суммы файла для сверки с реестром (line_count, key_count, net_total)
CREATE OR REPLACE VIEW believe.file_totals AS
SELECT
    file_id,
    count() AS line_count,
    uniqExact(reporting_month, sales_month, platform, country_region, isrc, upc,
              client_payment_currency, streaming_subscription_type, sales_type, release_type) AS key_count,
    sum(gross_revenue) AS gross_revenue,
    sum(net_revenue)   AS net_revenue
FROM believe.rows
GROUP BY file_id;

-- Имена пары за месяц отчёта (справочная информация, при расхождении берём max)
CREATE OR REPLACE VIEW believe.pair_attrs AS
SELECT
    reporting_month, isrc, upc,
    max(artist_name)   AS artist_name,
    max(label_name)    AS label_name,
    max(release_title) AS release_title,
    max(track_title)   AS track_title
FROM believe.rows
GROUP BY reporting_month, isrc, upc;

-- Актуальные имена пары: из последнего месяца отчёта, где пара встречалась
CREATE OR REPLACE VIEW believe.pair_attrs_latest AS
SELECT
    isrc, upc,
    argMax(artist_name, reporting_month)   AS artist_name,
    argMax(label_name, reporting_month)    AS label_name,
    argMax(release_title, reporting_month) AS release_title,
    argMax(track_title, reporting_month)   AS track_title
FROM believe.rows
GROUP BY isrc, upc;

-- Сводка по паре: для сигнала «пары из отчёта, которых нет в модуле 1» (06, решение 10)
CREATE OR REPLACE VIEW believe.pairs AS
SELECT
    isrc, upc,
    min(reporting_month) AS first_month,
    max(reporting_month) AS last_month,
    sum(net_revenue)     AS net_revenue
FROM believe.rows
GROUP BY isrc, upc;
