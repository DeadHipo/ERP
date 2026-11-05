# Арендатор как граница изоляции: план реализации от senior backend

Дата: 2026-11-05, ветка `feature/fable-001`, код не менялся. Прочитано: `вопрос.md`, `CLAUDE.md`, `facade/CLAUDE.md`,
`бриф_для_агента.md` (D-169…D-172), `src/main.ts`, `src/connect-sources.ts`, `src/api/{app,audit,http,upload}.ts`,
`src/api/routes/{index,sources}.ts`, `src/api/operations.ts`, `src/api/openapi.ts`, `src/facade/{index,context,payouts}.ts`,
`src/shared/{private-stores,pg-db,postgres,clickhouse,errors}.ts`, `src/modules/sources/{service,loader,registry,columnar}.ts`,
`src/modules/publishing/service.ts`, `src/modules/{owners,splits,settlements}/service.ts` (approve / changeSplit /
setLabel), `src/modules/audit/schema.ts`, `scripts/{migrate-postgres.sh,migrate-clickhouse.ts,check-owner-scope.ts}`,
`scripts/e2e/{seed,verify-seed,lib}.ts`, `tests/helpers/{stack,fixtures,test-sources,sources-stack}.ts`,
`tests/api-contract.test.ts`, `tests/boundaries.test.ts`, `packages/frontend/src/api/client.ts`,
`packages/frontend/src/lib/{label,operator}.ts`, `playwright.config.ts`, `scripts/e2e/start.sh`, оба compose-файла,
`.env.example`, миграции PostgreSQL 0001…0014 и ClickHouse 0001…0003.

## 0. Вердикт: B, с тремя поправками к тому, как он описан в вопросе

**B подтверждаю.** Кодом:

- Всё, что нужно арендатору, уже параметризовано значениями, а не окружением: `openFacade({ db, sources, dataDir,
  payoutThresholdCents })`, `createSourcesService({ registry, columnar, storageDir })`, `createBelieveColumnar(ch, { database,
  stageDatabase })`, `createApp(facade, { tmpDir })`. Единственное место, где окружение читается «один раз на процесс»,
  это `connectSources()` (`src/connect-sources.ts`) и `main.ts`. Модули и фасад не знают, на какой базе живут.
- ClickHouse: `columnar.ts` квалифицирует каждое имя (`${DB}.rows`, `${STAGE_DB}.rows_<id>`, строки 153–159), значение
  `database` у клиента не используется. Значит, **один HTTP-клиент ClickHouse на процесс обслуживает всех арендаторов**;
  база ClickHouse это каталог, стоимость N баз = N каталогов с одинаковыми DDL. `scripts/e2e/seed.ts` уже так и делает.
- PostgreSQL: соединение привязано к базе, поэтому пул на арендатора неизбежен. Но `pg_advisory_xact_lock` (`pg-db.ts`,
  ключ 72 011 301) имеет область видимости **базы** (в тег блокировки входит OID базы), так что «одна блокировка на всех»
  варианта A превращается в «одна на арендатора» без единой строки кода. То же с очередями загрузок: `serial` в
  `createBelieveLoader` (`loader.ts:54`) и в `createPublishingService` (`publishing/service.ts:56`) живут в замыкании
  экземпляра сервиса, то есть на арендатора.
- Приватные базы тестов (`createPrivateStores`) и стенд e2e это ровно «арендатор»: 400+ тестов и 37 сценариев e2e
  доказывают, что фасад над парой баз с настоящими миграциями работает.

Против A и C: A меняет ~40 таблиц, все репозитории, ключ `believe.rows` и проекцию `units_by_label` (75,7 млн строк,
мутация), и одна забытая `WHERE tenant_id` = утечка; C превращает все `pgSchema('owners')` Drizzle в динамические и ломает
`tests/boundaries.test.ts` («у каждого модуля своя схема», проверка по `pg_namespace`). Ни то, ни другое не даёт ничего,
чего нет у B, кроме «обзора по всем арендаторам одним SELECT», который системному администратору не нужен (у него нет
денег, только список и состояние).

**Три поправки** к B из вопроса:

1. `createPrivateStores` **не может быть production-путём как есть**: он прогоняет файлы миграций напрямую
   (`pg.pool.query(migration)`, `private-stores.ts:46–50`) и **не пишет `schema_migrations`**. Арендатор, созданный им,
   для `migrate-postgres.sh` выглядит как база без единой миграции: при следующем запуске runner попытается применить
   0001…0014 заново (DDL идемпотентны, но `0013` пересоздаёт MV, а любая будущая не-идемпотентная миграция упадёт), а
   контрольная сумма ничем не защищена. Нужен TS-runner PostgreSQL с той же таблицей и той же контрольной суммой, что у
   bash-скрипта (п. 2, 3); `createPrivateStores` становится его обёрткой, и тесты начинают проверять runner.
2. «Фасад на запрос» в `createV1Router` не нужен: нужен **роутер на арендатора**. Одиннадцать файлов `routes/*.ts`
   замыкаются на `facade` и `facade.modules` при построении (`sourcesRouter`: `const { sources, publishing } =
   facade.modules`); резолвер фасада на запрос заставил бы переписать их все. Кэшированный `createV1Router(facade, opts)`
   в записи арендатора не меняет ни одного файла маршрутов, `operatorTrace(facade)`, хука аудита и контракт-теста (п. 1).
3. Арендатор до D-172 — заголовок `X-Tenant`, не поддомен и не префикс пути (аргументы в п. 1.3). После D-172 он
   исчезает для всех, кроме системного администратора.

Где B действительно ломается или требует внимания (ответ на вопрос 1):

