# SPEC: шаги T1–T4 и M1–M7

Спецификация к `GOAL.md`. Версия 2: учтены аудиты `аудит/06_spec_против_кода.md` и
`аудит/07_готовность_оркестратора.md`.

- **Решения** (Р1–Р15, деньги, права, «Отложено») — по `план.md` (v4).
- **Исполнение** (файлы, порядок, ключи, проверки, пороги) — по этой SPEC: она новее.
- **Стоп (GOAL)**, если расхождение касается денег или прав, или если план и SPEC оба молчат о том, что меняет
  поведение.

Пути бэкенда даны от `packages/backend/`, фронта — от `packages/frontend/`.

**Имена.** `trackSchema` / `Track` / `trackMetaSchema` уже заняты: это ответ `GET /tracks` и полная мета D-238.
Модель плана называется `TrackView`. Везде ниже «трек-справочник» — это `TrackView`.

## 0. Перед началом

### Где работать

Основная папка `/Users/nearlydeadhipo/Desktop/0to8/ERP` — исходник живого стенда. Контейнеры `stage` (:3001) и `api`
(:3000) пересобирают её `packages/*` над живой базой. В основной папке:

- не переключай ветку;
- не правь файлы;
- не запускай тесты и сборку.

Работай в своём worktree:

```bash
R=/Users/nearlydeadhipo/Desktop/0to8/ERP
W=$R/.claude/worktrees/fable-004
git -C $R worktree add -b feature/fable-004-tracks-money $W feature/fable-003
cd $W && ln -s $R/.env .env && mkdir -p data/test-tmp data/mvp-load/verify && npm ci
```

**Ветка уже есть?** Не создавай новую: найди её через `git -C $R worktree list` и продолжи в её worktree по
`отчёт_исполнения.md`. Документы этой папки читай из `$W`.

**Worktree исполнителя** нужен только для параллельной пары (§1.4). Он ставится рядом с `$W`, не внутри:

```bash
git -C $R worktree add -b fable-004/<шаг> $R/.claude/worktrees/fable-004-<шаг> feature/fable-004-tracks-money
cd <он> && ln -s $R/.env .env && mkdir -p data/test-tmp && npm ci
```

**Две ловушки:**

- `node_modules` не делай ссылкой: npm workspaces укажут на пакеты чужой папки.
- Если используешь `isolation: worktree` инструмента Agent, сначала проверь
  `git merge-base --is-ancestor feature/fable-004-tracks-money HEAD`. Если проверка не проходит, такой worktree не
  используй.

### База

Живые `erp` / `believe` не меняются ни на строку.

- Миграций нет. Скриптов с `--apply` нет.
- `.env` и контейнеры не меняются.
- `docker compose` с переопределёнными переменными не запускается: он пересоздаёт общий PostgreSQL.
- Тесты и e2e работают на своих частных базах (`createPrivateStores`, Playwright).
- `main.ts` запускается только с `DB_DATABASE=erp_<имя> CLICKHOUSE_DATABASE=believe_<имя>` (частный стенд, §1.3).
- `:3000`, `:3001`, `:5173` — живые. Ни e2e, ни браузер, ни запросы туда не идут.
- Единственное чтение живой базы — M3, по его правилам.

### Стек и исходный прогон

- **Контейнеры** уже запущены (`docker ps`). Если PostgreSQL или ClickHouse не отвечают — стоп, сам не поднимай.
- **Браузер Playwright:** `npx playwright install chromium` — только если Playwright сообщает, что браузера нет.
- **Исходный прогон** в `$W` до первой правки — полный DoD (§1.2, все пять команд).
  - В отчёт запиши: число тестов backend / frontend, e2e passed, время.
  - Красный прогон — один повтор последовательно (§1.5). Снова красный — стоп всей работы.

### Прочитать

- `CLAUDE.md`;
- `packages/frontend/CLAUDE.md`, `packages/backend/tests/CLAUDE.md`, `src/facade/CLAUDE.md`;
- `план.md`;
- аудиты `06` и `07`: в них ссылки на код и доводы.

### D-номера

- Последний занятый номер — D-243, первый новый — D-244. Номер ставит оркестратор при коммите.
- Исполнитель сдаёт черновик записи как `D-XXX`.
- 97, `docs/agents/03_decision_index.md`, `frontend/CLAUDE.md` и `facade/CLAUDE.md` правит только оркестратор, при
  приёмке.
