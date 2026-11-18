# Аудит 06: SPEC.md против кода

2026-11-19. Независимый ревьюер, только чтение. Предмет: `SPEC.md` (шаги T1–T4, M1–M7) и `GOAL.md` против кода ветки
`feature/fable-003` (коммит 92b9694). Вопрос один: выполним ли каждый шаг как написан и пройдёт ли он DoD, не задев
защитные тесты, закрытую зону и живую базу.

Итог: **7 блокеров, 14 важных, 8 мелочей.** Большинство блокеров — имена и счётчики, которые есть в коде, но не
упомянуты в SPEC. Исполнитель упрётся в них на первом же прогоне, а правило GOAL «не ослабляй защитные тесты» без
оговорки остановит оркестратор.

Пути бэкенда даны от `packages/backend/`, фронта — от `packages/frontend/`.

---

## Общие замечания (касаются нескольких шагов)

### О1. Замороженные счётчики прав — **блокер** (T3, M2)

`tests/abilities.test.ts:46`:

```ts
expect([orgOps.length, count('L'), count('R'), count('O'), count('x')]).toEqual([130, 39, 20, 9, 62]);
```

В той же функции, `:48`, по действиям:

```ts
expect([...].map(byAction)).toEqual([22, 33, 21, 25, 15, 14]);
```

Ещё `:139`: `expect(orgAllowed).toHaveLength(68)`.

Каждая новая операция меняет все три счётчика. SPEC их не упоминает, а GOAL запрещает «ослаблять защитные тесты».
Поправка счётчика — штатная практика (см. комментарии D-238, D-219), но её надо разрешить явно.

**Вставить в T3 «Обвязка»:**

> `tests/abilities.test.ts`: счётчики `[131, 39, 21, 9, 62]`, по действиям `[23, 33, 21, 25, 15, 14]`,
> `orgAllowed` 69. В комментарий строки дописать «D-NNN: + POST /tracks/query (read, R)». Это обновление счётчика, а
> не ослабление теста.

**Вставить в M2 «Обвязка»:**

> `tests/abilities.test.ts`: счётчики `[132, 40, 21, 9, 62]`, по действиям `[23, 34, 21, 25, 15, 14]`,
> `orgAllowed` 70, с комментарием D-NNN.

### О2. Субъекта `track` нет — **блокер** (T3, M2)

`src/auth/abilities.ts:24-42`: тип `Subject` содержит `'tracks'` и `'releases'`, а `'track'` в нём нет. Строка SPEC
`subject: 'track'` не пройдёт typecheck. Соседние операции: `GET /tracks/summary` →
`{ read_money, tracks, label }` (`operations.ts:585`), `GET /tracks/:isrc/meta` → `{ read, tracks, org }`
(`operations.ts:1384`).

**Заменить в T3:** `ability: { action: 'read', subject: 'tracks', scope: 'record' }`.

**Заменить в M2:** `ability: { action: 'read_money', subject: 'tracks', scope: 'label' }`.

### О3. Гварды, которые решают «запись» по методу — **важно** (T3)

SPEC перечисляет `needsOperator`, `traceWrites` и `client.ts`. Есть ещё три места:

- `tests/api-contract.test.ts:908-909` ждёт заголовок `X-Operator` ровно при
  `op.method !== 'get' && op.access !== 'public'`. Для `readOnly` тест упадёт.
- `tests/api-descriptions.test.ts:43-45` отбирает чтения по `o.method === 'get'`. Поэтому требование SPEC
  «описания полей схем» для новых POST-операций **никто не проверит**.
- `client.ts:93`: `onAuditFailed` срабатывает при `method !== 'GET'`.

**Вставить в T3 «Признак readOnly»:**

> - `needsOperator` принимает `Pick<ApiOperation, 'method' | 'access' | 'readOnly'>`.
> - `tests/api-contract.test.ts:908`: ожидание `needsOperator(op)` вместо выражения по методу.
> - `tests/api-descriptions.test.ts`: в `reads` входят и `readOnly`-операции:
>   `(o.method === 'get' || o.readOnly) && …`. Тело запроса (`o.body`) описано так же, как query: добавить проверку
>   полей тела для `readOnly`.
> - `client.ts`: для `readOnly` не ставится `X-Operator` и не читается `X-Audit` (оба места, `:71` и `:93`).
> - `originGuard` (`src/auth/middleware.ts:200-215`) по-прежнему проверяет `Sec-Fetch-Site` и `Origin` на любом POST.
>   Это и есть защита от CSRF, менять не нужно.

