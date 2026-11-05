# Консилиум «арендатор как граница»: взгляд DevOps / эксплуатации

Дата: 2026-11-05. Роль: инженер эксплуатации. Предмет: вариант **B** (пара баз на арендатора: `erp_<t>` в PostgreSQL,
`believe_<t>` + `believe_<t>_stage` в ClickHouse) против **A** (одна пара баз, колонка `tenant_id`). Код не менялся.
Все числа ниже сняты с живого dev-стенда 2026-11-05 вечером (`docker compose ps`, `psql`, `clickhouse-client`,
`docker stats`).

## Вывод в двух абзацах

B эксплуатационно **лучше A до ~50 арендаторов на одном кластере** и остаётся рабочим до ~100–150, если
соединения открывать лениво и закрывать по простою. Всё, что нужно для B, уже есть в репозитории в виде тестового
пути (`createPrivateStores`), но этот путь **не production**: он не ведёт `schema_migrations`, переименовывает базы
ClickHouse регулярным выражением и работает от суперпользователя. Production-путь это тот же код плюс учёт миграций,
контрольная база, разделение ролей `erp_admin` / `erp_app` и пять команд `tenant:*`.

Где B дороже A: (1) миграции × N и «что делать с арендатором 7 из 20», (2) бюджет соединений PostgreSQL (сегодня
`max_connections = 100`, пул приложения 10), (3) обзор «по всем арендаторам» только циклом. Где B дешевле A:
бэкап, восстановление и удаление арендатора = операции над базой; статистика на арендатора бесплатна
(`pg_stat_database`, `pg_database_size`, `system.parts` по базе); утечка между арендаторами невозможна по
построению, а не по дисциплине в 40 таблицах SQL. Точка переключения **не на A**, а на «кластер на группу
арендаторов» (один compose-стек на ~30–50 арендаторов); A имеет смысл только для self-service с тысячами крошечных
арендаторов, что не наш случай.

## Снимок стенда (факты)

| Что | Значение |
|---|---|
| PostgreSQL 18.6 | `max_connections = 100`, `shared_buffers = 128MB` (дефолт образа), `work_mem = 4MB`, 11 backend-соединений, из них 3 к `erp` |
| Роль `erp` | **superuser**, CREATEDB, CREATEROLE (это пользователь из `POSTGRES_USER`, образ делает его суперпользователем); приложение и тесты ходят под ним |
| Базы PostgreSQL | `erp` 431 MB (14 миграций, 27 таблиц в 8 схемах, 47 файлов в `source_files`), `erp_demo` 31 MB, **78 баз `erp_t_*`** на 709 MB (остатки тестов, 7,5–10 MB каждая) |
| ClickHouse 26.8 | `max_connections = 4096`, `max_concurrent_queries = 1000`, RSS 2,9 GiB, 12 % CPU в покое (фоновые слияния), `max_server_memory_usage_to_ram_ratio = 0.8` |
| Базы ClickHouse | `believe` 1,63 GiB, 75,7 млн строк, 138 активных партов; **230 баз `believe_t_*`** (115 основных + 115 `_stage`), каждая 6–175 KiB |
| Приложение | один пул PostgreSQL `max: 10`, один HTTP-клиент ClickHouse `max_open_connections: 10`; `main.ts <dir>` задаёт только каталог файлов `<dir>/files/sources` и `<dir>/tmp` |
| Миграции | PostgreSQL: bash в образе postgres, `psql -1`, таблица `schema_migrations`, одна база из `PGDATABASE`; ClickHouse: `node` без зависимостей, `<db>.schema_migrations`, одна база из `CLICKHOUSE_DATABASE`. Оба «не для двух процессов сразу» |
| Бэкапы | ручные `pg_dump` в `data/backup/*.dump` (два файла); ClickHouse не бэкапится; скриптов нет |
| Логи | `json-file` 10 MB × 3 на контейнер; `log_min_duration_statement = 500`; `LOG_TIMINGS=1` печатает дерево шагов в stdout без идентификатора запроса, арендатора и оператора |

Расхождение 78 ≠ 115 объясняется порядком в `dropDatabases()`: сначала PostgreSQL, потом ClickHouse; прерванный
тест (Ctrl-C, таймаут vitest, упавший процесс) оставляет хвост в одной из систем.

---

## 1. Создание арендатора (provisioning)

**Кто запускает.** Два входа, одна функция:

- до D-172 (нет пользователей): операторская команда `npm run tenant:create -- <slug> --name "…"`;
- после D-172: `POST /admin/tenants` от роли `system_admin`, та же функция `provisionTenant()` внутри сервера.

Функция это обобщённый `createPrivateStores`, но с тремя отличиями от тестового пути:

