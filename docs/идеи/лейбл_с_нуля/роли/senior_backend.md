# Лейбл с нуля: план реализации от senior backend

Дата: 2026-11-05, ветка `feature/fable-001`, код не менялся. Прочитано: черновик, D-168, `facade/CLAUDE.md`,
`sources/CLAUDE.md`, `label-scope.ts`, `scope.ts`, `balance.ts`, `layers/label-of-record.ts`, `ads.ts`, `payouts.ts`,
`payout-gate.ts`, `calculation.ts`, `sources/{registry,columnar,service,loader}.ts`, `labels/{schema,service}.ts`,
`publishing/{schema,service,repository}.ts`, `owners/schema.ts`, `audit/schema.ts`, `api/audit.ts`, `api/operations.ts`,
миграции PostgreSQL 0001…0014 и ClickHouse 0001…0003, `scripts/{assign-operation-labels,check-label-books}.ts`, отчёты
`разделение_по_лейблу/роли/{архитектор_данных,разработчик_фасада}.md` и свежие `роли/{продакт,владелец_лейбла}.md`.
Цифры ниже сняты с рабочего стека (`erp` / `believe`, только чтение) 2026-11-05.

Факты, на которых стоит план (новые относительно прежних отчётов):

- Реестр: 47 `loaded` файлов (34 на счёте 1052428, 2023-11…2026-08; 13 на 1055956, 2025-08…2026-08); оба счёта уже
  зарегистрированы в `labels.label_accounts` (1052428 → 0to8, 1055956 → Echo8). Шесть выписок B17 (`loaded`, 7 кварталов).
  Документов 1 400 (813 договоров, все `migration`), операций 2 608 активных (0to8 2 601, Echo8 7 — все уже с лейблом),
  реклама 2 686 активных записей, все **без** `label_id` (33 без ISRC). Треков 26 305, все с ISRC; сплитов 24 107 на
  22 581 ISRC, участий 283. Аудит: 7 записей.
- ClickHouse 26.8: `believe.rows` 75,7 млн строк, 138 активных кусков, 1,63 ГиБ, 47 партиций (ключ партиции
  `(toYYYYMM(reporting_month), file_id)`), проекция `units_by_label` с ключом `file_id, isrc, upc, reporting_month,
  sales_month, label_name`.
- Время `count()` по `believe.units` (проекция): `file_id IN` (13 файлов Echo8) **0,05 с**; `file_id IN` (все 47)
  0,13–0,15 с; все 47 + `label_name IN` (5 строк Echo8) 0,06 с. Фильтр по файлу — это отсечение партиций, быстрее не бывает.
- Переезд Echo8 виден в данных точно: **2 437 ISRC** встречаются на обоих счетах, и это ровно те ISRC, что шли строкой
  «Echo8» внутри 1052428 (2024-12…2025-07) и с 2025-08 идут на 1055956. Остальные 9 493 ISRC только на 1052428,
  8 756 только на 1055956. То есть «ISRC в один момент у одного лейбла» по R6 верно, а история переноса выводится из файлов
  без ручного ввода.

## 1. Вердикт по черновику

**Верно и принимается без оговорок**

- R6 как ось книги: книга = лейбл счёта файла; строка лейбла решает только саблейбл-правило и «наше / не наше». Это
  единственная трактовка, при которой строка сверки (счёт × месяц) целиком лежит в одной книге и A = B + C + наше сходится
  **по книге без допущений** (сейчас `byLabel` строки сверки режет файл по строкам лейбла — после R6 он вырождается в один
  ключ, и это хорошо).
- Не хранить `sublabel_id` в ClickHouse (шаг 5): алиасы и правила меняются задним числом, замороженное сопоставление
  пришлось бы пересчитывать мутациями на 75 млн строк.
- Сплиты и владельцы глобальны, псевдоним — получатель, охват (reach) не меняется, слои не меняются.
- Лейбл у операции, выплаты, рекламы, выписки, файла — у **сущности** (параметр / поле), а не у сессии (`X-Label`); это
  уже закреплено D-168.
- Три сигнала лейбла у ISRC-месяца (счёт / строка / каталог) и правило «расхождения дают сигналы, а не меняют деньги».

**Неверно или перегружено**

1. **`label_id` в `believe.rows` не нужен** (шаг 5, «фильтр `label_id IN` вместо списков `file_id`»). Ключ партиции уже
   содержит `file_id`: `file_id IN (...)` — отсечение партиций, 0,05 с на 13 файлов. Список id лейбла короче списка
   файлов на десятки байт, а цена колонки: `ALTER ADD COLUMN` + смена ключа проекции (`DROP/ADD PROJECTION` +
   `MATERIALIZE` = полная перезапись 1,63 ГиБ), заполнение колонки загрузчиком, и **вторая истина**: если счёт
   перерегистрируют, строки устареют и их придётся лечить `ALTER UPDATE`. Истина — реестр файлов; юнит уже получает
   `account` из реестра по `file_id` в `snapshot()`, точно так же он получит `labelId`. Для BI, если понадобится, — словарь
   ClickHouse над `source_files` (одна команда), не колонка. Аргументы ниже в §6.
2. **`source_files.label_id` — хранить, но заполнять только из `label_accounts` при загрузке** (не вводить руками).
   Хранить нужно: файл грузится «под лейблом», отказ проверяется по реестру, и книга файла не должна поплыть при
   перерегистрации счёта (деньги уже пришли). Выводить на лету нельзя ещё и потому, что модуль sources не знает лейблов
   (D-009): он хранит непрозрачный `label_id text`, как `account`. Скрипт проверки закрепляет «хранимое = реестр счетов».
