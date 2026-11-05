# QA: арендатор как граница изоляции (вариант B) — инварианты, тесты, инфраструктура, риски

Дата: 2026-11-05, вечер. Ответ на `вопрос.md` в предположении **B** (пара баз на арендатора + контрольная база;
сервер отображает арендатор → фасад на запрос). Код не менялся. Предыдущий отчёт (`../роли/qa.md`) не повторяется:
его §1–§5 (инварианты книг, миграция реальных данных, риски D-169…D-172, e2e онбординга) остаются в силе внутри
арендатора; здесь только то, что добавляет граница между арендаторами и параллельная работа двух администраторов.

Прочитано: `src/shared/{private-stores,pg-db,timing,postgres,clickhouse}.ts`, `src/connect-sources.ts`, `src/main.ts`,
`src/api/{app,audit,http,upload,openapi}.ts`, `src/modules/sources/{loader,registry}.ts`, `migrations/postgres/0001`,
`src/modules/owners/service.ts` (`approveDocument`), `src/modules/splits/service.ts` (`changeSplit`),
`src/facade/{payouts,payment-service,index}.ts`, `scripts/{migrate-postgres.sh,migrate-clickhouse.ts}`,
`tests/{api-contract,sources-loader,connect-sources,scope}.test.ts`, `tests/helpers/*`, `tests/setup.ts`,
`scripts/e2e/{seed,lib,drop,keys}.ts`, `packages/frontend/{CLAUDE.md,playwright.config.ts,e2e/helpers.ts,
e2e/teardown.ts,scripts/e2e/start.sh}`, `docs/agents/19_golden_screens.md` §6, `../роли/владелец_лейбла.md` §4–§5.

Измерено на живом стеке (Docker, 14 миграций PostgreSQL + 3 ClickHouse): `createPrivateStores` **254–280 мс** на пару,
`resetModules` 21 мс, `drop` 27–128 мс; **две пары параллельно (`Promise.all`) — 267 мс**, то есть второй арендатор в
тестовом файле стоит ~0 при параллельном создании и ~0,27 с при последовательном. В PostgreSQL сейчас лежат пять
осиротевших `erp_t_*` (сироты от прерванных прогонов, `tests/CLAUDE.md` это предупреждает) — важно для §3 и §4.

## 0. Три находки, которые меняют план B до любого теста

1. **`createPrivateStores` не ведёт журнал миграций.** Она исполняет файлы `migrations/postgres/*.sql` напрямую
   (`pg.pool.query(migration)`), таблица `schema_migrations` не создаётся, строки не пишутся; ClickHouse — тоже
   (переименованные файлы через `ch.command`). Для тестов это неважно (база живёт минуты), но как **production-путь
   регистрации арендатора** это ломает `migrate-all`: первый же прогон `migrate-postgres.sh` на такой базе увидит
   0 применённых и попробует применить все 14; `0010_participations_overlap_key.sql` без `IF NOT EXISTS` упадёт.
   Регистрация арендатора должна идти через тот же runner (или писать ledger сама с теми же checksum). Тест Ж1 ниже
   ловит это первым.
2. **500 отдаёт `err.message` как есть** (`src/api/http.ts:27`): текст ошибки драйвера содержит имя базы
   (`database "erp_<t>" does not exist`, `relation "owners.owners"…`, `Code: 81. DB::Exception: Database believe_<t>
   doesn't exist`). При карте арендаторов это утечка имён чужих баз в тело ответа. Пин — И7.
3. **Очередь загрузок живёт в процессе** (`loader.ts:53` «One load at a time per process», то же в
   `publishing/service.ts:54`). Два процесса одного арендатора разделяются уникальными индексами реестра
   (`source_files_scope` по `(source, account, reporting_month) WHERE status IN ('loading','loaded')`, `source_files_sha`).
   Это уже правильно для B, но нигде не проверено двумя процессами: все тесты гоняют одну очередь. Тест П1 ниже.

## 1. Инварианты изоляции и чем прибить каждый

Обозначения: `A`, `B` — два арендатора в одном тесте (§4: `twoTenants()`), `idB` — любой id, созданный в B.
Все инварианты формулируются одной фразой: **под A не существует ничего из B — ни чтением, ни записью, ни именем.**