1. **Учёт миграций.** `createPrivateStores` выполняет файлы миграций подряд и **не пишет `schema_migrations`** (ни в
   PostgreSQL, ни в ClickHouse). Для теста это неважно, для арендатора фатально: следующий `tenant:migrate` сочтёт все
   14 + 3 миграции непримёнными и прогонит их заново (SQL идемпотентен, но это минуты на `rows` с данными и риск на
   любой будущей data-миграции). Production-путь обязан вызывать **тот же раннер**, что и compose-сервисы, а не
   копировать файлы в `pool.query`. Практически: вынести ядро `migrate-postgres.sh` в TypeScript (`migrate-postgres.ts`
   рядом с `migrate-clickhouse.ts`, те же `listMigrations` / `planMigrations`), а bash оставить тонкой обёрткой или
   убрать; compose-сервис `postgres-migrate` тогда запускает `node scripts/migrate-postgres.ts` из образа `node:24`,
   как `clickhouse-migrate`.
2. **Имена ClickHouse.** Миграции ClickHouse жёстко пишут `believe.` и `believe_stage.`; `createPrivateStores`
   переименовывает регулярным выражением `\bbelieve\b`. Это работает, пока в SQL нет строкового литерала или
   идентификатора со словом `believe` (например, `source = 'believe'`). Надёжнее плейсхолдеры `{db}` / `{stage}` в
   файлах миграций и подстановка в раннере; тесты на `splitStatements` + один тест «миграция после подстановки не
   содержит `believe.`» закрывают риск.
3. **Не суперпользователь.** См. роли ниже.

**Порядок шагов и идемпотентность.** `CREATE DATABASE` не бывает в транзакции, поэтому provisioning это машина
состояний в контрольной базе, а не транзакция:

```
control.tenants.status: provisioning → active | failed
1. INSERT tenants (slug, имена баз, status='provisioning')
2. CREATE DATABASE erp_<slug> OWNER erp_app          (IF NOT EXISTS через проверку pg_database)
3. migrate-postgres на erp_<slug>                     (schema_migrations заполняется)
4. CREATE DATABASE IF NOT EXISTS believe_<slug>, believe_<slug>_stage; migrate-clickhouse
5. mkdir -p data/tenants/<slug>/files/sources, data/tenants/<slug>/tmp
6. UPDATE tenants SET status='active', pg_version=14, ch_version=3
```

Повторный запуск с `status='failed'` продолжает с места ошибки (каждый шаг проверяет «уже есть»). `tenant:drop
--force` чистит незавершённого. Пустая пара баз создаётся за 1–3 с (тесты делают это десятки раз за прогон).

**Имена.** `slug` = `[a-z][a-z0-9_]{1,30}` (ограничение PostgreSQL 63 байта с запасом на `believe_<slug>_stage`).
Имена баз **хранятся в контрольной базе явно**, а не выводятся из префикса: это позволяет зарегистрировать нынешние
`erp` / `believe` без переименования (п. 7) и не зависеть от соглашения.

**Роли PostgreSQL.** Одна прикладная роль на всех арендаторов, не роль на арендатора:

- `erp_admin` (CREATEDB, CREATEROLE, NOSUPERUSER): provisioning, миграции, бэкапы, удаление. Пароль в `.env`
  (`DB_ADMIN_PASSWORD`). Сервер открывает им **одно** соединение и только на время `provisionTenant()`.
- `erp_app` (NOSUPERUSER, NOCREATEDB): владелец всех баз арендаторов (`CREATE DATABASE … OWNER erp_app`), под ним
  пулы запросов. Это сегодняшние `DB_USERNAME` / `DB_PASSWORD`.
- Сегодняшний `erp` остаётся суперпользователем образа; `packages/backend/init/postgres/` уже смонтирован в
  `/docker-entrypoint-initdb.d` и **пуст** — туда кладётся `01_roles.sql` с двумя ролями (выполняется только при
  первой инициализации тома; на существующем томе один раз руками).
- Роль на арендатора не даёт изоляции сверх того, что уже даёт выбор имени базы из контрольной записи, а стоит
  N паролей, их хранения и ротации. Защита «от ошибки в коде» дешевле: `REVOKE CONNECT ON DATABASE erp_<t> FROM
  PUBLIC` и проверка в `tenantPool(slug)` того, что `current_database()` после `connect()` равна ожидаемому имени
  (одна строка, ловит перепутанный конфиг).