3. **Документам лейбл сейчас нужен только как необязательное поле**, без разметки истории. Черновик §4 («документы:
   `label_id` = 0to8, кроме четырёх договоров Echo8») — это **изменение поведения**: 813 договоров-`migration` помечены
   0to8 закроют выплаты Echo8 по тем же людям в неделю ведомости (продакт прав). Правильно: `NULL` = «любой лейбл» (история),
   ворота под L принимают договор с `label_id ∈ {L, NULL}`; механизм делаем в D-169 (поведение сегодня не меняется), разметку
   — только решением владельца (⚠, вопрос продакта №5). Категоризация слоёв (`owner_unconfirmed` в C) договор лейбла **не
   смотрит** — иначе меняется B/C, а математика слоёв заморожена.
4. **Реклама «по плательщику» означает: `label_id` обязателен у каждой записи, и книга списания = он**, а не «лейбл
   строки ISRC в месяц расхода» (D-168). Владелец лейбла это требует прямо (п. 8 его отчёта). Строка ISRC остаётся
   только для саблейбл-правила (кто несёт невозвращённую часть).
5. **Оценка D-169 в 2–3 дня занижена**: с фронтом (загрузка под лейблом, формы), миграцией данных, тестами и e2e это
   4–5 дней. Итого четыре этапа ≈ 16–19 дней, не 10–11.
6. **«Каталог: `catalog.tracks` = `owners.tracks` + `label_id`» дублирует историю.** Достаточно истории
   `track_labels (isrc, label_id, from, to)`; «текущий лейбл» = открытый интервал. И история должна **выводиться из
   файлов** (первый отчётный месяц на новом счёте), а не набираться руками (требование владельца лейбла №2).
   Отдельный модуль `catalog` не нужен: треки живут в owners, туда и релизы.
7. **`created_by` везде** избыточно: каждая запись через API уже имеет строку аудита с оператором и id созданных
   сущностей. В обход аудита пишут только миграционные скрипты, и они печатают свой протокол. Не добавлять.
8. **Шаг 3, «саблейбл меняет own-лейбл, нужен период»** — после R6 период не нужен: `own_label_id` саблейбла влияет
   только на `ourLabelId` по строке, а он после D-169 решает лишь саблейбл-правило, сигнал `labelOutsideAccount` и
   справочный `ourShareByLabel`. Деньги идут по счёту. Перевесить саблейбл — не значит отдать прошлые деньги.
9. **Порядок этапов**: продакт прав, что ценность ближайших недель — ведомость-контроль 0to8. Но её фундамент — именно
   книга по счёту (D-169, коммиты 1–3 ниже). Поэтому D-169 остаётся первым, а `asOf`/выгрузка (D-170) идут сразу за
   ним; `documents.label_id`, B17 под лейблом и `audit.label_id` в D-169 — как **механизмы без разметки истории** (по
   одной колонке и одному полю каждый, полдня на всё), чтобы не возвращаться к миграции трижды.

## 2. D-169: книга по счёту файла

Цель: каждый файл Believe, выписка B17, рекламная запись, документ и запись аудита несут `label_id`; книга юнита = лейбл
файла; загрузка под лейблом с отказом по счёту; `calculate()` и слои без изменений в математике.

### 2.1. Миграция PostgreSQL `0015_label_books_2.sql` (одна на этап, все команды идемпотентны)

```sql
-- книга файла Believe (D-169): лейбл счёта на момент загрузки, из labels.label_accounts; NULL только у истории до разметки
ALTER TABLE source_files ADD COLUMN IF NOT EXISTS label_id text;
CREATE INDEX IF NOT EXISTS source_files_label ON source_files (label_id) WHERE status = 'loaded';

-- выписка паблишинга под лейблом; строки наследуют через pub_lines_by_key
ALTER TABLE publishing.pub_statements ADD COLUMN IF NOT EXISTS label_id text;
DROP MATERIALIZED VIEW IF EXISTS publishing.pub_lines_by_key;
CREATE MATERIALIZED VIEW publishing.pub_lines_by_key AS
SELECT s.label_id, l.period, l.writer_norm, MIN(l.writer_name COLLATE "C") AS writer_name, l.work_title, l.songwriters,
       l.operation_type, SUM(l.payable_pico) AS payable_pico
FROM publishing.pub_lines l JOIN publishing.pub_statements s ON s.id = l.statement_id
WHERE s.status = 'loaded'
GROUP BY s.label_id, l.period, l.writer_norm, l.songwriters, l.work_title, l.operation_type;
CREATE INDEX IF NOT EXISTS pub_lines_by_key_order ON publishing.pub_lines_by_key (...как в 0013, с label_id первым);

-- документ (договор) лейбла: NULL = история, подтверждает под любым лейблом
ALTER TABLE owners.documents ADD COLUMN IF NOT EXISTS label_id text;

-- лейбл контекста записи: ?label= или labelId тела
ALTER TABLE audit.actions ADD COLUMN IF NOT EXISTS label_id text;
CREATE INDEX IF NOT EXISTS actions_label ON audit.actions (label_id);
```

Без `NOT NULL` и без внешних ключей (D-121). Обязательность обеспечивает фасад для **новых** записей; история
размечается скриптом. ClickHouse: **миграций нет**.

Drizzle: `labels/schema.ts` без изменений; `publishing/schema.ts` (`pubStatements.labelId`), `owners/schema.ts`
(`documents.labelId`), `audit/schema.ts` (`actions.labelId`). У sources схемы нет: `registry.ts` (`COLUMNS`, `Row`,
`record`, `insertLoading(..., label_id)`, `SourceFileRecord.labelId: string | null`).

### 2.2. Модули