### О4. Отказы в `coverage.ts` заморожены — **важно** (T3, M2)

`packages/frontend/tests/coverage.test.ts:36`:

```ts
expect(refusals.map((r) => r.key).sort()).toEqual(['GET /health', 'GET /reconciliation', 'GET /tracks/:isrc/explain'].sort());
```

Временный `refusal` для T3 и M2 уронит этот тест.

**Заменить в T3 и M2 «Обвязка»** строку про `coverage.ts` на:

> `coverage.ts`: временный `refusal` (на английском, как соседние, длиннее 15 знаков, например
> `'not on a screen yet: P8/P5 move to it in T4'`). В `tests/coverage.test.ts:36` ключ добавляется в список
> отказов и убирается в шаге, который ставит страницу (T4 группа 1 / M5).

### О5. Имена `trackSchema` и `Track` заняты — **блокер** (T1)

`packages/shared/src/api-responses.ts:230-236`: `trackSchema` (строка `owners.tracks`: id, isrc, upc, title, note) и
`export type Track`. Их читают `GET /tracks` (`operations.ts:558`), фронт `client.ts:238-242` и
`scripts/compare-reference.ts`. Новая `trackSchema` либо не соберётся, либо молча сменит контракт `GET /tracks`.

Имя `trackMetaSchema` тоже занято (`:2157`, полная мета D-238). Новое `metaSchema` к нему слишком близко.

**Заменить в T1:**

> Схемы: `trackViewSchema` (тип `TrackView`), `trackViewMetaSchema` (`TrackViewMeta`), `trackViewReleaseSchema`
> (`TrackViewRelease`). Существующие `trackSchema` / `Track` / `trackMetaSchema` не трогать. Во всех шагах ниже
> «`Track`» означает `TrackView`.

Есть и обратная коллизия: `baseTitle` уже есть в `src/facade/pubv2-links.ts:12`. Это другая функция, нормализация
для сопоставления песен. Имя `baseTitleOf` различимо, но в D-записи стоит сказать, что это не она.

### О6. В `packages/shared` тесты не запускаются — **важно** (T1)

У `packages/shared/package.json` нет скрипта `test` и нет vitest. `npm test` идёт по workspaces с `--if-present`, так
что тест в `packages/shared` никогда не выполнится. Новый модуль ещё нужно добавить в `exports`.

**Заменить в T1 «Тесты»:**

> Тест `baseTitleOf` — в `packages/backend/tests/track-title.test.ts` (бэкенд-vitest импортирует `@erp/shared`). В
> `packages/shared/package.json` `exports` добавить `"./track-title": "./src/track-title.ts"`.

---

## T1. `baseTitleOf` и схема `Track`

| # | Серьёзность | Находка | Доказательство |
|---|---|---|---|
| T1-1 | блокер | Коллизия имён `trackSchema` / `Track` | О5 |
| T1-2 | важно | Тест в `packages/shared` не запустится | О6 |
| T1-3 | важно | «`Meta` = поля `owners.track_meta` плюс `baseTitle`» шире плана. Таблица несёт `updatedAt` / `updatedBy`, а `updatedBy` — это логин оператора. План §3.1 перечисляет девять полей без них | `src/modules/owners/schema.ts:144-161`; план §3.1 |
| T1-4 | мелочь | Логика `TrackName.tsx:17` срабатывает только при непустых `title` **и** `version`. Без `title` она возвращает `fallbackTitle`, а не `null`. `baseTitleOf` видит только мету, поэтому при `meta.title = null` должна вернуть `null`; фолбэк на наше название делает уже `title` трека | `components/TrackName.tsx:17` |

**Заменить в T1** пункт «`Meta` = …»:

> `TrackViewMeta` = ровно `{ title, baseTitle, version, artists, durationMs, explicit, releaseDate, coverUrl,
> primaryPlatform }` (план §3.1). Без `updatedAt` / `updatedBy`: логин оператора менеджеру не отдаём.
> `baseTitleOf(title, version)`: `null`, если `title` = `null`; срез, только если `version` непуст и `title`
> оканчивается на `` ` - ${version}` ``; иначе `title`.

Случаи теста дополнить: «`version` = `''`» и «`title` = `version`» (суффикса нет, не режется).

---

## T2. `tracksOf` в фасаде