| # | Инвариант | Тест (файл `tests/tenancy/isolation.test.ts`, если не сказано иное) |
|---|---|---|
| И1 | `GET` любой операции с `:id` = `idB` под A → 404 (`*_not_found`), тело без данных B | `ids-of-B-under-A.every-id-param-is-404`: цикл по `API_OPERATIONS` с параметром `:id`; для каждой пары (операция, вид сущности B: owner, artist, track, document, split, participation, label, rule, operation, ad, file) вызов под A; ожидание `status ∈ {404}`; тело не содержит ни одной строки из `JSON.stringify(entityB)` (имя, псевдоним, суммы) |
| И2 | id B в **теле** записи под A → 404, запись не создана: `ownerId`, `artistId`, `artistIds[]`, `documentId`, `labelId`, `fromId`/`intoId` (merge), `sellerArtistId`/`recipientArtistId` (buyout), `paymentProofId` | `ids-of-B-in-body.every-id-field-is-404`: по `BODY_ID_FIELDS` из `src/api/audit.ts` (это уже список полей-ссылок) × операции, чей `body`-схема их содержит; после каждого — `GET /audit` A не вырос (запись не прошла, аудит пишется только после 2xx) |
| И3 | id B в **query**: `?label=idB` → 404 `label_not_found` на каждом `label`-читающем GET; `ids=idA,idB` в `/owners/payables` и `/artists/balances` → ответ только по `idA` (или 404 — см. §7 В3), никогда строка B | `ids-of-B-in-query`: `GET /overview?label=`, `/owners/:id/balance?label=`, `/settlements/operations?label=`, `/signals?label=`; `payables?ids=`, `balances?ids=` |
| И4 | Один и тот же файл (одинаковый sha256, тот же `reportId_account_month`) грузится в A **и** в B, оба `loaded`; `duplicate_file` / `duplicate_period` — только внутри арендатора | `uploads.same-file-in-two-tenants-both-loaded`; затем `GET /sources/files` под A — ровно один файл, его `id` ≠ файла B; `GET /sources/files/:id/lines` с id файла B под A → 404 |
| И5 | Счёт Believe (`account`) регистрируется в A и в B независимо; `P1` A после загрузок B не меняется байт в байт | `overview.unchanged-by-the-other-tenant`: снимок `GET /overview` A до и после трёх записей B (файл, владелец, выплата) — `toEqual` |
| И6 | Поиск, дубликаты, каталог: `GET /search?q=<имя B>` под A пуст; `GET /artists/duplicates` под A не видит псевдоним-двойник из B; одинаковый псевдоним в A и B создаётся без 409 | `search-and-duplicates.blind-to-B` |
| И7 | Ответ любой ошибки под A (400/404/409/500) не содержит имён баз (`erp_`, `believe_`, `_stage`), ни имени арендатора B; 500 от сломанной базы B (роняем пул B) под A не возникает вовсе | `errors.no-foreign-database-names`: регулярка по `JSON.stringify(res.body)` для каждого отказа из И1–И3 плюс один искусственный 500 (`facade` A с подменённым `db.query`, бросающим ошибку с текстом `database "erp_b"`), ожидание: `message` = «Internal error», имя в логе, не в теле. Это требует правки `http.ts` (сообщение 500 — константа) |
| И8 | `LOG_TIMINGS=1` печатает дерево без имён баз и арендаторов | `timings.no-tenant-names`: перехват `console.log` (как `connect-sources.test.ts` перехватывает `ch.command`), вызов `GET /owners/:id/balance` под A при `LOG_TIMINGS=1`, ни `erp_`, ни `believe_`, ни slug арендатора в выводе. Сейчас `timing.ts` печатает только `label` и `info` (счётчики строк) — инвариант держится; карта арендаторов не должна добавить `info: tenant=…` |
| И9 | Документ OpenAPI не зависит от арендатора и не называет его | `openapi.tenant-free` (в `api-contract.test.ts`): `buildOpenApiDocument()` под A `toEqual` под B; строка документа не содержит `erp_`, `believe_`, `tenant` (кроме, если решат, одного заголовка/`securitySchemes`, тогда whitelist) |
| И10 | Аудит A не содержит строк B: после N записей в B `GET /audit` A по длине равен прежнему; `listByEntity(idB)` под A пуст | `audit.separate-ledgers` + `expectOneAuditRow` контракт-теста остаётся однотенантным (§4) |
| И11 | Файловое хранилище раздельно: после загрузки Believe и B17 в A каталог B (`<dataDir>/tenants/<B>/files/{sources,publishing}`) пуст, временный `tmp` A не содержит файлов B; удаление B не трогает файлы A | `files.per-tenant-directories`: `readdirSync` обоих деревьев до/после; `storageDir` фасада B ≠ A (`expect(pathB).not.toContain(pathA)`) |
| И12 | Платёжная заглушка на арендатора: `createPayout` в A вызывает `paymentService` A, не B; `externalRef` двух арендаторов не совпадают | `payment-stub.per-tenant`: `newFacade`-аналог с `paymentService: spy` на каждого; `openFacade` уже принимает `paymentService` в конфиге, так что фабрика «арендатор → сервис» — точка подмены |
| И13 | Все SQL ClickHouse арендатора квалифицированы его базой; ни одного неквалифицированного имени таблицы (иначе уйдёт в `database` клиента, общего на всех) | расширить `connect-sources.test.ts` «the columnar queries name the databases it was given»: записывающий клиент, прогон **всех** методов `columnar` (не только `createStage`), регулярка `(FROM|JOIN|INSERT INTO|ATTACH|DROP TABLE|TRUNCATE)\s+(?!believe_x[._]|system\.)[a-z_]+` → пусто |
| И14 | Заголовок/поддомен арендатора нельзя подделать: с удостоверением A и `X-Tenant: B` (или `Host: b.…`) ответ — данные A или 400, никогда B | `tenant-resolution.spoofed-header-is-ignored` (до D-172 — что «удостоверение» значит, см. §7 В1) |
| И15 | Неизвестный арендатор → 404 `tenant_not_found` **до** любого открытия базы (счётчик `pg_stat_activity` по несуществующему имени не растёт, `CREATE DATABASE` не вызывается) | `tenant-resolution.unknown-tenant-opens-nothing` |
| И16 | Advisory lock и очереди — внутри арендатора: долгая запись A (транзакция с `pg_sleep(2)` под локом) не задерживает запись B | `locks.per-tenant`: `Promise.all([slowWriteA, writeB])`, `writeB` завершается < 500 мс |

