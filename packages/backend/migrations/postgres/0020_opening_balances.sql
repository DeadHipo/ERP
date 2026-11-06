-- Стартовые позиции (D-174, срез 15.10.2026): утверждённая позиция псевдонима в книге лейбла на дату среза вместо
-- пересчёта истории. Строка `start` — снимок кабинета (сумма по областям master / publishing, в центах), строка
-- `adjustment` — утверждённая корректировка старта с основанием. При наличии активной строки старта у псевдонима
-- баланс отбрасывает входы книги по месяц среза включительно (отчёты, выписки, реклама) и операции книги до
-- `synced_at` (кроме тех, на которые ссылается `operation_ref`: переоткрытый аванс), и считает
-- к выплате = старт + движения после среза. Строка не редактируется: исправление — новая строка `adjustment`,
-- ошибка — мягкий откат (`deactivated_at`). `missing` — у кабинета не было суммы: это не ноль, выплата закрыта.
-- Внешних ключей на другие модули нет (D-121): псевдоним, документ и операция проверяет фасад.

CREATE TABLE IF NOT EXISTS settlements.opening_balances (
    org_id              text NOT NULL,
    id                  text PRIMARY KEY,
    -- Книга: собственный лейбл, в котором действует старт.
    label_id            text NOT NULL,
    -- Псевдоним (позиция кабинета — на ник, не на владельца).
    artist_id           text NOT NULL,
    kind                text NOT NULL CHECK (kind IN ('start', 'adjustment')),
    -- Последний отчётный месяц внутри старта (первое число месяца).
    cutoff_month        date NOT NULL CHECK (cutoff_month = date_trunc('month', cutoff_month)::date),
    -- Граница движений: операции книги с датой не позже этого дня — внутри старта.
    synced_at           timestamptz NOT NULL,
    master_cents        bigint NOT NULL,
    publishing_cents    bigint NOT NULL,
    missing             boolean NOT NULL DEFAULT false,
    -- Основание: файл и sha снимка, решение владельца, строка Main.
    basis               text NOT NULL CHECK (length(basis) BETWEEN 1 AND 2000),
    document_id         text,
    -- Аванс до среза, который остаётся к погашению после него (переоткрытый).
    operation_ref       text,
    comment             text NOT NULL DEFAULT '',
    created_at          timestamptz NOT NULL DEFAULT now(),
    deactivated_at      timestamptz,
    deactivated_reason  text,
    -- Нет суммы только у снимка; корректировка всегда с суммой.
    CONSTRAINT opening_balances_missing CHECK (
        (NOT missing) OR (kind = 'start' AND master_cents = 0 AND publishing_cents = 0)
    ),
    CONSTRAINT opening_balances_amount CHECK (missing OR master_cents <> 0 OR publishing_cents <> 0 OR kind = 'start')
);

-- Один активный старт псевдонима в книге на дату среза.
CREATE UNIQUE INDEX IF NOT EXISTS opening_balances_one_start
    ON settlements.opening_balances (org_id, label_id, artist_id, cutoff_month)
    WHERE kind = 'start' AND deactivated_at IS NULL;
CREATE INDEX IF NOT EXISTS opening_balances_artist ON settlements.opening_balances (org_id, artist_id);
CREATE INDEX IF NOT EXISTS opening_balances_label ON settlements.opening_balances (org_id, label_id);