- **sources**: `LoadInput.labelId: string` (обязателен), `NewSourceFile.labelId`; `loader.ts` пишет его в `insertLoading`.
  Экспортировать `parseBelieveFileName` из `modules/sources/index.ts` (чистая функция, фасаду нужен счёт до загрузки).
  `SourceUnit.labelId: string | null` — из `files` в `snapshot()` (карта `labelOf = new Map(files.map(f => [f.id, f.labelId]))`
  рядом с `accountOf`). `SnapshotFilter.labelIds?: string[]` — обрабатывается там же, где `accounts`:
  `read = files.filter(f => labelIds.includes(f.labelId))`, список файлов `files` в ответе остаётся полным (D-161).
  **Убрать** `UnitsFilter.labelStrings` и `labelStringsOfAliases` (книга больше не множество строк; одна истина, один путь).
  `isrcsOfLabelStrings`/`isrcsOfLabelAliases` остаются: ими пользуется охват (получатели саблейбл-правил). Новое
  `columnar.isrcsOfFiles(fileIds)` (`SELECT DISTINCT isrc FROM units WHERE file_id IN`) для `labelIsrcs`.
  `registry.loaded()` без изменений; `listFiles` отдаёт `labelId`.
- **publishing**: `ingestB17({ ..., labelId })` пишет `label_id`; `AggregatedLine.labelId` из `pub_lines_by_key`;
  `activeStatements()` отдаёт `labelId`; `snapshotForCalculation({ lines, labelIds? })` — фильтр строк по лейблу
  (под лейблом строки B17 читаются только его; сейчас под лейблом они не читаются вовсе).
- **owners**: `createDocument({ labelId? })`, `DocumentView.labelId`; `confirmedContracts(): { ownerId, labelId | null }[]`
  (или `confirmedOwnerIds(labelId?)`: договор с `label_id ∈ {labelId, NULL}`). `listDocuments({ labelId })` показывает
  документы лейбла **и без лейбла**.
- **ads**: `create` требует `labelId` у каждой записи (сейчас — только без ISRC); `AdExpense.labelId: string` после
  разметки (тип оставить `string | null` до неё, чтобы скрипт мог работать).
- **audit**: `recordAction({ ..., labelId })`, `recentActions({ labelId })`.
- **labels**: без изменений (`label_accounts`, `index().labelOfAccount` уже есть).

### 2.3. Фасад

| Место | Сейчас | Станет |
|---|---|---|
| `sources.ts` `ingestBelieve` | прокси в модуль | `parseBelieveFileName(fileName).account` → `labels.index().labelOfAccount(account)`: `undefined` → `RuleViolationError('account_unregistered', { account })` (UI предлагает `POST /labels/:id/accounts`); ≠ `labelId` → `RuleViolationError('account_of_other_label')`; иначе `sources.ingestBelieve({ ..., labelId })`. Проверка до сериализованной загрузки; гонка с регистрацией счёта безвредна (файл либо ляжет под L, либо откажет) |
| `sources.ts` `ingestB17` | без лейбла | `assertOwnLabel(labelId)` → `publishing.ingestB17({ ..., labelId })` |
| `calculation.ts` | `UnitResult.ourLabelId/Name` по строке | плюс **`bookLabelId: string \| null`, `bookLabelName`** = `u.labelId` из `SourceUnit` (ставится в `calculate()` после `allocateUnit`, слои и `LayerContext` не трогаются). `PublishingResult.labelId` из строки. `Calculation.confirmedOwnersUnder(labelId)` (множество по договорам лейбла и без лейбла); `confirmedOwners` для слоёв как было |
| `reconcile()` | `book(r, u.ourLabelName)` | `book(r, u.bookLabelName ?? '?')` — строка Believe (счёт × месяц) целиком в одной книге; `ourShareByLabel` по строке лейбла **оставить** как справку «строка чужого лейбла на счёте»; строки b17 → `p.labelId` |
| `balance.ts` | `keyOf(u.ourLabelId)` для earned/waiting, `IncomeItem.labelId = u.ourLabelId`, паблишинг `'?'` | `keyOf(u.bookLabelId)`, `IncomeItem.labelId = u.bookLabelId`; паблишинг `keyOf(p.labelId)` — книга «без лейбла» у паблишинга исчезает после разметки; `confirmed = view ? calc.confirmedOwnersUnder(view.labelId).has(ownerId) : calc.confirmedOwners.has(ownerId)`; formula payable_L не меняется |
| `payout-gate.ts` | без изменений | без изменений: `confirmed` приходит из баланса (под лейблом — договор лейбла), остальное как D-168 |
| `payouts.ts` `createPayout` | снимок `files.b17 = activeStatements()` | `activeStatements().filter(s => s.labelId === label.id)` — входы книги; `createOperation` без изменений |
| `label-scope.ts` | `LabelBook { labelStrings }`, `labelIsrcs` по строкам | `LabelBook { id, name, fileIds }` (= `loaded` файлы с `labelId = L`), `labelIsrcs = sources.isrcsOfFiles(fileIds)`; `labelVisibility` без изменений по сути |
| `scope.ts` | `UnitScope = SnapshotFilter & {...}` | тип расширяется сам (`labelIds`); `scoped()` без изменений |
| `context.ts` `labelContext` / `viewOf` | строки | `labelIds: [L]` в фильтр; под лейблом `publishingLines` больше не `false`, а фильтр по лейблу |
| `ads.ts` `allocateAd` | `ourLabelId` = лейбл строки ISRC, запасной — `ad.labelId` | `ourLabelId = ad.labelId` (плательщик) всегда; `labelStringOf`/`labelOf` остаются **только** для правила саблейбла (`borneBy`); новый сигнал `adOutsideBook` — доход ISRC в месяц расхода идёт в другую книгу (информация, деньги не трогает) |
| `ads-api.ts` | `labelId` обязателен без ISRC | обязателен всегда (`400 label_required`); фильтр `?label=` как был (по `ourLabelId`) |
| `reports.ts` сигналы | `labelOutsideAccount`: `ourLabelId ≠ labelOfAccount(account)` | то же через `u.bookLabelId` (смысл: «строка чужого лейбла в нашей книге»); новые `filesWithoutLabel` (как `operationsWithoutLabel`), `adsWithoutLabel`, `statementsWithoutLabel` — все пусты после разметки |
| `aggregates.ts`, `artist-view.ts`, `queue.ts` | фильтр по строкам | фильтр по `labelIds`; `cItems` → `bookLabelName`; треки/релизы под лейблом = ISRC его файлов |
| `audit.ts` | | `labelId` в `recordAction` |