| # | Серьёзность | Находка | Доказательство |
|---|---|---|---|
| T2-1 | важно | Помощники `calcScoped`, `nameMaps`, `registryByUpc` — замыкания внутри `aggregatesApi`, их не экспортируют. При этом `tracks.ts` по SPEC **не должен импортировать `./aggregates`**. Значит, `nameMaps` и `registryByUpc` надо вынести из `aggregates.ts`. SPEC этого не говорит | `facade/aggregates.ts:82-103` |
| T2-2 | важно | `metaLookup` отдаёт лёгкую мету (isrc, title, version, coverUrl), а `TrackView.meta` нужны все поля. Читать надо `owners.trackMeta.of(isrcs)` | `facade/track-meta-lite.ts:15-20` |
| T2-3 | важно | Права на `releases`. Пара `(trackId, upc, title)` берётся из `owners.tracks`, а это `GET /tracks` (`O`): открыто любому. `release` (строка реестра) — это `GET /releases/registry` / `GET /releases/:upc`, то есть `L`, только свой лейбл. С правилом «видимый ISRC → весь реестр всех лейблов» менеджер увидит строки реестра **чужого** лейбла по UPC своего ISRC. Права расширятся (Р13) | `manager-answers.ts:23,31-32,110`; `aggregates.ts:94-103` (`registryByUpc(labelId)`) |
| T2-4 | важно | `title` из отчёта Believe для ISRC, которого менеджер не видит, — это строка из файла чужой книги. Сегодня `GET /tracks/catalog` (`L`) отдаёт её только для видимых ISRC, `GET /sources/lines` — тоже `L`. Открыто (`O`) только наше название `owners.tracks.title` через `GET /tracks`. Вывод плана «`title` открыт» верен лишь для названия каталога | `aggregates.ts:284-297`; `manager-answers.ts:23,26-27,66` |
| T2-5 | важно | Правило «неизвестный ISRC» пропускает открытый интервал истории. `trackCatalog` знает ISRC из пар файлов, `owners.tracks` **и** `open` (`track_labels`). SPEC называет «строку каталога, единицу, мету». «Единица» в фасаде без расчёта — это пара в `sources.pairAttributes` | `aggregates.ts:284-288` |
| T2-6 | важно | `TrackRelease.trackId` обязателен, но UPC ISRC берутся и из пар файлов (`upcsOf`), где строки `owners.tracks` нет. Такие релизы либо теряются, либо `trackId` должен быть `null` | `aggregates.ts:268-273, 292` |
| T2-7 | мелочь | Правило видимости живёт в `facade/viewer.ts:103-106` как `viewerScope(modules, viewer).mayTouchIsrc`. В фасаде оно доступно через `ctx.scopeOf(viewer).isrcFilter()` (так делают `splits.ts:195`, `search.ts:62`). «Или его аналог» можно убрать. Учтите: правило пропускает и ISRC, которого нет ни в одном загруженном файле (новый трек). Это совпадает с `GET /splits` | `viewer.ts:52, 103` |
| T2-8 | мелочь | «Всё читается одним `db.snapshot`» не выполнимо буквально: `nameMaps` читает ClickHouse (`sources.pairAttributes`) вне PG-снимка, как и сегодня в `trackCatalog` | `aggregates.ts:267` |
| T2-9 | мелочь | Строки `registryRowOf` называются `releaseTitle` / `releaseDate` / `labelName` / `trackCount`. В плане у `TrackRelease.release` — `title` / `version` / `releaseDate` / `labelName` / `trackCount`, то есть `releaseTitle` переименовывается в `title`. Это надо сказать явно, чтобы не было двух названий | `release-registry.ts:130-146` |

**Заменить в T2** блоки «Источники» и «Правила полей»:

> **Вынести** из `aggregates.ts` в `facade/tracks.ts` помощники `nameMaps` и `registryByUpc` (как функции от `ctx`).
> `aggregates.ts` импортирует их оттуда. `tracks.ts` не импортирует `./aggregates`, `./calculation`, `./scope`,
> `./balance`, `./reports`.
>
> **Источники:**
> - `owners.listTracks({ isrcs })`;
> - `sources.pairAttributes({ isrcs })` (название и UPC из отчёта);
> - `owners.trackMeta.of(isrcs)` (полная мета, не `metaLookup`);
> - `owners.trackLabels.list()` (открытый интервал → `catalogLabel`);
> - реестр по UPC;
> - `artistsByIsrc` по `splits.listSplits({ isrcs })` / `listParticipations({ isrcs })`.
>
> **Правила полей:**
> - `meta`, `catalogLabel` и `title` при `titleSource = 'catalog'` — для любого ISRC организации.
> - `title` при `titleSource = 'report'` (из файла) — только если `viewer` видит ISRC. Иначе `title = null`,
>   `titleSource = null`.
> - Пустая строка названия считается `null` (D-243: ISRC не повторяется).
> - `artists` — только если `scopeOf(viewer).mayTouchIsrc(isrc)`, иначе `null`.
> - `releases` — только для видимого ISRC, иначе `null`. Элемент: `{ trackId: string | null, upc, title, release }`,
>   UPC = пары файлов ∪ `owners.tracks`.
> - `release` — строка реестра лейбла, который видит `viewer`. Для `ALL_VIEWER` — последняя обновлённая, как
>   `registryRows`. Чужая строка реестра → `release: null`.
> - ISRC без строки `owners.tracks`, без пары в файлах, без меты и без открытого интервала в ответ не попадает.

В «Тесты» T2 добавить: «менеджер лейбла A по ISRC файлов A не видит строку реестра лейбла B того же UPC».

---

## T3. Признак `readOnly` и `POST /tracks/query`

| # | Серьёзность | Находка | Доказательство |
|---|---|---|---|
| T3-1 | блокер | `subject: 'track'` | О2 |
| T3-2 | блокер | Счётчики `abilities.test.ts` | О1 |
| T3-3 | важно | Гварды по методу: контракт-заголовки, описания полей, `X-Audit` | О3 |
| T3-4 | важно | Замороженный список отказов `coverage.test.ts:36` | О4 |
| T3-5 | важно | Прогон менеджера (`api-contract.test.ts:956-981`) шлёт POST с телом `{ labelId, items: [{ labelId }] }`. Для «своей книги» ответ будет 400 `validation_error`; прогон его допускает (не 403 и не `label_required`). Отдельного теста «своя книга 200» прогон не даёт: его надо написать | `api-contract.test.ts:956-962, 976-980` |
| T3-6 | мелочь | `traceWrites` (`audit.ts:321`) общий для `operatorTrace`, `systemTrace`, `noOrgTrace`, `selfTrace`. Проверку `operationOf(req.method, req.path)?.readOnly` разумно ставить только в первый: остальные не обслуживают операции организации. `req.path` там относителен роутеру организации, как в `authorize.ts:44` | `audit.ts:321-364, 367` |
| T3-7 | мелочь | Ограничение «только при `method: 'post'` и `read` / `read_money`» требует сузить `Ability['action']` в ветке типа: `{ readOnly: true; method: 'post'; ability: Ability & { action: 'read' \| 'read_money' } }`. Выполнимо, но это перестройка объединения `ApiOperation` (`operations.ts:51-52`) | `operations.ts:11-52` |

Про MCP: проверено, POST-операции туда не попадают ни локально, ни удалённо. Фильтр `op.method === 'get'` стоит в
`src/api/mcp.ts:19`, локальный пакет умеет только GET (`mcp-connection.ts:26`). У `readOnly` в OpenAPI появится схема
безопасности `readToken` (`readsWithToken`, `openapi.ts:50`). Это верно: читатель вправе читать. Тест
`read-token.test.ts:76-86` трогает только не-чтения, поэтому не упадёт.

**Вставить в T3 «Обвязка»** пункты О1, О3, О4 и строку:

> Отдельный тест «менеджер своей книги → 200» (прогон менеджера даёт на этом теле 400 `validation_error`).

---

## T4. `TrackName` на `Track`