Генерация И1–И3 по `API_OPERATIONS` важнее ручного перечня: новая операция с `:id` попадёт в тест сама, как сейчас
попадает в `api-contract` (D-119). Для этого в `operations.ts` нужна подсказка «вид сущности у параметра» (или
эвристика по пути: `/owners/:id` → owner, `/documents/:id/…` → document) — иначе тест не знает, какой `idB` подставить.

## 2. Параллельная работа двух администраторов одного арендатора

Как писать (все на приватной паре одного файла, `tests/tenancy/concurrency.test.ts`):

- **Один процесс**: `Promise.all([f.x(), f.y()])` без внутренних `await` (правило `tests/CLAUDE.md`). Проверяет
  advisory lock и очереди в процессе.
- **Два процесса** (два сервера на одной паре, как будет при двух инстансах или при перезапуске): второй фасад на том же
  имени базы, но **со своим пулом и своим `createDb`** — не `openFacade` второй раз на `stack.db` (он разделит
  `AsyncLocalStorage` и пул, это тот же процесс). Хелпер `secondProcess(stack)` в `tests/helpers/`: `createPostgres({...,
  database: stack.names.pg})`, `createDb(pool)`, свой `createSourcesService` на том же `storageDir`, `openFacade`.
  Закрывать в `afterAll`. Цена — один пул (4 соединения).