**ClickHouse: пользователи и квоты.** Один пользователь `erp` (сегодня `users_xml`, из переменных образа;
`CLICKHOUSE_DEFAULT_ACCESS_MANAGEMENT=1` позволяет SQL-управление). Квоты и профили настроек ClickHouse привязаны к
пользователю, IP или **`quota_key`**, а не к базе. Это решает задачу без N пользователей: клиент передаёт
`X-ClickHouse-Quota-Key: <slug>` (в `@clickhouse/client` это настройка `quota_key` на запрос), а на сервере
`CREATE QUOTA tenant_quota KEYED BY client_key FOR INTERVAL 1 hour MAX queries = …, read_rows = …, execution_time = …
TO erp`. Лимиты памяти на запрос (`max_memory_usage`, сейчас 0 = без лимита при 80 % RAM на сервер) задаются
профилем пользователя один раз. Отдельный пользователь на арендатора нужен только если кому-то снаружи дадут
`clickhouse-client` к своей базе (Play UI сегодня торчит на `0.0.0.0:8123`): тогда `CREATE USER t_<slug>` + `GRANT
SELECT ON believe_<slug>.* TO t_<slug>`, и это разовый оператор, не часть provisioning.

## 2. Миграции

**Из одноразовых сервисов в «мигрировать всех».** Сегодня `postgres-migrate` и `clickhouse-migrate` это one-shot
сервисы compose на одну базу из `.env`. При B:

- оба сервиса остаются и мигрируют **контрольную базу** (`PGDATABASE=erp_control`; у ClickHouse контрольной базы
  нет, сервис можно оставить для `believe` текущего арендатора или убрать);
- появляется `scripts/tenant-migrate.ts` (`npm run tenant:migrate -- [--all | <slug>…] [--status] [--jobs 4]`),
  который читает `control.tenants WHERE status IN ('active','maintenance')` и для каждой пары вызывает оба раннера
  как функции (не как процессы). Источник списка — контрольная база, **не** `pg_database LIKE 'erp_%'`: иначе
  раннер начнёт мигрировать `erp_demo` и 78 хвостов тестов;
- третий one-shot сервис `tenant-migrate` с `depends_on: postgres-migrate: service_completed_successfully`, тот же
  образ `node:24-alpine`, те же volume-монтирования. Сервер приложения в compose (когда появится) ждёт его.

**Один раннер в один момент.** Оба раннера честно пишут «не для двух процессов». Для цикла достаточно
`pg_advisory_lock` в контрольной базе на время всего прогона (`tenant:migrate` и `provisionTenant()` берут один и тот же
ключ: пока идёт миграция всех, новый арендатор не создаётся, и наоборот). Разные арендаторы мигрируются параллельно
без риска: раннеры не делят состояние между базами; `--jobs 4` безопасен, `--jobs 1` по умолчанию.

**Отказ на арендаторе 7 из 20.** Правило: **продолжать остальных, не останавливаться, завершиться ненулевым кодом,
напечатать таблицу** `slug | pg: 14/14 | ch: 3/3 | error`. Обоснование: миграция PostgreSQL транзакционна на файл
(`psql -1` / один `BEGIN` в TS-версии), так что арендатор 7 остаётся на прошлой версии целиком, а не наполовину;
ClickHouse не транзакционен, но все statement'ы идемпотентны по правилу репозитория, и повтор довершает файл.
Остановка на первом отказе оставила бы 13 арендаторов в старой схеме при уже выкаченном коде, что хуже.

Что защищает от «новый код на старой схеме»: при открытии фасада арендатора сервер сравнивает
`max(version)` из `erp_<t>.schema_migrations` и `believe_<t>.schema_migrations` с константой из каталога миграций
(число файлов, вычисляется при старте). Не совпало → арендатор в состоянии `maintenance`, запросы к нему получают
`503 tenant_maintenance`, остальные работают. Это и есть обзор отказа: `GET /admin/tenants` показывает версии.

**Как добавить миграцию безопасно.** Как сейчас: новый файл `NNNN_name.sql`, идемпотентный SQL, никогда не править
применённый (контрольная сумма). Добавляется одно требование: миграция **не знает имени базы** (плейсхолдеры в
ClickHouse; в PostgreSQL имена и так не нужны, схемы `owners.*` одинаковы во всех базах). И одна практика: любая
миграция с `ALTER TABLE believe.rows` (материализация проекции, смена типа) сначала прогоняется на самом большом
арендаторе на копии (`RESTORE … AS believe_rehearsal`), потому что её время пропорционально данным, а не числу
арендаторов.

**Время на 20 арендаторов.** Инкрементальная миграция «один файл DDL» на базу: подключение + `psql` ≈ 100–300 мс в
PostgreSQL, миллисекунды для `CREATE OR REPLACE VIEW` в ClickHouse; 20 арендаторов последовательно — до 10 с,
параллельно — 2–3 с. Полная схема с нуля (provisioning): 1–3 с на пару. Тяжёлые случаи: `ALTER TABLE … MATERIALIZE
PROJECTION` на 75 млн строк — минуты на арендаторе такого размера, и у N арендаторов это N × минут фонового
`mutation` (ClickHouse выполняет их асинхронно и параллельно в пределах `background_pool_size`). Контрольная база
мигрируется первой и отдельно: её схема (`tenants`, `users`, `memberships`) меняется редко.