- **T4:** одна D-запись в коммите группы 1 на все группы. Коммиты групп 2–4 ссылаются на неё и её не правят.
- **M3:** своя D-запись, в ней только счётчики, время и размер, без ISRC и UPC.
- Дубль D-237 в индексе не трогай.

## 1. Протокол

### 1.1 Фазы шага

| Фаза | Кто | Вход | Выход |
|---|---|---|---|
| Исполнение | исполнитель (в `$W`; при паре — в своём worktree) | раздел шага, DoD шага | diff, тесты, черновик D-записи |
| Ревью | независимый агент | только diff и раздел шага | замечания: блокер / важно / мелочь |
| Приёмка | оркестратор | diff после правок | DoD §1.2, D-запись, коммит, строка в отчёте |

Исполнитель запускает только `npm run typecheck` и свои файлы тестов. Полный DoD — у оркестратора.

**Ревьюер проверяет:**

- закрытая зона не тронута; тест равенства есть и сравнивает JSON-строки;
- права равны правам заменяемой операции; строка в `manager-answers.ts` добавлена, старые не изменены;
- у новой операции полный комплект:
  - `operations.ts` (`access`, `ability`, `readOnly`);
  - `coverage.ts` и `coverage.test.ts`;
  - сценарий `api-contract.test.ts`;
  - счётчики `abilities.test.ts`;
  - описания полей;
- нет лишних и пропущенных `await`;
- нет персональных данных;
- нет ничего из «Отложено».

### 1.2 DoD по шагам

| Шаг | typecheck | lint | `REQUIRE_STACK=1 npm test` | build:client | e2e |
|---|---|---|---|---|---|
| T1 | да | да | да | да | нет |
| T2, T3, T4 (каждая группа) | да | да | да | да | да |
| M1, M2, M4–M7 | да | да | да | да | да |
| M3 (скрипт) | да | да | да | нет | нет |

Плюс перед каждым коммитом две проверки.

1. Diff по закрытой зоне пуст:

   ```bash
   git diff --name-only feature/fable-003...HEAD -- packages/backend/src/facade/calculation.ts \
     packages/backend/src/facade/layers packages/backend/src/facade/balance.ts \
     packages/backend/src/facade/owner-scope.ts packages/backend/src/facade/scope.ts migrations .env
   ```

2. В `manager-answers.ts` строки только добавляются (вывод пуст):

   ```bash
   git diff -U0 feature/fable-003...HEAD -- packages/backend/tests/helpers/manager-answers.ts | grep '^-[^-]'
   ```

Защитные тесты: `boundaries`, `rules-coverage`, `api-contract`, `org-scope`, `golden`, `layers/exactness`, `no-dto`,
`api-descriptions`. В их diff только добавления. Исключения — правки, прямо названные в шаге: счётчики
`abilities.test.ts`, список отказов `coverage.test.ts`, правило записи в `api-contract.test.ts` и
`api-descriptions.test.ts`.

### 1.3 e2e, частный стенд, браузер

**Замок** — один на машину, всегда по абсолютному пути основной папки:

```bash
L=/Users/nearlydeadhipo/Desktop/0to8/ERP/data/test-tmp/e2e.lock
until mkdir $L 2>/dev/null; do sleep 60; done
trap 'rmdir $L' EXIT
npm run e2e
```

**Если ждёшь дольше 60 минут**, проверь процессы: `pgrep -fl "playwright|main.ts"`.

- Процессов нет ещё 10 минут — замок протух. Удали его и запиши это в отчёт.
- Процессы есть — жди дальше, а пока делай шаги без e2e.

**Частный стенд** — для итераций исполнителя и проверки в браузере.

- Имя `f4<шаг>` (`a-z0-9_`).
- Порт 3150–3199, у каждого исполнителя свой.

```bash
npx tsx packages/backend/scripts/e2e/seed.ts f4t41
DB_DATABASE=erp_f4t41 CLICKHOUSE_DATABASE=believe_f4t41 PAYOUT_THRESHOLD_CENTS=0 AUTH_MODE=on \
  AUTH_SECRET=$(openssl rand -hex 32) PORT=3151 ERP_DATA_DIR=data/test-tmp/e2e-data-f4t41 \
  npx tsx packages/backend/src/main.ts data/test-tmp/e2e-data-f4t41
```