| Случай | Что на самом деле | Что делать |
|---|---|---|
| `max_connections` (100 у образа) | пул на арендатора; сегодня `max` 10 по умолчанию | `TENANT_POOL_MAX=4` (тесты живут на 4), контрольная база 2, `max_connections=300` в `command` compose; PgBouncer в режиме transaction только после ~30 одновременно активных арендаторов (xact-lock с ним совместим, session-level не нужен) |
| Миграции × N | цикл; одна упавшая база не должна останавливать остальные молча | runner по списку контрольной базы, своя `schema_migrations` у каждого, сервер при открытии арендатора сверяет версию и отвечает 503 `tenant_schema_outdated` |
| Обзор «все арендаторы» | только циклом | системному администратору список, статус, версия схемы, размеры; денег в нём нет по решению овнера |
| Перенос владельца между арендаторами | нет и не делать | экспорт/импорт позже; владелец в двух арендаторах это два владельца |
| Общий каталог ISRC | нет общего; один ISRC может быть у двух арендаторов | правильно: отчёты не пересекаются по условию овнера; никакой глобальной уникальности |
| Бэкапы, удаление | `pg_dump <база>` + `BACKUP DATABASE` ClickHouse; удаление = `DROP DATABASE` ×3 + каталог файлов | удаление в два шага (suspend → delete с подтверждением), строка в контрольной базе остаётся со статусом `deleted` |
| Стоимость ClickHouse | N баз × 3 миграции; `system.parts` растёт линейно по файлам, не по арендаторам | ничего; проекция `units_by_label` в каждой базе |
| Два процесса API | `serial` загрузок per-process; два процесса разделены уникальными индексами реестра и `pub_statement_periods` (как сегодня) | ничего нового |

Ниже по десяти пунктам задания.

## 1. Сервер: реестр арендаторов, middleware, роутер, аудит, OpenAPI, загрузки

### 1.1 `src/tenants/` (новая папка; модули её не импортируют, `boundaries.test.ts` это проверяет)

```
src/tenants/
  types.ts        TenantRecord { slug, name, status, pgDatabase, chDatabase, chStageDatabase, dataDir | null, schemaVersion }
                  TenantEntry  { record, db, sources, facade, router, opened, lastUsed, inFlight }
  control.ts      контрольная база: Drizzle-схема control.tenants (+ позже users/memberships), репозиторий, openControl(pool)
  static.ts       staticRegistry(env): один арендатор `main` из DB_DATABASE / CLICKHOUSE_DATABASE (сегодняшний режим)
  pool.ts         openTenants({ registry, pgConfig, ch, dataDir, payoutThresholdCents, poolMax, idleMs }) → TenantPool
  middleware.ts   resolveTenant(pool, { defaultTenant }) → res.locals.tenant
  provision.ts    provisionTenant / dropTenant (п. 2)
  connect.ts      connectTenant(slug) для скриптов (п. 4)
```

`TenantPool` (`pool.ts`):

- `get(slug)`: single-flight (`Map<slug, Promise<TenantEntry>>`); открытие = `createPostgres({ ...pgConfig, database:
  record.pgDatabase, max: poolMax })` → `createDb(pool)` → `createSourceFilesRegistry(pool)` +
  `createBelieveColumnar(sharedCh, { database, stageDatabase })` → `createSourcesService({ registry, columnar, storageDir:
  join(tenantDir, 'files', 'sources') })` → `openFacade({ db, dataDir: tenantDir, sources, payoutThresholdCents })` →
  `router = Router().use(operatorTrace(facade)).use(createV1Router(facade, { tmpDir: join(tenantDir, 'tmp') }))`.
  `tenantDir = record.dataDir ?? join(dataDir, slug)` (п. 5). Перед открытием: `SELECT max(version) FROM
  schema_migrations` и то же в ClickHouse; меньше, чем файлов в `migrations/` → `AppError(503, 'tenant_schema_outdated')`,
  запись не кэшируется.
- `inFlight` считает запросы (middleware `+1` на входе, `−1` на `res.on('close')`); `sweep()` раз в минуту закрывает
  записи с `inFlight === 0` и `lastUsed < now − idleMs` (`TENANT_IDLE_MS`, по умолчанию 10 мин): `pool.end()`, запись
  удаляется, следующий запрос открывает заново. Сам `pg.Pool` и так отпускает простаивающие соединения через 10 с
  (`idleTimeoutMillis` pg), так что idle-close это про порядок, а не про `max_connections`; про `max_connections` — `poolMax`.
- `closeAll()` для `shutdown()` в `main.ts` (сегодня там `closeSources()`); общий `ch.close()` в конце.
- `invalidate(slug)` после `suspend`/`delete`: закрывает запись сразу (в полёте запросы дорабатывают, новых нет).
- Один клиент ClickHouse на процесс (`createClickHouse(clickHouseConfigFromEnv())`), `max_open_connections` 10 общие:
  загрузки двух арендаторов идут параллельно, это нормально (ClickHouse не транзакционен, партиции разных баз независимы).

`resolveTenant` (`middleware.ts`), монтируется на `/api/v1` после системных маршрутов и до роутера арендатора:

```
slug = req.header('x-tenant') ?? opts.defaultTenant
нет → 400 tenant_required; не /^[a-z0-9_]{1,32}$/ → 400 validation_error
record = registry.find(slug)  (кэш записей 30 с + invalidate при записи)
нет или status 'deleted' → 404 tenant_not_found; 'suspended' → 423 tenant_suspended; 'provisioning' / 'failed' → 409 tenant_not_ready
entry = await pool.get(slug); res.locals.tenant = { slug, facade: entry.facade }; entry.router(req, res, next)
```

### 1.2 `createApp`

`src/api/app.ts` получает две точки входа с общим телом:

```ts
export function createApp(facade: Facade, opts)                      // как сегодня: один статический роутер (тесты, e2e, single)
export function createTenantApp(pool: TenantPool, opts: { dataDir, clientDist?, defaultTenant?, systemKey? })
```

Общее тело `mountApi(app, { system: Router, tenant: RequestHandler })`:

