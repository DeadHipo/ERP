# SPEC: шаги T1–T4 и M1–M7

Спецификация к `GOAL.md`. Источник решений — `план.md` (v4). Если SPEC и план расходятся, прав план. Если план молчит,
остановись и спроси. Пути бэкенда даны от `packages/backend/`, фронта — от `packages/frontend/`.

## 0. Перед началом

**Прочитать:**
- `CLAUDE.md`;
- `packages/frontend/CLAUDE.md`, `packages/backend/tests/CLAUDE.md`, `src/facade/CLAUDE.md`;
- `план.md`;
- `аудит/04_проверка_v3.md` и `05_реализуемость.md` — там ссылки на код.

**Стек:**
- `docker compose -f docker-compose.yml -f docker-compose.dev.yml up -d`;
- `npm ci`;
- исходный прогон DoD до первого изменения. Если он красный, остановись и сообщи: это не твоя поломка.

**D-номера.** Следующий свободный — после последнего `## D-` в `docs/97_принятые_решения.md` (на 2026-11-19 это
D-243). Один шаг — одна D-запись. Пиши её в стиле соседних записей: что, почему, что не меняется, тесты. Добавь строку
в `docs/agents/03_decision_index.md`. Старые записи не правь.

**Справочники агентов.** Если поведение меняется, обнови `packages/frontend/CLAUDE.md` (хуки страниц) и
`src/facade/CLAUDE.md`.

## 1. Протокол оркестратора

| Фаза | Кто | Вход | Выход |
|---|---|---|---|
| Исполнение | агент-исполнитель (worktree, если параллельно) | раздел шага из SPEC, список файлов, DoD шага | diff + тесты + черновик D-записи |
| Ревью | независимый агент | только diff и раздел шага, без выводов исполнителя | список замечаний: блокер / важно / мелочь |
| Приёмка | ты | diff после правок | полный DoD, коммит |

**Ревьюер проверяет:**
- деньги не изменились: нет правок в закрытой зоне, тест равенства есть и сравнивает строки;
- права = права заменяемой операции, строка в `manager-answers.ts` есть;
- у новой операции есть всё: `operations.ts` (`access`, `ability`), `coverage.ts`, сценарий в `api-contract.test.ts`,
  описания полей схем;
- нет `await` без нужды и нет пропущенного `await`;
- нет персональных данных;
- нет лишнего из «Отложено».

**e2e:**
- Перед запуском возьми замок: `mkdir data/test-tmp/e2e.lock`. Если не вышло, жди. После — `rmdir`.
- Для итераций агенту нужен свой стенд (см. «A private stand» в `packages/frontend/CLAUDE.md`).
- Полный `npm run e2e` под замком запускаешь только ты, на приёмке.

**Перед каждым коммитом:**

```bash
npm run typecheck
```

```bash
npm run lint
```

```bash
REQUIRE_STACK=1 npm test
```

```bash
npm run build:client
```

```bash
npm run e2e
```

`npm run e2e` нужен, если шаг трогает фронт или API, которое читает фронт.

## 2. Линия «Трек»

### T1. `baseTitleOf` и схема `Track`

**Файлы:**
- `packages/shared/src/track-title.ts` (новый): `baseTitleOf(title: string | null, version: string | null): string | null`.
  Логика сегодня живёт в `components/TrackName.tsx:17`: если `title` заканчивается на ` - ${version}`, суффикс
  отрезается, иначе возвращается `title`.
- `packages/shared/src/api-responses.ts`: схемы `metaSchema`, `trackReleaseSchema`, `trackSchema`. Поля — по плану
  §3.1, у каждого `.describe('D-NNN: …')`.
  - `Meta` = поля `owners.track_meta` (D-238) плюс `baseTitle`.
  - `releases` и `artists` допускают `null`: так помечено «не видно».

**Тесты:** `packages/shared` — `baseTitleOf` на случаях:
- версия в конце;
- версии нет;
- `title` = `null`;
- версия в середине (не режется);
- точный суффикс ` - Slowed`.

**Без** изменения поведения и без e2e. D-запись: «модель Track».

### T2. `tracksOf` в фасаде