- Без обоих `*_DATABASE=…_f4…` в начале команды стенд не запускается.
- `E2E_BASE_URL` и браузер — только на свой порт.
- Входить под пользователем из файла ключей стенда.
- В конце: `npx tsx packages/backend/scripts/e2e/drop.ts f4t41`.

### 1.4 Порядок и параллельность

**Зависимости:**

- T1 → T2 → T3 → T4.1 → T4.2 → T4.3 → T4.4;
- T2 → M1 (общий `aggregates.ts`: M1 после T2);
- {T3, M1} → M2 (`readOnly` из T3);
- M1 → M3;
- M2 → M4;
- {M3 зелёный, M4, T4.1} → M5 → M6;
- {M6, T4.4} → M7.

| Волна | Что |
|---|---|
| 1 | T1 |
| 2 | T2 |
| 3 | T3 ‖ M1 |
| 4 | M2 |
| 5 | M3 (оркестратор) ‖ T4.1 |
| 6 | M4 |
| 7 | M5 ‖ T4.2 |
| 8 | M6 ‖ T4.3 |
| 9 | T4.4 |
| 10 | M7 |

**Правила:**

- Одновременно не больше двух исполнителей. Если пары нет, исполнитель работает прямо в `$W`.
- Пары сливаются так:
  1. `git diff --name-only` обеих веток против вершины — пересечения быть не должно;
  2. ветки вливаются по одной: `git merge --squash fable-004/<шаг>`, затем D-запись, DoD, коммит;
  3. вторая ветка перебазируется на новую вершину.
- Конфликт в общих файлах (`operations.ts`, `api-responses.ts`, `coverage.ts`, `manager-answers.ts`,
  `abilities.test.ts`) наугад не решай: верни шаг исполнителю на новую вершину.
- Стоп на M3 блокирует M4–M7. Линия «Трек» продолжается.

### 1.5 Падения и повторы

**Машина занята**, если видишь `Hook timed out`, `terminating connection due to administrator command` или минуты
вместо секунд. Тогда повтори упавшие файлы последовательно (в `packages/backend`):

```bash
REQUIRE_STACK=1 npx vitest run --no-file-parallelism --testTimeout=300000 --hookTimeout=120000 <файлы>
```

**Повтор снова красный** — прогони те же файлы на вершине ветки до шага (worktree `fable-004-base`).

- Красно и там — причина вне шага: стоп.
- Зелено — виноват шаг: верни исполнителю.

**e2e** (`retries: 0`) — упавшую спецификацию повтори один раз отдельно, под замком. Упала снова — это настоящее
падение.

**Ревью:**

- Не больше трёх кругов «исполнитель → ревьюер». Блокер после третьего круга — стоп шага.
- Разногласие про деньги, права, защитные тесты, персональные данные — стоп. Остальное решаешь сам и пишешь решение
  в отчёт.

**Красное не коммитится.**

- Недоделанный шаг остаётся на ветке `fable-004/<шаг>` (WIP-коммит там разрешён) и в отчёте.
- `git reset --hard` и `git push --force` по основной ветке запрещены.

**Похоже на запись в живую базу** или обращение к :3000 / :3001 — немедленно останови процесс, стоп всей работы,
опиши в отчёте.

## 2. Линия «Трек»

### T1. `baseTitleOf` и схема `TrackView`

**Файлы:**

- `packages/shared/src/track-title.ts` (новый): `baseTitleOf(title: string | null, version: string | null)`.
  - `title = null` → `null`.
  - Суффикс ` - ${version}` отрезается, только если `version` непуст и `title` на него оканчивается.
  - Иначе — `title`.

  Это не `baseTitle` из `facade/pubv2-links.ts`: тот нормализует названия для сопоставления песен. Скажи это в
  D-записи.
- `packages/shared/package.json`, `exports`: `"./track-title": "./src/track-title.ts"`.
- `packages/shared/src/api-responses.ts`: `trackViewMetaSchema`, `trackViewReleaseSchema`, `trackViewSchema` (типы
  `TrackViewMeta`, `TrackViewRelease`, `TrackView`). У каждого поля `.describe('D-NNN: …')`.
  - `TrackViewMeta` — ровно поля плана §3.1: `title, baseTitle, version, artists, durationMs, explicit, releaseDate,
    coverUrl, primaryPlatform`. Без `updatedAt` / `updatedBy`: логин оператора менеджеру не отдаём.
  - `TrackViewRelease` = `{ trackId: string | null, upc, title, release }`, где `release` =
    `{ title, version, releaseDate, labelName, trackCount } | null`. Поле `releaseTitle` реестра здесь называется
    `title`.
  - `TrackView.releases` и `TrackView.artists` допускают `null`: так помечено «не видно».