1. `app.use('/api/v1', systemRouter)`: `/health`, `/openapi.json`, `/docs` (они не зависят от арендатора; сегодня они в
   `createV1Router`, вынести) и `/tenants` (п. 2);
2. `app.use('/api/v1', tenantHandler)`: в `createApp(facade)` это сам роутер (`operatorTrace(facade)` + `createV1Router`),
   в `createTenantApp` — `resolveTenant(pool)`;
3. 404 `/api`, статика клиента, `errorHandler` — без изменений.

Важно для `tests/api-contract.test.ts`: его `expressRoutes(app)` обходит `app.router.stack` рекурсивно через
`layer.handle.stack`; роутер, спрятанный за замыканием `(req,res,next) => entry.router(...)`, он не увидит. Поэтому
single-режим монтирует роутер **как есть** (контракт-тест не меняется), а для multi-режима `tests/tenants.test.ts`
обходит `createV1Router(facade, opts)` напрямую и сравнивает с `API_OPERATIONS` (п. 8).

`main.ts`:

```
если DB_CONTROL_DATABASE задан → control = openControl(createPostgres({ ...cfg, database: DB_CONTROL_DATABASE, max: 2 }))
                                  registry = controlRegistry(control)
иначе                           → registry = staticRegistry(env)   // один арендатор `main` на DB_DATABASE / CLICKHOUSE_DATABASE
pool = openTenants({ registry, ... }); app = createTenantApp(pool, { defaultTenant: ERP_DEFAULT_TENANT ?? (static ? 'main' : undefined) })
```

То есть структурно приложение всегда многоарендное; сегодняшний `.env` без `DB_CONTROL_DATABASE` даёт ровно сегодняшнее
поведение (`X-Tenant` не нужен, арендатор `main`), e2e-стенд (`start.sh`: `DB_DATABASE=erp_e2e CLICKHOUSE_DATABASE=believe_e2e`)
и частные стенды из `frontend/CLAUDE.md` работают без правок. `process.loadEnvFile` переезжает из `connectSources` в `main.ts`
и в `connect.ts` скриптов.

### 1.3 Как определять арендатора до D-172: заголовок `X-Tenant`

- **Заголовок.** Ровно та же механика, что `X-Operator`: одна строка в `client.ts` (`headers['X-Tenant']`), одна в
  `operatorTrace`-подобном middleware, одна в OpenAPI. Пути `operations.ts`, обходчик контракт-теста, `BASE` клиента,
  `ROUTE_PATHS` SPA, `coverage.ts`, 37 e2e-спеков, Swagger UI (`servers: [{ url: '/api/v1' }]`) не трогаются. После
  D-172 арендатор приходит из сессии, заголовок остаётся только у `system_admin` (выбрать, на кого смотреть) и у скриптов;
  у остальных ролей заголовок, не совпадающий с членством, → 403 `tenant_forbidden`. Ничего не остаётся «в URL навсегда».
- Префикс `/api/v1/t/:tenant/`: ломает `operations.ts` (путь = ключ контракта), обходчик, `BASE`, OpenAPI; после D-172
  должен остаться, потому что структура URL это контракт, хотя смысла в нём уже нет.
- Поддомен: DNS/hosts в dev, прокси Vite, `baseURL` Playwright, cookie-домены в D-172; после D-172 избыточен.

Без заголовка: `defaultTenant` (в single-режиме `main`; в multi-режиме не задан → 400 `tenant_required`). Это даёт
скриптам, curl и Swagger ту же свободу, что сегодня.

### 1.4 `operatorTrace` и хук аудита

Не меняются. `operatorTrace(facade)` монтируется внутри роутера арендатора (замыкание на его фасад), `recordAction` пишет
в `audit.actions` **базы арендатора** — арендатор в записи аудита не нужен, он равен базе. В `summary` ничего нового.
В лог сервера (`console.error('audit record failed…')`) добавить slug. `BODY_ID_FIELDS` без изменений. Единственное
новое: `X-Audit: failed` и `operator_required` ведут себя как прежде, но после `resolveTenant`, так что без арендатора
запись отклоняется раньше, чем читается оператор (порядок кодов: `tenant_required` → `operator_required`).

### 1.5 OpenAPI и контракт-тест, когда фасад на арендатора

Документ `buildOpenApiDocument()` строится из `operations.ts` и не зависит от фасада; `/openapi.json` и `/docs`
переезжают на системный уровень, чтобы не строиться на каждого арендатора. В `openapi.ts` один раз добавляется
`components.parameters.XTenant` (header, optional, описание «slug арендатора; без него арендатор по умолчанию») и
подставляется в `parameters` каждой операции (не трогать `headers` в `operations.ts`: там `X-Operator` только у записей,
а `X-Tenant` у всех). `tests/api-contract.test.ts` не меняется (п. 8); новые операции `/tenants` добавляются в
`operations.ts` с `tag: 'tenants'` и вызываются в сценарии (п. 2.3).

### 1.6 Загрузки

`receiveUpload(req, tmpDir)` не меняется; `tmpDir` на арендатора = `join(tenantDir, 'tmp')` через `opts` роутера (уже
параметр `createV1Router`). Оригиналы: `storageDir = join(tenantDir, 'files', 'sources')` (как в `main.ts` и `seed.ts`);
паблишинг сам берёт `join(config.dataDir, 'files', 'publishing')` (`facade/index.ts:40`). Раскладка:

```
<dataDir>/<slug>/files/sources/<sha>-<name>.csv
<dataDir>/<slug>/files/publishing/...
<dataDir>/<slug>/tmp/<id>.upload
```

`source_files.stored_path` хранит абсолютный путь (`loader.ts:81`), поэтому для арендатора «один» (п. 5) каталог не
переносится: его `data_dir` в контрольной базе указывает на сегодняшний корень.