**Файл** `src/facade/tracks.ts` (новый): `tracksOf(isrcs: string[], viewer: Viewer = ALL_VIEWER): Promise<Record<string, Track>>`.

Источники берутся из тела `trackCatalog` (`facade/aggregates.ts:252`):
- `owners.listTracks({ isrcs })`;
- `nameMaps` (название из отчёта);
- `metaLookup` (мета);
- история `track_labels` (открытый интервал → `catalogLabel`);
- `registryByUpc` (релизы);
- `artistsByIsrc` по сплитам и участиям (ники, отметка MC с строки сплита).

Всё читается одним `db.snapshot`.

**Правила полей:**
- `title`: первая строка каталога; если её нет — название из отчёта; иначе `null`.
- `titleSource` — откуда взято `title`.
- `meta`, `title`, `catalogLabel` — для любого ISRC организации.
- `releases`, `artists` — только если `viewer` видит ISRC (`mayTouchIsrc` или его аналог в `facade/viewer.ts`), иначе
  `null`.
- ISRC, который организация не знает (нет ни строки каталога, ни единицы, ни меты), в ответ не попадает.

**Рефакторинг:** `trackCatalog` строит свои строки через общие помощники `tracks.ts`. Ответ `GET /tracks/catalog`
остаётся байт в байт прежним.

**Тесты:**
- `tests/tracks.test.ts` (новый): поля, источник названия, `null` для невидимого (`labelsViewer`), отсутствие
  неизвестного ISRC.
- `catalog.test.ts` и `aggregates.test.ts` — без правок.
- В `boundaries.test.ts` новый случай: `facade/tracks.ts` не импортирует `./calculation`, `./scope`, `./balance`,
  `./reports`, `./aggregates`.

### T3. Признак `readOnly` и `POST /tracks/query`

**Признак `readOnly` (план §4.3):**
- `src/api/operations.ts`: поле `readOnly?: true` в `ApiOperation`. На уровне типа оно разрешено только при
  `method: 'post'` и `ability.action` ∈ `read | read_money`.
- `needsOperator` (`:1871`) возвращает `false` для `readOnly`. OpenAPI не требует `X-Operator`.
- `src/api/audit.ts` `traceWrites` (`:321`): не пишет журнал для `readOnly`. Решение принимается по
  `operationOf(req)`, а не по методу.
- Фронт `src/api/client.ts` `call()`: `readOnly`-операция не требует оператора и `X-Audit`. Признак клиент берёт из
  своей функции операции (флаг в `client.ts`), рукописных DTO нет (`tests/no-dto.test.ts`).
- `originGuard`, `noStore` и `authorize` не меняются.

**Маршрут `POST /tracks/query`:**
- тело `{ isrcs: string[] }`, 1…1 000 элементов, формат ISRC проверяет `api-schemas.ts`;
- ответ `{ tracks: Record<isrc, Track> }`;
- `access: 'org'`, `ability: { action: 'read', subject: 'track', scope: 'record' }`;
- в маршрут передаётся `viewerOf(res)`.

**Обвязка:**
- `tests/helpers/manager-answers.ts`: строка `R`;
- `src/api/coverage.ts` (фронт): `refusal` с причиной «используется с T4», затем страница;
- `api-contract.test.ts`: вызов в сценарии.

**Тесты:**
- после `POST /tracks/query` в `audit` ни одной новой строки;
- запрос без `X-Operator` даёт 200;
- менеджер чужого лейбла получает `releases` / `artists` = `null`, а `meta` — нет;
- 1 001 ISRC → 400.

D-запись: POST-чтение как исключение из D-140, плюс довод про CSRF (план §4.3).

### T4. `TrackName` на `Track`

- `src/api/client.ts`: `tracks.query(isrcs)`.
- `src/api/queries/tracks.ts`: `useTracks(isrcs)`. Ключ `['tracks', 'query', isrcs отсортированные]`, `staleTime`
  60 с, ключа нет в `MONEY_KEYS`.
- `components/TrackName.tsx`: `TrackName({ track })` или `TrackName({ isrc, track? })`. Название —
  `meta?.baseTitle ?? title ?? isrc`, без локального отрезания.

**Группы, по коммиту на каждую:**

