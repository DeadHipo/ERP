# Отчёт роли «junior dev»: можно ли реализовать черновик без разговора с автором

Дата: 2026-11-05. Роль: младший разработчик (или будущий ИИ-агент), которому дадут `черновик.md` как ТЗ и не дадут
автора. Код не менялся; это единственный файл, который я написал. Прочитано: `CLAUDE.md`, `черновик.md`,
`docs/agents/01_big_picture.md`, `04_recipes.md`, `packages/backend/src/facade/CLAUDE.md`,
`packages/frontend/CLAUDE.md`, D-167 и D-168 в `docs/97_принятые_решения.md`, хвост `03_decision_index.md`,
и код, по которому я прошёл для трёх изменений (раздел 3).

Вывод в одну строку: черновик хорош как карта («что куда относится»), но как ТЗ для D-169 его нельзя исполнить без
примерно 30 уточнений, из которых 6 противоречат D-168 (принятому в тот же день) и два — правилам из `CLAUDE.md`.
Главное: **книга денег по счёту (R6) отменяет первый пункт решения D-168** («the label of money is the unit's label
string: no transfer by ISRC or by account»), а черновик пишет в §5 «что не меняется», будто меняются только данные.

---

## 1. Что понятно, что нет

Понятно и реализуемо почти дословно (оставляю без вопросов):

- §0, §2 «три сигнала лейбла» — хорошее объяснение ролей счёта / строки лейбла / каталога; я понял, что слой
  `label-of-record.ts` остаётся как есть и решает только саблейбл-правило и «наше / label_unmapped».
- §5 «что не меняется» в части слоёв `MASTER_LAYERS`, 12 знаков, «строка или участие», одной выплаты кнопкой —
  совпадает с `CLAUDE.md` и D-168.
- Шаги 1, 2, 3, 6, 7, 9 честно отнесены к D-171/D-172/«позже»: для D-169 они не нужны.
- Таблица §6: состав D-169 перечислен одной строкой (8 пунктов), остальные этапы отделены.

Непонятно (таблица). «Место» — раздел/шаг черновика; «вопрос» — то, что я спросил бы автору, не имея права угадать.