## 3. Бюджет соединений

**Сегодня.** `max_connections = 100`. Приложение: пул `max: 10` к одной базе. Тесты: на файл `admin` 1 + `pg` 4
соединения, vitest гоняет файлы параллельно → пиково десятки. Остаток ~50 на `psql`, pgAdmin, скрипты.

**При B, арифметика.** Записи сериализованы advisory-lock'ом на базу, так что больше одного писателя на арендатора
в работе никогда нет; чтения (`calculate()` в одном `snapshot`) занимают одно соединение на запрос. Пул на арендатора
`max: 4` достаточен (1 писатель + 3 читателя; при `?label=`-страницах фронт шлёт 3–5 параллельных GET, они встанут в
очередь пула, что приемлемо). Значит:

| Арендаторов активных одновременно | Соединений (×4) | Что нужно |
|---|---|---|
| 5 | 20 | ничего |
| 20 | 80 | `max_connections = 200`, `shared_buffers` ≥ 1 GB (сейчас 128 MB, дефолт) |
| 50 | 200 | `max_connections = 300` **или** PgBouncer |
| 200 | 800 | PgBouncer обязателен или второй кластер |

«Активных» — ключевое слово. Пул `pg.Pool` это объект без соединений, пока к нему не обратились; `idleTimeoutMillis`
(выставить 60 с; сейчас дефолт 10 с) отдаёт простаивающие соединения серверу, `min: 0`. То есть 200 зарегистрированных
арендаторов, из которых 15 работают в этот час, стоят 15 × ≤4 соединений. Карта `tenant → { db, sources, facade }`
закрывается по простою (30 мин без запросов → `pool.end()`, запись из карты вон), чтобы не копить объекты и
`AsyncLocalStorage`-обёртки; ленивое открытие стоит один `connect()` ≈ 5–20 мс на первом запросе.

Каждое backend-соединение PostgreSQL это процесс ~5–10 MB RSS; 200 соединений ≈ 1–2 GB. В Docker-VM на 7,65 GiB, где
ClickHouse уже держит 2,9 GiB, 300 соединений — предел без второго хоста.

**PgBouncer.** Режим `transaction` совместим с кодом: advisory-lock взят как `pg_advisory_xact_lock` (транзакционный,
не сессионный), `BEGIN … REPEATABLE READ READ ONLY` живёт внутри одной транзакции, соединение транзакции закреплено
за `AsyncLocalStorage` до `COMMIT`, сессионных `SET` / `LISTEN` / именованных prepared statements в коде нет (drizzle
через `node-postgres` без `.prepare()`). Нужно проверить одно: `pool.query` вне транзакции (репозитории на `orm()`
вне `transaction/snapshot`) не полагается на `SET search_path`; схемы в коде квалифицированы (`owners.*`), так что
нет. PgBouncer ставится одним сервисом compose перед PostgreSQL, с `databases = *` (один upstream, имя базы
пробрасывается), `default_pool_size = 4`, `max_client_conn = 2000`. Включать не раньше 50 активных арендаторов:
до того это лишний сервис и лишняя точка отказа.

**ClickHouse.** Бюджет **не растёт с N**. Колоннар уже обращается к таблицам по полному имени
(`createBelieveColumnar(ch, { database, stageDatabase })` подставляет `believe_<t>.rows`), значит один HTTP-клиент с
`max_open_connections: 10` обслуживает всех арендаторов, карта на арендатора хранит только пару имён. Серверные
лимиты (4096 соединений, 1000 параллельных запросов) недостижимы. Что растёт с N — это число таблиц и партов на
сервере (п. 8), не соединения.

## 4. Бэкап, восстановление, удаление, каталоги

**PostgreSQL: `pg_dump` на базу.** Так уже делается руками (`data/backup/erp-*.dump`, custom format). Команда
`npm run tenant:backup -- <slug>` = `pg_dump -Fc -d erp_<slug>` в `data/backup/<slug>/<date>/erp.dump` +
контрольная запись (`tenants.last_backup_at`). Все арендаторы: цикл по контрольной базе, параллельно `--jobs`.
Контрольная база бэкапится первой и всегда. Восстановление в новое имя: `pg_restore -C` не умеет менять имя базы в
custom-дампе напрямую, поэтому `createdb erp_<slug>_restored -O erp_app && pg_restore -d erp_<slug>_restored
file.dump` → регистрация в контрольной базе как арендатор `<slug>_restored` (для сверки) или подмена имени в записи
арендатора после проверки. Размер: 431 MB базы ≈ 60–100 MB дампа; 50 арендаторов такого размера это ~5 GB дампов в
день, оставлять 7 суточных + 4 недельных.