## 2. Жизненный цикл арендатора: API

### 2.1 Контрольная база

Отдельная база `erp_control` (`DB_CONTROL_DATABASE`), не схема внутри `erp`: иначе удаление или бэкап арендатора «один»
задевает control plane, а `boundaries.test.ts` («схема на модуль, без FK между модулями») пришлось бы учить особому
случаю. Миграции в новой папке `migrations/control/NNNN_*.sql` со своей `schema_migrations` (тот же runner, п. 3).

`0001_tenants.sql`:

```sql
CREATE SCHEMA IF NOT EXISTS control;
CREATE TABLE IF NOT EXISTS control.tenants (
  slug            text PRIMARY KEY CHECK (slug ~ '^[a-z0-9_]{1,32}$'),
  name            text NOT NULL,
  status          text NOT NULL CHECK (status IN ('provisioning','active','suspended','failed','deleted')),
  pg_database     text NOT NULL UNIQUE,
  ch_database     text NOT NULL UNIQUE,
  ch_stage_database text NOT NULL UNIQUE,
  data_dir        text,                      -- NULL = <dataDir>/<slug>; у арендатора «один» = сегодняшний корень
  error           text,                      -- причина failed
  created_at      timestamptz NOT NULL DEFAULT now(),
  created_by      text NOT NULL,             -- X-Operator
  updated_at      timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS control.tenant_events (  -- аудит control plane: create, suspend, resume, delete, migrate
  id bigserial PRIMARY KEY, at timestamptz NOT NULL DEFAULT now(), slug text NOT NULL, operator text NOT NULL,
  kind text NOT NULL, details jsonb NOT NULL DEFAULT '{}'
);
```

D-172 добавит сюда `control.users`, `control.memberships (user_id, slug, role)`, `control.user_labels (user_id, slug,
label_id)` — `label_id` локален арендатору, FK в другую базу нет (в духе D-121). Таблица `auth.users` из брифа
(`0018_auth.sql` в базе арендатора) переезжает в control (п. 9).

### 2.2 `provisionTenant` (`src/tenants/provision.ts`), не `createPrivateStores`

Имена баз: `erp_tenant_<slug>`, `believe_tenant_<slug>`, `believe_tenant_<slug>_stage`. Не `erp_<slug>`: тесты занимают
`erp_t_<hex>` / `believe_t_<hex>`, e2e — `erp_e2e`; префикс `tenant_` исключает столкновение и даёт `drop.ts`-подобную
уборку по маске.

Шаги, каждый идемпотентен, статус записывается в control:

1. `INSERT control.tenants (status 'provisioning')` — slug занят → 409 `tenant_exists` (в том числе `deleted`: slug не
   переиспользуется, чтобы старые записи аудита и файлы не смешались; снять ограничение можно отдельным решением).
2. `CREATE DATABASE erp_tenant_<slug>` через admin-пул (control-пул с `max: 2`, как `admin` в `private-stores.ts`); уже есть
   → ошибка `tenant_database_exists` (никогда не переиспользовать чужую базу молча).
3. `migratePostgres({ pool, dir: migrations/postgres })` — TS-runner, пишет `schema_migrations` (п. 3).
4. `migrateClickHouse({ ch, database, stageDatabase, dir })` с переименованием `believe` → `believe_tenant_<slug>` (регулярка
   из `private-stores.ts:48`, вынести в `shared/clickhouse-sql.ts` как `renameDatabases(sql, names)` и покрыть тестом:
   комментарии миграций тоже содержат слово `believe`, это безвредно, но тест должен это зафиксировать).
5. `mkdir -p <dataDir>/<slug>/{files/sources,files/publishing,tmp}`.
6. `UPDATE status 'active'`, событие `create`.

Любая ошибка на шагах 2–5: `DROP DATABASE IF EXISTS … WITH (FORCE)` ×1 + `DROP DATABASE … SYNC` ×2, `status 'failed'`,
`error` = сообщение; повтор `POST /tenants` с тем же slug при `failed` разрешён (перезапускает с шага 2). Ничего не
пишется в базы арендатора: пустой арендатор это пустые таблицы, `newFacade()` сеет лейблы сам, а production-арендатор
получает лейблы через `POST /labels` (D-171, чек-лист).

`createPrivateStores(name)` после этого = `provisionStores({ pgName: 'erp_'+name, chName: 'believe_'+name, … })` без строки в
control: тесты и e2e работают на том же коде, что production, и runner с `schema_migrations` проверяется 400 тестами.

### 2.3 Маршруты (`src/api/routes/tenants.ts`, системный уровень, не внутри роутера арендатора)

| Маршрут | Что | Коды |
|---|---|---|
| `GET /tenants` | список: slug, name, status, версия схемы PG/CH, число `loaded` файлов и владельцев (циклом по открытым, остальным `null`), размер баз (`pg_database_size`, `system.parts`) | |
| `POST /tenants { slug, name }` | `provisionTenant`; ответ 201 с записью | 409 `tenant_exists`, 422 `tenant_database_exists`, 500 с `status 'failed'` |
| `GET /tenants/:slug` | запись + состояние пула (открыт, inFlight, lastUsed) | 404 |
| `POST /tenants/:slug/suspend` | статус `suspended`, `pool.invalidate` | 409 если не `active` |
| `POST /tenants/:slug/resume` | обратно в `active` | |
| `POST /tenants/:slug/delete { confirm: slug }` | только из `suspended`; `DROP` ×3, `rm -rf <dataDir>/<slug>` **только если `data_dir IS NULL`** (арендатор «один» указывает на корень, его файлы не трогать), статус `deleted` | 409 `tenant_not_suspended`, 400 `confirm_mismatch` |
| `POST /tenants/:slug/migrate` | прогнать миграции этого арендатора (п. 3) | |