**Тест** `packages/backend/tests/track-title.test.ts` (в shared нет vitest). Случаи:

- версия в конце;
- версии нет;
- `title = null`;
- `version = ''`;
- версия в середине;
- `title` = `version`;
- ` - Slowed`.

Поведение не меняется.

### T2. `tracksOf` в фасаде

**Вынести** из `aggregates.ts` в новый `facade/tracks.ts` помощники `nameMaps` и `registryByUpc`, как функции от
`ctx`. `aggregates.ts` импортирует их оттуда.

`tracks.ts` не импортирует `./aggregates`, `./calculation`, `./scope`, `./balance`, `./reports`. Это закрепляет новый
случай в `boundaries.test.ts`.

**Функция** `tracksOf(isrcs: string[], viewer: Viewer = ALL_VIEWER): Promise<Record<string, TrackView>>`.

Источники:

- `owners.listTracks({ isrcs })`;
- `sources.pairAttributes({ isrcs })` — название и UPC из отчёта;
- `owners.trackMeta.of(isrcs)` — полная мета, а не `metaLookup`;
- `owners.trackLabels` — открытый интервал → `catalogLabel`;
- реестр по UPC;
- `artistsByIsrc` по `splits.listSplits({ isrcs })` / `listParticipations({ isrcs })`, с отметкой MC строки сплита.

PostgreSQL читается в одном `db.snapshot`, ClickHouse — как сегодня в `trackCatalog`.

**Видимость** — `ctx.scopeOf(viewer).isrcFilter()` / `mayTouchIsrc`, как в `splits.ts:195`.

**Правила полей:**

| Поле | Кто видит |
|---|---|
| `meta`, `catalogLabel`, `title` при `titleSource = 'catalog'` | любой ISRC организации |
| `title` при `titleSource = 'report'` | только видимый ISRC; иначе `title = null`, `titleSource = null` |
| `artists`, `releases` | только видимый ISRC; иначе `null` |
| `releases[].release` | только строка реестра лейбла, который видит `viewer` (для `ALL_VIEWER` — последняя обновлённая, как `registryRows`); чужая → `null` |

- Пустая строка названия считается `null` (D-243).
- Набор UPC в `releases`: пары файлов ∪ `owners.tracks`. `trackId = null`, если строки каталога нет.
- ISRC без строки `owners.tracks`, без пары в файлах, без меты и без открытого интервала в ответ не попадает.

`trackCatalog` строит строки через помощники `tracks.ts`. `GET /tracks/catalog` остаётся байт в байт прежним.

**Тесты:**

- `tests/tracks.test.ts` (новый):
  - каждое правило таблицы;
  - менеджер лейбла A по ISRC файлов A не видит строку реестра лейбла B того же UPC;
  - неизвестный ISRC в ответ не попадает.
- `catalog.test.ts` и `aggregates.test.ts` — без правок.

### T3. Признак `readOnly` и `POST /tracks/query`

**Признак `readOnly`:**

- `operations.ts`: ветка типа
  `{ readOnly: true; method: 'post'; ability: Ability & { action: 'read' | 'read_money' } }`.
- `needsOperator` принимает `readOnly` и для него возвращает `false`.
- `api/audit.ts`: в `operatorTrace` пропускать `operationOf(req.method, req.path)?.readOnly`, как в
  `authorize.ts:44`. Остальные `*Trace` не трогать.
- `tests/api-contract.test.ts:908`: ожидание заголовка — `needsOperator(op)`, а не выражение по методу.
- `tests/api-descriptions.test.ts:43`: в `reads` входят и `readOnly`-операции. Поля тела проверяются так же, как поля
  query.
- Фронт `src/api/client.ts`: для `readOnly` не ставится `X-Operator` и не читается `X-Audit` (`:71`, `:93`).
  - Признак — в функции операции клиента.
  - Рукописных DTO нет (`tests/no-dto.test.ts`).