Инвариант D-168 «Σ книг (с «без лейбла») = итог по каждому полю» сохраняется дословно — меняется только ключ книги.
`Case.verify()`, `scope.test.ts`, `check-label-books.ts` его и держат.

### 2.4. API и `operations.ts`

| Маршрут | Изменение |
|---|---|
| `POST /sources/believe` | `query: S.uploadLabelQuery = z.object({ label: z.string().min(1) })` (multipart, поэтому параметр, не тело); errors: `400 label_required`, `409 account_unregistered` (с `account` в деталях), `409 account_of_other_label`, `409 duplicate_period` |
| `POST /publishing/b17` | то же `?label=`; `400 label_required` |
| `GET /sources/files` | `?label=` → файлы и выписки лейбла; `labelId` в `sourceFileSchema` и у выписки |
| `POST /documents` | body `labelId?` (`assertOwnLabel`); `documentSchema.labelId` |
| `GET /documents` | `?label=` → документы лейбла и без лейбла |
| `POST /ads` | `labelId` обязателен в каждом элементе |
| `GET /audit` | `?label=`; `labelId` в ответе |
| `GET /signals` | новые списки и счётчики (`filesWithoutLabel`, `adsWithoutLabel`, `statementsWithoutLabel`, `adOutsideBook`) |
| `GET /reconciliation`, `/overview` | `byLabel` строк теперь по книге (один ключ на строку Believe), `ourShareByLabel` — по строке лейбла (как было) |

Хук `api/audit.ts`: `labelId = typeof req.query.label === 'string' ? req.query.label : body.labelId` → `recordAction`.
`OPERATOR_HEADER` без изменений. Контракт-тест (D-119) уже регистрирует счёт 1052428 до загрузки (строки 206 и 236) —
добавить `?label=` и два отказа.

Ошибки: коды `account_unregistered` / `account_of_other_label` через `RuleViolationError` (как `use_payout_button`), чтобы
UI отличал «зарегистрируй» от «чужой».

### 2.5. Скрипты

- **`scripts/assign-label-books.ts [dataDir] [--apply]`** (dry run по умолчанию, через фасад/модули, без аудита, как
  `assign-operation-labels.ts`), три шага с счётчиками:
  1. `files`: каждому `loaded`/`superseded`/`failed` файлу `label_id = labelOfAccount(account)`; файл с незарегистрированным
     счётом печатается и **останавливает** шаг (сначала `POST /labels/:id/accounts`). Ожидание: 34 → 0to8, 13 → Echo8.
  2. `statements`: все шесть выписок → own-лейбл `0to8` (черновик §4, вопрос продакта №10 — подтвердить до `--apply`).
  3. `ads`: 2 686 записей → `0to8` (решение 05.11 «операции, реклама: 0to8»), но dry run печатает, у скольких записей
     доход ISRC в месяц расхода идёт на счёт Echo8 (по D-168 это было 44 606 под Echo8 по строке) — список владельцу на
     пересмотр, лейбл правится `PATCH /ads/:id`.
- **`scripts/check-label-books.ts`** дополнить: (а) `source_files.label_id` = `label_accounts` по счёту у каждого файла;
  (б) у каждой строки сверки Believe ровно одна книга; (в) печать книги 0to8 для владельца и псевдонима, переданных
  аргументом (ожидание из разбора владельца: 0to8 −1 091,77 у псевдонима со смешанной историей — без имён в репозитории);
  (г) сумма `labelOutsideAccount` по 1052428 = 222 130 (книга 0to8). Существующие проверки (Σ книг = итог, view = книга)
  как были.
- `scripts/e2e/seed.ts` и сценарии `sources.ts`, `publishing.ts`, `label-books.ts`: регистрация счёта и загрузка под лейблом.

### 2.6. Тесты

- `tests/sources.test.ts`: `labelId` обязателен и хранится; `snapshot({ labelIds })` читает только файлы лейбла, `files`
  полный; `labelStrings` удалён.
- `tests/scope.test.ts` «the label as a book»: переписать фикстуру на **два счёта** (1052428 → 0to8 с файлом, несущим
  строку «Echo8»; 1055956 → Echo8): книга строки «Echo8» в счёте 0to8 — **0to8**; Σ книг = итог; view под лейблом = книга;
  чтения под лейблом = полные, ограниченные файлами лейбла; выплата под Echo8 не видит этих денег. `withFullReads`
  должен игнорировать и `labelIds`.
- `tests/golden.test.ts`: `Case`/`newFacade` регистрируют тестовый счёт под 0to8 (иначе книги станут `'?'`); новый G51:
  юнит со строкой Echo8 на счёте 0to8 → `byLabel: { '0to8': … }`, `ourShareByLabel: { 'Echo8': … }`; G52: паблишинг под
  0to8 входит в книгу 0to8 и платится кнопкой под 0to8 (закрывает открытый пункт D-168).
- `tests/layers/*`: без изменений (слои не трогаются) — это и есть проверка «математика не изменилась».
- `tests/api-contract.test.ts`: `?label=` на загрузках, оба отказа, `labelId` документа и рекламы, `GET /audit?label=`.
- `tests/audit.test.ts`: `label_id` из `?label=` и из `labelId` тела.
- `tests/rules-coverage.test.ts`, `boundaries.test.ts`: проверить, что `parseBelieveFileName` экспортирован через `index.ts`,
  а не импортом из глубины модуля.