`DELETE`-метод не вводить: `HttpMethod` в `operations.ts` это `'get' | 'post' | 'patch'`, клиент `call()` тоже; POST
`/delete` с телом-подтверждением надёжнее для необратимого действия.

Доступ до D-172: заголовок `X-System-Key` = `SYSTEM_ADMIN_KEY` из `.env` (без ключа в `.env` маршруты отвечают 503
`tenants_disabled`; в single-режиме без контрольной базы — 404). Это временная заглушка в одном middleware
`requireSystemKey`, которую D-172 заменяет на роль `system_admin`. Запись требует `X-Operator` (тот же `operatorTrace`
над системным роутером, но хук аудита пишет в `control.tenant_events`, а не в `facade.recordAction`: сделать
`operatorTrace(record: (input) => Promise<void>)` вместо `operatorTrace(facade)` — одна строка в сигнатуре, оба
вызова передают функцию).

В `operations.ts` шесть записей с `tag: 'tenants'`, `access: 'system'` (поле из D-172 можно завести уже сейчас как
необязательное). Контракт-тест вызывает их в сценарии: `POST /tenants` с `slug: 'ct_' + hex`, `GET`, `suspend`, `resume`,
`suspend`, `delete`. Это создаёт и удаляет пару баз (≈3 с на стеке); приемлемо, это и есть проверка provisioning.
Контрольная база теста — приватная `erp_control_t_<hex>` из `createPrivateControl()` (п. 8).

## 3. Миграции по всем арендаторам

### 3.1 TS-runner PostgreSQL (`src/shared/migrate-postgres.ts`)

Зеркало `scripts/migrate-postgres.sh`, чтобы оба писали одну таблицу одинаково: `schema_migrations (version int PK, name,
checksum, applied_at)`, контрольная сумма = sha256 файла **без `\r`** (bash делает `tr -d '\r'`; CH-runner делает
`replace(/\r\n/g, '\n')` — для файлов без одиночных `\r` это одно и то же, но в TS-runner PG повторить именно `tr -d '\r'`),
применение `BEGIN; <файл>; INSERT schema_migrations; COMMIT` на одном соединении, изменённый применённый файл → ошибка,
файл младше применённого максимума → ошибка. `planMigrations`/`listMigrations` из `migrate-clickhouse.ts` переиспользовать
(они уже экспортированы). Bash-скрипт остаётся для compose (образ postgres без node), но становится вторым клиентом той
же таблицы; тест `tests/migrations.test.ts` применяет временный каталог с двумя файлами TS-runner'ом и проверяет, что
`--status` bash-скрипта (если `psql` доступен; иначе skip) видит их как `applied`.

### 3.2 `scripts/migrate-tenants.ts [--status] [--tenant <slug>] [--control-only]`

1. Открыть control-пул, мигрировать `migrations/control/` (своя `schema_migrations` в `erp_control`).
2. `SELECT … FROM control.tenants WHERE status IN ('active','suspended') ORDER BY slug`.
3. Для каждого: PG-runner на `pg_database`, затем CH-runner на `ch_database`/`ch_stage_database` (переименование как в
   provisioning), событие `migrate` в `tenant_events` с числом применённых. Ошибка у арендатора: печать, статус
   арендатора **не** меняется (его база просто отстаёт; сервер ответит 503 `tenant_schema_outdated` на этот slug, остальные
   работают), продолжить остальных, в конце exit 1 со списком. Последовательно, не параллельно: один runner «not safe to
   run in two processes at once», и `max_connections`.
4. `--status` печатает таблицу slug × применено/ожидает.

Сервер при открытии арендатора сверяет `max(version)` с числом файлов в `migrations/postgres` и `migrations/clickhouse`
(их список читается один раз при старте). Миграция на работающем сервере: DDL идемпотентны и под `IF NOT EXISTS`, Drizzle
не кэширует схему, активные транзакции ждут табличных блокировок; рекомендация в recipe: `migrate-tenants` → перезапуск API.
Никакой «миграции на лету при первом запросе»: это скрыло бы ошибку в середине запроса пользователя.

### 3.3 Compose

Пока нет образа приложения (деплой вне scope), `postgres-migrate` и `clickhouse-migrate` остаются и мигрируют
`${DB_DATABASE}` / `${CLICKHOUSE_DATABASE}` — то есть базу арендатора «один» и больше ничего. Контрольную базу и
остальных арендаторов мигрирует `npm run migrate:tenants` с хоста (`tsx scripts/migrate-tenants.ts`), как сегодня
`migrate:ch`. `.env.example` получает `DB_CONTROL_DATABASE=erp_control`, `TENANT_POOL_MAX=4`, `TENANT_IDLE_MS=600000`,
`SYSTEM_ADMIN_KEY=`, `ERP_DEFAULT_TENANT=`. Когда появится образ приложения, compose-one-shot становится одним
сервисом `migrate` = `node scripts/migrate-tenants.ts`, и bash-скрипт уходит. Создание самой `erp_control`:
`init/postgres/` сегодня пуст; добавить `00_control.sql` с `CREATE DATABASE erp_control` не выйдет (entrypoint выполняет
файлы в `POSTGRES_DB`, а `CREATE DATABASE` в нём работает, это допустимо, но только при первом старте тома) — надёжнее
`scripts/migrate-tenants.ts` сам делает `CREATE DATABASE IF NOT EXISTS`-эквивалент (проверка `pg_database` + `CREATE`).

## 4. Скрипты (`scripts/*.ts`)

23 файла открывают стек через `connectSources(join(dataDir, 'files', 'sources'))` и читают `DB_DATABASE` /
`CLICKHOUSE_DATABASE` из `.env`. Новый `src/tenants/connect.ts`:

```ts
export async function connectTenant(opts: { tenant?: string; dataDir?: string }): Promise<{
  slug: string; db: Db; sources: SourcesService; dataDir: string; close(): Promise<void>;
}>
```

