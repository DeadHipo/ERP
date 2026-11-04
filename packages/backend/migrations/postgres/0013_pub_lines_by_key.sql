-- Строки B17, сгруппированные по ключу расчёта (D-164): период, автор-плательщик, соавторы, произведение, вид операции.
-- Производные данные, как проекция units в ClickHouse (D-122): сырые строки не трогаются, представление обновляется
-- в той же транзакции, что загрузка выписки (publishing.service, после insertLines). Чтение расчёта берёт 8 660 групп
-- вместо агрегации 1,16 млн строк на каждый запрос.

CREATE MATERIALIZED VIEW IF NOT EXISTS publishing.pub_lines_by_key AS
SELECT l.period,
       l.writer_norm,
       MIN(l.writer_name COLLATE "C") AS writer_name,
       l.work_title,
       l.songwriters,
       l.operation_type,
       SUM(l.payable_pico) AS payable_pico
FROM publishing.pub_lines l
JOIN publishing.pub_statements s ON s.id = l.statement_id
WHERE s.status = 'loaded'
GROUP BY l.period, l.writer_norm, l.songwriters, l.work_title, l.operation_type;

CREATE INDEX IF NOT EXISTS pub_lines_by_key_order
    ON publishing.pub_lines_by_key (period COLLATE "C", writer_norm COLLATE "C", songwriters COLLATE "C", work_title COLLATE "C", operation_type COLLATE "C");