**ClickHouse: `BACKUP DATABASE`.** Встроенная команда `BACKUP DATABASE believe_<slug> TO Disk('backups',
'<slug>/<date>.zip')` требует диск `backups` в конфиге (`ops.xml`: `<storage_configuration><disks><backups><path>
/var/lib/clickhouse/backups/</path>`, плюс `<backups><allowed_disk>backups</allowed_disk>`) и смонтированный том.
Восстановление в другое имя одной строкой: `RESTORE DATABASE believe_<slug> AS believe_<slug>_restored FROM Disk(…)`.
`_stage` не бэкапится (временные таблицы одной загрузки). Альтернатива `ALTER TABLE … FREEZE` + копирование
`shadow/` даёт то же без zip, но требует ручной сборки метаданных; `BACKUP` проще. Инкрементальные бэкапы
(`SETTINGS base_backup = …`) имеют смысл с 1 GB на арендатора. Важно для B: бэкап арендатора содержит только его базу,
без копирования 1,6 GB соседа, что при A невозможно (там бэкап всегда весь `rows`).

**Согласованность пары.** Загрузка = реестр PostgreSQL + партиции ClickHouse (D-108). Бэкап пары делается
последовательно PostgreSQL → ClickHouse при отсутствии идущей загрузки (`tenant:backup` берёт тот же advisory-lock
записи `erp-writes` в базе арендатора на время `pg_dump`? нет: `pg_dump` сам снимок, но загрузка между дампом и
BACKUP даст файл `loaded` в PostgreSQL без партиций в ClickHouse). Простое правило: при восстановлении сверить
`source_files WHERE status='loaded'` с `system.parts` и перевести отсутствующие в `failed`; загрузчик уже умеет
перезаливать файл. Скрипт `tenant:restore --verify` делает эту сверку.

**Удаление арендатора.** `npm run tenant:drop -- <slug> [--force]`:

```
1. UPDATE tenants SET status='deleting'        → сервер закрывает пул, новые запросы 410 tenant_deleted
2. tenant:backup <slug>                        (пропускается только с --force)
3. ALTER DATABASE erp_<slug> RENAME TO erp_<slug>_deleted_<yyyymmdd>   (карантин 30 дней; DROP позже)
   или сразу DROP DATABASE erp_<slug> WITH (FORCE)
4. DROP DATABASE IF EXISTS believe_<slug> SYNC; то же _stage
5. mv data/tenants/<slug> data/tenants/_deleted/<slug>_<yyyymmdd>  (или rm -rf с --force)
6. UPDATE tenants SET status='deleted', deleted_at=now()           (строка остаётся: аудит и уникальность slug)
```

Удаление при A — это `DELETE … WHERE tenant_id` по ~40 таблицам и `ALTER TABLE rows DELETE WHERE tenant_id` (мутация
на 75 млн строк); при B — три команды и каталог.

**Каталоги данных.** Сегодня `main.ts <dir>` → `<dir>/files/sources` и `<dir>/tmp`. При B:

```
data/
  control/                      (ничего, кроме, возможно, экспортов)
  tenants/<slug>/files/sources/ (оригиналы Believe и B17 арендатора)
  tenants/<slug>/tmp/           (загрузки в процессе; busboy пишет сюда)
  backup/<slug>/<date>/         (erp.dump, believe.zip)
  test-tmp/, test-files/        (как сейчас)
```

`tmp` на арендатора, а не общий: два администратора двух арендаторов грузят файлы одновременно, и имена временных
файлов не должны пересекаться; загрузка серилизуется по модулю **внутри** арендатора (D-034 остаётся в силе на
уровне фасада арендатора), между арендаторами идёт параллельно. На сервере `DATA_DIR` bind-mount уже предусмотрен
(`docker-compose.yml`); квота на каталог арендатора — `du` в мониторинге, не quota ФС.

## 5. Мониторинг

Что B даёт бесплатно, а A не даёт вовсе:

- **размер на арендатора:** `SELECT datname, pg_database_size(datname) FROM pg_database` и `SELECT database,
  sum(bytes_on_disk), sum(rows) FROM system.parts WHERE active GROUP BY database` — обе команды уже работают (см.
  снимок стенда);
- **нагрузка на арендатора:** `pg_stat_database` (транзакции, блоки, временные файлы, deadlocks на базу),
  `system.query_log` имеет колонку `databases` — запросы по арендатору без единой строчки в приложении;
- **медленные запросы:** `log_min_duration_statement = 500` уже пишет имя базы в каждой строке лога PostgreSQL.

Что добавить в приложении:

- `GET /admin/tenants` (system_admin): slug, status, версии схем, размеры обеих баз, число файлов `loaded`, дата
  последней загрузки и последнего бэкапа, соединений в пуле сейчас. Источник — один цикл по контрольной базе с
  `pg_database_size` и одним запросом к `system.parts`. Это же экран «обзор по всем арендаторам», которого
  в B боятся: для эксплуатации он покрывает 90 % нужд, а для денег обзор по арендаторам и не нужен (у каждого свои
  книги).