Правило выбора, одно на все скрипты: `--tenant <slug>` в argv или `ERP_TENANT` в env → control-база → запись → пул на её
базу (тот же код, что `TenantPool.get`, без кэша); ни того, ни другого → если `DB_DATABASE` задан, старый путь
`connectSources` (static `main`) с предупреждением «tenant: main (static)». Так частные e2e-стенды (`DB_DATABASE=erp_mine …
main.ts`) и `verify-seed.ts` (он выставляет `process.env.DB_DATABASE` сам, строки 29–30) работают без правок, а на
production-стенде `ERP_TENANT` обязателен (пустой `DB_DATABASE` в `.env`). Замена в скриптах механическая: три строки
на файл (`const { db, sources, dataDir, close } = await connectTenant({ tenant: flag('--tenant'), dataDir: argv })`), `dataDir`
скрипта больше не аргумент, а свойство арендатора. `scripts/mvp/lib.ts` и `scripts/mvp/compare-common.ts` открывают стек
в одном месте — там одна правка на всю стадию 4/5. Скрипты D-169 (`assign-label-books.ts`, `check-label-books.ts`) писать
сразу через `connectTenant`.

## 5. Сегодняшние `erp` / `believe` как арендатор «один» без копирования

`scripts/register-tenant.ts --slug <slug> --name <имя> --pg erp --ch believe --data-dir <repo>/data`:

1. Проверяет, что базы существуют и `schema_migrations` в обеих на последней версии (иначе «сначала `npm run migrate:pg` /
   `migrate:ch`»).
2. Проверяет, что `<data-dir>/files/sources` существует и `stored_path` первых `loaded` файлов из реестра лежат под ним
   (они абсолютные, `loader.ts:81`), иначе отказ: это защита от регистрации не того каталога.
3. `INSERT control.tenants (slug, name, 'active', 'erp', 'believe', 'believe_stage', data_dir = <data-dir>)`, событие `register`.

Ни один файл и ни одна строка не копируются; `.env` получает `DB_CONTROL_DATABASE=erp_control` и `ERP_DEFAULT_TENANT=<slug>`,
`DB_DATABASE`/`CLICKHOUSE_DATABASE` остаются для compose-one-shot и скриптов без `--tenant`. Slug и имя выбирает овнер
(в коде и документах имя юрлица не нужно). Второй лейбл того же владельца (Echo8) остаётся книгой **внутри** этого
арендатора — ровно по D-168/D-169, ничего не переезжает.

Что проверить после регистрации на реальных данных: `GET /overview` без заголовка (default) и с `X-Tenant: <slug>` байт в
байт равны ответу сегодняшнего сервера; `check-owner-scope.ts --tenant <slug>` 0 differing; `check-label-books.ts` те же числа.

## 6. Два администратора одного арендатора параллельно

Что уже гарантирует код (и что стоит зафиксировать тестом в `tests/tenants.test.ts`, чтобы не потерять):

- **Все записи сериализованы** внутри базы арендатора (`pg_advisory_xact_lock` в `db.transaction()`); проверки
  «прочитал → решил → вставил» внутри одной транзакции безопасны: `activeByScope` + `duplicate_period`, `periodTaken` B17,
  перекрытия сплитов и участий (D-126), `createContract`, слияния. Между арендаторами записи **не** ждут друг друга
  (блокировка в теге несёт OID базы) — пин: длинная транзакция в A, запись в B завершается за < 100 мс.
- **Двойная выплата невозможна**: `createPayout` считает баланс **внутри** `db.transaction` (`payouts.ts:115–118`, снимок
  той же транзакции), вторая кнопка видит первую выплату и получает `nothing_to_pay`/`below_threshold`. Пин: `Promise.all`
  из двух `createPayout` → одна операция.
- Загрузки: `serial` на процесс плюс уникальные индексы реестра на два процесса.
- Чтения: `db.snapshot()` REPEATABLE READ — один администратор видит одну версию, даже пока другой пишет.

Чего код не гарантирует — потерянное обновление между двумя запросами (экран прочитан → подумали → PATCH). Таблицы
модулей **не имеют `updated_at`** (есть только у `source_files`, миграция 0001), поэтому `If-Match: <updatedAt>` потребовал
бы колонку и триггер на ~10 таблиц. Не делать. Вместо этого — **ожидаемое состояние в теле** там, где правка касается денег,
и «последний побеждает, оба в аудите» везде, где нет:

| Правка | Сегодня | Предложение |
|---|---|---|
| `POST /splits/change` | история append-only: текущий сплит закрывается `setValidTo`, новый вставляется (`splits/service.ts:268–279`); второй администратор со старого экрана закроет сплит, который только что создал первый — ничего не теряется, оба в аудите | необязательное `expectedCurrentSplitId` в теле: `current.id !== expected` → 409 `split_changed` (details: текущий id). Фронт P15 передаёт id из своей таблицы |
| `POST /documents/:id/approve` | идемпотентно (`approveDocument:723`); `attachFile` сбрасывает утверждение (`:704`) — гонка «A утверждает, B прикладывает новый файл» заканчивается неутверждённым документом, что и правильно | ничего; аудит показывает обе записи |
| `PATCH /settlements/operations/:id` (лейбл) | последняя запись побеждает, `setLabel` без проверки | `expectedLabelId` (nullable) в теле → 409 `label_changed`; D-170 и так добавляет `reason` в тело, одной строкой больше |
| `PATCH /ads/:id` (процент, область) | LWW | `expectedRecoveryPercent` необязательный → 409 `ad_changed`; деньги зависят от процента |
| `PATCH /tracks/:id`, `note` | LWW | ничего |
| `POST /artists/:id/owner`, слияния | внутри транзакции проверяют текущее состояние | ничего |