| # | Серьёзность | Находка | Доказательство |
|---|---|---|---|
| T4-1 | блокер | P5 показывает весь каталог: на живой базе `GET /tracks/catalog` отдаёт **25 854** ISRC. Поиск `keep` фильтрует по `meta.title` / `version` **всех** строк, а не только видимых. `useTracks(isrcs)` одним `POST /tracks/query` с лимитом 1 000 получит 400. Пачками по 1 000 — это 26 запросов на загрузку страницы | `pages/catalog/TracksPage.tsx:103-112, 129-135`; лимит T3 |
| T4-2 | важно | Группа 5 «удаление `trackMeta` / `meta` из ответов» противоречит §4 SPEC «не менять ответы, которые читает MCP» и самому T2 (`GET /tracks/catalog` байт в байт). Поля читают MCP-инструменты: `get-tracks-catalog`, `get-tracks-summary`, `get-releases-by-upc`, `get-owners-by-id-balance`, `get-artists-by-id-balance`. `meta` лежит и в `GET /sublabels/:id/report`, который §4 трогать запрещает. План §5 говорит только «старые **пропсы** удаляются» | `api-responses.ts:279, 333, 483`; список MCP; план §5 |
| T4-3 | мелочь | «12 мест» — это 11 файлов страниц плюс сам компонент. Все 11 есть в группах 1–4, так что группа «остальные» плана пуста. Это в порядке | `grep TrackName` |
| T4-4 | мелочь | Ключ: в плане `['tracks', isrcs]`, в SPEC `['tracks', 'query', …]`. Вариант SPEC лучше, `['tracks', …]` уже занят `trackKeys`. После записей немонетные ключи сбрасываются целиком (`queries/core.ts:61, 87`), поэтому `staleTime` 60 с безопасен | `queries/tracks.ts:8-20`; `queries/core.ts:57-61` |

**Заменить в T4** первый пункт и строку группы 5:

> - `useTracks(isrcs)` запрашивает только ISRC, которые **показаны** (строки на экране, как D-162), пачками по 1 000.
>   На P5 поиск и фильтр по названию продолжают работать по `meta` / `title` строки каталога (`GET /tracks/catalog`):
>   первая фаза P5 не меняется. `TrackName` на P5 берёт `TrackView` видимой строки, а пока он не пришёл — строит
>   его из строки каталога.
> - Группа 5: удаление старых **пропсов** `meta` / `fallbackTitle` и типа `TrackMetaLite` во фронте. Ответы API
>   (`trackMeta`, `meta` в строках) **не удаляются**: их читает MCP (§4). Удаление — отдельным решением вместе с
>   «MCP POST» из «Отложено».

---

## M1. `masterRows` в фасаде

| # | Серьёзность | Находка | Доказательство |
|---|---|---|---|
| M1-1 | важно | `parseIsrcList` переиспользовать нельзя: он разбирает **строку через запятую** с лимитом **500** и бросает `ValidationError`. M2 принимает массив до 5 000 | `aggregates.ts:25-29` |
| M1-2 | важно | `calcScoped` — замыкание в `aggregatesApi`, не в контексте. `labelContext` уже в `ctx` (`context.ts:204, 361`). «Экспортируй из контекста» для `calcScoped` значит перенести его в `context.ts`. Это не закрытая зона, но сказать надо явно | `aggregates.ts:82`; `context.ts:204` |
| M1-3 | важно | Срез `isrcs` под лейблом: `trackSummary` передаёт в расчёт **и** `isrcs: only`, **и** `labelIds: [lc.book.id]`. SPEC говорит только о пересечении с `visible`. Без `labelIds` в расчёт попадут единицы файлов других лейблов по тем же ISRC, и равенство с `trackSummary({ label })` сломается | `aggregates.ts:187-194` |
| M1-4 | важно | `isrcs: []` (пустая страница P5) и `isrcs` не задан — разные вещи. `scoped` трактует `[]` как «ничего» (`scope.ts:36`, `[]` truthy), но `asked ?? visible` в коде по образцу `trackSummary` подставит под лейблом весь `visible`, если вместо `[]` где-то окажется `undefined`. Нужна явная семантика | `aggregates.ts:187`; `scope.ts:32-39` |
| M1-5 | важно | `viewer` в сигнатуре не нужен: оба заменяемых ответа его не берут (`routes/aggregates.ts:33-34, 96`), права решает `can()` по `?label=`. Неиспользуемый аргумент без `_` уронит lint | `eslint.config` `no-unused-vars argsIgnorePattern '^_'` |
| M1-6 | мелочь | Равенство выполнимо. `release`: те же `calcScoped({ upcs, labelIds?, publishingLines: false })` и фильтр `u.upc === upc && u.isrc !== ''`. `trackSummary`: те же `isrcs` / `labelIds`. `sumUnits` зависит только от выбранных единиц (`cItems({ ...calc, units, publishing: [] })`), порядок ключей `cByReason` — от порядка `calc.units`, он одинаков. Ключ месяца: `reportingMonth` ↔ `month`, SPEC это учёл. Нулевые строки: `release().tracks` и `trackSummary().items` содержат зарегистрированные треки без единиц. Отбрасывать их надо **с обеих сторон** по `net = B = C = ours = 0` и пустому `cByReason`. Строка с единицами и нулевой суммой у старого ответа тоже есть, так что сравнение работает | `aggregates.ts:51-63, 220-240, 447-489` |
| M1-7 | мелочь | Зерно `isrc,month` ни с чем не сравнивается. Нужен хотя бы инвариант | — |