- `originGuard` (`src/auth/middleware.ts:200-215`) проверяет `Sec-Fetch-Site` / `Origin` на любом POST. Это защита
  от CSRF; её не менять.
- **Новый тест** с замороженным списком `readOnly`-операций: сейчас ровно `POST /tracks/query`, с M2 ещё
  `POST /money/master/query`. Добавлять в список можно только вместе с планом.

**Маршрут `POST /tracks/query`:**

- тело `{ isrcs: string[] }`: от 1 до 1 000, формат ISRC, повторы убираются;
- ответ `{ tracks: Record<isrc, TrackView> }`;
- `access: 'org'`, `ability: { action: 'read', subject: 'tracks', scope: 'record' }`, `readOnly: true`;
- маршрут передаёт `viewerOf(res)`.

**Обвязка:**

- `manager-answers.ts`: строка `R`.
- `tests/abilities.test.ts`: счётчики `[131, 39, 21, 9, 62]`, по действиям `[23, 33, 21, 25, 15, 14]`, `orgAllowed`
  69. В комментарии — «D-NNN: + POST /tracks/query (read, R)».
- Фронт `coverage.ts`: временный `refusal` по-английски (`'not on a screen yet: TrackName moves to it in T4'`). Ключ
  добавляется в список `tests/coverage.test.ts:36` и убирается в T4.1.
- Сценарий в `api-contract.test.ts`. Описания полей тела и ответа.

**Тесты:**

- после вызова в журнале ни одной новой строки;
- без `X-Operator` — 200;
- менеджер своей книги — 200 (прогон менеджера на своём теле даст 400 `validation_error`, поэтому нужен отдельный
  тест);
- менеджер по чужому ISRC: `releases = artists = null`, `meta` есть;
- 1 001 ISRC — 400.

**D-запись:** POST-чтение как исключение из D-140; довод про CSRF (`originGuard` + JSON); список `readOnly`
заморожен.

### T4. `TrackName` на `TrackView`

**Общее:**

- `src/api/client.ts`: `tracks.query(isrcs)`.
- `src/api/queries/tracks.ts`: `useTracks(isrcs)`.
  - Ключ `['tracks', 'query', isrcs отсортированные]`, `staleTime` 60 с, в `MONEY_KEYS` его нет.
  - Запрашиваются только ISRC, которые показаны (строки на экране, как D-162), пачками по 1 000.
- `components/TrackName.tsx`: `TrackName({ isrc, track? })`. Название — `track?.meta?.baseTitle ?? track?.title ??
  isrc`, без локального отрезания. Пока `track` не пришёл, показывается ISRC.
- **P5** (25 854 ISRC в каталоге) не вызывает `POST /tracks/query` на весь список.
  - Поиск и фильтр по названию работают, как сейчас, по строкам `GET /tracks/catalog`.
  - `TrackName` получает `TrackView`, собранный из строки каталога помощником T2. Ответ `/tracks/catalog` не
    меняется.
- Хуки `track-name-<isrc>` / `track-version-<isrc>` прежние. `valueGetter` гридов читают `TrackView`.

**Группы**, по коммиту на каждую:

| Группа | Файлы |
|---|---|
| T4.1 | P8 `pages/catalog/ReleasePage.tsx`, P5 `pages/catalog/TracksPage.tsx`; `coverage.ts` — страница P8 вместо `refusal` |
| T4.2 | P10 `pages/owners/BalanceTab.tsx`, `pages/owners/tabs.tsx`; P12 `pages/artists/ArtistBalanceTab.tsx`, `pages/artists/tabs.tsx` |
| T4.3 | P15 `pages/reference/splits/SplitsPage.tsx`, P16 `ParticipationsPage.tsx` |
| T4.4 | P36/P37 `pages/reference/sublabels/ReportTab.tsx`, `SuggestionsTab.tsx`, `TermsTab.tsx`; удаление старых пропсов `meta` / `fallbackTitle` и типа `TrackMetaLite` во фронте |

**Ответы API.** В T4.4 из ответов снимаются `trackMeta` и `meta` строк, которые фронт больше не читает (проверить
поиском по `packages/frontend/src`). Ответ `GET /tracks/catalog` остаётся: из него P5 собирает `TrackView`. MCP —
не причина оставлять поле: его инструменты строятся из OpenAPI и меняются вместе с ответом. Проверка в браузере на частном
стенде: обложка, название, версия на каждой странице группы.

