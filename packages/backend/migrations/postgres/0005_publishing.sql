-- Модуль издательских отчётов (D-121): квартальные выписки B17, их строки, писатели -> владельцы
-- и издательские условия автора (процент автора от нашей доли).
-- owner_id и document_id ссылаются на модуль владельцев: внешних ключей между модулями нет (проверяет фасад).
-- Деньги строк хранятся в пико-USD (целые), суммы считаются в SQL как numeric и читаются текстом.

CREATE SCHEMA IF NOT EXISTS publishing;

CREATE TABLE IF NOT EXISTS publishing.pub_statements (
    id                   text PRIMARY KEY,
    source               text NOT NULL CHECK (source = 'b17'),
    -- Кварталы выписки, JSON-массив строк ["2026-Q1"], отсортирован.
    periods              text NOT NULL CHECK (periods IS JSON ARRAY),
    file_name            text NOT NULL,
    stored_path          text NOT NULL,
    -- sha256 файла: защита от повторной загрузки того же файла.
    sha256               text NOT NULL UNIQUE CHECK (sha256 ~ '^[0-9a-f]{64}$'),
    -- Дата формирования выписки: передана при загрузке (provided) или время загрузки (upload_time).
    generated_at         timestamptz NOT NULL,
    generated_at_source  text NOT NULL CHECK (generated_at_source IN ('provided', 'upload_time')),
    uploaded_at          timestamptz NOT NULL,
    -- Сейчас пишется только loaded; в расчёте участвуют только loaded.
    status               text NOT NULL CHECK (status IN ('loaded', 'superseded', 'failed')),
    line_count           integer NOT NULL CHECK (line_count >= 0),
    -- Контрольная сумма Total Payable по строкам, USD (десятичная, без округления).
    total_payable        numeric NOT NULL,
    -- Предупреждения загрузки, JSON-массив строк.
    warnings             text NOT NULL CHECK (warnings IS JSON ARRAY)
);

-- Один квартал источника принадлежит одной выписке: вторая выписка за тот же квартал не принимается.
CREATE TABLE IF NOT EXISTS publishing.pub_statement_periods (
    source        text NOT NULL CHECK (source = 'b17'),
    period        text NOT NULL CHECK (period ~ '^[0-9]{4}-Q[1-4]$'),
    statement_id  text NOT NULL REFERENCES publishing.pub_statements (id),
    PRIMARY KEY (source, period)
);

CREATE TABLE IF NOT EXISTS publishing.pub_lines (
    statement_id    text NOT NULL REFERENCES publishing.pub_statements (id),
    -- Номер строки в файле.
    line_no         integer NOT NULL,
    period          text NOT NULL CHECK (period ~ '^[0-9]{4}-Q[1-4]$'),
    -- rights-holder name (получатель) и его нормализованная форма; авторы перечислены в songwriters (D-087).
    writer_name     text NOT NULL,
    writer_norm     text NOT NULL,
    songwriters     text,
    work_title      text NOT NULL,
    work_code       text,
    operation_type  text,
    retailer        text,
    country         text,
    -- Total Payable строки в пико-USD (может быть отрицательным: корректировки).
    payable_pico    bigint NOT NULL,
    PRIMARY KEY (statement_id, line_no)
);
CREATE INDEX IF NOT EXISTS pub_lines_writer ON publishing.pub_lines (writer_norm);

CREATE TABLE IF NOT EXISTS publishing.pub_writers (
    writer_norm   text PRIMARY KEY,
    display_name  text NOT NULL,
    -- Владелец писателя; NULL = ещё не сопоставлен.
    owner_id      text,
    resolution    text NOT NULL CHECK (resolution IN (
                      'unmapped', 'external', 'ambiguous', 'matched', 'created_waiting_documents', 'manual', 'merged')),
    -- holder: правообладатель строки; songwriter: автор из ячейки songwriters.
    role          text NOT NULL DEFAULT 'holder' CHECK (role IN ('holder', 'songwriter'))
);

CREATE TABLE IF NOT EXISTS publishing.pub_terms (
    id           text PRIMARY KEY,
    owner_id     text NOT NULL,
    -- Процент автора от денег за нашу долю, 0..100.
    percent      numeric NOT NULL CHECK (percent >= 0 AND percent <= 100),
    -- valid_from включается, valid_to не включается (D-025); NULL = без конца.
    valid_from   date NOT NULL,
    valid_to     date CHECK (valid_to IS NULL OR valid_to > valid_from),
    -- Документ-подтверждение; смена условий требует документа (проверяет сервис).
    document_id  text,
    created_at   timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS pub_terms_owner ON publishing.pub_terms (owner_id);
