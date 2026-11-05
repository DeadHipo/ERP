-- Лейбл как книга (D-168): операции и рекламные записи получают own-лейбл, у own-лейбла — список счетов Believe.
-- label_id ссылается на labels.labels из другого модуля: внешних ключей между модулями нет (проверяет фасад).

-- Операция (выплата, аванс, вычет, кредит, возврат) под лейблом. NULL = «без лейбла»: история до разделения,
-- размечается скриптом scripts/assign-operation-labels.ts или оператором (PATCH /settlements/operations/:id).
ALTER TABLE settlements.operations ADD COLUMN IF NOT EXISTS label_id text;
CREATE INDEX IF NOT EXISTS operations_label ON settlements.operations (label_id);

-- Рекламная запись без ISRC получает лейбл явно (обязателен при создании); с ISRC лейбл берётся из строки юнита,
-- а записанный — запасной, когда ни одна строка ISRC не сопоставлена.
ALTER TABLE ads.expenses ADD COLUMN IF NOT EXISTS label_id text;

-- Счета Believe own-лейбла: 1052428 → 0to8, 1055956 → Echo8. Счёт принадлежит одному лейблу. Строки файла, ведущие
-- к другому own-лейблу, не отвергаются: они видны в сигнале labelOutsideAccount.
CREATE TABLE IF NOT EXISTS labels.label_accounts (
    account     text PRIMARY KEY CHECK (account <> ''),
    label_id    text NOT NULL REFERENCES labels.labels (id),
    created_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS label_accounts_label ON labels.label_accounts (label_id);