| Группа | Файлы |
|---|---|
| 1 | P8 `pages/catalog/ReleasePage.tsx`, P5 `pages/catalog/TracksPage.tsx` |
| 2 | P10 `pages/owners/BalanceTab.tsx`, `pages/owners/tabs.tsx`; P12 `pages/artists/ArtistBalanceTab.tsx`, `pages/artists/tabs.tsx` |
| 3 | P15 `pages/reference/splits/SplitsPage.tsx`, P16 `ParticipationsPage.tsx` |
| 4 | P36/P37 `pages/reference/sublabels/ReportTab.tsx`, `SuggestionsTab.tsx`, `TermsTab.tsx` |
| 5 | удаление старых пропсов `meta` / `fallbackTitle`; удаление `trackMeta` / `meta` из ответов, которые больше никто не читает (`f.trackMeta` в загрузчике D-241 остаётся) |

- Хуки `track-name-<isrc>` и `track-version-<isrc>` не меняются, поэтому e2e-спеки остаются как есть.
- Проверка в браузере: обложка, название, версия на каждой странице группы.
- Значения для фильтра и экспорта грида (`valueGetter`) берутся из `Track`.

## 3. Линия «Деньги»

### M1. `masterRows` в фасаде

**Файл** `src/facade/money.ts` (новый):

```ts
masterRows(
  q: { scope: { kind: 'release'; upc } | { kind: 'isrcs'; isrcs?: string[] };
       grain: 'isrc' | 'month' | 'isrc,month';
       period?: { from?; to? } },
  label?: string, viewer?: Viewer,
): Promise<{ rows: MasterRow[]; totals: MoneySums; calculatedAt: string }>
```

**Выбор единиц** повторяет код и не изобретает нового:
- `release` — как `release()` (`aggregates.ts:447-451`):
  `calcScoped({ upcs: [upc], labelIds?, publishingLines: false })`, затем единицы `u.upc === upc && u.isrc !== ''`.
- `isrcs` — как `trackSummary()` (`aggregates.ts:181-208`):
  - под лейблом список пересекается с `lc.visible.isrcs`;
  - без списка берётся весь `visible`;
  - под «Все» без списка — все единицы с ISRC.
- `period` — по месяцу отчёта (`from` / `to`, `basis: 'report'`).

**Группировка и суммы:**
- группы — по ключам зерна; суммы — `sumUnits(calc, us)`;
- `totals` = `sumUnits` всех выбранных единиц;
- порядок строк — ключи по возрастанию; строк без единиц нет.

Общие помощники (`labelContext`, `calcScoped`, `parseIsrcList`) переиспользуй: экспортируй из контекста фасада, не
копируй.

**Тест равенства** `tests/money-rows.test.ts`. Мир — синтетический: два лейбла, релиз из трёх ISRC, один ISRC без
единиц, C разных причин. Сравнивай `JSON.stringify` денежных полей (`net, B, C, ours, cByReason`) по ISRC с
ненулевыми суммами:

| Новое | Старое |
|---|---|
| `release`, `isrc` | `release(upc, label).tracks` |
| `release`, `month` | `release(upc, label).months` (`reportingMonth` ↔ `month`) |
| `isrcs` со списком и без, под лейблом и под «Все», `isrc` | `trackSummary({ isrcs, label }).items` |
| `totals` | `sumUnits` тех же единиц |

Плюс кейс в `scope.test.ts`: тот же срез по полному расчёту даёт тот же ответ.

### M2. `POST /money/master/query?label=`

- Схемы в `api-schemas.ts` (тело) и `api-responses.ts` (`masterRowSchema`, `moneySumsSchema`, ответ).
- `MasterGrain` — `z.enum`.
- `isrcs` ≤ 5 000.
- `readOnly: true`, `access: 'org'`, `ability: { action: 'read_money', subject: 'track', scope: 'label' }`.
- Маршрут передаёт `label` из query и `viewerOf(res)`.

**Обвязка:**
- `manager-answers.ts`: `L`;
- `coverage.ts`: `refusal` до M5;
- сценарий контракта.

**Тесты:**
- контракт;
- проход менеджера: своя книга 200, без метки 400 `label_required`, чужая 403;
- нет строк журнала.

D-запись должна покрывать запрос, права (= заменяемых, Р13) и R2′ (Р12).