- **Дерево `LOG_TIMINGS`.** Сейчас корень печатается без контекста. Добавить в `startTiming` корневую метку
  `tenant=<slug> op=<operator> <METHOD> <path>` (всё уже лежит в `req`, оператор берётся в `operatorTrace`). Иначе на
  двух арендаторах деревья нельзя различить.
- **Строка лога на запрос** (один `console.log` JSON в `app.ts` после ответа): `{ ts, tenant, operator, method,
  path, status, ms, audit: 'ok'|'failed' }`. Имена людей не логировать: оператор это логин (после D-172 — subject
  токена), пути без имён (ids). Это согласуется с правилом «никаких персональных данных в логах».
- **Сигналы для алертов** (достаточно cron + psql, без Prometheus на этом этапе): `numbackends` по базе близко к
  пулу; `status='failed'` или `maintenance` в `tenants`; `sum(numbackends)` > 80 % `max_connections`;
  `system.parts` > 2000 активных партов на сервер; свободное место тома.

## 6. Dev и тесты

**Dev-стенд с 2–3 арендаторами.** `.env` остаётся один (кластер + контрольная база, п. 9). Сценарий:

```
docker compose … up -d                     # postgres, clickhouse, миграции control
npm run tenant:register -- zero --pg erp --ch believe      # нынешние данные 0to8+Echo8 (п. 7)
npm run tenant:create -- demo_a; npm run tenant:create -- demo_b
npm run dev                                # сервер читает control, открывает арендаторов лениво
```

До D-172 арендатор выбирается заголовком `X-Tenant: <slug>` (как `X-Operator`), фронт хранит его рядом с оператором
в `localStorage`; скрипты (`mvp:load`, `load-b17`, `reconcile-erp`, `check-*`) получают `TENANT=<slug>` в окружении
вместо нынешнего `DB_DATABASE` и берут имена баз из контрольной базы. Compose-профиль «три арендатора» не нужен: это
данные, а не сервисы.

**Юнит- и интеграционные тесты.** `createPrivateStores(name)` остаётся как есть для модулей и фасада: они и сейчас
получают `{ db, sources }` напрямую, арендатор для них это просто пара баз. Меняется только слой выше:

- `createPrivateStores` начинает вести `schema_migrations` (одно и то же ядро раннера, п. 1), иначе production и
  тесты расходятся;
- для `app.ts`, контракт-теста и e2e появляется `createPrivateControl(name)`: контрольная база
  `erp_<name>_control` с одной строкой арендатора, указывающей на `erp_<name>` / `believe_<name>`; тест строит
  `createApp({ control })` и ходит с `X-Tenant`. Контракт-тест добавляет один сценарий «второй арендатор не видит
  первого» (две пары, один сервер): это единственный новый тест изоляции, при A таких нужно было бы по одному на
  каждый репозиторий;
- e2e: `erp_e2e_control` + `erp_e2e` / `believe_e2e`, `scripts/e2e/seed.ts` регистрирует арендатора; lock
  `data/test-tmp/e2e.lock` без изменений.

**Хвосты тестов.** 78 баз PostgreSQL (709 MB) и 230 баз ClickHouse `*_t_*` — это прерванные прогоны. Чистка **не
выполнялась** (только подсчёт). Команда `npm run stores:clean` (новая): список кандидатов по шаблону
`^erp_t_[0-9a-f]{10}$` / `^believe_t_[0-9a-f]{10}(_stage)?$`, без активных backend'ов, и только эти; `erp_e2e`,
`erp_demo`, `erp` под шаблон не попадают. Сегодня руками, сначала посмотреть список:

```sql
-- PostgreSQL: кандидаты (ничего не удаляет)
SELECT d.datname, pg_size_pretty(pg_database_size(d.datname)), s.numbackends
FROM pg_database d JOIN pg_stat_database s USING (datname)
WHERE d.datname ~ '^erp_t_[0-9a-f]{10}$' ORDER BY 1;
-- затем по одной: DROP DATABASE erp_t_xxxxxxxxxx WITH (FORCE);
```

```sql
-- ClickHouse: кандидаты
SELECT name FROM system.databases WHERE match(name, '^believe_t_[0-9a-f]{10}(_stage)?$') ORDER BY name;
-- затем: DROP DATABASE believe_t_xxxxxxxxxx SYNC;
```

Профилактика дешевле чистки: в `tests/setup.ts` или глобальном `globalSetup` vitest при старте прогона удалять
базы по тому же шаблону старше суток (у `pg_database` нет времени создания; брать `pg_stat_file('base/' || oid)`
от суперпользователя или `metadata_modification_time` из `system.tables` в ClickHouse). Пока это не сделано,
`stores:clean` раз в неделю.

