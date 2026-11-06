-- Виды операций (D-173, этап 5 «Ведомость»): вид операции хранится. До D-173 смысл выводился из полей (`meaningOf`):
-- out с областью погашения = аванс, out = выплата, in > 0 = удержание, in < 0 со ссылкой = возврат, иначе зачисление.
-- Миграция записывает в историю ровно этот вывод (функция settlements.kind_of), добавляет четыре вида ведомости
-- (выкуп, прощение, списание, корректировка), заменяет правила 0004 правилами по виду и добавляет источник лейбла,
-- канал, область книги и колонку замены выписки B17. Идемпотентна: повторный прогон ничего не меняет.

-- 1. Вид из полей: то же правило, что `kindOf` (@erp/shared/operation-kinds) и бывший `meaningOf`.
CREATE OR REPLACE FUNCTION settlements.kind_of(direction text, amount_cents bigint, scope text, operation_ref text)
RETURNS text LANGUAGE sql IMMUTABLE AS $$
    SELECT CASE
        WHEN direction = 'out' AND scope IS NOT NULL THEN 'advance'
        WHEN direction = 'out' THEN 'payout'
        WHEN amount_cents > 0 THEN 'deduction'
        WHEN operation_ref IS NOT NULL THEN 'return'
        ELSE 'credit'
    END
$$;

-- 2. Колонка вида: история получает выведенный вид, затем NOT NULL и список девяти видов.
ALTER TABLE settlements.operations ADD COLUMN IF NOT EXISTS kind text;
UPDATE settlements.operations SET kind = settlements.kind_of(direction, amount_cents, scope, operation_ref) WHERE kind IS NULL;
ALTER TABLE settlements.operations ALTER COLUMN kind SET NOT NULL;
ALTER TABLE settlements.operations DROP CONSTRAINT IF EXISTS operations_kind_check;
ALTER TABLE settlements.operations ADD CONSTRAINT operations_kind_check CHECK (
    kind IN ('payout', 'advance', 'deduction', 'credit', 'return', 'buyout', 'forgiveness', 'writeoff', 'adjustment')
);
CREATE INDEX IF NOT EXISTS operations_kind ON settlements.operations (org_id, kind);

-- 4 (до 3: правило списания читает область книги). Кто задал лейбл (NULL до `assign-operation-labels.ts
-- --mark-source`): one = единственный лейбл юнитов, default = история по умолчанию 0to8 (D-168), operator = оператор,
-- payout = по выплате или авансу, на которые ссылается. Канал выплаты текстом. Область книги: master или publishing
-- (история master). Индекс поиска дублей импорта по идентификатору перевода (не UNIQUE).
ALTER TABLE settlements.operations ADD COLUMN IF NOT EXISTS label_source text;
ALTER TABLE settlements.operations DROP CONSTRAINT IF EXISTS operations_label_source_check;
ALTER TABLE settlements.operations ADD CONSTRAINT operations_label_source_check CHECK (
    label_source IS NULL OR label_source IN ('one', 'default', 'operator', 'payout')
);
ALTER TABLE settlements.operations ADD COLUMN IF NOT EXISTS channel text;
ALTER TABLE settlements.operations DROP CONSTRAINT IF EXISTS operations_channel_check;
ALTER TABLE settlements.operations ADD CONSTRAINT operations_channel_check CHECK (
    channel IS NULL OR length(channel) BETWEEN 1 AND 100
);
ALTER TABLE settlements.operations ADD COLUMN IF NOT EXISTS area text NOT NULL DEFAULT 'master';
ALTER TABLE settlements.operations DROP CONSTRAINT IF EXISTS operations_area_check;
ALTER TABLE settlements.operations ADD CONSTRAINT operations_area_check CHECK (area IN ('master', 'publishing'));
CREATE INDEX IF NOT EXISTS operations_external_ref ON settlements.operations (org_id, external_ref) WHERE external_ref IS NOT NULL;

-- 3. Правила 0004 (по направлению и знаку) заменяются правилами по виду; старые правила — подмножество новых, история
-- проходит по построению.
ALTER TABLE settlements.operations
    DROP CONSTRAINT IF EXISTS operations_out_rules,
    DROP CONSTRAINT IF EXISTS operations_deduction_rules,
    DROP CONSTRAINT IF EXISTS operations_credit_rules,
    DROP CONSTRAINT IF EXISTS operations_kind_rules;
ALTER TABLE settlements.operations ADD CONSTRAINT operations_kind_rules CHECK (
    CASE kind
        -- выплата: владельцу, без области и ссылки
        WHEN 'payout' THEN direction = 'out' AND amount_cents > 0 AND owner_id IS NOT NULL
            AND scope IS NULL AND operation_ref IS NULL
        -- аванс: владельцу, к псевдониму, с областью погашения и документом-основанием
        WHEN 'advance' THEN direction = 'out' AND amount_cents > 0 AND owner_id IS NOT NULL AND artist_id IS NOT NULL
            AND document_id IS NOT NULL AND scope IS NOT NULL AND operation_ref IS NULL
        -- удержание: к псевдониму, область погашения всегда есть (по умолчанию any)
        WHEN 'deduction' THEN direction = 'in' AND amount_cents > 0 AND artist_id IS NOT NULL
            AND scope IS NOT NULL AND operation_ref IS NULL
        -- зачисление: к псевдониму, без области
        WHEN 'credit' THEN direction = 'in' AND amount_cents < 0 AND artist_id IS NOT NULL
            AND scope IS NULL AND operation_ref IS NULL
        -- возврат: ссылка на выплату, без области
        WHEN 'return' THEN direction = 'in' AND amount_cents < 0 AND operation_ref IS NOT NULL AND scope IS NULL
        -- выкуп: владельцу, документ, без области и ссылки (вне `paid` и `payable`)
        WHEN 'buyout' THEN direction = 'out' AND amount_cents > 0 AND owner_id IS NOT NULL AND document_id IS NOT NULL
            AND scope IS NULL AND operation_ref IS NULL
        -- прощение: ссылка на аванс, документ, без области
        WHEN 'forgiveness' THEN direction = 'in' AND amount_cents > 0 AND operation_ref IS NOT NULL
            AND document_id IS NOT NULL AND scope IS NULL
        -- списание паблишинга: владельцу, документ, область книги publishing, без области погашения и ссылки
        WHEN 'writeoff' THEN direction = 'in' AND amount_cents > 0 AND owner_id IS NOT NULL AND document_id IS NOT NULL
            AND scope IS NULL AND operation_ref IS NULL AND area = 'publishing'
        -- корректировка: in со знаком (> 0 уменьшает к выплате, < 0 увеличивает), владельцу, документ
        WHEN 'adjustment' THEN direction = 'in' AND owner_id IS NOT NULL AND document_id IS NOT NULL
            AND scope IS NULL AND operation_ref IS NULL
        ELSE false
    END
);

-- 5. Замена выписки B17: старая выписка ссылается на заменившую (без внешнего ключа, D-121).
ALTER TABLE publishing.pub_statements ADD COLUMN IF NOT EXISTS replaced_by text;