Общее правило в D-записи: «оптимистичный контроль = ожидаемое значение изменяемого поля в теле запроса, 409 с текущим
значением в `details`; колонок версий нет». Кодов три, в `errors.ts` ничего нового (`ConflictError`), в
`i18n/ru/errors.ts` три фразы «запись изменена другим оператором, обновите страницу», во фронте один общий перехват
409 с перезапросом. Тест `tests/concurrency.test.ts`: для каждого из трёх — две конкурентные правки, одна 200, вторая 409.

## 7. Фронт

До D-172: `lib/tenant.ts` по образцу `lib/operator.ts` (`erp.tenant` в `localStorage`, событие), `client.ts` добавляет
`X-Tenant` ко всем запросам, когда значение непустое (пустое = арендатор по умолчанию, как сегодня у e2e). В `AppShell`
рядом с `OperatorField` поле арендатора (свободный slug; 404 от API показывается как «арендатор не найден»). Смена
арендатора: `setStoredLabel('')`, `queryClient.clear()`, переход на `/`. Переключатель лейбла (`LabelSwitch`,
`useLabel`) живёт **внутри** арендатора и не меняется: `GET /labels` уже отвечает лейблами текущей базы. В URL арендатора
нет (`?label=` остаётся): `ROUTE_PATHS`, `coverage.ts`, 37 e2e-спеков и `routes-no-names.test.ts` построены на путях без
префикса; ссылка открывается в арендаторе того, кто её открыл (как сегодня с оператором).

После D-172: `GET /auth/me` → `{ user, tenant, labels, role }`; поле арендатора исчезает у всех, кроме `system_admin`, у
которого это выпадающий список из `GET /tenants` (и он же шлёт `X-Tenant`). Страница входа принимает логин без slug:
пользователь принадлежит одному арендатору (членство в control), многоарендное членство одного пользователя — позже,
по запросу овнера. Для e2e ничего: стенд single-режима, `openAs` ставит оператора как сегодня.

## 8. Тесты

- `tests/helpers/fixtures.ts` `newFacade()` и `tests/helpers/test-sources.ts` — **без изменений**: приватная пара баз
  уже и есть арендатор; меняется только внутренность `createPrivateStores` (через `provisionStores`, теперь с
  `schema_migrations`). Побочный плюс: `tests/private-stores.test.ts` (новый, 3 теста) проверяет, что после создания
  `schema_migrations` содержит все версии с теми же контрольными суммами, что считает bash-скрипт.
- `tests/api-contract.test.ts` — без изменений в механике (`createApp(f, …)` single-режим, статический роутер,
  обходчик видит всё); плюс шесть вызовов `/tenants` в сценарии и приватная контрольная база (`createPrivateControl()`
  в `tests/helpers/control.ts`, `erp_control_t_<hex>`, дропается в `setup.ts` рядом с `closeTestSources`).
- Новый `tests/tenants.test.ts` (стек): (1) `provisionTenant` ×2 → у каждого свои базы, версии схем полные; (2) один и тот
  же ISRC, одно имя владельца, один файл Believe (`writeBelieve`, один sha256) загружены в оба без 409; `GET /owners` под
  `X-Tenant: a` не видит владельца b; (3) без заголовка и без default → 400 `tenant_required`; с default → арендатор
  default; неизвестный → 404; `suspended` → 423; (4) запись под `a` оставляет строку `audit.actions` только в базе `a`;
  (5) `sweep()` с подменённым временем закрывает пул, следующий запрос открывает заново, `GET /tenants/:slug` показывает
  `opened: false/true`; (6) запись в `b` не ждёт транзакции в `a`; (7) `expressRoutes(createV1Router(facade, opts))` =
  список `API_OPERATIONS` минус `tenants`/`system` (контракт multi-режима); (8) `migrate-tenants` с временным каталогом
  миграций и лишним файлом `0099_probe.sql` применяет его в обе базы и записывает версию; (9) `delete` арендатора с
  `data_dir IS NULL` удаляет каталог, с заданным `data_dir` — нет; (10) двойная выплата (п. 6).
- `tests/boundaries.test.ts`: добавить правило «`src/modules/**` и `src/facade/**` не импортируют `src/tenants/`»;
  `src/api/**` может импортировать только `tenants/{types,middleware}`.
- `tests/concurrency.test.ts` (п. 6), `tests/migrations.test.ts` (п. 3.1).
- Фронт: `tests/coverage.test.ts` узнаёт шесть операций `tenants` как «страница системного администратора»
  (до D-172 — отказ с причиной «нет UI до D-172», список отказов там уже есть); e2e без изменений.
- Golden, `scope.test.ts`, `layers/*`: не трогаются — это и есть доказательство, что деньги не заметили арендатора.

## 9. Порядок коммитов, оценка, что меняется в D-169…D-172

Каждый коммит проходит definition of done. Коммиты 1–2 не конфликтуют с D-169 (тот правит `sources`, `facade`, `labels`,
`publishing`; эти — `api/app.ts`, `main.ts`, `shared/`, новую папку), поэтому их можно сделать **до** D-169 или
параллельно в другой ветке.