**Заменить в M1** абзац «Общие помощники…»:

> `calcScoped` перенести в `context.ts` (`ctx.calcScoped`); `aggregates.ts` берёт его оттуда. `labelContext` уже в
> `ctx`. `parseIsrcList` не используется: формат и лимит 5 000 проверяет схема M2, фасад делает `assertIsrc`,
> убирает повторы и сортирует. Сигнатура без `viewer`: `masterRows(q, label?)`.

**Заменить в M1** пункт про срез `isrcs`:

> - `isrcs` — как `trackSummary()` (`aggregates.ts:185-194`): `only = lc ? (isrcs ?? [...lc.visible.isrcs]).filter(visible) : isrcs`;
>   расчёт `calcScoped({ isrcs: only?, labelIds: lc ? [lc.book.id] : undefined, from/to/basis из period, publishingLines: false })`.
>   `isrcs: []` → `rows: []` и нулевые `totals` без расчёта; `isrcs` не задан → весь срез.

В «Тест равенства» добавить:

> нулевые строки отбрасываются с обеих сторон; инвариант: строки `isrc,month`, сложенные по ISRC (в тесте,
> `Decimal`), дают строки `isrc`.

---

## M2. `POST /money/master/query?label=`

| # | Серьёзность | Находка | Доказательство |
|---|---|---|---|
| M2-1 | блокер | `subject: 'track'` | О2 |
| M2-2 | блокер | Счётчики `abilities.test.ts` | О1 |
| M2-3 | важно | `refusal` в `coverage.ts` и `coverage.test.ts:36` | О4 |
| M2-4 | мелочь | Заменяемый `GET /tracks/summary` помечен `explain: true` (D-178: описание полей денежного ответа в OpenAPI для Claude). Новому денежному ответу нужно то же | `operations.ts:583` |
| M2-5 | мелочь | «Маршрут передаёт `viewerOf(res)`» — снять, см. M1-5 | — |

Прогон менеджера даст `L`: без метки 400 `label_required`, с чужой 403, со своей и неверным телом 400
`validation_error`. Это проходит.

**Вставить в M2:** `explain: true`; счётчики О1; `refusal` по О4; убрать `viewerOf(res)`.

---

## M3. Сверка и замер на живой базе

| # | Серьёзность | Находка | Доказательство |
|---|---|---|---|
| M3-1 | важно | Три разных порога скорости. GOAL «Готово» 3: «время не хуже старого». План §6: «не больше, чем у старого». SPEC: «≤ 1,2 × старого». По правилу SPEC прав план, то есть 1,0×. На живой базе разброс одного прогона больше 20 %, так что порог без правила замера ненадёжен | GOAL:13; план §6 M3; SPEC:273 |
| M3-2 | мелочь | `connectOrg` есть (`src/connect-sources.ts`). `data/` в git не попадает (`.gitignore:15`), так что отчёт не закоммитится. Это и нужно | — |
| M3-3 | мелочь | После M7 старые ответы `release()` без денег, и скрипт M3 перестанет собираться. Надо сказать, что M3 — разовая сверка и в M7 её удаляют или замораживают | см. M7-2 |

**Заменить в M3 «Готово»:**

> 0 расхождений. Время — медиана 3 прогонов каждого запроса подряд. Новое ≤ старого (план), допуск — разброс
> старого между прогонами. Иначе стоп.

---

## M4. Подготовка фронта (R2′)

| # | Серьёзность | Находка | Доказательство |
|---|---|---|---|
| M4-1 | важно | `MONEY_PATH` содержит `releases\/[^/]+`, то есть `GET /releases/:upc` — денежный вызов, пока M7 не снимет с него деньги | `e2e/helpers.ts:111-112` |
| M4-2 | мелочь | Тот же шаблон совпадает и с `GET /releases/registry`: старая неточность, к шагу не относится. Если правите шаблон, добавьте исключение | `e2e/helpers.ts:112` |

**Вставить в M4:**