| # | Место в черновике | Что непонятно / где надо угадывать | Какой вопрос |
|---|---|---|---|
| 1 | Шаг 4 «файл грузится под лейблом» | На уровне HTTP лейбл не определён. `POST /sources/believe` — multipart (`api/upload.ts`, busboy), тело не JSON; `?label=` в D-168 закреплён только за чтениями, `labelId` в теле — за JSON-записями; заголовка нет (D-168 «no X-Label header»). B17-маршрут уже читает текстовое поле multipart (`up.fields['generatedAt']`). | Лейбл передаётся полем multipart `labelId` (как `generatedAt`), query `?label=` или иначе? Обязателен ли он? |
| 2 | Шаг 4 «отказ `account_not_of_label` … (если он ничей) или отказ (если он чужой)» | Два разных случая (счёт не зарегистрирован / зарегистрирован за другим лейблом), один код. Не сказан HTTP-статус (400 `ValidationError`, 409 `ConflictError`, 422 `RuleViolationError` — все три есть в `shared/errors.ts`), не сказано, что в `details` (счёт? лейбл счёта?), не сказано, что такое «с предложением зарегистрировать» на уровне API и UI. | Один код или два (`account_unregistered` / `account_not_of_label`)? Статус? Что в `details`? «Предложение» — это диалог на P19 «зарегистрировать счёт N за лейблом L» → `POST /labels/:id/accounts` → повтор загрузки? Русская фраза для `i18n/ru/errors.ts`? |
| 3 | Шаг 4 «`source_files.label_id` … и `uploaded_by`» | `uploaded_by` **уже есть** (миграция 0001, `NOT NULL DEFAULT 'operator'`), но маршрут не передаёт оператора: `facade.ingestBelieve({ path, fileName })` без `uploadedBy`, loader пишет `'operator'`. Для `label_id`: таблица `public.source_files` (не схема модуля), `NULL` или `NOT NULL`? | Входит ли в D-169 проброс `res.locals.operator` в `uploadedBy` (и для B17)? `label_id` допускает `NULL` (загрузка скриптом `scripts/load-believe.ts`, тесты, e2e-сид) и что тогда значит `NULL` для денег? |
| 4 | Шаг 4 «неизменяемая» + вопрос «счёт может перейти…» + Шаг 5 «источник истины остаётся реестр файлов» | Сегодня у расчёта **две** правды о лейбле счёта: живой реестр `labels.label_accounts` (`labels.index().labelOfAccount`, используется сигналом `labelOutsideAccount`) и предлагаемая заморозка `source_files.label_id`. Если счёт зарегистрируют после загрузки (путь «ничей → зарегистрировать»), у файла останется `NULL`. | Чем определяется книга юнита, когда `source_files.label_id` ≠ `label_accounts` (или `NULL`)? Дозаполняется ли `label_id` у ранее загруженных файлов при регистрации счёта — кем (скрипт, `POST /labels/:id/accounts`)? |
| 5 | Шаг 4 (ответ API) | `sourceFileSchema` (`packages/shared/src/api-responses.ts`) и P19 не упомянуты. | Добавляется ли `labelId` в ответ `/sources/files` и колонка «Лейбл» на P19? |
| 6 | Шаг 5 `believe.rows.label_id`, «фильтр `label_id IN` вместо списков `file_id`» | §6 относит к D-169 только `source_files.label_id`; §2 пишет «Файл Believe, строки ClickHouse». Колонка в ClickHouse = миграция `clickhouse/0004`, запись в loader, stage-таблица `AS believe.rows`, проекция `units_by_label`, обратное заполнение партиций мутацией. Фильтр `label_id IN` противоречит правилу «сначала `loaded` файлы из реестра, потом `file_id IN`» (`CLAUDE.md`, `sources/CLAUDE.md`). | Колонка в ClickHouse входит в D-169 или нет? Если да — остаётся ли `file_id IN` обязательным (я считаю, что да), и зачем тогда колонка кроме BI? |
| 7 | §2 «Юнит (деньги мастера) \| лейбл файла \| R6» | Не названо поле. Сегодня книга = `u.ourLabelId` (`balance.ts` 324, 774; `IncomeItem.labelId` 353), а `ourLabelId` ставит слой 1 из строки лейбла и он же нужен саблейбл-правилу. Нужно второе поле (`UnitResult.bookLabelId`?). Не сказано, какие из потребителей переходят на него: `balance.byLabel`, recoup (`IncomeItem.labelId`, `Position.labelId`), `reconcile().byLabel` и `ourShareByLabel`, `overview.totals.byLabel`, `labelVisibility`, `SnapshotFilter.labelStrings` → `accounts`, `facade/ads.ts` (стр. 68), сигналы. | Какое поле, откуда берётся (живой реестр или `source_files.label_id`), и точный список мест, которые переходят на книгу по счёту, против мест, которые остаются по строке лейбла? |
| 8 | §2 / R6 | Юнит счёта, который не зарегистрирован ни за кем (в тестах `1052428` по умолчанию не зарегистрирован: `fixtures.ts` `believeFileName`, `newFacade` счета не заводит). | Книга такого юнита — `'?'` («без лейбла», как сегодня у паблишинга), или такой файл теперь невозможно загрузить? |
| 9 | §6 «реклама по плательщику», §2 «Реклама \| `label_id` = плательщик \| D-169» | Слова «плательщик» нет ни в модуле `ads`, ни в D-168. Сегодня (D-168, `facade/ads.ts` 65–68): с ISRC — лейбл строки лейбла юнита в месяце, сохранённый `label_id` — запасной; без ISRC — сохранённый. 2 653 записи с ISRC сохранённого лейбла не имеют. | Что такое плательщик: лейбл счёта файла той строки (R6), или сохранённый `label_id` «кто оплатил счёт»? Если второе — правило заполнения для существующих записей с ISRC? |
| 10 | §4 «Проверка: Σ книг = полный баланс … один псевдоним под 0to8 = −1 091,77» | Σ книг = total верно для **любого** ключа разбиения (это конструкция `balance.ts`, D-168), R6 оно не проверяет. Единственное число — один псевдоним из разбора вне репозитория (`context_data/разбор_01/`, git-ignored). Нет: сколько владельцев меняют книги, какая сумма переезжает (строка «Echo8» в счёте 1052428: 222 130 net; «наше 0to8 +131 848» по `разделение_по_лейблу/README.md`:374), сколько у Echo8 остаётся. | Какие числа `check-label-books.ts` (или нового скрипта) считаются приёмкой после R6: владельцев с изменившимися книгами ???, Σ earned, переехавшая из книги Echo8 в книгу 0to8 ???, строк сверки ???. |
| 11 | Шаг 10 «выписка грузится под лейблом: `pub_statements.label_id`» | Транспорт — как в #1. Обязателен ли. Существующие 7 выписок → 0to8: SQL в миграции (в чистой базе тестов/e2e лейбла 0to8 с таким id нет) или скрипт по имени `'0to8'` (как `assign-operation-labels.ts`)? Ответ владельца на Q8 (`разделение_по_лейблу/README.md`:379) в D-168 помечен «Open». | Q8 решён («весь 0to8»)? Если да — где это записано? Скрипт или миграция? Что делать, если лейбла 0to8 нет? |
| 12 | Шаг 10 «строки наследуют; книга «без лейбла» исчезает» | Строки B17 в расчёт идут **сгруппированными** материализованным представлением `publishing.pub_lines_by_key` (миграция 0013, D-164) по ключу период × автор × соавторы × произведение × вид операции — **без `statement_id`**. Лейбл выписки не доедет до `AggregatedLine`, пока ключ группировки не включит лейбл (новая миграция, пересоздание MV; 0013 править нельзя). Дальше: `PublishingResult.labelId`, `balance.ts` 399 (`labelId: null` → лейбл выписки), `labelVisibility` (владельцы с паблишингом под L), `scope.ts` (`publishingLines: false` под лейблом → читать выписки L), выплата под L начинает платить паблишинг. | Подтверждаете цепочку: MV с `label_id` в ключе → `AggregatedLine.labelId` → `PublishingResult.labelId` → книга? Под `?label=` строки B17 этого лейбла теперь читаются (D-168 говорил «Все only»)? Сколько владельцев и какая сумма к выплате под 0to8 прирастёт (B паблишинга 682 348 по Q8)? |
| 13 | Шаг 10 (неявно) | `pub_statement_periods PRIMARY KEY (source, period)`: один квартал на источник. Два лейбла не смогут загрузить один квартал. | Пока намеренно (B17 только 0to8)? Запишем как ограничение D-169, ключ не меняем? |
| 14 | §6 «`documents.label_id` + ворота выплаты по договору лейбла» vs Шаг 8 «Вопросы: … D-168 пока проверяет «любой договор»» | В §6 это решение, в шаге 8 — вопрос. Какая таблица: `owners.documents.label_id` или `owners.contracts`? Подтверждение владельца = договор с утверждённым документом (`owners.confirmedOwnerIds()`), и оно используется **дважды**: воротами выплаты (`payouts.ts`, `owner_not_confirmed`) и слоем категоризации (`layers/categorise.ts`, причина C `owner_unconfirmed`) — т. е. меняет деньги B→C, не только кнопку. | Ворота по лейблу входят в D-169? Только кнопка или и категория C? Если `confirmedOwners` становится по лейблу — сколько владельцев и какая сумма уходят из B в C под Echo8 (D-133: 320 636,21 счёта 1055956 без документа сплита; получатели B17 без договора)? |
| 15 | §4 «Документы: `label_id` = 0to8, кроме четырёх договоров Echo8 из архива» | Четыре договора определены в разборе владельца вне репозитория. Без ключей (id документа / маркер в note) скрипт их не найдёт; имена в бриф нельзя (D-090). | По какому признаку скрипт отличает эти четыре (список id в локальном JSON `data/mvp-load/…`, маркер `mvp:` в note, kind + owner)? |
| 16 | §3 «`audit.actions.label_id` (лейбл контекста запроса: `?label=` / `labelId` тела)» | Хук `api/audit.ts` берёт id только из `req.body` (список `BODY_ID_FIELDS`, там уже есть `labelId`) и `req.params`; query не читает; у multipart `req.body` пуст. Отдельной колонки нет (схема `audit`, миграция 0011). | Правило в порядке: `labelId` тела → поле multipart → `?label=`? Показывать ли в `AuditTable` (вкладки «история» P6/P10)? Миграция `0015` в схеме `audit`? |
| 17 | §3 «`created_by` там, где его сегодня нет (документы, сплиты, лейблы)» vs §6 D-172 «`created_by` везде» | Один и тот же пункт в двух этапах. | В D-169 или D-172? |
| 18 | §4 «семь операций Echo8 пересмотреть по плательщику» | D-168 уже разметил 7 операций Echo8 по правилу одного лейбла. «Пересмотреть» — действие кода, ручной `PATCH /settlements/operations/:id` владельцем или ничего? «Плательщик» операции не определён (см. #9). | Что именно сделать с этими семью: ничего в коде, список в отчёт, или новый скрипт с правилом ???. |
| 19 | §6 D-169 «миграция текущих данных» | Нет ни имён скриптов, ни ожидаемых чисел: сколько файлов Believe получат лейбл (в D-168 чисел по файлам нет; я их не знаю), 7 выписок, документов ???, порядок (сначала регистрация счетов — в чистой базе их нет; D-168: счета «registered locally»). | Один скрипт `assign-file-labels.ts` (dry-run/`--apply`, как `assign-operation-labels.ts`) или SQL в миграции? Ожидаемые счётчики для `--apply` и для повторного dry-run (`already_done`)? |
| 20 | §6 «фильтр по лейблу файла» | Под `?label=` сегодня юниты режутся `SnapshotFilter.labelStrings` (`label_name IN`), а `SnapshotFilter.accounts` уже существует (D-161). Что становится «областью лейбла»: счета лейбла (`labels.getLabel().accounts`) или файлы с `label_id` (`file_id IN`)? Для `labelIsrcs` нужен новый метод `sources` (есть только `isrcsOfLabelStrings`). | Область под лейблом = `accounts` лейбла из реестра или `file_id` с `label_id = L`? Нужен ли `sources.isrcsOfAccounts`/`isrcsOfFiles`? |
| 21 | §6 оценка «2–3 дня» на 8 пунктов | Порядок не задан; пункты зависят: книга по счёту требует зарегистрированных счетов, B17 требует MV, ворота требуют миграции документов. Не сказано, один коммит или по пункту. | Порядок и границы коммитов (ниже предлагаю свой в шаблоне). |
| 22 | §7 «Мастер онбординга… чек-лист на P1» | Нет этапа. | Отложено до D-171? |
| 23 | Шаг 2 «Лейбл это арендатор», §7 «книга сейчас, арендатор после ролей» | Отказ при загрузке (шаг 4) — поведение арендатора уже сейчас. | Для D-169 единственное «арендаторское» правило — отказ по счёту при загрузке? Чтения под «Все» остаются? |
| 24 | §4 «Файлы: label_id по счёту (1052428 → 0to8, 1055956 → Echo8)» | В чистой базе (тесты, e2e, новый стенд) счета не зарегистрированы: миграция SQL сделать это не может без id. | Регистрация счетов — часть сида e2e (`scripts/e2e/lib.ts`) и `fixtures.ts newFacade`, или остаётся локальным ручным шагом? |
| 25 | Тесты (нигде) | Ни одного имени теста/кейса. Golden-мир `tests/scope.test.ts` «the label as a book (D-168)» различает книги **строками лейбла** на одном счёте — при R6 он поедет; `Case.verify()` в `golden.test.ts` (G50) тоже. | Какие `it(...)` должны существовать после D-169 и какие старые переписываются (а не «чинятся» подгонкой чисел)? |

---

## 2. Противоречия

Внутри черновика и с действующими документами. Нумерую П1…П12.

- **П1. R6 против D-168, решение 1.** D-168 (статус accepted, решения владельца 2026-11-05): «The label is the own label;
  **the label of money is the unit's label string** … no transfer by ISRC or by account. `calculate()` and the layers are
  unchanged». Черновик §0/§2: «книга денег = счёт-получатель Believe» (R6, тоже 05.11). Это отмена первого пункта
  D-168, а не уточнение. По правилам репозитория D-169 обязан явно написать «refines D-168 (decision 1, visibility,
  `labelStrings`)» и получить строку «*refined by* D-169» в индексе. Черновик этого не говорит, а §0 пишет
  «математика … решена и не меняется».
- **П2. §5 «что не меняется» неверно для фасада.** `calculate()` действительно не меняется в слоях, но книга по счёту
  трогает `balance.ts` (ключ книг, `IncomeItem.labelId`), `layers/recoup.ts` (косвенно, через `labelId` позиций и
  доходов), `label-scope.ts` (видимость и область), `scope.ts`, `reports.ts` (`byLabel` сверки, `totals.byLabel` P1),
  `ads.ts`, golden-кейс G50 и мир `scope.test.ts`. Слои остаются, фасад — нет.
- **П3. Шаг 5 против §6 против §2 про ClickHouse.** Шаг 5 рекомендует `believe.rows.label_id` и фильтр
  `label_id IN`; §6 в D-169 кладёт только `source_files.label_id`; §2 пишет «Файл Believe, строки ClickHouse». А
  `label_id IN` без `file_id IN` противоречит правилу «a file that is not loaded never counts» (`CLAUDE.md`,
  `sources/CLAUDE.md`).
- **П4. «Неизменяемая денормализация» против «истина в реестре» против живого `label_accounts`.** Шаг 4: `source_files.label_id`
  неизменяем; шаг 5: источник истины — реестр файлов; код сегодня: `calc.labelOfAccount` = живой `labels.label_accounts`
  (сигнал `labelOutsideAccount`). Три кандидата на одну правду, черновик не выбирает.
- **П5. Ворота по договору лейбла.** §6 относит к D-169 «`documents.label_id` + ворота выплаты по договору лейбла»;
  шаг 8 ставит это вопросом и добавляет «история без лейбла = любой»; §4 размечает **все** документы 0to8 кроме четырёх,
  после чего `NULL` не остаётся и правило «любой» никогда не срабатывает, а под Echo8 закрываются ворота всем, кроме
  владельцев четырёх договоров. И `confirmedOwners` стоит не только в воротах, но и в слое категоризации
  (`owner_unconfirmed` → C): деньги меняют категорию, чего §5 не допускает.
- **П6. Реклама.** D-168: лейбл записи с ISRC = лейбл строки лейбла юнита в месяце, сохранённый — запасной; §2 черновика:
  «`label_id` = плательщик, D-169»; §4: «Операции, реклама: 0to8 (решение 05.11)» — но решение 05.11 в D-168 касалось
  операций, а у записей с ISRC сохранённого лейбла нет и по D-168 он не нужен. Термин «плательщик» не определён.
- **П7. B17.** D-168: «Open (for the product owner): publishing … until Q8 of the analysis is answered»; черновик §4 «B17:
  `label_id` = 0to8» и шаг 10 «книга «без лейбла» исчезает» как решённое, при статусе черновика «идея, не решение».
  Также D-168: «the B17 lines are not read under a label («Все» only)» — черновик меняет это молча.
- **П8. `created_by`.** Шаг 1: через аудит, как сегодня (ничего не делать); §3: колонка там, где нет (документы, сплиты,
  лейблы); §6: D-172 «`created_by` везде». Три версии.
- **П9. Арендатор или книга.** Шаг 2 «лейбл это арендатор: всё создаётся под лейблом», §7 «книга сейчас, арендатор после
  ролей». Для D-169 отказ по счёту при загрузке — единственный арендаторский элемент; остальные чтения остаются с «Все».
  Надо сказать прямо.
- **П10. Правило «ISRC у одного лейбла в момент времени».** §2 «Релиз, трек каталога … ISRC один в момент времени», §7
  «ломается только у Believe (чужая строка в счёте)». Для D-169 это не мешает (каталог — D-171), но таблица §2 подаёт как
  инвариант то, что данные уже нарушают (Echo8 в 1052428 за 8 месяцев).
- **П11. Критерий приёмки §4** «Σ книг = полный баланс» — тождество любого разбиения (так устроен `balance.ts`, D-168), оно
  не отличает «по строке лейбла» от «по счёту». Приёмка R6 — это разность книг до/после на реальных данных.
- **П12. Транспорт лейбла у загрузок** не покрыт ни D-168 (reads `?label=`, writes `labelId` в JSON-теле), ни черновиком;
  хук аудита (§3) предполагает, что лейбл «в теле», которого у multipart нет.

Не противоречие, но ловушка: `CLAUDE.md` и D-168 говорят «A loaded file is never refused» (про строки лейбла). Отказ по
**счёту** с этим совместим, но бриф должен сказать, что сигнал `labelOutsideAccount` остаётся и строки чужого лейбла
внутри своего счёта по-прежнему грузятся.

---

## 3. Где я начал бы для (a), (b), (c) и чего не нашёл

Пути под `packages/backend/` если не сказано иначе.

### (a) «Файл Believe грузится под лейблом и отвергается, если его счёт не зарегистрирован за этим лейблом»

Начал бы с маршрута и шёл вниз:

1. `src/api/routes/sources.ts`, `r.post('/sources/believe')`: `receiveUpload(req, tmpDir)` отдаёт `up.fields` — текстовые
   поля multipart (B17-маршрут так берёт `generatedAt`). Сюда же **прокинуть оператора**: `uploadedBy: res.locals.operator`
   (сейчас не передаётся, loader пишет `'operator'`; хук `api/audit.ts` кладёт оператора в `res.locals`).
2. `src/facade/sources.ts`, `ingestBelieve` — сегодня чистый проброс в `sources.ingestBelieve`. Проверка — здесь, потому
   что модуль `sources` не может открыть `labels` (`tests/boundaries.test.ts`). Счёт берётся из имени файла:
   `parseBelieveFileName` экспортирован из `modules/sources/index.ts`, так что фасад может разобрать имя до загрузки.
   Лейбл: `ctx.assertOwnLabel(labelId)` (404 / 400 `label_not_own`, как у операций, `facade/context.ts` 147). Счёт:
   `labels.index().labelOfAccount(account)` или `labels.listAccounts()`. Отказ: `RuleViolationError(msg, code, details)` (422)
   — но код/статус см. вопрос #2.
3. `src/modules/sources/loader.ts` `load()` → `registry.insertLoading({... labelId })` и `uploadedBy`;
   `src/modules/sources/registry.ts`: `SourceFileRecord.labelId`, `NewSourceFile.labelId`, строка `COLUMNS`, `Row`,
   `record()`, `INSERT`.
4. Миграция: `migrations/postgres/0015_<имя>.sql` на `public.source_files` (`ADD COLUMN IF NOT EXISTS label_id text`,
   индекс). Drizzle-схемы у `sources` нет (D-102/D-110) — менять только SQL и `registry.ts`.
5. Контракт: `packages/shared/src/api-responses.ts` `sourceFileSchema` (+ `labelId`), `src/api/operations.ts` запись
   `/sources/believe` (поле `errors`: новые коды), `tests/api-contract.test.ts` — сценарий грузит файл **после**
   `POST /labels/:id/accounts` на счёт `1052428` для лейбла `own`, созданного в сценарии (стр. 206), а `newFacade`
   сидит 0to8/Echo8 без счетов: сценарий придётся переписать под лейбл загрузки.
6. Тесты поведения: `tests/sources-service.test.ts` или `tests/facade.test.ts` (отказ, успех, `NULL`-случай);
   `tests/helpers/fixtures.ts` (`believeFileName` даёт счёт `1052428` по умолчанию, `newFacade` счета **не регистрирует**) —
   если лейбл обязателен, ломаются 15 вызывающих (`tests/*.test.ts`, `helpers/golden-case.ts`, `scripts/e2e/lib.ts`
   `this.f.ingestBelieve(file)`, `scripts/load-believe.ts`).
7. Фронт: `packages/frontend/src/api/client.ts` `sources.uploadBelieve(file)` → `fileForm(file)` плюс поле `labelId` из
   `useLabel()`; `pages/reference/sources/SourcesPage.tsx` `UploadForm` (под «Все» — отключить с подсказкой «выберите
   лейбл», как кнопка выплаты); `i18n/ru/errors.ts` — фраза для нового кода; e2e `e2e/golden/30-sources.spec.ts`,
   `35-label-switch.spec.ts`; `api/coverage.ts` без изменений (маршрут тот же).
8. `src/modules/labels/service.ts`: `addAccount`, `listAccounts`, `index().labelOfAccount` уже есть — новых методов не нужно,
   если «предложить зарегистрировать» делается на фронте через существующий `POST /labels/:id/accounts`.

Не нашёл: ни одного места, где счёт проверяется при загрузке (по D-168 так и задумано: «A loaded file is never refused»);
проброса оператора в `uploaded_by`; формы передачи лейбла в multipart; русской строки ошибки; ответа на вопрос, что
делать 15 существующим вызовам без лейбла.

### (b) «Книга денег юнита = лейбл счёта его файла»

1. `src/facade/calculation.ts`: `UnitResult.ourLabelId` берётся из `state.ourLabelId`, который ставит слой 1
   (`layers/label-of-record.ts`) по строке лейбла. В `Calculation` уже есть `labelOfAccount(account)` (из
   `labels.index()`), его использует только сигнал в `reports.ts` 167. Начал бы с нового поля юнита
   (`bookLabelId = labelOfAccount(u.account) ?? null`, стр. ~226) — или, если истина `source_files.label_id`, то
   `SourceUnit.labelId` из `sources.snapshot()` (там уже есть карта `accountOf` по `file_id`, стр. 160 `service.ts`).
2. `src/facade/balance.ts`: ключ книги `keyOf(u.ourLabelId)` (324 владелец, 774 псевдоним) и `IncomeItem.labelId:
   u.ourLabelId` (353) — заменить на поле книги. `layers/recoup.ts` не трогать (он читает `labelId` позиций/доходов).
3. `src/facade/label-scope.ts`: `labelBook` = строки лейбла алиасов → при R6 книга = счета лейбла
   (`labels.getLabel(id).accounts`), область чтения — `SnapshotFilter.accounts` (существует, D-161) вместо `labelStrings`;
   `labelIsrcs` — нужен метод `sources` по счетам/файлам (сегодня есть только `isrcsOfLabelStrings`);
   `labelVisibility` по форме не меняется. `src/facade/context.ts` `labelContext` / `viewOf` — без изменений.
4. `src/facade/reports.ts`: сверка `byLabel` (384–428, ключ `ourLabelName`) и `totals.byLabel` P1 — решить, по книге или
   по лейблу записи (вопрос #7); сигнал `labelOutsideAccount` остаётся как есть.
5. `src/facade/ads.ts` 65–68: `ourLabelId` из строки лейбла → ? (вопрос #9).
6. `src/facade/layers/label-of-record.ts` — **не менять**: черновик подтверждает, что строка лейбла решает саблейбл и
   «наше / `label_unmapped`».
7. Тесты: `tests/scope.test.ts` describe «the label as a book (D-168)» (4 `it`, 508–612) — мир различает книги строками
   лейбла; `tests/golden.test.ts` G50 + `Case.verify()`; `tests/helpers/golden-case.ts` (`testLabels`, без счетов);
   `scripts/check-label-books.ts` на реальных данных.

Не нашёл: поля книги у `UnitResult`/`SourceUnit`; чтения ISRC по счёту в `sources`; D-записи, которая разрешает книгу ≠
лейблу записи (D-168 запрещает); ожидаемых чисел.

### (c) «Выписка B17 несёт лейбл»

1. `src/modules/publishing/schema.ts` `pubStatements` + `migrations/postgres/0015_*.sql` (схема `publishing`:
   `ALTER TABLE publishing.pub_statements ADD COLUMN IF NOT EXISTS label_id text`); оба места (рецепт 3).
2. `src/modules/publishing/repository.ts`: `insertStatement` (65) берёт `$inferInsert` — поле появится само после схемы;
   `getStatement`/`listStatements` (115, 118).
3. `src/modules/publishing/service.ts`: `ingestB17(input)` (67) + `labelId`; `view()` (35) и `StatementView`;
   `activeStatements` (211) — снимок выплаты уже хранит хеши выписок.
4. `src/facade/sources.ts` `ingestB17`: `ctx.assertOwnLabel(labelId)` до `publishing.ingestB17`.
5. `src/api/routes/publishing.ts`: `up.fields['labelId']` рядом с `generatedAt`; `operations.ts` запись `/publishing/b17`
   (`errors`); `packages/shared/src/api-responses.ts` `statementSchema` (+ `labelId`); `tests/api-contract.test.ts` (245);
   `scripts/mvp/load-b17.ts` — аргумент лейбла.
6. Деньги: `publishing.pub_lines_by_key` (миграция 0013) группирует строки **без** `statement_id` → новая миграция,
   пересоздающая MV с `label_id` в ключе (0013 не править), `AggregatedLine.labelId`; `calculation.ts` (~250,
   `pubData.lines.flatMap`) → `PublishingResult.labelId`; `balance.ts` 399 `labelId: null` → лейбл; `label-scope.ts`
   `labelVisibility` + владельцы с паблишингом под L; `scope.ts` (`publishingLines: false` под лейблом) → читать выписки
   L; `reports.ts` сверка `b17` строки `byLabel`.
7. Фронт: `client.ts` `publishing.uploadB17(file)` + `labelId`; P19; P10/P12 книги уже именованы API.
8. Миграция 7 выписок → 0to8: скрипт по образцу `scripts/assign-operation-labels.ts` (ищет own-лейбл по имени `'0to8'`,
   dry-run / `--apply`, без строки аудита) — черновик не говорит.

Не нашёл: `labelId` где-либо в `publishing`; ответа владельца на Q8; решения по PK `(source, period)`; имён тестов;
чисел по владельцам.

### Как добавляется маршрут и пишется D-запись (проверил, чтобы шаблон был точным)

- Маршрут: zod-схемы в `packages/shared/src/api-schemas.ts` / `api-responses.ts` → метод фасада → роутер →
  запись в `src/api/operations.ts` (`method, path, tag, summary, body|query|upload, status, response, errors`) → вызов в
  сценарии `tests/api-contract.test.ts` (`call()` падает, если операции нет в контракте; тест «the scenario touched every
  operation» падает, если операция не вызвана; `expectOneAuditRow` на каждую запись) → функция в
  `packages/frontend/src/api/client.ts` → ключ в `packages/frontend/src/api/coverage.ts` (страница + маршрут или
  `refusal`). D-169 нового маршрута не добавляет (если не делать «зарегистрировать и повторить» отдельной операцией), но
  меняет ответы (`sourceFileSchema`, `statementSchema`) и списки `errors`.
- D-запись (`docs/97_принятые_решения.md`, образец D-167/D-168): `## D-169: <заголовок>` / `- Date:` / `- Question:` /
  `- Decision:` (маркеры, **жирным** правило) / `- Checked:` (имена тестов + реальные данные с числами) /
  `- Consequences:` / `- Open (for the product owner):` / `- References:` / `- Status:`. Индекс
  `docs/agents/03_decision_index.md`: одна строка `- D-169 … · in force` после D-168 (стр. 154) и пометка
  «*refined by* D-169» на строке D-168 (а если книга по счёту — и на D-123/D-130, где уже стоит «refined by D-168»).
  Плюс по D-120 — обновить `facade/CLAUDE.md` (абзац «The label as a book»), `sources/CLAUDE.md`, `frontend/CLAUDE.md`
  (P19, «The label view»), `01_big_picture.md` §5.

---

## 4. Шаблон брифа D-169, заполненный тем, что есть в черновике (`???` = черновик не говорит)

```markdown
# Бриф D-169: книга по счёту, загрузка под лейблом, B17 под лейблом

Дата: ???. Статус: решение владельца продукта от ??? (ссылка: context_data/разбор_01/…, без имён).
Уточняет: D-168 (решение 1 «label of money = label string», видимость по строкам, «B17 только в «Все»»),
D-123, D-130 (byLabel). Не трогает: D-051, D-126, D-127/D-130 (12 знаков), D-161…D-165 (scope / reach).

## 1. Цель (одно предложение)
Каждый доллар мастера лежит в книге лейбла, за которым зарегистрирован счёт Believe файла; файл и выписка
грузятся под лейблом и помнят его; выплата под лейблом платит и паблишинг этого лейбла.
Сделано, когда: все критерии §10 выполнены и числа §8 совпали.

## 2. Правила в силе (формулировки, которые войдут в D-запись)
R6. Книга юнита = own-лейбл, за которым зарегистрирован счёт файла юнита
    (источник: ??? — `labels.label_accounts` живой / `source_files.label_id` замороженный;
    при расхождении побеждает ???; незарегистрированный счёт → книга `'?'` / отказ ???).
R6a. Строка лейбла юнита по-прежнему решает саблейбл-правило и «наше / label_unmapped»
     (`layers/label-of-record.ts` без изменений). Сигнал `labelOutsideAccount` остаётся.
R7. Файл Believe грузится под own-лейблом; счёт из имени файла обязан быть зарегистрирован за ним.
    Без лейбла: ??? (запрещено / разрешено для скриптов с label_id NULL).
R8. Выписка B17 грузится под own-лейблом; её строки попадают в книгу этого лейбла; книга «без лейбла»
    для паблишинга исчезает (ответ владельца на Q8: ???). Один квартал на источник (PK не меняется): да/нет ???.
R9. Реклама: лейбл записи = ??? («плательщик» определить: сохранённый label_id / лейбл счёта строки).
R10. Ворота выплаты под L требуют договор с L: входит в D-169 ??? (да/нет); категория C owner_unconfirmed
     тоже по лейблу ??? (да/нет); документ без лейбла = «любой» ??? (да/нет).
R11. Аудит: label_id записи = labelId тела → поле multipart labelId → ?label= (порядок ???).

## 3. Термины
книга (book) · лейбл записи (label of record, слой 1) · лейбл файла (`source_files.label_id`) ·
счёт (Believe account, из имени файла) · «?» = без лейбла · own-лейбл / саблейбл (D-125).

## 4. Модель данных (точные имена)
| Таблица / тип | Поле | Тип, NULL | Миграция | Drizzle / TS |
|---|---|---|---|---|
| `public.source_files` | `label_id` | text, NULL = ??? | `migrations/postgres/0015_source_file_label.sql` (имя ???) | `registry.ts`: `SourceFileRecord.labelId`, `NewSourceFile.labelId`, `COLUMNS`, `Row`, `record()`, INSERT |
| `public.source_files` | `uploaded_by` | есть; заполнять из `res.locals.operator` | — | `routes/sources.ts`, `routes/publishing.ts` |
| `publishing.pub_statements` | `label_id` | text, NULL = ??? | `0015`/`0016_pub_statement_label.sql` ??? | `schema.ts pubStatements`, `StatementView.labelId` |
| `publishing.pub_lines_by_key` (MV) | `label_id` в ключе | — | новая миграция, DROP + CREATE MV (0013 не править) | `AggregatedLine.labelId` |
| `owners.documents` или `owners.contracts` ??? | `label_id` | text, NULL = «любой» ??? | ??? | ??? |
| `audit.actions` | `label_id` | text, NULL | `00xx_audit_label.sql` ??? | `modules/audit/schema.ts`, `RecordActionInput.labelId` |
| `ads.expenses.label_id` | есть (D-168) | правило заполнения для записей с ISRC: ??? | — | `facade/ads.ts` |
| ClickHouse `believe.rows.label_id` | в D-169: ??? (нет, если истина — реестр) | | `clickhouse/0004` ??? | `loader.ts`, `columnar.ts` |
| `SourceUnit` / `UnitResult` | `labelId` / `bookLabelId` ??? (имя) | string \| null | — | `sources/service.ts snapshot()`, `facade/calculation.ts` |
| `PublishingResult` | `labelId` | string \| null | — | `facade/calculation.ts` |
| `IncomeItem.labelId` | источник: книга юнита (не `ourLabelId`) | | — | `facade/balance.ts` 353, 399 |

## 5. API (по операциям)
- `POST /sources/believe` (multipart): поле `labelId` ??? / `?label=` ???; порядок проверок:
  1) `X-Operator` (400 `operator_required`), 2) лейбл есть (400 `label_required` ??? если обязателен),
  3) лейбл own (404 / 400 `label_not_own`), 4) имя файла (400), 5) счёт зарегистрирован за лейблом —
  иначе ??? `account_unregistered` (???: 422) / `account_not_of_label` (???: 422, details `{ account, labelId,
  accountLabelId }` ???), 6) `duplicate_period` / `duplicate_file` 409 как сегодня.
  Ответ `sourceFileSchema` + `labelId`. `operations.ts`: обновить `errors`. `coverage.ts`: без изменений.
- `POST /publishing/b17`: те же шаги 1–3, поле `labelId`; ответ `statementSchema` + `labelId`.
- `GET /sources/files`: `believe[].labelId`, `b17[].labelId`.
- Чтения под `?label=` (список D-168): область = ??? (`accounts` лейбла / `file_id` с `label_id`); строки B17
  лейбла читаются под лейблом: да ???.
- `GET /owners/:id/balance`, `/artists/:id/balance`: ключ книг = книга юнита (R6); книга `'?'` остаётся для
  ??? (незарегистрированный счёт / операции без лейбла).
- `GET /overview`, `/reconciliation`: `byLabel` строки = по книге ??? / по лейблу записи ???.
- Русские фразы в `packages/frontend/src/i18n/ru/errors.ts` для каждого нового кода: ???.

## 6. Расчёт (фасад) — что меняется, что нет
Меняется: `calculation.ts` (поле книги), `balance.ts` (ключ книг, доходы), `label-scope.ts` (`labelBook`,
`labelIsrcs`, `labelVisibility` + паблишинг), `scope.ts` (B17 под лейблом), `reports.ts` (`byLabel` ???),
`ads.ts` (???), `payouts.ts` (ворота ???). Не меняется: `layers/*`, `MASTER_LAYERS`, `recoup.ts`, `ownerReach`
(паблишинг читается целиком — reach не расширять; `tests/scope.test.ts` это закрепляет).
Инварианты: Σ книг (с `'?'`) = total по каждому полю; A = B + C + наше по счёту и месяцу, discrepancy 0;
balance-by-reach = full; scoped = full.

## 7. UI
P19: загрузка Believe/B17 под текущим лейблом (`useLabel()`); под «Все» кнопка отключена с подсказкой
«выберите лейбл» (как `action-pay`); при `account_not_of_label`/`account_unregistered` — ??? (тост / диалог
«зарегистрировать счёт N за L» → `POST /labels/:id/accounts` → повтор). Колонка «Лейбл» в списке файлов: ???.
P1/P10/P12: имена книг те же, семантика «по счёту» — подпись/подсказка ???. P17: без изменений.
Хуки для e2e: `field-upload-believe`, `upload-believe-label` ???, `source-file-<id> [data-label-id]` ???.

## 8. Миграция существующих данных (скрипт, dry-run по умолчанию, идемпотентно)
`scripts/assign-source-labels.ts` ??? (имя) `[dataDir] [--apply]`, по образцу `assign-operation-labels.ts`:
- счета: 1052428 → 0to8, 1055956 → Echo8 (если не зарегистрированы — регистрирует ??? / падает ???);
- файлы Believe: `label_id` по счёту; ожидаемо: файлов всего ???, 0to8 ???, Echo8 ???, без лейбла 0;
- выписки B17: 7 → 0to8 (Q8 = ???); 
- документы: все → 0to8 кроме четырёх Echo8, определяемых по ??? (ключ без имён); ожидаемо ??? / 4;
- операции: 7 операций Echo8 — действие ??? (ничего / список / правило);
- реклама: записи с ISRC — ???; 33 без ISRC — как D-168;
- повторный dry-run после `--apply`: только `already_done`.
Приёмка на реальных данных (`check-label-books.ts` до/после, `LOG_TIMINGS=1`):
- владельцев с изменившимися книгами: ???; Σ earned, переехавшая из книги Echo8 в 0to8: ??? (ожидание
  по разбору: строка «Echo8» в 1052428 за 2024-12…2025-07, 222 130 net; наше 0to8 +131 848 по разделению);
- payable под 0to8 у псевдонима из разбора владельца: −1 091,77 (число есть; псевдоним — в локальном разборе);
- строк сверки с Σ книг = строка: ??? (сегодня 54); расхождений 0; полный баланс каждого владельца без
  изменений (книга — проекция): да;
- после B17 под 0to8: владельцев, у которых payable под 0to8 вырос на паблишинг: ???, Σ: ??? (B 682 348 по Q8).

## 9. Тесты (имена)
Backend:
- `tests/sources-service.test.ts` (или `facade.test.ts`): `it('refuses a Believe file whose account is not
  registered under the label (account_not_of_label)')`, `it('refuses … unregistered account (???)')`,
  `it('stores label_id and uploaded_by of the upload')`, `it('??? a file without a label')`.
- `tests/scope.test.ts`, describe «the label as a book (D-169)»: мир с двумя счетами, зарегистрированными за
  0to8 и Echo8, и чужой строкой лейбла внутри счёта: `it('the book of a unit is the label of its account, the
  sublabel rule still follows the label string')`, `it('Σ books = total')`, `it('a view under a label = the book')`,
  `it('every read under a label is the full answer restricted to the accounts of the label')`,
  `it('B17 of a label sits in its book and is paid by the label payout')`.
- `tests/golden.test.ts`: G50 переписан под счета ???, новый G51 «чужая строка в своём счёте» с ручными числами
  (`docs/agents/12_golden_cases.md`) ???.
- `tests/api-contract.test.ts`: загрузка под лейблом после регистрации счёта; все операции вызваны.
- `tests/publishing-terms.test.ts` / новый `publishing-label.test.ts` ???: MV с лейблом в ключе.
- `tests/audit.test.ts`: `label_id` записи при `labelId` в теле, в multipart, в `?label=` ???.
- `tests/helpers/fixtures.ts newFacade`: регистрирует `1052428` → 0to8 (иначе 15 файлов тестов не грузятся) ???.
Frontend / e2e: `30-sources.spec.ts` (загрузка под лейблом, отказ, под «Все» отключено), `35-label-switch.spec.ts`
(книги по счёту), `26-payout.spec.ts` (выплата под лейблом платит паблишинг ???); сид `scripts/e2e/lib.ts`
регистрирует счета сценариев ???.
Реальные данные: `scripts/check-label-books.ts`, `scripts/check-owner-scope.ts`, новый `assign-source-labels.ts`.

## 10. Критерии готовности
`npm run typecheck`, `npm run lint`, `REQUIRE_STACK=1 npm test`, `npm run build:client`, `npm run e2e` (с локом)
зелёные; числа §8 совпали; D-169 в 97 + строка в индексе + «refined by» на D-168 (и D-123/D-130 ???);
обновлены `facade/CLAUDE.md`, `sources/CLAUDE.md`, `frontend/CLAUDE.md`, `01_big_picture.md` §5, `17_frontend_model`
(P19) ???, `12_golden_cases.md` (новый кейс); коммит по шагу §12.

## 11. Что не трогать
`layers/*` и `MASTER_LAYERS`; `exact.ts`; `recoup.ts`; `ownerReach`/`artistReach`; правило «строка или участие»;
`createPayout` как единственная выплата (D-051); `label-of-record.ts`; миграции 0001…0014 и `clickhouse/0001…0003`;
`context_data/`; решения ⚠ из индекса; имена из `data/real` (D-090) — в код, тесты, логи, доки не копировать.

## 12. Порядок шагов (и коммитов)
1. Миграция `source_files.label_id` + `registry.ts` + `uploaded_by` из оператора + `sourceFileSchema` (тесты
   без поведения) — коммит.
2. Загрузка под лейблом и отказ по счёту (фасад, маршрут, фронт P19, ошибки, contract-тест, fixtures/e2e-сид) — коммит.
3. Книга по счёту (`calculation`/`balance`/`label-scope`/`scope`/`reports`, golden, scope.test, `check-label-books`) — коммит.
4. B17 под лейблом (миграция + MV, сервис, фасад, маршрут, `load-b17.ts`, фронт, тесты) — коммит.
5. ??? ворота по договору лейбла (если входит) — коммит.
6. `audit.label_id` — коммит.
7. Скрипт миграции данных, прогон на `data/real`, числа в D-запись — коммит с D-169 и индексом.

## 13. D-запись (заготовка)
## D-169: The book of a unit is the label of its file's account (R6); Believe files and B17 statements are
loaded under a label; ??? (documents / gate / audit)
- Date: ???  - Question: (факты D-168 + R6 владельца от 05.11, ссылка на разбор без имён)
- Decision: R6…R11 из §2 с именами полей из §4, кодами из §5, скриптом из §8.
- Checked: тесты §9 по именам; реальные данные — числа §8.
- Consequences: D-168 decision 1 / visibility / «B17 только в «Все»» refined; D-123, D-130 refined.
- Open (for the product owner): ??? (переход счёта между лейблами с периодом; ClickHouse label_id для BI;
  второй квартал B17 другого лейбла).
- References: файлы из §4–§9.  - Status: accepted (owner decision ???).
Индекс: `- D-169 … · in force`; на D-168: «*refined by* D-169 (the book by account, B17 under a label)».

## 14. Вопросы владельцу, без ответа на которые старт невозможен
1. Книга по счёту: живой реестр или замороженный `source_files.label_id`; незарегистрированный счёт → `'?'` или отказ.
2. Транспорт лейбла у загрузок и обязателен ли он (судьба скриптов и тестов без лейбла).
3. Коды и статусы отказа; что такое «предложение зарегистрировать» в UI.
4. Q8: B17 = 0to8? Под `?label=` строки B17 читаются?
5. Ворота по договору лейбла — в D-169? Только кнопка или и категория C? Документ без лейбла = «любой»?
6. «Плательщик» рекламы и операций — определение и правило для существующих записей.
7. Четыре договора Echo8 — ключ для скрипта.
8. Ожидаемые числа миграции и приёмки (файлы, владельцы, суммы).
9. `created_by` и ClickHouse `label_id` — в D-169 или позже.
```

---

Итог для сводки: черновик можно взять в работу как **описание модели**, но не как бриф. Для D-169 нужны ответы на
9 вопросов §14, после чего §4–§9 шаблона заполняются за час. Без ответов любой исполнитель (я или агент) будет
угадывать в ~25 местах, и как минимум в двух (книга по счёту против D-168; ворота по договору лейбла против §5
«деньги не меняются») угадает по-разному с автором.