## 7. Путь обновления: нынешние `erp` / `believe` становятся арендатором регистрацией

Данных не копировать и базы не переименовывать:

1. Миграция контрольной базы создаёт `erp_control` (`CREATE DATABASE` вне миграций: compose-сервис
   `postgres-migrate` получает `PGDATABASE=erp_control`, а саму базу создаёт `init/postgres/02_control.sql` при
   первой инициализации или оператор один раз: `createdb -O erp_app erp_control`).
2. `npm run tenant:register -- zero --name "0to8" --pg erp --ch believe --ch-stage believe_stage --files data/real`
   вставляет строку со **своими** именами баз и каталога. Это и есть причина хранить имена явно (п. 1): нынешний
   арендатор не следует соглашению `erp_<slug>`, и не должен.
3. `schema_migrations` в `erp` и `believe` уже ведутся раннерами (14 и 3) — версии совпадают с каталогом, арендатор
   сразу `active`.
4. `.env`: `DB_DATABASE` / `CLICKHOUSE_DATABASE` перестают быть именем арендатора и переименовываются в
   `CONTROL_DATABASE=erp_control` (а `CLICKHOUSE_DATABASE` уходит вовсе); скрипты получают `TENANT=zero` по умолчанию
   на этой машине. `erp_demo` регистрируется как `demo` или остаётся вне контроля (demo-режим не поддерживается, D-112).
5. Откат: удалить строку и вернуть `DB_DATABASE=erp` — базы не трогались.

Единственная «миграция данных» — каталог файлов: `data/real/files/sources` либо остаётся по явному пути в записи
арендатора (рекомендуется, путь уже хранится), либо переезжает в `data/tenants/zero/files/sources` одним `mv`.

## 8. Где B болит на 10 / 50 / 200 и точка переключения

| N | PostgreSQL | ClickHouse | Эксплуатация |
|---|---|---|---|
| **10** | 40 соединений пиково, 10 × ~10 MB пустых каталогов; ничего не менять, кроме `shared_buffers` | 10 × (1 таблица + 2 проекции + 7 view) ≈ 30 таблиц, парты по данным; ничего | миграции ≤ 5 с; бэкап цикл минуты; `admin/tenants` хватает |
| **50** | 200 соединений пиково → `max_connections = 300` или PgBouncer; autovacuum launcher обходит 50 баз (`autovacuum_max_workers` поднять до 6); `pg_dump` ×50 параллелить | 150 таблиц, ~1–2 тыс. партов при похожих объёмах: фоновые слияния заметны, `background_pool_size` 16 → хватает; память на запрос общая, арендаторы мешают друг другу только тяжёлыми `calculate()` одновременно | один стек ещё управляем; логи json-file 30 MB на контейнер тесны, нужен сбор логов; бэкапы ночью по расписанию |
| **200** | 800 потенциальных соединений → PgBouncer обязателен; 200 баз = 200 × каталог ≈ 2 GB только системных таблиц; `pg_stat_database` и `pg_database_size` по 200 базам — секунды; миграция ×200 минуты; одна `MATERIALIZE PROJECTION` ×200 — часы фоновых мутаций | 600 таблиц, 5–10 тыс. партов, `system.parts`-запросы медленные, старт сервера дольше (загрузка метаданных всех таблиц); OOM одного запроса валит сервер для всех | один compose-стек уже не единица отказа, которую хочется иметь: любая остановка PostgreSQL = 200 клиентов |

Болевые точки B по порядку появления: (1) бюджет соединений — с 20 активных, лечится ленивыми пулами и PgBouncer;
(2) время и надёжность миграций × N — с 50, лечится параллельным раннером и `maintenance`-статусом; (3) «единица
отказа слишком большая» — с 50–100, и это лечится не A, а **кластером на группу**: второй compose-стек (или второй
хост) с теми же образами, контрольная база хранит у арендатора `cluster_id` и адрес кластера, сервер держит карту
кластеров. Для B это естественное продолжение (арендатор = пара баз, кластер = адрес), для A — переписывание
(шардирование по `tenant_id`). A выиграл бы, если бы арендаторов были тысячи и каждый был крошечным (цена каталога
на базу и миграции × N перевесила бы), или если бы бизнесу нужны были запросы поверх всех арендаторов (общий каталог
ISRC, сводная отчётность) — в вопросе прямо сказано, что между арендаторами общего нет.

Отдельно о стоимости ClickHouse при B: база в ClickHouse это каталог с метаданными; 1,63 GiB `believe` это данные
одного арендатора, которые были бы теми же байтами в одной таблице при A. Разница только в числе партов: при A
партиция `(month, file_id)` и так на файл, то есть число партов **одинаково** в A и B; при B к нему добавляется
`schema_migrations` и проекции на таблицу (мелочь). Суммарно ClickHouse к N почти безразличен до сотен таблиц.