| # | Случай | Тест | Ожидание (что прибить) |
|---|---|---|---|
| П1 | Две загрузки одного счёта и месяца (разные байты) | `uploads.same-period-two-processes`: `Promise.all([f1.uploadBelieve(file1), f2.uploadBelieve(file2)])` через два фасада | ровно одно `rejects` с `code: 'duplicate_period'` (409), ровно один `loaded` в `source_files`, ни одной `loading`, стадийных таблиц 0, `fileRows` победителя = его строкам; **в одном процессе** то же через очередь (второй ждёт и получает 409 от реестра, не от очереди) |
| П1' | Те же байты дважды одновременно | `uploads.same-bytes-two-processes` | один `loaded`, второй `duplicate_file` (индекс `source_files_sha`) |
| П2 | Две выплаты одному владельцу | `payouts.two-at-once-one-wins`: `Promise.all([f1.createPayout(o, {labelId}), f2.createPayout(o, {labelId})])` | одна операция `out` без proof, вторая `payout_blocked` с `operationIds: [первая]` (вторая транзакция ждёт лок, перечитывает баланс и видит неподтверждённую выплату — `payouts.ts:131`); сумма первой = payable до; `GET /audit` — одна строка выплаты. Вариант «два разных лейбла одного владельца» → **обе** проходят (книги разные, D-168) — отдельный `it`, он задаёт ожидание, а не выводит |
| П3 | Две правки одной записи | нет `PATCH /splits`; сплит меняется `POST /splits/change` (история: старый получает `valid_to = from`, новый вставляется). Тест `splits.two-changes-same-day`: два `changeSplit(isrc, from, shares1/2)` одновременно | «последняя побеждает» по построению: три строки (исходная, пустой период `[from, from)`, победитель), две строки аудита, `splitAt(isrc, from)` = победитель. Это ровно open point 19 §8.1 (`split_unchanged`): если продукт выберет отказ — тест меняет ожидание на один 409. Для существующих `PATCH` (`/tracks/:id` note, `/ads/:id`, `/settlements/operations/:id` labelId): `patch.last-write-wins-two-audit-rows` — обе 200, поле = второе по времени коммита, 2 строки аудита. Оптимистичный контроль (`updatedAt` в теле → 409) требует колонки `updated_at` во всех модулях (сейчас только у `source_files`) — миграция + ответ-схемы; тест `patch.stale-updatedAt-409` пишется `it.todo` до решения §7 В5 |
| П4 | Два утверждения одного документа | `documents.approve-twice-idempotent`: `Promise.all([f1.approveDocument(d,'x'), f2.approveDocument(d,'y')])` | обе 200 (`approveDocument` идемпотентна: `if (d.approvedAt) return d`), `approvedBy` = тот, кто первым взял лок, обе ответа `toEqual`, в аудите две строки `POST /documents/:id/approve`. Если продукт хочет 409 второму — меняем ожидание (В5) |
| П5 | Один грузит, другой читает баланс | `snapshot.reader-sees-before-or-after`: 20 повторов `Promise.all([f1.uploadBelieve(file_i), f2.ownerBalance(o)])`, где файл даёт известный прирост `earned` | каждый ответ ∈ {до, после}; никогда промежуточное. Основание: `calculate()` берёт `loaded` файлы из реестра **в снимке**, ClickHouse читается с `file_id IN (...)`, партиция присоединяется до `markLoaded` — читатель до коммита не видит `file_id`, после — весь файл. Проверять и `A = B + C + ours` на каждом ответе |
| П6 | Два создания одного владельца (дубликат) | `owners.create-same-name-twice` | ровно одно 201, второе 409 с `duplicate` details (проверка «check-then-insert» под локом, D-121) |
| П7 | Загрузка и удаление арендатора одновременно (сисадмин) | `tenant.delete-during-upload` (в `lifecycle.test.ts`) | либо удаление ждёт (lock), либо загрузка падает `failed`, но **никогда** `loaded` в базе, которой нет; ответ загрузки — 409/503, не 500 с именем базы (И7) |

## 3. Жизненный цикл арендатора (`tests/tenancy/lifecycle.test.ts`, `scripts/tenants/*`)

Предпосылка: регистрация = `createTenant(slug)` в контрольной базе (`erp_control`, приватная копия на тест:
`createPrivateStores` расширяется флагом `control: true` или отдельная `createPrivateControl(name)`), и тот же код,
что будет в production. Тесты:

| # | Тест | Ожидание |
|---|---|---|
| Ж1 | `create.two-databases-fully-migrated` | после `createTenant('t1')`: `pg_database` содержит `erp_t1`; `system.databases` — `believe_t1`, `believe_t1_stage`; **`erp_t1.schema_migrations` = список файлов `migrations/postgres` с их sha256** (как считает `migrate-postgres.sh`: `tr -d '\r' \| sha256sum`); `believe_t1.schema_migrations` = список `migrations/clickhouse`; `migrate-postgres.sh --status` на ней печатает только `applied`. Этот тест красный на сегодняшней `createPrivateStores` (§0.1) — и должен быть первым |
| Ж2 | `create.control-row-and-idempotence` | строка арендатора в `control.tenants` (slug, имена баз, `created_at`); повторный `createTenant('t1')` → 409 `tenant_exists`, баз не стало больше (сравнить `pg_database` до/после) |
| Ж3 | `create.failure-leaves-nothing` | инъекция: ClickHouse недоступен (клиент с `command: () => reject`) → `createTenant` падает, `erp_t1` **удалена**, строки в control нет (или `status: 'failed'` — В6); повторный вызов проходит |
| Ж4 | `migrate-all.failure-on-second-of-three` | три арендатора `t1,t2,t3` на старой схеме (временный `MIGRATIONS_DIR` без последнего файла), затем полный каталог плюс файл `0015_probe.sql` с телом `DO $$ BEGIN IF current_database() = 'erp_t2' THEN RAISE EXCEPTION 'injected'; END IF; END $$;` — падает только на t2 без моков. Ожидание по выбранной политике (В7): **stop** — t1 применён, t2 откачен (psql `-1`: ни DDL, ни строки ledger), t3 нетронут, код выхода ≠ 0, в выводе имя t2; **continue** — t1 и t3 применены, t2 нет, код ≠ 0. Затем правим пробу и повторный прогон: все три `up to date`, ledger одинаков у всех трёх (`SELECT version, checksum` `toEqual`) |
| Ж5 | `migrate-all.serial-not-parallel` | runner PostgreSQL «не параллелится» (комментарий в `.sh`): цикл по арендаторам последовательный; тест — спай на порядок вызовов и отсутствие пересечений по времени; для ClickHouse — то же (`migrate-clickhouse.ts` экспортирует функции, их можно вызвать с `database` на каждого) |
| Ж6 | `migrate-all.skips-deleted-and-unknown` | арендатор с `deleted_at` не мигрируется; база `erp_x`, которой нет в control (сирота вроде сегодняшних `erp_t_*`), не трогается и попадает в отчёт «orphans» |
| Ж7 | `delete.databases-files-and-row` | после загрузки файла и B17 в t1: `deleteTenant('t1')` → пула t1 в карте нет (`pg_stat_activity` по `erp_t1` = 0 **до** `DROP … WITH (FORCE)` — иначе пул переподключится и упадёт с 500), `pg_database` без `erp_t1`, `system.databases` без обеих, каталог `tenants/t1` удалён, `control.tenants.deleted_at` проставлен (строка остаётся); запрос под t1 → 404 `tenant_not_found`, не 500 |
| Ж8 | `delete.does-not-touch-neighbour` | t2 после удаления t1: `GET /overview` t2 `toEqual` снимку, файлы t2 на месте, ClickHouse-представления t2 отвечают |
| Ж9 | `restore-from-backup` (`it.todo` до В8) | `pg_dump erp_t1` + `BACKUP DATABASE believe_t1` → новый slug → `GET /overview` равен; доказывает «бэкап арендатора = базы» из плюсов B |
| Ж10 | `gc.orphan-databases-report` | скрипт `scripts/tenants/gc.ts --dry-run` печатает `erp_*`/`believe_*` без строки в control и не удаляет; `--apply` удаляет только те, что старше N часов и совпадают с маской `erp_t_[0-9a-f]{10}` (тестовые) |

Лимит соединений: пул по умолчанию `max: 10` (`postgres.ts`), `createPrivateStores` — 4 + admin 1. При `max_connections`
= 100 (умолчание образа) горячих арендаторов ≈ 9 с пулом 10 или ≈ 20 с пулом 4. Тест `pools.idle-tenant-closed`:
карта с `idleMs: 200`, запрос под t1, через 400 мс `SELECT count(*) FROM pg_stat_activity WHERE datname='erp_t1'` = 0;
`pools.hot-limit`: при `maxOpen: 2` третий арендатор вытесняет самого давнего, не падает. Без этих двух тестов B
нельзя назвать безопасным по соединениям.

## 4. Тестовая инфраструктура