- Фронт: `coverage.test.ts` (новые операции → страницы), e2e `35-label-switch` + загрузка под лейблом; под «Все» кнопки
  загрузки и формы рекламы/документа закрыты подсказкой «выберите лейбл» (как кнопка выплаты).

### 2.7. Порядок коммитов (каждый проходит definition of done)

1. `feat(sources): a Believe file is loaded under a label` — миграция 0015 целиком (все колонки нулевые, поведение
   не меняется), `registry/loader/service`, фасад `ingestBelieve` с отказами, `?label=` на `POST /sources/believe`,
   `GET /sources/files` с лейблом, тесты sources + contract, фронт P3 (загрузка под лейблом, колонка «лейбл»).
2. `feat(facade): the book of a unit is the label of its file (R6)` — `SourceUnit.labelId`, `bookLabelId`, ключи
   `balance.ts`/`reconcile`/`queue`/signals, `labelBook` по файлам, `SnapshotFilter.labelIds`, удаление `labelStrings`,
   `scope.test` и golden, `check-label-books` расширен, скрипт `assign-label-books files` + прогон на `data/real`.
3. `feat(ads): the label of an advertising record is its payer` — обязательный `labelId`, `allocateAd`, сигнал
   `adOutsideBook`, скрипт шаг `ads`, фронт P19/P20.
4. `feat(publishing): a statement is loaded under a label` — `ingestB17`, `pub_lines_by_key.label_id`, `PublishingResult.labelId`,
   книга паблишинга, чтения под лейблом с B17, снимок выплаты, скрипт шаг `statements`, golden G52, фронт P4.
5. `feat(owners,audit): documents carry a label; the gate asks for a contract of the label; the audit records the label` —
   `documents.label_id` (необязателен), `confirmedOwnersUnder`, `GET /documents?label=`, `audit.label_id`, тесты.
6. `docs: D-169` — запись в 97 (ссылки на миграцию, скрипты, числа реального прогона), индекс 03, `facade/CLAUDE.md`,
   `sources/CLAUDE.md`, `labels/CLAUDE.md`, `01_big_picture.md` §5; D-168 помечается «уточнено D-169» в индексе.

### 2.8. Оценка

Бэкенд 2,5 дня (коммиты 1–2 — 1,5; 3–5 — 1), фронт 1 день, данные + проверки + документы 0,5–1 день: **4–5 дней**.

## 3. D-170: операции под ведомость

Что просят: выкуп ≠ роялти, прощение аванса (D6), `asOf` и выгрузка ведомости по области мастер / паблишинг, замена
выписки B17. Владелец лейбла добавляет: списание паблишинга, переходная корректировка к кабинету, причина у смены
лейбла операции, пометка «лейбл по умолчанию» у 1 315 операций, юрлицо и валюта у лейбла.

### 3.1. Модель: явный вид операции

Сейчас `meaning` **выводится** из направления, знака, области и `operation_ref` (`meaningOf`). Новые виды в эту схему не
ложатся (выкуп — тоже `out` без области). Миграция `0016_operation_kinds.sql`:

```sql
ALTER TABLE settlements.operations ADD COLUMN IF NOT EXISTS kind text
  CHECK (kind IS NULL OR kind IN ('payout','advance','deduction','credit','return','buyout','forgiveness','writeoff','adjustment'));
UPDATE settlements.operations SET kind = <выражение meaningOf в SQL> WHERE kind IS NULL;   -- внутримодульно, детерминированно
ALTER TABLE settlements.operations ADD COLUMN IF NOT EXISTS label_source text
  CHECK (label_source IS NULL OR label_source IN ('one','default','operator','payout'));    -- D-168: откуда лейбл
ALTER TABLE labels.labels ADD COLUMN IF NOT EXISTS legal_name text;                          -- юрлицо для ведомости и снимка
ALTER TABLE labels.labels ADD COLUMN IF NOT EXISTS currency text NOT NULL DEFAULT 'USD';
```

Ограничения `operations_out_rules` / `deduction_rules` / `credit_rules` 0004 нужно **заменить** (DROP CONSTRAINT + ADD с
учётом `kind`): выкуп — `out`, владелец, документ вида `buyout`, без области; прощение — `in`, `operation_ref` на аванс,
документ, сумма ≤ непогашенного; списание — `in` на владельца с областью `publishing` и документом (сегодня удержание
требует `artist_id`); корректировка — `in`/`out` на владельца с документом. Старые строки удовлетворяют новым CHECK по
построению (проверить скриптом до `--apply`).

Семантика в `balance.ts` (книги не ломаются: каждое новое поле — отдельное слагаемое, Σ книг = итог по полю):

- `buyout`: не входит в `paid`; отдельное поле `buyouts_L`; `payable_L` без изменений (выплата за выкуп — не роялти,
  README §5). Доля продавца 0 с даты — уже сплитом (`POST /splits/buyout`).
- `forgiveness`: не деньги, а долг. `layers/recoup.ts`: позиция получает `forgiven` (Σ прощений по `operation_ref`) и
  дату; ёмкость позиции для доходов с месяца ≥ даты прощения = `amount − recouped_до_даты − forgiven`. Поле книги
  `forgiven_L`, `unrecouped` уменьшается, `payable` не меняется. Это единственное место, где D-170 трогает `recoup.ts` —
  с собственным тестом в `tests/layers/recoup.test.ts`.
- `writeoff`: уменьшает `earnedPublishing_L` владельца на сумму (никому); поле `writtenOff_L`; `payable_L` уменьшается.
- `adjustment` (стартовый остаток / корректировка к кабинету): поле `adjustments_L`, в `payable_L` со знаком.
- `PATCH /settlements/operations/:id { labelId, reason }`: `reason` обязателен (в `summary` аудита), `label_source = 'operator'`;
  сигнал `operationsRelabelled` = счётчик по аудиту. Ограничение «только администратор системы» — D-172.
