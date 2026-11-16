-- D-217: саблейблы отдельным справочником и условия саблейбла по треку в links, по образцу условий паблишинга (D-185,
-- D-188). Деньги их пока не читают: расчёт идёт по старым правилам саблейблов (labels.label_rules); переключение — отдельно.

-- Справочник: только название. Заполняется сегодняшними саблейблами с теми же id.
CREATE TABLE IF NOT EXISTS labels.sublabels (
    org_id      text NOT NULL,
    id          text PRIMARY KEY,
    name        text NOT NULL CHECK (btrim(name) <> ''),
    created_at  timestamptz NOT NULL
);

CREATE INDEX IF NOT EXISTS sublabels_org ON labels.sublabels (org_id);
CREATE UNIQUE INDEX IF NOT EXISTS sublabels_org_name ON labels.sublabels (org_id, lower(name));

INSERT INTO labels.sublabels (org_id, id, name, created_at)
SELECT org_id, id, name, created_at
FROM labels.labels
WHERE kind = 'sublabel'
ON CONFLICT (id) DO NOTHING;

-- Условие саблейбла по треку: процент доли лейбла после артистов и участий, с какого и до какого месяца, документ.
-- На ISRC действует одна неотменённая запись; новая закрывает открытую; отменить можно только последнюю.
CREATE TABLE IF NOT EXISTS links.sublabel_terms (
    org_id          text NOT NULL,
    id              text PRIMARY KEY,
    sublabel_id     text NOT NULL,
    isrc            text NOT NULL CHECK (isrc ~ '^[A-Z]{2}[A-Z0-9]{3}[0-9]{7}$'),
    percent         numeric(9, 6) NOT NULL CHECK (percent > 0 AND percent <= 100),
    -- первое число месяца (M52); valid_to исключается (D-025), NULL = без конца
    valid_from      date NOT NULL CHECK (extract(day FROM valid_from) = 1),
    valid_to        date CHECK (valid_to IS NULL OR (valid_to > valid_from AND extract(day FROM valid_to) = 1)),
    document_id     text,
    note            text,
    decided_by      text NOT NULL,
    decided_at      timestamptz NOT NULL,
    -- документ, приложенный позже (одно разрешённое изменение записи без документа)
    document_by     text,
    document_at     timestamptz,
    cancelled_at    timestamptz,
    cancelled_by    text,
    cancel_reason   text,
    CHECK ((cancelled_at IS NULL) = (cancelled_by IS NULL)),
    CHECK ((document_at IS NULL) = (document_by IS NULL))
);

CREATE INDEX IF NOT EXISTS sublabel_terms_org ON links.sublabel_terms (org_id);
CREATE INDEX IF NOT EXISTS sublabel_terms_sublabel ON links.sublabel_terms (org_id, sublabel_id);
CREATE UNIQUE INDEX IF NOT EXISTS sublabel_terms_start
    ON links.sublabel_terms (org_id, isrc, valid_from) WHERE cancelled_at IS NULL;