## 9. Секреты и контрольная база

**Сегодня.** Один `.env`: `DB_HOST/PORT/DATABASE/USERNAME/PASSWORD`, `CLICKHOUSE_HOST/HTTP_PORT/NATIVE_PORT/
DATABASE/USERNAME/PASSWORD`, `PGADMIN_*`, `TZ`. Пароли «только буквы и цифры» (ClickHouse пишет их в XML).

**При B.** `.env` по-прежнему **единственное место секретов**, в нём на две строки больше и на две меньше:

```
DB_HOST, DB_PORT, DB_USERNAME=erp_app, DB_PASSWORD          # пулы арендаторов
DB_ADMIN_USERNAME=erp_admin, DB_ADMIN_PASSWORD              # provisioning / миграции / бэкапы
CONTROL_DATABASE=erp_control                                # вместо DB_DATABASE
CLICKHOUSE_HOST, CLICKHOUSE_HTTP_PORT, CLICKHOUSE_USERNAME, CLICKHOUSE_PASSWORD   # без CLICKHOUSE_DATABASE
AUTH_SECRET (D-172)
```

Контрольная база хранит **конфигурацию, не секреты**:

```
control.tenants (id, slug UNIQUE, name, status, pg_database, ch_database, ch_stage_database, files_dir,
                 cluster_id, pg_version, ch_version, created_at, last_backup_at, deleted_at)
control.clusters (id, pg_host, pg_port, ch_url)              -- адреса без паролей; пароль кластера в .env по id
auth.users, auth.memberships (user_id, tenant_id, role)      -- D-172, расширенный арендатором
```

Пароли арендаторов в контрольной базе не появляются, потому что ролей на арендатора нет (п. 1). Если когда-нибудь
появятся кластеры с разными паролями — `DB_PASSWORD_<cluster_id>` в `.env`, не колонка в таблице (иначе бэкап
контрольной базы = утечка всех паролей). Внешний доступ к ClickHouse (Play UI на `0.0.0.0:8123` через KeenDNS) при
нескольких арендаторах должен закрыться до `127.0.0.1` или получить отдельных read-only пользователей: общий
пароль `erp` даёт чтение всех `believe_*`.

## 10. Команды, которые нужно добавить

Все в `packages/backend/scripts/tenant/`, запускаются из корня, читают `.env`, печатают только slug'и и числа:

| Команда | Что делает | Флаги |
|---|---|---|
| `npm run tenant:create -- <slug> --name "…"` | машина состояний п. 1: пара баз, миграции с учётом, каталоги, строка в control | `--dry-run`, `--cluster` |
| `npm run tenant:register -- <slug> --pg <db> --ch <db> [--ch-stage <db>] [--files <dir>]` | регистрирует существующую пару (п. 7), проверяет версии `schema_migrations` | `--name` |
| `npm run tenant:migrate -- [--all \| <slug>…]` | раннеры PostgreSQL и ClickHouse циклом по control; продолжает после отказа, итоговая таблица, код ≠ 0 при любом отказе | `--status`, `--jobs N`, `--control-only` |
| `npm run tenant:backup -- [--all \| <slug>]` | `pg_dump -Fc` + `BACKUP DATABASE` в `data/backup/<slug>/<date>/`, `last_backup_at` | `--keep-days`, `--jobs N` |
| `npm run tenant:restore -- <slug> --from <dir> [--as <new_slug>]` | восстанавливает в новое имя, сверяет `loaded` ↔ `system.parts` (`--verify`), регистрирует | `--verify-only` |
| `npm run tenant:drop -- <slug>` | статус `deleting`, бэкап, карантин/удаление баз, каталог, `deleted_at` | `--force` (без бэкапа и карантина), `--purge` (удалить карантин старше N дней) |
| `npm run tenant:list` | таблица `GET /admin/tenants` в терминале: статус, версии, размеры, соединения | `--json` |
| `npm run stores:clean` | удаляет хвосты тестов по шаблону `*_t_<10 hex>` без активных соединений | `--dry-run` (по умолчанию), `--apply` |

Compose: сервис `tenant-migrate` (one-shot, после `postgres-migrate`), `init/postgres/01_roles.sql` и
`02_control.sql`, `ops.xml` + том для диска `backups` ClickHouse, порт 8123 на `127.0.0.1`. `.env.example`
обновить по п. 9. Все команды должны быть идемпотентны (повтор без изменений печатает `already_done`, как шаги
`mvp:load`), и ни одна не печатает имена владельцев, псевдонимов или писателей.

Чего **не** добавлять сейчас: PgBouncer (до 50 активных), Prometheus/Grafana (до сбора логов), роли на арендатора,
пользователей ClickHouse на арендатора, второй кластер. Всё это запланировано точкой, где появится, и не меняет
ни одного решения выше.