- `label_source` для 1 315 «по умолчанию»: функция решения из `assign-operation-labels.ts` детерминирована на тех же юнитах —
  прогнать в режиме `--mark-source` и записать `one`/`default`/`payout`; список «default» — отчёт владельцу.

### 3.2. `asOf` и выгрузка ведомости

- `asOf` — это `PeriodFilter.to` по отчётному месяцу для юнитов и выписок **плюс** операции с `date ≤ asOf` (сейчас
  период-фильтр операции не режет). `ownerBalance(calc, …, f: { to, asOf })`: операции фильтруются по дате; позиции
  (авансы) — по дате тоже. Ничего не хранится: ведомость воспроизводима из сырых данных и `asOf`.
- `GET /owners/payables?label=&asOf=2026-09&format=csv` (или `GET /statements/payroll.csv`): одна полная калькуляция
  (как `ownerPayables`), строка на владельца × псевдоним: лейбл (юрлицо), владелец, псевдоним, договор (номер, лейбл
  договора), earned, recouped, ads, paid, buyouts, forgiven, writtenOff, adjustments, payable, «по решению, без договора»
  (пусто до D-171), блок (`payout_blocked` с пометкой «другим лейблом»). Отдельно `area=master|publishing`: мастер-ведомость
  без строк B17, паблишинг-ведомость только B17 (книга лейбла уже их различает по `labelId` строки).
- Контракт: новая операция в `operations.ts` с `response: z.string()` для csv (или `text/csv` особым флагом как `upload`);
  контракт-тест вызывает её в сценарии.

### 3.3. Замена выписки B17

`POST /publishing/b17?label=&replace=<statementId>`: в одной транзакции модуля — старая выписка `superseded`, её строки
остаются (снимки выплат ссылаются на sha), `pub_statement_periods` перевешиваются на новую (PK `(source, period)` —
удалить старые строки, вставить новые), `REFRESH MATERIALIZED VIEW` (уже в транзакции загрузки). Ошибки: `replace` не
`loaded` → 409; кварталы нового файла ≠ кварталы старого → 409 `periods_differ` (замена — ровно тот же период). Это
закрывает D-041 ⚠ (Updated Q2) после подтверждения владельца. Believe-замена не нужна: `duplicate_period` остаётся.

### 3.4. Порядок коммитов

1. `feat(settlements): explicit operation kinds` — 0016, `kind`, новые CHECK, `label_source`, `meaning` = `kind`,
   `createOperation({ kind })`, скрипт `--mark-source`, тесты settlements.
2. `feat(facade): buyout, forgiveness, write-off and adjustment in the books` — `balance.ts` поля, `recoup.ts` прощение,
   golden G53–G56, `Case.verify()` расширен на новые поля.
3. `feat(reports): asOf and the payroll export` — фильтр операций по дате, csv, контракт, фронт P9 (дата среза, кнопка выгрузки).
4. `feat(publishing): replace a statement` — `replace`, тесты, фронт P4.
5. `feat(labels): legal name and currency` + `docs: D-170`.

Оценка: **3–4 дня** (виды и ограничения 1, книги и recoup 1, asOf + csv 0,5–1, замена 0,5, фронт 1).

## 4. D-171: каталог, импорт сплитов, «принять как допущение»

### 4.1. История принадлежности ISRC и релизы (в модуле owners, миграция `0017_catalog.sql`)

```sql
CREATE EXTENSION IF NOT EXISTS btree_gist;
CREATE TABLE IF NOT EXISTS owners.track_labels (
    isrc        text NOT NULL,
    label_id    text NOT NULL,
    valid_from  date NOT NULL CHECK (extract(day FROM valid_from) = 1),     -- правило первого числа (M52)
    valid_to    date CHECK (valid_to IS NULL OR extract(day FROM valid_to) = 1),
    source      text NOT NULL CHECK (source IN ('files', 'operator', 'import')),
    note        text,
    created_at  timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (isrc, valid_from),
    EXCLUDE USING gist (isrc WITH =, daterange(valid_from, valid_to, '[)') WITH &&)   -- один лейбл в момент времени
);
CREATE TABLE IF NOT EXISTS owners.releases (
    upc text PRIMARY KEY, title text NOT NULL, version text, artist_string text, label_string text,
    release_date date, track_count integer, catalog_number text, label_id text,
    source text NOT NULL, imported_at timestamptz NOT NULL DEFAULT now()
);
```

Без `owners.tracks.label_id`: текущий лейбл = открытый интервал истории (один источник истины).

- Вывод истории из файлов: `scripts/derive-track-labels.ts [--apply]` — по юнитам `loaded` файлов для каждого ISRC
  последовательность книг по отчётным месяцам → интервалы, начало интервала = первый отчётный месяц на новом счёте.
  Ожидание на реальных данных: 2 437 ISRC с двумя интервалами (0to8 до 2025-08, Echo8 с 2025-08), остальные с одним.
  Повторный прогон идемпотентен (только `source = 'files'`, интервалы оператора не трогает).
- Ручной перенос: `POST /tracks/:isrc/label { labelId, from }` (месяц → первое число; закрывает открытый интервал на
  `from`, `empty_period` при пустом) и `GET /tracks/:isrc/labels`. Аудит через хук.
- Сигналы: `catalogOutsideAccount` (юнит, чья книга ≠ лейбл каталога в его отчётный месяц; сумма, счёт, месяц),
  `tracksWithoutLabel` (ISRC с юнитами без интервала). Деньги не меняются — только списки.