**Два арендатора в тесте дёшево.** `tests/helpers/tenants.ts`:
`twoTenants()` = `Promise.all([createPrivateStores('t_<id>a'), createPrivateStores('t_<id>b')])` (измерено 267 мс
вместе, как одна) + приватная control-база (третья `CREATE DATABASE`, ~50 мс, одна таблица) + `tenantMap` с двумя
фасадами + один `createApp(map)`. Регистрация в `tests/setup.ts` через тот же `closeTestSources`-паттерн (ленивая
`stackPromise`, `drop` в `afterAll`). `newFacade()` **не меняется** — однотенантные тесты не знают об арендаторах.
Файлов с двумя арендаторами нужно 3–4 (`tenancy/isolation`, `concurrency`, `lifecycle`, `api-tenancy`), прирост
времени прогона < 2 с на 406 тестов.

**Контракт-тест остаётся однотенантным** (`api-contract.test.ts` в режиме «один арендатор по умолчанию»; `call()` и
`expectOneAuditRow` без изменений) **плюс один перекрёстный сценарий** в новом `tests/tenancy/api-tenancy.test.ts`:
`every-operation-with-an-id-refuses-B-under-A` — тот же обход `API_OPERATIONS`, что в И1, через `writer(app)`. Два
файла, потому что контракт-тест требует «каждая операция вызвана один раз» (`covered`), а перекрёстный — «каждая
операция с id отказала»; смешивать счётчики нельзя.

**E2E.** Рекомендую **одну дополнительную пару `erp_e2e_b` / `believe_e2e_b`**, а не двух арендаторов внутри одного
сида:
- сид B минимален: только S00 (общие лейблы) и один сценарий S40 «чужие данные» (владелец, псевдоним-двойник по имени
  с S23, файл того же счёта и месяца, что S34, выплата) — ~1 с;
- `seed.ts` получает `--tenant b` (имя пары из аргумента уже есть: `seed.ts <name>`), ключи B пишутся в
  `.seed-keys.json` как `tenants.b` (тип `SeedKeys` расширяется, старые поля не двигаются);
- `start.sh` поднимает **один** сервер с control-базой `erp_control_e2e` и двумя арендаторами (до D-172 — выбор
  арендатора заголовком/поддоменом; Playwright: второй `browser.newContext({ extraHTTPHeaders })` или `baseURL`
  `http://b.localhost:3100`; после D-172 — `loginAs(tenant, role)`);
- один новый спек `36-tenants.spec.ts` (после 35, читает только своё): под A — P9 поиск имени B пуст, P11 двойник без
  «дубликата», URL `/owners/<idB>` → `page-state-error` 404, P19 один файл, P1 без строки счёта B; под B — всё
  наоборот; `/api/v1/docs` одинаков. Остальные 149 тестов не трогаются (они под A = сегодняшний `erp_e2e`);
- `drop.ts e2e` и `teardown.ts` дропают обе пары и control; `verify-seed.ts` проверяет B отдельно;
- **правило lock-файла** не меняется: `mkdir data/test-tmp/e2e.lock` покрывает все три базы, потому что их имена
  фиксированы; в `packages/frontend/CLAUDE.md` дописать, что лок защищает и `_b`, и `erp_control_e2e`. «Приватный
  стенд» (`seed.ts mine`) получает `seed.ts mine --tenant b` → `erp_mine_b`.
Альтернатива «два арендатора в одном сиде, вход на каждого» дешевле на базу, но ломает инвариант сида «один фасад,
один `dataDir`» (`Seed` держит один `f`) и смешивает ключи — отвергаю.

## 5. Риски регрессии B для 406 + 65 тестов и 149 e2e

Ожидание «фасад не меняется, только `main.ts`/`app.ts`» в основном верно; что всё же заденет:

| Что | Где | Риск / что сделать |
|---|---|---|
| `createApp(facade, {tmpDir})` → `createApp(tenants, …)` | 8 вызовов в 6 тестовых файлах (`api-contract`, `api`, `audit`, `review-*`, `ads`…) | дать **совместимую перегрузку**: `createApp(facade, opts)` = карта из одного арендатора «default» без control-базы (режим `single`); тогда тесты и `start.sh` с `DB_DATABASE=erp_e2e` работают как есть |
| `operatorTrace(facade)` берёт фасад при монтировании | `src/api/audit.ts:96` | станет `operatorTrace(() => res.locals.facade)`; тест `audit.test.ts` «one row per write» — проверить, что строка ушла в аудит **того** арендатора |
| `sourcesRouter(facade, {tmpDir})` — `tmpDir` общий | `routes/sources.ts:8`, `upload.ts` | временные файлы с случайными именами — делить можно, но `deleteTenant` не должен чистить общий `tmp`; лучше `tmp` на арендатора |
| `openFacade({ dataDir })` → `files/publishing` | `facade/index.ts:39` | `dataDir` на арендатора: `tenants/<slug>/`; `seed.ts` и `main.ts` считают `dataDir` корнем — поменять в одном месте (`tenantPaths(root, slug)`) |
| `tests/connect-sources.test.ts` мутирует `process.env.CLICKHOUSE_DATABASE` | строки 21–31 | если карта арендаторов читает env один раз при импорте, тест станет порядкозависимым; карта должна брать конфиг аргументом |
| 20 скриптов читают `DB_DATABASE`/`CLICKHOUSE_DATABASE` (`check-label-books`, `check-owner-scope`, `mvp/load`, `reconcile-erp`, `import-legacy`, `assign-operation-labels`, `load-believe`, `restore-publishing-terms`, `add-writer-aliases`, `mvp/*.py` …) | `scripts/` | они продолжают работать «на одну пару = один арендатор»; добавить `--tenant <slug>` → имена из control (или оставить env и задокументировать в рецепте 9); `check-owner-scope.ts`/`check-label-books.ts` на реальных данных — прогнать на арендаторе «0to8» после регистрации (данные не копируются — числа должны совпасть байт в байт; это и есть приёмочный тест миграции на B) |
| `boundaries.test.ts` (импорты по слоям) | новый `src/tenancy/` | внести в правила границ: `tenancy` импортирует `connect-sources`, `facade`, `shared`; `facade` и `modules` **не** импортируют `tenancy` |
| `rules-coverage.test.ts` (`Number(` allow-list) | `main.ts` уже в списке | карта с `idleMs`, `maxOpen` из env — добавить файл в allow-list или парсить через zod |
| `api-contract` «каждая операция в `operations.ts`» | новые `/tenants*` (сисадмин) | либо в `operations.ts` с тегом `control` и вызовом в сценарии, либо отдельный роутер `/api/control/v1` с собственным контрактом; `coverage.ts` фронта потребует страницу или отказ для каждой |
| e2e `openAs` кладёт только оператора | `e2e/helpers.ts:65` | до D-172 — заголовок арендатора в `page.route`/контексте; после — логин; `states.spec.ts` мокает API — моки под арендатора |
| `privacy.test.ts` (grep `src/`, `e2e/`) | slug арендаторов | slug реальных арендаторов (имя компании) — не в коде и не в фикстурах; в тестах `t_<hex>` |
| `DROP DATABASE … WITH (FORCE)` в `drop.ts` | `scripts/e2e/drop.ts` | при одном сервере на две пары `drop.ts e2e` рвёт соединения живого процесса — порядок: остановить сервер, потом дроп (уже так в `teardown`) |
| `schema_migrations` отсутствует у приватных баз | `private-stores.ts` | §0.1: тест `clickhouse-migrate.test.ts` сегодня проверяет runner на своей базе; для PostgreSQL runner — bash, тестов нет; Ж1 закрывает |

Что **не** ломается: `newFacade`, `tmpDir`/`TMP` тестов (на файл, не на арендатора), все `layers/*`, `golden`,
`scope`, фронтовые guard-тесты (65), 22 golden-спека (они под арендатором по умолчанию).

## 6. Smoke-чеклист изоляции для владельца лейбла (руками, по его §4–§5)

Предусловие: сисадмин зарегистрировал второго арендатора «Проба» (пустой), у владельца доступ к обоим.

1. Под «Проба» загрузить **тот же** Believe-файл 1052428 за любой месяц, что уже загружен в 0to8 → `loaded`
   (не `duplicate_file`). Под 0to8: P19 — число файлов не изменилось, P1 — строка месяца не изменилась ни в одной
   колонке (его §5 п.1 «не оставил следа», теперь между арендаторами).
2. Под «Проба» создать владельца и псевдоним с именем, которое есть в 0to8 → нет предупреждения о дубликате; под
   0to8 P11/«Дубликаты» двойника нет, P9 поиск по имени даёт только своего.
3. Скопировать из адресной строки «Пробы» URL владельца (`/owners/<id>`) и открыть под 0to8 → страница «не найдено»,
   не карточка и не пустая карточка; то же для `/artists/<id>`, `/documents/<id>`, `/sources/files/<id>`.
