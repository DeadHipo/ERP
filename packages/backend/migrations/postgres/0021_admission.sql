-- Допуск к выплате (D-176, модуль 17 правил владельца): получатель и канал владельца, холды (решение, просьба артиста,
-- вопрос, спорная история), ответы «платить» на проверку первой выплаты, порог выплаты в договоре. Гейт выплаты
-- (facade/payout-gate.ts) читает их в порядке: договор → старт → нечего платить → ниже порога → холд → выплата без
-- подтверждения → нет получателя → нужен ответ → готово. Проверки «нет получателя» и «нужен ответ» действуют с первой
-- записи получателя в организации. Внешних ключей между модулями нет (D-121): владельца и лейбл проверяет фасад.
-- Строки не редактируются: отключение / снятие с причиной, замена — новая строка.

ALTER TABLE owners.contracts ADD COLUMN IF NOT EXISTS payout_threshold_cents bigint;
ALTER TABLE owners.contracts DROP CONSTRAINT IF EXISTS contracts_threshold_check;
ALTER TABLE owners.contracts ADD CONSTRAINT contracts_threshold_check CHECK (payout_threshold_cents IS NULL OR payout_threshold_cents >= 0);

CREATE TABLE IF NOT EXISTS settlements.payees (
    org_id              text NOT NULL,
    id                  text PRIMARY KEY,
    owner_id            text NOT NULL,
    channel             text NOT NULL CHECK (channel IN ('tipalti', 'easystaff', 'other')),
    -- Идентификатор получателя в кассе (payee id Tipalti, e-mail EasyStaff); пусто = по истории выплат.
    payee_ref           text,
    status              text NOT NULL CHECK (status IN ('confirmed', 'proposed')),
    basis               text NOT NULL CHECK (length(basis) BETWEEN 1 AND 2000),
    valid_from          date NOT NULL,
    -- Откуда строка (файл и ключ решения владельца); идемпотентность загрузчиков.
    source              text,
    created_at          timestamptz NOT NULL DEFAULT now(),
    deactivated_at      timestamptz,
    deactivated_reason  text
);
CREATE UNIQUE INDEX IF NOT EXISTS payees_one_active ON settlements.payees (org_id, owner_id) WHERE deactivated_at IS NULL;
CREATE INDEX IF NOT EXISTS payees_owner ON settlements.payees (org_id, owner_id);

CREATE TABLE IF NOT EXISTS settlements.holds (
    org_id              text NOT NULL,
    id                  text PRIMARY KEY,
    owner_id            text NOT NULL,
    -- Книга, в которой действует холд; NULL = во всех.
    label_id            text,
    kind                text NOT NULL CHECK (kind IN ('decision', 'artist_request', 'question', 'dispute')),
    -- Закрывает выплату (холд, спор с impact block_row) или только информирует (спор без влияния).
    blocks              boolean NOT NULL,
    reason              text NOT NULL CHECK (length(reason) BETWEEN 1 AND 4000),
    -- Условие снятия.
    release_when        text,
    amount_cents        bigint,
    period              text,
    review_on           date,
    since               date NOT NULL,
    source              text,
    status              text NOT NULL CHECK (status IN ('active', 'released')),
    released_at         timestamptz,
    released_reason     text,
    created_at          timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT holds_release CHECK ((status = 'active') = (released_at IS NULL))
);
CREATE INDEX IF NOT EXISTS holds_owner ON settlements.holds (org_id, owner_id);

CREATE TABLE IF NOT EXISTS settlements.payout_answers (
    org_id              text NOT NULL,
    id                  text PRIMARY KEY,
    owner_id            text NOT NULL,
    label_id            text,
    -- Сумма, на которую дан ответ: ответ действует только при той же сумме к выплате.
    due_cents           bigint NOT NULL CHECK (due_cents > 0),
    decision            text NOT NULL CHECK (decision IN ('pay', 'pay_task')),
    why                 text NOT NULL CHECK (length(why) BETWEEN 1 AND 4000),
    -- Вопрос, на который отвечено (история нерегулярная, первая выплата, договор).
    about               text NOT NULL,
    answered_by         text NOT NULL,
    source              text,
    created_at          timestamptz NOT NULL DEFAULT now(),
    deactivated_at      timestamptz,
    deactivated_reason  text
);
CREATE INDEX IF NOT EXISTS payout_answers_owner ON settlements.payout_answers (org_id, owner_id);