- Релизы: `POST /releases/import?label=` (csv экспорта Believe: `;`, BOM, `"UPC : 3617…"`, `<br />` в дате; 8 242 строки)
  → `owners.releases` с `label_id` загрузившего лейбла; контрольные сигналы `releasesIncomplete` (`track_count` >
  различных ISRC этого UPC в юнитах), `releasesUnknown` (UPC в юнитах, нет в экспорте). `GET /releases` показывает
  метаданные экспорта рядом с данными отчётов.
- Под лейблом каталог (P5/P6) = ISRC с открытым интервалом лейбла **∪** ISRC файлов лейбла (деньги могли прийти до
  переноса) — иначе P5 под Echo8 потеряет историю 2024-12…2025-07? Нет: по R6 эти деньги в книге 0to8, под Echo8 их и не
  должно быть. Значит каталог под L = ISRC с интервалом L; деньги под L = файлы L; расхождение — сигнал. Так и оставить.

### 4.2. Импорт сплитов через UI

`POST /splits/import?label=&dryRun=1` (multipart csv/xlsx, фиксированный шаблон: `isrc, pseudonym, percent, from, to?,
owner?, document_number?`). Разбор — TS (`xlsx` streaming reader уже есть у B17), не Python. Предпросмотр = классификация
строк: `new_pseudonym`, `isrc_outside_label` (нет интервала лейбла), `overlaps_existing` (пересечение периода со строкой),
`row_or_participation` (псевдоним уже участник на ISRC и дату, D-126), `percent_sum ≠ 100`, `empty_period`. Применение
(`dryRun=0`) через `facade.createSplit` / `changeSplit` в одной `db.transaction()` — всё или ничего; созданные псевдонимы
видны лейблу через ISRC (D-168). Строки без документа грузятся без документа (`split_unconfirmed`, деньги ждут) — не
`assumption` (владелец лейбла №4). Скрипт `scripts/mvp/load.ts splits` не трогать (стадия 4 закрыта).

### 4.3. «Принять как допущение»

`POST /splits/assume { isrcs | splitIds, reason }`: один документ вида `assumption` (заголовок с датой и причиной, под
лейблом через `documents.label_id`), прикреплённый ко всем строкам группы без документа; деньги остаются в C
`assumption` — ровно то, что делает шаг `assumption-rows` загрузчика, но через API и аудит. Вариант «решение лейбла,
платим без договора» (утверждаемый вид документа, деньги в B) — **отдельное решение владельца** (⚠, вопрос продакта №4):
это меняет категоризацию, в D-171 не входит.

### 4.4. Коммиты и оценка

1. `feat(owners): the label history of an ISRC` (0017, `track_labels`, вывод из файлов, маршруты, сигналы, тесты, фронт P6).
2. `feat(owners): releases from the Believe export` (импорт, контрольные сигналы, P5/P7).
3. `feat(splits): import with a preview` (разбор, классификация, применение, тесты на каждую классификацию, P7).
4. `feat(splits): accept rows as an assumption` + `docs: D-171`.

Оценка: **4–5 дней** (история 1,5, релизы 1, импорт сплитов 1,5–2, допущение 0,5).

## 5. D-172: пользователи, JWT, роли

- Миграция `0018_auth.sql`: схема `auth`; `users (id, login UNIQUE, password_hash, role CHECK IN ('system_admin',
  'label_admin','label_manager'), created_at, disabled_at)`, `user_labels (user_id, label_id)`. `audit.actions.user_id`
  (login остаётся в `operator`: subject токена = значение `X-Operator`, миграции данных нет — черновик прав).
- Без новых зависимостей: `crypto.scrypt` для пароля, HMAC-SHA256 JWT через `node:crypto` (или `jose`, если нужен RS256
  позже). Секрет `AUTH_SECRET` в `.env`; `AUTH_MODE=off|on` (off = сегодняшний `X-Operator`, для скриптов и локальной
  разработки; `on` в тестах контракта и e2e обязательно).
- Маршруты: `POST /auth/login` → `{ token, user }`, `GET /auth/me`, `POST /users`, `PATCH /users/:id` (роль, лейблы,
  отключение), `POST /users/:id/password` — только `system_admin`. Первый администратор — `scripts/create-user.ts`.
- Middleware `authenticate` перед `operatorTrace`: `Authorization: Bearer` → `res.locals.user`; `X-Operator` при `on`
  игнорируется и заменяется логином. Авторизация — данными в `operations.ts`: поле `access: 'system' | 'label' |
  'label_write' | 'approve'` у каждой операции; `api-contract.test.ts` требует его у всех и проверяет 403 для чужой роли.
  Правила: `label_manager`/`label_admin` на чтении обязаны передать `?label=` из своих лейблов (`400 label_required`,
  `403 label_forbidden`), «Все» только `system_admin`; на записи `labelId` тела / `?label=` загрузки ∈ лейблы
  пользователя; `approve`-операции (`/documents/:id/approve`, `/splits/:id/confirm`, кнопка выплаты, `PATCH` лейбла
  операции, регистрация счёта, слияния) — `label_admin` своего лейбла или `system_admin`; слияние владельцев, видимых двум
  лейблам, — только `system_admin`.
- Фронт: страница входа, токен в `localStorage`, `OperatorField` → имя пользователя, `LabelSwitch` ограничен лейблами
  пользователя, «Все» скрыт не-администратору.
- Коммиты: `feat(auth): users and login` → `feat(api): access rules per operation` → `feat(frontend): login and the
  user's labels` → `docs: D-172`. Оценка: **4–5 дней** (бэкенд 2,5, фронт 1,5, тесты и e2e 1).

## 6. Риски и альтернативы