4. Под «Проба» выплата новому владельцу (договор, сплит, файл) → под 0to8 у любого владельца кнопка выплаты не
   стала «заблокирована чужой выплатой»; P21 и P2 0to8 без новых строк.
5. Журнал (`/audit`, P10 история) под 0to8 после всех действий в «Пробе»: последняя строка — его собственная, строк
   с оператором, работавшим в «Пробе», нет.
6. Переключатель лейбла под 0to8 не предлагает лейблы «Пробы»; `?label=<id лейбла Пробы>` в URL → «не найдено».
7. `/api/v1/docs` открыт под обоими — один и тот же документ; в нём нет названия ни одного арендатора.
8. Два администратора 0to8 одновременно (две вкладки, два оператора): оба грузят файл одного счёта и месяца → у
   одного `loaded`, у другого отказ «уже загружен за этот период»; оба нажимают выплату одному владельцу → одна
   операция, у второго «заблокировано предыдущей выплатой»; P19 показывает один файл, P20 одну выплату.
9. Сисадмин удаляет «Пробу» → под 0to8 всё из п.1 и п.5 без изменений, выгрузка ведомости совпадает с сохранённой
   до п.1 построчно (его §5 п.4–5).
10. Сломать «Пробу» (сисадмин останавливает её базу) → под 0to8 работа продолжается; ни одна ошибка на экране не
    содержит `erp_`/`believe_`.

## 7. Что нельзя проверить без ответов владельца продукта

| # | Вопрос | Почему блокирует тест |
|---|---|---|
| В1 | Как определяется арендатор **до** D-172: заголовок `X-Tenant`, поддомен, или не делаем B до входа пользователей? | И14/И15, `call()` контракт-теста, `openAs` e2e: без этого перекрёстные тесты не могут отправить запрос «под A» |
| В2 | Чужой id под A — 404 (не раскрывать существование) или 403? | И1–И3 ожидают один код; 404 рекомендую (нет утечки «такой id есть») |
| В3 | Списки `ids=` с чужими id: молча отбросить или 400/404 на весь запрос? | И3 для `/owners/payables`, `/artists/balances` |
| В4 | Один файл Believe в двух арендаторах — допустимо (И4) или глобальный sha-реестр в control? | И4 как написан ожидает «допустимо» |
| В5 | Две правки одной записи: «последняя побеждает + 2 строки аудита» (сегодня по построению) или `updatedAt` → 409? Второе утверждение документа: идемпотентно (сегодня) или 409? | П3, П4; `updated_at` нет в модулях — миграция на 7 схем |
| В6 | Неудачная регистрация: удалить всё (Ж3) или оставить строку `failed` для повторного запуска? | Ж3 |
| В7 | `migrate-all` при ошибке на арендаторе: остановиться или продолжить и отчитаться? | Ж4 |
| В8 | Удаление арендатора: жёсткий `DROP` сразу, или мягкое удаление с хранением N дней и бэкапом (Ж9)? Кто вправе? | Ж7, Ж9 |
| В9 | Лимит горячих арендаторов и простоя (`maxOpen`, `idleMs`), размер пула на арендатора | `pools.*` тесты нуждаются в числах; при `max_connections` 100 и пуле 10 — девять |
| В10 | Сисадмин «без денег»: список арендаторов, создание, миграции — и только? Может ли он открыть чужой P1? Видит ли ошибки/логи арендатора? | контракт `/tenants*`, И8 |
| В11 | Перенос владельца между арендаторами (продажа каталога): нет / экспорт-импорт / общий справочник ISRC? | если «нет» — тест отказа; если экспорт — отдельный сценарий с проверкой равенства книг до/после |
| В12 | Платёжный сервис: один на систему (реквизиты в control) или на арендатора? | И12 |
| В13 | Текущие 0to8 + Echo8 = арендатор «default» на базах `erp`/`believe` без переименования — или переименовать базы по slug? | Ж1 на реальных данных (`schema_migrations` там уже есть — runner compose), `check-label-books`/`check-owner-scope` до/после |

Пока В1, В2, В5 открыты, И1–И3, И14 и П3–П4 пишутся с ожиданием по умолчанию (404; «последняя побеждает»;
идемпотентно) и `it.todo` на альтернативу — чтобы выбор был в тесте, а не в памяти сессии. Ж1 не ждёт никого:
её можно написать сегодня, и она красная.