### M3. Сверка и замер на живой базе

**Скрипт** `scripts/check-master-rows.ts [--org <id>]`. Только чтение, `connectOrg`.

Для каждой своей книги и для «Все»:
- по 20 релизам с наибольшим `net` и по всем ISRC сравнить M1 со старыми ответами, теми же правилами, что в тесте M1;
- замерить время и размер JSON старого и нового ответа для «isrcs без списка» и для одного большого релиза.

**Отчёт** — `data/mvp-load/verify/master-rows-<дата>.json` плюс краткий `.md`. В отчёте только ISRC, UPC и суммы, имён
нет.

Запускает оркестратор на `.env` живого стека; API не нужен. Это не коммит кода с изменением поведения, но скрипт
коммитится.

- **Готово:** 0 расхождений, новое время ≤ 1,2 × старого.
- **Иначе:** стоп и вопрос владельцу (GOAL).

### M4. Подготовка фронта (R2′)

- `src/api/queries/core.ts`: `MONEY_KEYS` + `['money', 'master']`.
- `e2e/helpers.ts:112-123`: `MONEY_PATH` видит и `POST /money/master/query`. Фильтр метода — GET или POST по
  `readOnly`-путям.
- `expectMoneyCalls(page, n)` считает блоки: на P8 после M5 их будет 2 вместо 1. Правь ожидание только в спеке
  переведённой страницы и только в её шаге.
- `packages/frontend/CLAUDE.md`: R2 → «один денежный запрос на блок; баланс — отдельный ответ своей страницы».

Экраны не меняются, e2e зелёный.

### M5. P8 на блоках

- `pages/catalog/ReleasePage.tsx`:
  - таблица треков — `useMasterRows({ kind: 'release', upc }, 'isrc')` + `useTracks`;
  - таблица месяцев — `useMasterRows(…, 'month')`;
  - итог — `totals`.
- Нулевые треки релиза и шапка (название, артисты, реестр, обложка) остаются из `GET /releases/:upc`.
- Общие блоки — в `components/money-blocks/`: `TracksMoneyBlock`, `MonthsMoneyBlock`.
- Хуки `release-track-<isrc>`, `release-month-<month>`, `[data-col=…]` прежние.
- e2e `golden/11-release`:
  - числа не меняются;
  - добавить проверку «экран = API»: снять ответ `page.waitForResponse` и сравнить ячейки, по образцу
    `49-sublabels.spec.ts:58-72`;
  - `expectMoneyCalls` = 2.

### M6. P5, вторая фаза

- `pages/catalog/TracksPage.tsx`:
  - первая фаза без изменений: `GET /tracks/catalog`;
  - деньги видимых строк — `useMasterRows({ kind: 'isrcs', isrcs: видимые }, 'isrc')` пачками до 5 000 вместо
    `GET /tracks/summary?isrcs=`;
  - «посчитать все» — срез без списка.
- Фильтры `account` и `month` с P1 остаются на старом `GET /tracks/summary`: в `MasterGrain` и в фильтрах M1 их нет.
  Это записывается в D-запись.
- Хуки `money-pending`, `tracks-visible-money`, `tracks-all-money` прежние.
- e2e: `golden/40-catalog` и спеки P5.

### M7. Удаление

- Из `GET /releases/:upc` убрать денежные поля `tracks[]` и `months[]` (оставить справочные) и обновить схему ответа.
- `GET /tracks/summary` не удалять, пока его читают:
  - режим P5 «account / month»;
  - MCP `get-tracks-summary`;
  - `scripts/compare-reference.ts`.

  Пометить его в 97 как оставленный, с причиной.
- Удалить только то, у чего потребителей ноль. Проверь это поиском по `packages/` и `scripts/`.

## 4. Чего не делать

- Ничего из таблицы «Отложено» плана.
- Не трогать: паблишинг, рекламу, срезы `owner` / `artist` / `track` / `book`, `byArtist`, P7 `net`,
  `/sublabels/:id/report`, MCP, `decimal.js` во фронте.
- Не менять ответы, которые читает MCP, кроме удаления в M7 по правилу выше.
- Не трогать живую базу на запись. Не менять `.env`.
