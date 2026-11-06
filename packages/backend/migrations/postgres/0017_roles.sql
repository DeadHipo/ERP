-- Пользователи и роли (этап 3, D-171): членство в организациях, лейблы менеджера, отзываемые сессии, гранты поддержки.
-- Организация пользователя переезжает из auth.users.org_id в auth.memberships (роль org_admin: у пользователей этапа 2
-- был полный доступ), колонка удаляется. org_id без внешнего ключа на orgs.organizations (стиль D-121, проверяет
-- сервис). Миграция идемпотентна: повторный запуск ничего не меняет.

-- 1. Членство: пользователь в организации с ролью; disabled_at = членство приостановлено (другие не затронуты).
CREATE TABLE IF NOT EXISTS auth.memberships (
    user_id      text NOT NULL REFERENCES auth.users (id),
    org_id       text NOT NULL,
    role         text NOT NULL CONSTRAINT memberships_role CHECK (role IN ('org_admin', 'label_manager')),
    created_at   timestamptz NOT NULL DEFAULT now(),
    created_by   text NOT NULL,
    disabled_at  timestamptz,
    PRIMARY KEY (user_id, org_id)
);
CREATE INDEX IF NOT EXISTS memberships_org ON auth.memberships (org_id);

-- 2. Лейблы менеджера (только own-лейблы организации, проверяет сервис); у org_admin строк нет (у него все).
CREATE TABLE IF NOT EXISTS auth.user_labels (
    user_id     text NOT NULL,
    org_id      text NOT NULL,
    label_id    text NOT NULL,
    created_at  timestamptz NOT NULL DEFAULT now(),
    created_by  text NOT NULL,
    PRIMARY KEY (user_id, org_id, label_id),
    FOREIGN KEY (user_id, org_id) REFERENCES auth.memberships (user_id, org_id) ON DELETE CASCADE
);

-- 3. Сессии: токен несёт { sub, sid }, строка перечитывается на каждом запросе; выход и смена пароля отзывают.
-- org_id NULL только у системного администратора.
CREATE TABLE IF NOT EXISTS auth.sessions (
    id          text PRIMARY KEY,
    user_id     text NOT NULL REFERENCES auth.users (id),
    org_id      text,
    issued_at   timestamptz NOT NULL DEFAULT now(),
    expires_at  timestamptz NOT NULL,
    revoked_at  timestamptz,
    CONSTRAINT sessions_expiry CHECK (expires_at > issued_at)
);
CREATE INDEX IF NOT EXISTS sessions_user ON auth.sessions (user_id) WHERE revoked_at IS NULL;

-- 4. Гранты поддержки: администратор организации пускает системного администратора на срок (не больше 7 суток,
-- проверяет сервис).
CREATE TABLE IF NOT EXISTS auth.support_grants (
    id          text PRIMARY KEY,
    org_id      text NOT NULL,
    user_id     text NOT NULL REFERENCES auth.users (id),
    write       boolean NOT NULL DEFAULT false,
    granted_by  text NOT NULL,
    granted_at  timestamptz NOT NULL DEFAULT now(),
    expires_at  timestamptz NOT NULL,
    revoked_at  timestamptz,
    revoked_by  text,
    CONSTRAINT support_grants_expiry CHECK (expires_at > granted_at)
);
CREATE INDEX IF NOT EXISTS support_grants_active ON auth.support_grants (org_id, user_id) WHERE revoked_at IS NULL;

-- 5. Перенос auth.users.org_id в членство org_admin (только пока колонка есть), затем колонка, её CHECK и индекс
-- удаляются: два источника организации пользователя хуже одного.
DO $$
BEGIN
    IF EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_schema = 'auth' AND table_name = 'users' AND column_name = 'org_id'
    ) THEN
        INSERT INTO auth.memberships (user_id, org_id, role, created_at, created_by, disabled_at)
        SELECT id, org_id, 'org_admin', now(), 'migration 0017', NULL
        FROM auth.users
        WHERE org_id IS NOT NULL AND NOT is_system_admin
        ON CONFLICT DO NOTHING;
    END IF;
END
$$;
ALTER TABLE auth.users DROP CONSTRAINT IF EXISTS users_org;
DROP INDEX IF EXISTS auth.users_org;
ALTER TABLE auth.users DROP COLUMN IF EXISTS org_id;