> Фильтр метода в `openAs`: `r.method() === 'GET' || (r.method() === 'POST' && /^\/api\/v1\/money\//.test(path))`.
> `GET /releases/:upc` остаётся в `MONEY_PATH` до M7.

---

## M5. P8 на блоках

| # | Серьёзность | Находка | Доказательство |
|---|---|---|---|
| M5-1 | блокер | `expectMoneyCalls = 2` неверно. После M5 P8 делает `GET /releases/:upc` (шапка и нулевые треки; это всё ещё `MONEY_PATH`, M4-1) и два POST, **итого 3**. 2 будет только после M7, когда `releases/[^/]+` уйдёт из `MONEY_PATH`, а `['releases', 'detail']` — из `MONEY_KEYS` | `e2e/helpers.ts:112`; `e2e/golden/11-release.spec.ts:21`; `queries/core.ts:33-34` |
| M5-2 | важно | Порядок. M5 берёт `useTracks`, а это T4 (клиент и хук), и правит `ReleasePage.tsx`, который T4 переводит в группе 1. GOAL говорит «M5 после T3», хотя нужно «после T4 группы 1». Иначе два агента правят один файл | GOAL:37; SPEC T4 группа 1 |
| M5-3 | мелочь | Образец `49-sublabels.spec.ts:58-72` берёт ответ через `page.request.get(...)`, а не `page.waitForResponse`. Оба варианта работают: `page.request` не попадает в счётчик `page.on('request')`. Но ссылка противоречит тексту | `e2e/golden/49-sublabels.spec.ts:58-63` |
| M5-4 | мелочь | Клиент денег живёт в `src/api/catalog.ts` (`catalog.release`, `catalog.trackMoney`), не в `client.ts`. `useMasterRows` разумно положить туда же, хук — в `queries/money.ts` | `queries/releases.ts:21`; `queries/tracks.ts:53` |

**Заменить в M5** последний пункт e2e:

> `expectMoneyCalls(page, 3)` (GET `/releases/:upc` + два POST). В M7 — 2.

**Заменить в GOAL «Как работать»** «M5 идёт после T3» на:

> M5 — после T4 группы 1 и M4; M6 — после M5 (тот же блок) и T4 группы 1.

---

## M6. P5, вторая фаза

| # | Серьёзность | Находка | Доказательство |
|---|---|---|---|
| M6-1 | блокер | У P5 есть колонка `months` («N: from – to»), а `valueGetter` читает `money.months.{count, from, to}` из `TrackSummaryItem`. У `MasterRow` зерна `isrc` месяцев нет. С зерном `isrc,month` суммы по ISRC пришлось бы складывать на клиенте, а это отложенный Р1. Нужен второй запрос (`isrc,month`, только для `count` / `min` / `max`, без сложения денег) или решение владельца снять колонку | `pages/catalog/TracksPage.tsx:324-330` |
| M6-2 | важно | e2e P5 живут в `golden/12-track.spec.ts:209-260`, а не в `40-catalog`. Строка `:212` ждёт именно `waitForRequest(… '/api/v1/tracks/summary?')`, её придётся менять | `e2e/golden/12-track.spec.ts:212, 217` |
| M6-3 | важно | «Посчитать все» (`all=1`) сегодня берёт **строки** из `summary.data.items`: название, артисты, UPC, флаги, `months`. Срез без списка вернёт только деньги. Строки надо брать из каталога (`fullRows` → `pagedRows` + деньги), и это меняет набор строк. Каталог под лейблом включает ISRC открытого интервала без единиц, а `trackSummary` их не включает | `TracksPage.tsx:118-128`; `aggregates.ts:284-287` |
| M6-4 | мелочь | Сегодня страница P5 ≤ 500 строк (`parseIsrcList`), поэтому «пачками до 5 000» сведётся к одному запросу. Достаточно сказать «одним запросом на видимые» | `aggregates.ts:27` |

**Заменить в M6** первые пункты:

> - Видимые строки: `useMasterRows({ kind: 'isrcs', isrcs: видимые }, 'isrc')`, один запрос.
> - Колонка `months`: **вопрос владельцу до шага**. Варианты: второй блок `isrc,month` только для count / from / to
>   (два денежных запроса на P5) или снять колонку. До ответа M6 не начинать.
> - «Посчитать все»: строки — из `GET /tracks/catalog` (как первая фаза), деньги — срез без списка. Строки без
>   денег показывают «—». Расхождение набора строк с прежним `all=1` записать в D-запись.
> - e2e: `golden/12-track.spec.ts:209-260` (ожидание запроса `:212` — на `POST /money/master/query`), плюс
>   `40-catalog`.