## 3. Линия «Деньги»

### M1. `masterRows` в фасаде

**Перенос.** `calcScoped` переносится в `context.ts` (`ctx.calcScoped`), `aggregates.ts` берёт его оттуда. Это не
закрытая зона: поведение то же. `labelContext` уже в `ctx`.

**Файл** `src/facade/money.ts` (новый):

```ts
masterRows(
  q: { scope: { kind: 'release'; upc: string } | { kind: 'isrcs'; isrcs?: string[] };
       grain: 'isrc' | 'month' | 'isrc,month';
       period?: { from?: string; to?: string } },
  label?: string,
): Promise<{ rows: MasterRow[]; totals: MoneySums; calculatedAt: string }>
// MasterRow = { isrc?, month?, sums: MoneySums, months?: { from, to, count } }   // months — только у зерна 'isrc'
```

`parseIsrcList` не используется. Схема M2 проверяет формат и лимит; фасад делает `assertIsrc`, убирает повторы и
сортирует.

**Выбор единиц** — как в существующем коде.

- **`release`** — как `release()` (`aggregates.ts:447-451`):
  - `calcScoped({ upcs: [upc], labelIds: lc ? [lc.book.id] : undefined, publishingLines: false })`;
  - единицы `u.upc === upc && u.isrc !== ''`.
- **`isrcs`** — как `trackSummary()` (`aggregates.ts:185-194`):
  - `only = lc ? (isrcs ?? [...lc.visible.isrcs]).filter(visible) : isrcs`;
  - `calcScoped({ isrcs: only, labelIds: lc ? [lc.book.id] : undefined, from/to/basis 'report' из period,
    publishingLines: false })`;
  - единицы `u.isrc !== ''`.
  - `isrcs: []` → `rows: []` и нулевые `totals` без расчёта.
  - `isrcs` не задан → весь срез.
- **`period`** — месяц отчёта.

**Строки:**

- группы по ключам зерна, суммы `sumUnits(calc, us)`;
- у зерна `isrc` есть `months` = `{ from, to, count }` по месяцам отчёта единиц, как в `trackSummary`. Это метаданные,
  не деньги;
- `totals` = `sumUnits` всех выбранных единиц;
- порядок — ключи по возрастанию; строк без единиц нет.

**Тест** `tests/money-rows.test.ts`. Мир синтетический:

- два лейбла;
- релиз из трёх ISRC;
- один ISRC без единиц;
- C с разными причинами;
- единицы другого лейбла на тех же ISRC.

Сравниваются `JSON.stringify` денежных полей (`net, B, C, ours, cByReason`) и `months`. Нулевые строки (все суммы 0
и пустой `cByReason`) отбрасываются с обеих сторон.

| Новое | Старое |
|---|---|
| `release`, `isrc` | `release(upc, label).tracks` |
| `release`, `month` | `release(upc, label).months` (`reportingMonth` ↔ `month`) |
| `isrcs` со списком и без, под лейблом и под «Все», `isrc` | `trackSummary({ isrcs, label }).items` (с `months`) |
| `totals` | `sumUnits` тех же единиц |
| `isrc,month`, сложенные в тесте через `Decimal` по ISRC | строки `isrc` (инвариант) |

Случаи `release` дополнительно закрепляются фиксированными строками `expected`, посчитанными в мире теста.

Плюс кейс в `scope.test.ts`: тот же срез по полному расчёту даёт тот же ответ.

### M2. `POST /money/master/query?label=`

- Схемы:
  - тело в `api-schemas.ts`: `grain` — `z.enum`, `isrcs` ≤ 5 000;
  - ответ в `api-responses.ts`: `moneySumsSchema`, `masterRowSchema`, ответ.
- `access: 'org'`, `ability: { action: 'read_money', subject: 'tracks', scope: 'label' }`, `readOnly: true`,
  `explain: true` (D-178).
- Маршрут передаёт `label` из query. `viewer` не нужен: права решает `can()`.

**Обвязка:**

- `manager-answers.ts`: `L`.
- `abilities.test.ts`: счётчики `[132, 40, 21, 9, 62]`, по действиям `[23, 34, 21, 25, 15, 14]`, `orgAllowed` 70.
  Комментарий D-NNN. Если T3 ещё не влит, считай от фактических значений: +1 к `L` и к `read_money`.