| # | Коммит | Файлы | Дни |
|---|---|---|---|
| 1 | `refactor(api): the API over a tenant registry; a static tenant from the environment` | `src/tenants/{types,static,pool,middleware}.ts`, `api/app.ts` (`createTenantApp`, системный роутер с `/health`, `/openapi.json`, `/docs`), `routes/index.ts` (убрать системные маршруты), `main.ts`, `connect-sources.ts` (loadEnvFile наружу), `openapi.ts` (параметр `X-Tenant`); поведение не меняется, все тесты зелёные как есть | 1 |
| 2 | `feat(shared): a TypeScript migration runner for PostgreSQL; provisioned stores record schema_migrations` | `shared/migrate-postgres.ts`, `scripts/migrate-clickhouse.ts` → функция `migrateClickHouse` + `shared/clickhouse-sql.ts` `renameDatabases`, `shared/provision-stores.ts`, `private-stores.ts` как обёртка, `tests/{migrations,private-stores}.test.ts` | 1 |
| 3 | `feat(tenants): the control database, provisioning and the migration loop` | `migrations/control/0001_tenants.sql`, `tenants/{control,provision,connect}.ts`, `scripts/{migrate-tenants,register-tenant}.ts`, `tests/helpers/control.ts`, `tests/tenants.test.ts`, `.env.example` | 1,5 |
| 4 | `feat(api): /tenants for the system administrator` | `routes/tenants.ts`, `operations.ts` (6 операций, `access`), `requireSystemKey`, `operatorTrace(record)`, контракт-тест, `api-responses.ts` `tenantSchema`, `frontend/api/coverage.ts` | 1 |
| 5 | `feat(scripts): every script opens its tenant with --tenant / ERP_TENANT` | 23 скрипта через `connectTenant`, `scripts/mvp/lib.ts`, рецепты в `docs/agents/04_recipes.md` | 0,5 |
| 6 | `feat(frontend): the tenant field in the shell; the label switch inside the tenant` | `lib/tenant.ts`, `client.ts`, `AppShell.tsx`, `TenantField.tsx`, i18n, `smoke.spec.ts` | 0,5 |
| 7 | `feat(api): expected values on the three money-relevant PATCHes` | `splits.ts`, `payouts.ts`, `ads-api.ts`, `api-schemas.ts`, `tests/concurrency.test.ts`, фронт P15/P20/P19 | 0,5 |
| 8 | `docs: D-173` | 97, индекс 03, `CLAUDE.md` (команды, «Things that will bite you»: один клиент ClickHouse, пул на арендатора, `erp_tenant_` имена), `facade/CLAUDE.md` (один абзац: фасад = арендатор), `01_big_picture.md`, `04_recipes.md` (регистрация арендатора «один», миграции), `frontend/CLAUDE.md` | 0,5 |

Итого ≈ 6,5 дня. Регистрация арендатора «один» на реальных данных (п. 5) входит в коммит 3 как прогон, не как код.

Что меняется в брифе:

- **D-169, D-170, D-171 — ничего в поведении.** Фасад один на арендатора, книги по счёту файла внутри него. Две
  технические правки: скрипты D-169 (`assign-label-books.ts`, `check-label-books.ts`) и импорты D-170/D-171 пишутся через
  `connectTenant`; `labels.label_accounts` локальна арендатору (один счёт Believe в двух арендаторах допустим — отчёты не
  пересекаются по условию овнера; если овнер хочет запрет, это проверка в `provision`/`POST /labels/:id/accounts` по
  control-таблице `control.accounts`, отдельное решение ⚠).
- **D-172 сливается с контрольной базой**: `0018_auth.sql` становится `migrations/control/0002_users.sql`
  (`control.users`, `control.memberships (user_id, slug, role)`, `control.user_labels (user_id, slug, label_id)`);
  `audit.actions.user_id` в базе арендатора хранит id пользователя из control (без FK, D-121); `authenticate` стоит
  **перед** `resolveTenant` и подставляет slug из членства, `X-Tenant` принимается только от `system_admin`; роль
  `system_admin` глобальна (нет членства), `label_admin`/`label_manager` — членство в одном арендаторе; «Все» =
  все книги своего арендатора; `scripts/create-user.ts` пишет в control. `AUTH_MODE=off` остаётся = сегодняшний
  `X-Operator` + `X-Tenant`. Оценка D-172 не растёт: таблицы те же, база другая.
- `бриф_для_агента.md` §D-172 и `README.md` §4 п. 10 («Все» только администратору системы) уточнить: «системный
  администратор видит все арендаторы списком без денег; «Все» внутри арендатора — его администратор».

Что нужно от овнера: (а) slug и имя арендатора «один»; (б) можно ли один счёт Believe в двух арендаторах (по умолчанию
да); (в) нужен ли переиспользуемый slug после удаления (по умолчанию нет); (г) объём системного администратора до
D-172 — достаточно ли `SYSTEM_ADMIN_KEY` в `.env` на одном стенде.

## 10. Чего не делать

- Не добавлять `tenant_id` ни в одну таблицу и ни в `believe.rows`; не менять ключ проекции `units_by_label`.
- Не делать `createPrivateStores` production-путём, пока он не пишет `schema_migrations` (поправка 1).
- Не класть контрольную схему в `erp`: удаление/бэкап арендатора «один» задевал бы control plane.
- Не кодировать арендатора в путях API или SPA (`/t/:slug/`), не в поддомене: это контракт навсегда ради режима, который
  D-172 отменяет.
- Не резолвить фасад на запрос внутри `routes/*.ts` и не делать арендатора «ambient» через `AsyncLocalStorage`:
  фасад это значение, которое получает роутер; так его получают тесты, e2e и скрипты.
- Не один общий пул PostgreSQL с `SET search_path` / переключением базы (невозможно в PG) и не создание пула на запрос.
- Не глобальные очереди загрузок, не общий advisory-ключ «на всех»: сериализация внутри арендатора уже есть бесплатно.
- Не переименовывать `erp`/`believe` и не переносить `data/files`: `stored_path` абсолютный, арендатор «один» указывает
  на сегодняшний корень.
- Не колонки `updated_at`/`version` ради оптимистичного контроля: ожидаемое значение в теле на трёх PATCH достаточно.
- Не переносить владельцев и псевдонимы между арендаторами, не слиять их через границу; не делать «общий каталог ISRC».
- Не мигрировать арендатора «на лету» при первом запросе; не запускать runner'ы параллельно.
- Не начинать `auth` D-172 до контрольной базы (коммит 3): иначе `users` окажутся в базе арендатора и переедут.
- Не PgBouncer, не кэши, не деплой: вне scope, пока арендаторов меньше ~30 одновременно активных.