1. **`label_id IN` против `file_id IN` в ClickHouse.** Измерено: фильтр по файлам — отсечение партиций (ключ партиции
   содержит `file_id`): 13 файлов 0,05 с, 47 файлов 0,13 с; полное чтение 722 тыс. юнитов (~0,9 с по отчёту разработчика
   фасада) упирается в передачу и `parsePico`, не в `WHERE`. Колонка `label_id` ничего не ускорит, а стоит перезаписи
   проекции и второй истины. Альтернатива для BI: словарь ClickHouse над `source_files` (`file_id → label_id, account`),
   когда понадобится. Решение: ClickHouse не трогать.
2. **Хранимый `source_files.label_id` против выводимого.** Совпадают, пока счёт не перерегистрирован. Хранить — потому что
   книга файла есть факт загрузки (как `uploaded_by`), а модуль sources лейблов не знает. Риск расхождения закрыт проверкой
   в `check-label-books.ts`; перерегистрация счёта (`DELETE`/перенос `label_accounts`) эндпоинта не имеет — и не должна
   получить до первого реального случая (вопрос продакта №6).
3. **История каталога против правила «строка или участие».** Оси независимы: сплит и участие — по ISRC и дате, история
   лейбла — по ISRC и месяцу; ни одна запись истории не меняет ни одного слоя. Единственное пересечение — сигнал
   `catalogOutsideAccount`. Риск не в модели, а в UI импорта (§4.2): классификация `row_or_participation` должна отказывать
   до записи, иначе `createSplit` упадёт на половине файла — поэтому применение в одной транзакции.
4. **Замена выписки B17.** Строки старой выписки остаются (снимки выплат ссылаются на sha, D-053); `pub_lines_by_key`
   отбирает по `status = 'loaded'`, так что старые строки выпадают из расчёта в момент коммита; `REFRESH MATERIALIZED
   VIEW` над 1,16 млн строк — секунды внутри транзакции загрузки (уже так). Риск — выплата, сделанная по старой Q2:
   её снимок хранит старые файлы, баланс после замены изменится; это правильно и видно в `paid` против `earned`.
5. **Транзакции через модули.** Загрузка Believe = PostgreSQL (реестр) + ClickHouse (не транзакционен); проверка счёта
   идёт до `insertLoading`, в реестре файл сразу несёт лейбл, а неудача по-прежнему `failed` (D-108). Разметка данных —
   через модули в `db.transaction()` на шаг. Документ + договор (`createContract`) — один модуль. Кросс-модульных записей
   D-169 не добавляет.
6. **Фикстуры тестов.** `newFacade`/`Case` сейчас грузят юниты без регистрации счёта; после D-169 книги таких юнитов — `'?'`,
   и ожидания `byLabel: { '0to8': … }` в golden упадут. Регистрация счёта в фикстуре — одна строка, но её надо сделать
   **до** переключения ключа (коммит 2), иначе красный прогон между коммитами.
7. **Строки Believe под лейблом в сверке.** После R6 строка (счёт × месяц) целиком в одной книге, поэтому `GET /reconciliation?label=`
   может стать честным (сейчас сверка «Все» только): полная строка файла и `fileTotal` имеют смысл. Это бонус D-169, не
   обязательство.
8. **Ворота по договору лейбла.** С `NULL = любой` поведение не меняется; первый же документ с `label_id` подтвердит
   владельца только под своим лейблом. Опасность — массовая разметка истории (черновик §4): не делать без решения.
9. **Паблишинг в книге лейбла меняет recoup.** Позиция под L сегодня гасится мастер-доходом L **и** паблишингом по виду
   области; после D-169 паблишинг тоже имеет книгу, и позиция L гасится только доходами книги L (мастер и паблишинг). Для
   реальных данных (весь B17 → 0to8, позиции с областью `publishing` — 14, все 0to8) итог не меняется; скрипт
   `check-label-books` печатает владельцев, у которых изменился `payable`, — ожидание 0.
10. **Пустой ISRC `''`** (юниты без ISRC, 2 216 net, строки обоих лейблов на счёте 1052428): по R6 — книга 0to8, статус
    `no_isrc` как был. Истории каталога у него нет и не нужно; `tracksWithoutLabel` его исключает.
11. **Производительность `labelVisibility`** под лейблом: `isrcsOfFiles` — один `SELECT DISTINCT isrc` по проекции
    (0,1 с), дешевле нынешнего `isrcsOfLabelStrings`. Остальное как в D-168 (0,7–1,0 с на view).
12. **Альтернатива всему D-172 — сессионная cookie `httpOnly` вместо JWT в `localStorage`**: безопаснее для SPA (XSS не
    уносит токен), тот же subject = логин. Рекомендую cookie + CSRF-заголовок; JWT оставить как формат, транспорт — cookie.

## 7. Что не делать

- Колонки `label_id`/`sublabel_id` в `believe.rows`; любые миграции ClickHouse ради лейбла.
- `X-Label` заголовок; «режим» фасада для лейбла; второе понятие книги (строки лейбла) рядом с первым (файлы) —
  `labelStrings` удалить, не оставлять «на всякий случай».
- Разметку `documents.label_id` по истории (1 400 документов → 0to8) и категоризацию `owner_unconfirmed` по договору
  лейбла — без решения владельца.
- Период у `label_accounts` и у `own_label_id` саблейбла — до первого реального случая; по R6 они не влияют на деньги.
- `owners.tracks.label_id` рядом с историей; отдельный модуль/схему `catalog`; ручной ввод истории переноса там, где её
  дают файлы.
- `created_by` во всех таблицах — аудит уже отвечает «кто».
- Изоляцию «база на лейбл», хранение книг/начислений, кэши балансов (D-012, 09 принцип 7).
- Перепись `scripts/mvp/load.ts` под лейбл: стадия 4 закрыта, разметка — отдельным скриптом с dry run.
- Перенос денег между книгами «одной правкой» без причины: `PATCH` лейбла операции — с `reason`, в аудите, с
  сигналом-счётчиком; автоматических межлейбловых переводов не вводить.
