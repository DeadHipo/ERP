-- Модуль расчётов (D-121): каждое изменение баланса — операция in или out со знаковой суммой в целых центах.
-- Типов операций нет: смысл (выплата, аванс, удержание, кредит, возврат) задают необязательные поля.
-- owner_id, artist_id, document_id и payment_proof_id ссылаются на модуль владельцев: внешних ключей между модулями
-- нет (проверяет фасад). Остальные правила (сумма возвратов, блокировка выплат) проверяет сервис.

CREATE SCHEMA IF NOT EXISTS settlements;

CREATE TABLE IF NOT EXISTS settlements.operations (
    id                  text PRIMARY KEY,
    -- out: деньги ушли от нас владельцу; in: удержание (сумма > 0) или зачисление на баланс (сумма < 0).
    direction           text NOT NULL CHECK (direction IN ('in', 'out')),
    amount_cents        bigint NOT NULL CHECK (amount_cents <> 0),
    owner_id            text,
    artist_id           text,
    date                date NOT NULL,
    -- Свободный текст (обычно 'YYYY-MM'), сервис формат не проверяет.
    period              text,
    -- JSON области погашения {kind, isrcs?, excludeIsrcs?}. Есть у аванса (out) и у удержания (in > 0).
    scope               text CHECK (scope IS NULL OR scope IS JSON OBJECT),
    -- Документ-основание (у аванса обязателен).
    document_id         text,
    -- Платёжный документ: с ним выплата засчитана.
    payment_proof_id    text,
    -- Выплата, к которой относится возврат.
    operation_ref       text,
    -- Выплата в очереди платёжного сервиса: блокирует новые выплаты владельцу до платёжного документа.
    deferred            boolean NOT NULL DEFAULT false,
    -- Перенесена из старой системы: засчитана без платёжного документа.
    migration           boolean NOT NULL DEFAULT false,
    comment             text NOT NULL,
    -- Идентификатор перевода в платёжном сервисе.
    external_ref        text,
    created_at          timestamptz NOT NULL DEFAULT now(),
    -- Мягкий откат: запись остаётся с причиной, пересчёт её не учитывает.
    deactivated_at      timestamptz,
    deactivated_reason  text,

    -- Выплата положительна и идёт владельцу; аванс (out с областью) привязан к артисту и документу.
    CONSTRAINT operations_out_rules CHECK (
        direction <> 'out' OR (
            amount_cents > 0 AND owner_id IS NOT NULL
            AND (scope IS NULL OR (artist_id IS NOT NULL AND document_id IS NOT NULL))
        )
    ),
    -- Удержание (in > 0) привязано к артисту и всегда имеет область (по умолчанию any).
    CONSTRAINT operations_deduction_rules CHECK (
        direction <> 'in' OR amount_cents < 0 OR (artist_id IS NOT NULL AND scope IS NOT NULL)
    ),
    -- Зачисление (in < 0) без области: возврат выплаты (operation_ref) или кредит артисту.
    CONSTRAINT operations_credit_rules CHECK (
        direction <> 'in' OR amount_cents > 0 OR (scope IS NULL AND (operation_ref IS NOT NULL OR artist_id IS NOT NULL))
    ),
    CONSTRAINT operations_deactivation CHECK ((deactivated_at IS NULL) = (deactivated_reason IS NULL))
);
CREATE INDEX IF NOT EXISTS operations_owner ON settlements.operations (owner_id);
CREATE INDEX IF NOT EXISTS operations_artist ON settlements.operations (artist_id);
CREATE INDEX IF NOT EXISTS operations_ref ON settlements.operations (operation_ref) WHERE operation_ref IS NOT NULL;
CREATE INDEX IF NOT EXISTS operations_date ON settlements.operations (date DESC, created_at DESC);

-- Снимок выплаты кнопкой: разбивка по артистам, хэши файлов. Хранится текстом байт в байт, как был записан.
CREATE TABLE IF NOT EXISTS settlements.payout_snapshots (
    operation_id  text PRIMARY KEY REFERENCES settlements.operations (id),
    created_at    timestamptz NOT NULL DEFAULT now(),
    payload       text NOT NULL CHECK (payload IS JSON)
);