- Список `readOnly` дополняется.
- `coverage.ts`: временный `refusal` и строка в `coverage.test.ts:36`. Убирается в M5.
- Сценарий в контракте, описания полей.

**Тесты:**

- контракт;
- менеджер: своя книга 200 (отдельный тест), без метки 400 `label_required`, чужая метка 403;
- в журнале ни одной новой строки.

**D-запись:** запрос; права = права заменяемых ответов (Р13); R2′ (Р12).

### M3. Сверка и замер на живой базе

**Скрипт** `scripts/check-master-rows.ts [dataDir]`. Только чтение.

- Организация — `ERP_DEFAULT_ORG` из `.env`. `--org` не передавать: id в `CLAUDE.md` устарел.
- Первым делом скрипт проверяет `SHOW default_transaction_read_only` = `on`. Иначе — выход с кодом 1 и текстом
  «запусти с PGOPTIONS».
- Вызывает только `masterRows`, `release`, `trackSummary` и список своих книг.
- Сравнивает по правилам теста M1. Выводит только ключи (ISRC, UPC, месяц) и денежные строки, без названий и ников.

**Сверка.** Для каждой книги и для «Все»:

- 20 релизов с наибольшим `net`;
- «isrcs без списка».

**Замер.** Для «isrcs без списка» и для самого большого релиза каждой книги:

- 1 прогрев;
- затем 5 замеров попеременно старое / новое в одном процессе;
- берётся медиана;
- `uptime` — до и после.

**Запуск** — оркестратор, из `$W`, API не нужен:

```bash
PGOPTIONS='-c default_transaction_read_only=on' \
  npx tsx packages/backend/scripts/check-master-rows.ts /Users/nearlydeadhipo/Desktop/0to8/ERP/data
```

**Отчёт** — `data/mvp-load/verify/master-rows-<дата>.json` и `.md`. Они не коммитятся: `data/` игнорируется. В
D-запись и `отчёт_исполнения.md` — только счётчики сравнений, число расхождений, медианы и размеры.

- **Готово:** 0 расхождений, и для каждого замера `new ≤ 1,2 × old` или `new − old ≤ 0,3 с`.
- **Иначе — стоп (GOAL).** M4–M7 стоят, линия «Трек» продолжается.

### M4. Подготовка фронта (R2′)

- `src/api/queries/core.ts`: в `MONEY_KEYS` добавить `['money', 'master']`.
- Клиент денег — `src/api/catalog.ts`: `catalog.masterRows`. Хук `useMasterRows` — в `src/api/queries/money.ts`.
- `e2e/helpers.ts:112-123`, фильтр метода в `openAs`:
  `r.method() === 'GET' || (r.method() === 'POST' && /^\/api\/v1\/money\//.test(path))`.
  `GET /releases/:upc` остаётся в `MONEY_PATH`: он по-прежнему считает.
- `packages/frontend/CLAUDE.md`: R2 → «один денежный запрос на блок; баланс — отдельный ответ своей страницы».

Экраны не меняются, e2e зелёный.

### M5. P8 на блоках

`pages/catalog/ReleasePage.tsx`:

- таблица треков — `useMasterRows({ kind: 'release', upc }, 'isrc')` + `useTracks`;
- таблица месяцев — `useMasterRows(…, 'month')`;
- итог — `totals`;
- шапка и нулевые треки — из `GET /releases/:upc`, как раньше.

**Блоки** `components/money-blocks/TracksMoneyBlock.tsx`, `MonthsMoneyBlock.tsx`. Хуки `release-track-<isrc>`,
`release-month-<month>`, `[data-col=…]` прежние.

**Обвязка:** `coverage.ts` — страница P8 вместо `refusal`; ключ убрать из `coverage.test.ts:36`.

**e2e `golden/11-release`:**

- числа те же;
- проверка «экран = API» по образцу `49-sublabels.spec.ts:58-72` (ответ через `page.request`);
- `expectMoneyCalls(page, 3)`: GET `/releases/:upc` + два POST.

### M6. P5, вторая фаза

`pages/catalog/TracksPage.tsx`:

- Первая фаза не меняется (`GET /tracks/catalog`).
- Деньги видимых строк — `useMasterRows({ kind: 'isrcs', isrcs: видимые }, 'isrc')`, одним запросом. Колонка
  `months` берёт `row.months`.
