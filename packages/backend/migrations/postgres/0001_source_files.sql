-- Модуль источников: реестр загруженных файлов отчётов (Believe и др.).
-- Сами строки отчёта лежат в ClickHouse (believe.rows), здесь только сведения о файле.
-- В ClickHouse файл виден как file_id = source_files.id, аккаунт там не хранится: его берут отсюда по file_id.
--
-- Жизненный цикл записи (status):
--   loading     файл принят, строки ещё грузятся в ClickHouse (запись создаётся первой, до загрузки)
--   loaded      строки в ClickHouse, контрольные числа записаны; только такие файлы участвуют в расчёте
--   failed      загрузка не удалась, партиция в ClickHouse удалена; файл можно загрузить заново
--   superseded  заменён более новым файлом на тот же account + reporting_month; остаётся в истории

CREATE TABLE IF NOT EXISTS source_files (
    -- Совпадает с file_id в ClickHouse. Создаёт приложение (UUID), default нужен только для ручных вставок.
    id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),

    -- Источник отчёта: 'believe'. Другие источники (Vydia и т. п.) появятся позже.
    source           text NOT NULL CHECK (source <> ''),

    -- Аккаунт клиента у источника. В CSV его нет: берётся из имени файла <reportId>_<account>_<from>_<to>.csv
    account          text NOT NULL CHECK (account <> ''),

    -- Отчётный месяц, всегда 1-е число. Сначала берётся из имени файла, затем сверяется с колонкой
    -- «Reporting month» в строках отчёта. Вместе с account и source определяет область (scope).
    reporting_month  date NOT NULL CHECK (extract(day FROM reporting_month) = 1),

    -- Номер отчёта Believe из имени файла (необязательно, справочно).
    report_id        text,

    -- Имя файла, как его загрузили, и где лежит сохранённая копия (путь на диске или ссылка CDN).
    -- Это справочные сведения, расчёт на них не опирается.
    file_name        text NOT NULL,
    stored_path      text NOT NULL,

    -- sha256 файла ровно в том виде, как он загружен (для архива это хеш самого архива, не CSV внутри).
    -- Считается потоком до создания записи. Нужен для защиты от повторной загрузки того же файла
    -- и для воспроизводимости выплаты: в снимок выплаты попадают id и sha256 файлов.
    sha256           text NOT NULL CHECK (sha256 ~ '^[0-9a-f]{64}$'),

    status           text NOT NULL DEFAULT 'loading'
                     CHECK (status IN ('loading', 'loaded', 'failed', 'superseded')),

    -- Контрольные числа: считает загрузчик по строкам CSV (Decimal, без округления), затем они сверяются
    -- с ClickHouse после вставки. Пока файл loading, чисел ещё нет (NULL); у loaded они обязательны.
    line_count       bigint CHECK (line_count >= 0),
    net_total        numeric(38, 12),
    gross_total      numeric(38, 12),

    -- Кто загрузил (пока значение по умолчанию 'operator': прав доступа ещё нет).
    uploaded_by      text NOT NULL DEFAULT 'operator',

    -- created_at = момент загрузки файла. updated_at меняется триггером при любом UPDATE (смена статуса и т. д.).
    created_at       timestamptz NOT NULL DEFAULT now(),
    updated_at       timestamptz NOT NULL DEFAULT now(),

    CONSTRAINT source_files_loaded_has_totals CHECK (
        status <> 'loaded' OR (line_count IS NOT NULL AND net_total IS NOT NULL AND gross_total IS NOT NULL)
    )
);

-- Один действующий файл на область (ошибка duplicate_period). Упавшие и заменённые файлы не мешают:
-- они остаются в истории, а новый файл на ту же область принимается.
CREATE UNIQUE INDEX IF NOT EXISTS source_files_scope
    ON source_files (source, account, reporting_month)
    WHERE status IN ('loading', 'loaded');

-- Один и тот же файл не загружается дважды (ошибка duplicate_file). Условие то же, что выше.
CREATE UNIQUE INDEX IF NOT EXISTS source_files_sha
    ON source_files (sha256)
    WHERE status IN ('loading', 'loaded');

-- Общая функция для всех таблиц с updated_at: подставляет текущее время при каждом обновлении строки.
CREATE OR REPLACE FUNCTION set_updated_at() RETURNS trigger
    LANGUAGE plpgsql AS $$
BEGIN
    NEW.updated_at = now();
    RETURN NEW;
END
$$;

DROP TRIGGER IF EXISTS source_files_updated_at ON source_files;
CREATE TRIGGER source_files_updated_at
    BEFORE UPDATE ON source_files
    FOR EACH ROW EXECUTE FUNCTION set_updated_at();
