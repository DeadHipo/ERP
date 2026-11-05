-- Книга лейбла по счёту файла (D-169): файл Believe, выписка B17, документ и запись аудита получают own-лейбл.
-- label_id ссылается на labels.labels из другого модуля: внешних ключей между модулями нет (D-121), проверяет фасад.
-- NULL = «без лейбла» (история до разметки; размечает scripts/assign-label-books.ts). Все команды идемпотентны.

-- Файл Believe загружается под лейблом, которому зарегистрирован его счёт (labels.label_accounts).
ALTER TABLE public.source_files ADD COLUMN IF NOT EXISTS label_id text;
CREATE INDEX IF NOT EXISTS source_files_label ON public.source_files (label_id) WHERE status = 'loaded';

-- Выписка B17 загружается под лейблом.
ALTER TABLE publishing.pub_statements ADD COLUMN IF NOT EXISTS label_id text;

-- Сгруппированные строки B17 (0013) несут лейбл своей выписки. Период определяет выписку (pub_statement_periods),
-- поэтому label_id в группировке не дробит группы; индекс и порядок строк те же, что в 0013.
DROP MATERIALIZED VIEW IF EXISTS publishing.pub_lines_by_key;
CREATE MATERIALIZED VIEW publishing.pub_lines_by_key AS
SELECT l.period,
       l.writer_norm,
       MIN(l.writer_name COLLATE "C") AS writer_name,
       l.work_title,
       l.songwriters,
       l.operation_type,
       s.label_id,
       SUM(l.payable_pico) AS payable_pico
FROM publishing.pub_lines l
JOIN publishing.pub_statements s ON s.id = l.statement_id
WHERE s.status = 'loaded'
GROUP BY l.period, l.writer_norm, l.songwriters, l.work_title, l.operation_type, s.label_id;

CREATE INDEX IF NOT EXISTS pub_lines_by_key_order
    ON publishing.pub_lines_by_key (period COLLATE "C", writer_norm COLLATE "C", songwriters COLLATE "C", work_title COLLATE "C", operation_type COLLATE "C");

REFRESH MATERIALIZED VIEW publishing.pub_lines_by_key;

-- Документ под лейблом; NULL = документ действует для любого лейбла.
ALTER TABLE owners.documents ADD COLUMN IF NOT EXISTS label_id text;

-- Действие оператора под лейблом (журнал неизменен: старые записи не заполняются).
ALTER TABLE audit.actions ADD COLUMN IF NOT EXISTS label_id text;
CREATE INDEX IF NOT EXISTS actions_label ON audit.actions (label_id);