---

## M7. Удаление

| # | Серьёзность | Находка | Доказательство |
|---|---|---|---|
| M7-1 | блокер | Снятие денег с `GET /releases/:upc` ломает тесты, которые SPEC не упоминает: `scope.test.ts:98-99` (scoped = full для `release`), `:665-667`, `:815-816` (`release.tracks` / `months` с `net`), `aggregates.test.ts:350-363` («tracks and months add up») и сам тест равенства M1, у которого исчезнет оракул. По правилу GOAL «не ослаблять гварды» оркестратор встанет | указанные строки |
| M7-2 | важно | `GET /releases/:upc` читает MCP (`get-releases-by-upc`). Правило самого M7 «удалить только то, у чего потребителей ноль» и §4 «не менять ответы MCP» запрещают снимать деньги, пока есть MCP-инструмент. План (M7) снимает их безусловно — это противоречие плана и SPEC | §4 SPEC; план §6 M7; список MCP |
| M7-3 | важно | Если `release()` перестаёт считать, набор ISRC релиза и ответ 404 (`aggregates.ts:452-455`) должны идти из `sources.pairAttributes({ upcs })` и реестра, а не из `calc.units`. Если считать продолжает, выигрыша нет. SPEC не выбирает. Перестанет считать — в `MONEY_PATH` / `MONEY_KEYS` его больше нет, `expectMoneyCalls` на P8 = 2, ability можно оставить `read_money` (ответ менеджера `L` тот же) | `aggregates.ts:447-455` |

**Заменить в M7** первый пункт:

> - **Вопрос владельцу до шага** (противоречие плана и §4): снимать ли деньги с `GET /releases/:upc`, пока его
>   читает MCP `get-releases-by-upc`.
> - Если «да», в том же коммите:
>   - `release()` больше не считает: ISRC — из `pairAttributes({ upcs })` ∪ `owners.tracks`, 404 — как раньше по
>     трём источникам;
>   - `scope.test.ts:98-99` переносятся на `masterRows` (тот же срез, те же `units`);
>   - `scope.test.ts:665-667, 815-816` и `aggregates.test.ts:350-363` переписываются на `masterRows` с **теми же
>     числами**;
>   - тест равенства M1 переходит с живого `release()` на зафиксированные строки, снятые до удаления;
>   - `MONEY_PATH` без `releases/[^/]+`, `MONEY_KEYS` без `['releases', 'detail']`, P8 `expectMoneyCalls = 2`;
>   - скрипт M3 удаляется (разовая сверка) или переводится на сохранённый отчёт.

---

## «Отложено» и закрытая зона

- **Закрытая зона не задета ни одним шагом.** `calcScoped` вызывает `scoped()` / `calculate()` без правок.
  `scope.test.ts` — тест, а не код. `scope.ts` менять не нужно: `isrcs: []` уже значит «ничего».
- **Живая база.** Только чтение в M3. Тесты работают на частных базах (`REQUIRE_STACK=1`), e2e — на `erp_e2e` под
  замком. Риска записи нет.
- **SPEC против «Отложено».** T4 группа 5 (удаление полей ответов) в плане отсутствует и противоречит §4 (T4-2).
  Снятие денег с `/releases/:upc` в M7 противоречит §4 (M7-2). Остальное совпадает: паблишинга, рекламы, срезов
  `owner` / `artist` / `track` / `book`, `decimal.js` в шагах нет.

## Мелочи вне шагов

- §0 SPEC: «Следующий свободный — … это D-243». D-243 — последний занятый, первый свободный — **D-244**. Заменить на
  «последний — D-243, первый новый — D-244».
- §0: рабочая копия содержит незакоммиченные правки `GOAL.md` / `SPEC.md`. `git switch -c` унесёт их в новую ветку,
  и они попадут в первый коммит шага. Сначала закоммитить их в `feature/fable-003` (или явно в первом коммите
  новой ветки).
- Ссылки на код проверены и верны: `aggregates.ts:181-208, 252, 447-451`, `operations.ts:17, 1871`,
  `audit.ts:321` (проверка метода на `:332`), `TrackName.tsx:17`, `manager-answers.ts:97, 100`,
  `e2e/helpers.ts:112-123` (±1 строка).