- «Посчитать все» (`all=1`):
  - строки — из `GET /tracks/catalog`, как в первой фазе;
  - деньги — срез без списка;
  - строки без денег показывают «—»;
  - разницу набора строк с прежним `all=1` записать в D-запись: каталог под лейблом включает ISRC открытого
    интервала без единиц.
- Режим «account / month» с P1 остаётся на `GET /tracks/summary`: этих фильтров в M1 нет. Записать в D-запись.

**e2e:**

- `golden/12-track.spec.ts:209-260`: ожидание запроса `:212` → `POST /money/master/query`;
- `golden/40-catalog`.

### M7. Итог и пометка старого

MCP — не причина держать старое: его инструменты строятся из OpenAPI и меняются вместе с ответами.

**`GET /releases/:upc` без денег** — одним коммитом:

- `release()` больше не считает. ISRC берутся из `sources.pairAttributes({ upcs })` ∪ `owners.tracks`. 404 — как
  раньше, если нет ни треков, ни пар, ни строки реестра.
- Из ответа уходят денежные поля `tracks[]` и `months[]` (`net, B, C, ours, cByReason`), а также `months[]` целиком.
  Схема ответа обновляется.
- Тесты, которые читали эти деньги, переносятся на `masterRows` **с теми же числами**:
  - `scope.test.ts:98-99`, `:665-667`, `:815-816`;
  - `aggregates.test.ts:350-363`.
- Тест равенства M1 по `release` переходит на фиксированные строки `expected` (они уже есть с M1).
- `scripts/check-master-rows.ts`: сравнение `release` со старым убирается. `isrcs` против `trackSummary` остаётся.
- Фронт:
  - `MONEY_PATH` без `releases/[^/]+`;
  - `MONEY_KEYS` без `['releases', 'detail']`;
  - P8 `expectMoneyCalls(page, 2)`.
- `ability` `GET /releases/:upc` остаётся прежним (ответ менеджера `L` не меняется), строки `manager-answers.ts` не
  трогать.

**`GET /tracks/summary` остаётся.** Его читает экран: режим P5 «account / month» с P1. Его читает и
`scripts/compare-reference.ts`. Параметр `isrcs` снимается, если поиск по `packages/` не находит ни одного
потребителя, кроме MCP.

**D-запись:** что снято, что осталось и почему (только экраны и скрипты, не MCP).

## 4. Чего не делать

- Ничего из таблицы «Отложено» плана.
- Не трогать:
  - паблишинг;
  - рекламу;
  - срезы `owner` / `artist` / `track` / `book`;
  - `byArtist`;
  - P7 `net`;
  - `/sublabels/:id/report`;
  - код MCP (`api/mcp.ts`, `mcp-connection.ts`);
  - `decimal.js` во фронте.
- Не держать старые поля ради MCP: он следует за OpenAPI.
- Не писать в живую базу, не менять `.env`, не трогать основную папку.

## 5. Отчёт

Файл `docs/идеи/выдача_денег_и_треков/отчёт_исполнения.md`.

- Обновляется после каждого коммита и каждого стопа. Это и журнал для продолжения после обрыва.
- Коммитится вместе со следующим шагом и с последним коммитом.
- Без персональных данных, без живых ISRC / UPC.

Разделы:

1. **Итог в пяти строках:** сделано / остановлено / не начато; нужно ли что-то от владельца.
2. **Исходный прогон:** коммит, число тестов backend / frontend / e2e, время.
3. **Шаги** (таблица):
   - шаг, коммит, D-номер;
   - число файлов;
   - добавленные тесты;
   - число тестов после шага;
   - e2e да / нет;
   - замечания ревьюера: принято / отклонено и почему;
   - отступления от SPEC.
4. **M3:** книги, число сравнений, расхождения, медианы старое / новое, размеры JSON, `uptime`.
5. **Что изменилось в API:** новые операции и их права, снятые поля и ответы; что осталось и почему.
6. **Стопы и вопросы владельцу:** по каждому — шаг, что видно, что заблокировано, варианты ответа.
7. **Что осталось на машине:**
   - worktree и ветки;
   - частные базы `erp_f4*` / `believe_f4*`;
   - файлы в `data/mvp-load/verify/`;
   - состояние замка e2e.
8. **Как проверить:** команды для владельца (DoD, M3).
