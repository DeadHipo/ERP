# SPEC: шаги T1–T4 и M1–M7

Спецификация к `GOAL.md`. Версия 4: справочник из трёх мап (аудит `08_линия_трек.md`); сквозная проверка и пробный
прогон (`аудит/09_сквозная_проверка.md`, `аудит/10_пробный_прогон.md`); раньше учтены аудиты
`аудит/06_spec_против_кода.md` и `аудит/07_готовность_оркестратора.md`.

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
BASE=$(git -C $W merge-base feature/fable-003 feature/fable-004-tracks-money)   # точка ответвления; в отчёт, раздел 2
```

**Worktree `fable-004-base`** (для §1.5) создаётся, только когда он понадобится, на вершине ветки до шага:

```bash
git -C $R worktree add --detach $R/.claude/worktrees/fable-004-base <вершина ветки до шага>
cd $R/.claude/worktrees/fable-004-base && ln -s $R/.env .env && mkdir -p data/test-tmp && npm ci
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
- Инструменты `mcp__erp__*` и скрипты `packages/backend/scripts/*` (кроме `e2e/seed.ts`, `e2e/drop.ts` и M3) не
  запускаются никем: с `.env` они читают живую базу.

### Стек и исходный прогон

- **Контейнеры** уже запущены (`docker ps`). Если PostgreSQL или ClickHouse не отвечают — стоп, сам не поднимай.
- **Браузер Playwright:** `npx playwright install chromium` — только если Playwright сообщает, что браузера нет.
- **Исходный прогон** в `$W` до первой правки — полный DoD (§1.2, все пять команд).
  - В отчёт запиши: коммит `BASE`, число тестов backend / frontend, e2e passed, время.
  - Число тестов сравнивается с фактом этого прогона, не с `CLAUDE.md` (там 674 + 102; последний лог — 673 + 5
    skipped и 106). Несовпадение с `CLAUDE.md` — не стоп.
  - Красный прогон — один повтор последовательно (§1.5). Снова красный — стоп всей работы.

### Прочитать

- `CLAUDE.md`;
- `packages/frontend/CLAUDE.md`, `packages/backend/tests/CLAUDE.md`, `src/facade/CLAUDE.md`;
- `план.md`;
- аудиты `06`, `07`, `08`, `09`, `10`: в них ссылки на код и доводы.

### D-номера

- Последний занятый номер — D-243, первый новый — D-244. Номер ставит оркестратор при коммите.
- Исполнитель сдаёт черновик записи как `D-XXX` и в коде (`.describe`, комментарии) пишет `D-XXX`.
- Перед коммитом `git grep -n 'D-XXX\|D-NNN' -- packages` пуст: оркестратор заменяет заглушки номером.
- 97, `docs/agents/03_decision_index.md`, `frontend/CLAUDE.md` и `facade/CLAUDE.md` правит только оркестратор, при
  приёмке. Он же правит `docs/agents/19_golden_screens.md`, если шаг меняет golden-спецификацию (T4.1, M5, M6).
- Каждый коммит несёт свою D-запись и строку индекса (GOAL п. 5).
- **T4:** запись T4.1 описывает модель, кеш и загрузчик. T4.2 и T4.3 — короткие свои записи со ссылкой на запись T4.1
  и сменами поведения группы. T4.4 — своя запись: что снято с каких ответов, что осталось и почему. Старые записи не
  правятся.
- **M3:** своя D-запись, в ней только счётчики, время и размер, без ISRC и UPC.
- Дубль D-237 в индексе не трогай.

## 1. Протокол

### 1.1 Фазы шага

| Фаза | Кто | Вход | Выход |
|---|---|---|---|
| Исполнение | исполнитель (в `$W`; при паре — в своём worktree) | раздел шага, DoD шага | diff, тесты, черновик D-записи |
| Ревью | независимый агент | diff шага (см. ниже), файлы копии, раздел шага | замечания: блокер / важно / мелочь |
| Приёмка | оркестратор | diff после правок | DoD §1.2, D-запись, коммит, строка в отчёте |

Исполнитель запускает только `npm run typecheck` и свои файлы тестов. Полный DoD — у оркестратора.

**Diff для ревью** включает новые файлы. Без пары оркестратор делает `git add -A` в `$W`, ревьюер смотрит
`git diff --cached HEAD`. В паре — `git diff <вершина>...fable-004/<шаг>` (ветка исполнителя закоммичена, §1.4).
Ревьюер ничего не запускает, кроме `git` и `grep`; базу, тесты и `mcp__erp__*` не трогает.

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

Плюс перед каждым коммитом проверки. Они идут по индексу (`git add -A`), а не по коммитам: шаг (и squash-слияние
пары) ещё не закоммичен. Закрытая зона и `manager-answers.ts` сверяются с точкой ответвления `BASE` (§0), защитные
тесты — с вершиной ветки, то есть только этот шаг.

```bash
cd /Users/nearlydeadhipo/Desktop/0to8/ERP/.claude/worktrees/fable-004 && git add -A
BASE=$(git merge-base feature/fable-003 feature/fable-004-tracks-money)
# 1. закрытая зона (вывод пуст)
git -c core.quotepath=false diff --cached --name-only $BASE -- \
  packages/backend/src/facade/calculation.ts packages/backend/src/facade/layers \
  packages/backend/src/facade/balance.ts packages/backend/src/facade/owner-scope.ts \
  packages/backend/src/facade/scope.ts packages/backend/migrations
# 2. .env git не видит (.gitignore): это по-прежнему ссылка на живой .env
[ "$(readlink .env)" = "/Users/nearlydeadhipo/Desktop/0to8/ERP/.env" ] && echo ok
# 3. manager-answers.ts только добавляется (вывод пуст)
git diff --cached -U0 $BASE -- packages/backend/tests/helpers/manager-answers.ts | grep '^-[^-]'
# 4. защитные тесты только добавляются (вывод — только исключения, названные шагом)
git diff --cached -U0 HEAD -- packages/backend/tests/{boundaries,rules-coverage,api-contract,org-scope,golden,api-descriptions}.test.ts \
  packages/backend/tests/layers/exactness.test.ts packages/frontend/tests/no-dto.test.ts | grep '^-[^-]'
```

Защитные тесты: `boundaries`, `rules-coverage`, `api-contract`, `org-scope`, `golden`, `layers/exactness`, `no-dto`,
`api-descriptions`. В их diff только добавления. Исключения — правки, прямо названные в шаге:

- счётчики `abilities.test.ts`, список отказов `coverage.test.ts`;
- правило записи в `api-contract.test.ts` и `api-descriptions.test.ts` (T3);
- `org-scope.test.ts` (T3): условие `:576` становится `o.method !== 'get' && !o.readOnly` (POST-чтение проверяется
  как чтение: тот же ответ, что на неизвестный id, и без утечек); `CASES` дополняется (T3, M2);
- фронт `tests/stage5-helpers.test.ts:69` (T3): `o.method !== 'get' && !o.readOnly` (подписи журнала только у
  записей).

### 1.3 e2e, частный стенд, браузер

**Замок** — один на машину, всегда по абсолютному пути основной папки. e2e запускается одной фоновой командой
(`run_in_background`), не foreground: foreground `sleep` харнесс блокирует, предел команды — 10 минут.

```bash
L=/Users/nearlydeadhipo/Desktop/0to8/ERP/data/test-tmp/e2e.lock
cd /Users/nearlydeadhipo/Desktop/0to8/ERP/.claude/worktrees/fable-004 && \
until mkdir $L 2>/dev/null; do sleep 60; done; trap 'rmdir $L' EXIT INT TERM; \
! lsof -nP -iTCP:3100 -sTCP:LISTEN >/dev/null && npm run e2e > data/test-tmp/f4-e2e.log 2>&1; echo "E2E EXIT $?" >> data/test-tmp/f4-e2e.log
```

- `REQUIRE_STACK=1 npm test` и e2e — фоновыми командами с логом в `data/test-tmp/f4-*.log`; ждать уведомления, не
  опрашивать в цикле.
- :3100 занят — e2e не запускается; ждать, как при чужом замке.
- Обрыв по таймауту может оставить замок: тогда — правило «дольше 60 минут» ниже.

**Если ждёшь дольше 60 минут**, проверь процессы: `pgrep -fl "playwright|main.ts"`.

- Процессов нет ещё 10 минут — замок протух. Удали его и запиши это в отчёт.
- Процессы есть — жди дальше, а пока делай шаги без e2e.

**Частный стенд** — для итераций исполнителя и проверки в браузере.

- Имя `f4<шаг>` (`a-z0-9_`).
- Порт 3150–3199, у каждого исполнителя свой.
- До запуска — `npm run build:client` в той же копии: стенд отдаёт `dist`.
- До M2 стенд не нужен.

```bash
npx tsx packages/backend/scripts/e2e/seed.ts f4t41
DB_DATABASE=erp_f4t41 CLICKHOUSE_DATABASE=believe_f4t41 PAYOUT_THRESHOLD_CENTS=0 AUTH_MODE=on \
  AUTH_SECRET=$(openssl rand -hex 32) PORT=3151 ERP_DATA_DIR=data/test-tmp/e2e-data-f4t41 \
  npx tsx packages/backend/src/main.ts data/test-tmp/e2e-data-f4t41
```

- Без обоих `*_DATABASE=…_f4…` в начале команды стенд не запускается.
- `E2E_BASE_URL` и браузер — только на свой порт.
- Входить под пользователем из файла ключей стенда (`data/test-tmp/e2e-keys-f4t41.json`).
- Спецификация на стенде — из `packages/frontend`:
  `E2E_BASE_URL=http://127.0.0.1:3151 E2E_KEYS=<файл ключей> npx playwright test <файл>`.
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
  0. исполнитель пары коммитит свою работу в `fable-004/<шаг>` (без D-номера, `D-XXX`); перед слиянием
     `git -C <его worktree> status --porcelain` пуст;
  1. `git -c core.quotepath=false diff --name-only <вершина>...fable-004/<шаг>` обеих веток — пересечения быть не
     должно;
  2. ветки вливаются по одной: `git merge --squash fable-004/<шаг>`, затем D-запись, проверки и DoD §1.2, коммит;
  3. вторая ветка перебазируется на новую вершину, и для неё снова полный DoD.
- `facade/index.ts` в волне 3 правит только M1: `tracksOf` подключён в T2.
- Конфликт в общих файлах (`operations.ts`, `api-responses.ts`, `coverage.ts`, `manager-answers.ts`,
  `abilities.test.ts`) наугад не решай: верни шаг исполнителю на новую вершину.
- Стоп на M3 блокирует M4–M7. Линия «Трек» продолжается.

### 1.5 Падения и повторы

**Машина занята**, если видишь `Hook timed out`, `terminating connection due to administrator command` или минуты
вместо секунд. Тогда повтори упавшие файлы последовательно (в `packages/backend`):

```bash
REQUIRE_STACK=1 npx vitest run --no-file-parallelism --testTimeout=300000 --hookTimeout=120000 <файлы>
```

**Повтор снова красный** — прогони те же файлы на вершине ветки до шага (worktree `fable-004-base`, §0).

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

### 1.6 Брифы

**Исполнитель:**

```text
Ты исполнитель шага <ШАГ> в /Users/nearlydeadhipo/Desktop/0to8/ERP/.claude/worktrees/<копия> (ветка <ветка>).
Bash сбрасывает cwd: каждая команда начинается с `cd <абсолютный путь> &&`.
Задача — раздел <ШАГ> SPEC (ниже дословно) + SPEC §0 «База», §1.1, §1.2 (закрытая зона, защитные тесты и их
исключения). Прочитай CLAUDE.md, packages/backend/tests/CLAUDE.md, packages/backend/src/facade/CLAUDE.md
[, packages/frontend/CLAUDE.md].
Можно запускать: `npm run typecheck` (из корня копии); свои тесты —
`cd packages/backend && REQUIRE_STACK=1 npx vitest run tests/<файл>` и `cd packages/frontend && npx vitest run <файл>`;
частный стенд §1.3, если шаг просит браузер.
Нельзя: полный `npm test`, `npm run e2e`, `main.ts` и `npm run dev` вне частного стенда, scripts/* (кроме
e2e/seed.ts и e2e/drop.ts), инструменты mcp__erp__*, правка 97 / индекса / CLAUDE.md, закрытая зона, удаление строк
manager-answers.ts.
D-номер не ставь: в коде и черновике везде `D-XXX`; черновик D-записи — в ответе.
Сдача: [в паре — коммит в свою ветку, `git status --porcelain` пуст; без пары — без коммита].
Ответ: список файлов, добавленные тесты и их результат, черновик D-записи, отступления от SPEC с доводом.
<раздел шага дословно>
```

**Ревьюер:**

```text
Ты независимый ревьюер шага <ШАГ>, только чтение: ничего не правь и не запускай, кроме git и grep; базу, тесты,
mcp__erp__* не трогай. Копия: <путь>. Смотри <команда diff из §1.1> и любые файлы копии. Сверяй с разделом шага
(ниже) и с чек-листом SPEC §1.1 «Ревьюер проверяет».
Не повторяй выводы исполнителя — проверяй код. Ответ: замечания «блокер / важно / мелочь», у каждого файл:строка
и что должно быть; отдельно — всё, что касается денег, прав, защитных тестов, персональных данных.
<раздел шага дословно> <чек-лист §1.1 дословно>
```

## 2. Линия «Трек»

### T1. `baseTitleOf` и схема `TrackView`

**Файлы:**

- `packages/shared/src/track-title.ts` (новый): `baseTitleOf(title: string | null, version: string | null)`.
  - `title = null` или `''` → `null`.
  - Суффикс ` - ${version}` отрезается, только если `version` непуст и `title` на него оканчивается.
  - Иначе — `title`.
  - Результат `''` → `null`.

  Это не `baseTitle` из `facade/pubv2-links.ts`: тот нормализует названия для сопоставления песен. Скажи это в
  D-записи.
- `packages/shared/package.json`, `exports`: `"./track-title": "./src/track-title.ts"`.
- `packages/shared/src/api-responses.ts`: схемы `trackViewMetaSchema`, `trackViewSchema`, `releaseViewSchema`,
  `artistViewSchema`, `tracksQueryResponseSchema`; типы `TrackViewMeta`, `TrackView`, `ReleaseView`, `ArtistView`.
  У каждого поля `.describe('D-XXX: …')`. Существующие `trackSchema` / `Track`, `artistSchema` / `Artist`,
  `ArtistRef`, `releaseSchema` не трогать. Одноимённые типы модуля owners (`modules/owners/service.ts:32,81,89`)
  в `facade/tracks.ts` не импортировать (при нужде — под другим именем).
  - `TrackView` = `{ isrc, catalogTitle, reportTitle, meta, catalogLabel, upcs, artists }` (план §3.1).
    - Поля `title` / `titleSource` нет.
    - `upcs: string[] | null`, `artists: string[] | null` (id ников): `null` значит «не видно». Отметки MC нет.
    - `catalogLabel: { id, name } | null` (типа `LabelRef` в shared нет).
  - `TrackViewMeta` — ровно `title, baseTitle, version, artists, durationMs, explicit, releaseDate, coverUrl,
    primaryPlatform`. Без `updatedAt` / `updatedBy`: логин оператора менеджеру не отдаём.
  - `ReleaseView` = `{ upc, title, version, releaseDate, labelName, trackCount }`.
    - Это строка реестра; `releaseTitle` реестра здесь называется `title`.
    - Поля из реестра (`owners/schema.ts:119-131`, как `aggregates.ts:94-111`): `title` ← `releaseTitle`,
      `releaseDate` ← `releasedAt`, `labelName` ← имя лейбла строки (`registryRowOf`), `trackCount` ← `trackCount`.
    - Строки реестра нет — `title` из отчёта (`releaseTitle` пары), остальные поля `null`.
  - `ArtistView` = `{ id, pseudonym, ownerId }`.
  - Ответ: `{ tracks: Record<isrc, TrackView>, releases: Record<upc, ReleaseView>, artists: Record<id, ArtistView> }`.

**Тест** `packages/backend/tests/track-title.test.ts` (в shared нет vitest). Случаи и ожидания:

- `("Song - Slowed", "Slowed")` → `"Song"`;
- `("Song", null)` → `"Song"`;
- `(null, "X")` → `null`;
- `("Song - X", "")` → `"Song - X"`;
- `("A - X - B", "X")` → `"A - X - B"`;
- `("X", "X")` → `"X"`;
- `(" - Slowed", "Slowed")` → `null` (пустой остаток — `null`, D-243).

Поведение не меняется.

### T2. `tracksOf` в фасаде

**Вынести** из `aggregates.ts` в новый `facade/tracks.ts` помощники `nameMaps` и `registryByUpc`, как функции от
`ctx`. `aggregates.ts` импортирует их оттуда.

`tracks.ts` не импортирует `./aggregates`, `./calculation`, `./scope`, `./balance`, `./reports`. Это закрепляет новый
случай в `boundaries.test.ts`.

**Функция** `tracksOf(isrcs: string[], viewer: Viewer = ALL_VIEWER)` возвращает
`Promise<{ tracks, releases, artists }>` — три мапы, как в ответе T3. В мапы `releases` и `artists` попадают только
UPC и ники, на которые ссылается хотя бы один `TrackView` ответа.

Группа подключается в `facade/index.ts` в этом же шаге (`facade.tracksOf`): T3 `index.ts` не правит, и в волне 3
его правит только M1.

Источники:

- `owners.listTracks({ isrcs })`;
- `sources.pairAttributes({ isrcs })` — название и UPC из отчёта;
- `owners.trackMeta.of(isrcs)` — полная мета, а не `metaLookup`;
- `owners.trackLabels` — открытый интервал → `catalogLabel`;
- реестр по UPC;
- ники — `artistsByIsrc` (`facade/track-artists.ts`) по `splits.listSplits({ isrcs })` /
  `listParticipations({ isrcs })` и `owners.artistIndex()`, без изменений. Порядок `TrackView.artists` — порядок
  `artistsByIsrc` (по нику, затем id): e2e сверяет текст «A-111, P-111».

PostgreSQL читается в одном `db.snapshot`, ClickHouse — как сегодня в `trackCatalog`.

**Видимость** — `ctx.scopeOf(viewer).isrcFilter()` / `mayTouchIsrc`, как в `splits.ts:195`.

**Правила полей:**

| Поле | Кто видит |
|---|---|
| `meta`, `catalogTitle`, `catalogLabel` | любой ISRC организации |
| `reportTitle` | только видимый ISRC; иначе `null` |
| `upcs`, `artists` | только видимый ISRC; иначе `null` |
| `ReleaseView` в мапе | UPC из `upcs` видимого трека. Поля реестра — из строк лейблов, которые видит `viewer`; из нескольких — последняя обновлённая (как `registryRows`). Видимой строки нет → поля реестра `null`, `title` = `releaseTitle` пары отчёта |
| `ArtistView` в мапе | ник из `artists` видимого трека; `ownerId` — как его отдают `GET /splits` / `GET /participations` этому `viewer` |

- `catalogTitle` — первая непустая `title` строк `owners.tracks` по ISRC в порядке `(upc, id)`. Порядок задаётся
  явно (`ORDER BY upc, id` в чтении или та же сортировка в `tracks.ts`): у `allTracks` его нет
  (`modules/owners/repository.ts:156-162`).
- `trackCatalog` этот помощник **не** берёт: его `title` остаётся прежним правилом
  `ts[0]?.title ?? names?.trackTitle ?? ''` (`aggregates.ts:297`), чтобы `GET /tracks/catalog` остался байт в байт.
  Поэтому для ISRC с пустой первой строкой `owners.tracks` или с несколькими строками `catalogTitle` трека и `title`
  строки каталога могут различаться. Записать в D-запись T2.
- `reportTitle` — `trackTitle` первой пары ISRC в порядке ключа `isrc|upc` (как `nameMaps().byIsrc`,
  `aggregates.ts:86-90`).
- Каждое поле отдаётся как есть, выбор делает фронт. Пустая строка считается `null` (D-243).
- Набор `upcs`: пары файлов ∪ `owners.tracks`, без пустых, отсортирован.
- `artistsByIsrc` не расширять: ответ `GET /tracks/catalog` должен остаться байт в байт.
- ISRC без строки `owners.tracks`, без пары в файлах, без меты и без открытого интервала в ответ не попадает.

`trackCatalog` строит строки через помощники `tracks.ts` (`nameMaps`, `registryByUpc`), со своим правилом `title`.
`GET /tracks/catalog` остаётся байт в байт прежним.

**Тесты:**

- `tests/tracks.test.ts` (новый):
  - каждое правило таблицы;
  - `catalogTitle`: первая по `(upc, id)` строка пустая — берётся следующая непустая;
  - релиз двух треков приходит в `releases` один раз, ник двух треков — в `artists` один раз;
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
- **Новый тест** `tests/read-only-operations.test.ts` с замороженным списком `readOnly`-операций: сейчас ровно
  `POST /tracks/query`, с M2 ещё `POST /money/master/query`. Добавлять в список можно только вместе с планом.
- **Тест фронта** на `call()` с `readOnly`-операцией (нет `X-Operator`, `X-Audit` не читается) — в T3, хотя
  вызывающего ещё нет; `tracks.query` в клиенте появляется в T4.

**Маршрут `POST /tracks/query`:**

- тело `{ isrcs: string[] }`: от 1 до 1 000, формат ISRC, повторы убираются;
- ответ `{ tracks, releases, artists }` (T1);
- `access: 'org'`, `ability: { action: 'read', subject: 'tracks', scope: 'record' }`, `readOnly: true`;
- маршрут передаёт `viewerOf(res)`.

**Обвязка:**

- `manager-answers.ts`: строка `R`.
- `tests/abilities.test.ts`: счётчики `[131, 39, 21, 9, 62]`, по действиям `[23, 33, 21, 25, 15, 14]`, `orgAllowed`
  69. В комментарии — «D-XXX: + POST /tracks/query (read, R)».
- Фронт `coverage.ts`: временный `refusal` по-английски (`'not on a screen yet: TrackName moves to it in T4'`). Ключ
  добавляется в список `tests/coverage.test.ts:36` и убирается в T4.1.
- Сценарий в `api-contract.test.ts`. Описания полей тела и ответа.
- `tests/org-scope.test.ts` (исключение §1.2): условие `:576` → `o.method !== 'get' && !o.readOnly`; строка в
  `CASES` (`:379`): `'POST /tracks/query': (x) => ({ body: { isrcs: [x.isrc] } })`. В `ID_LESS` не класть.
- Фронт `tests/stage5-helpers.test.ts:69` (исключение §1.2): `o.method !== 'get' && !o.readOnly` — подписи журнала
  только у записей.

**Тесты:**

- после вызова в журнале ни одной новой строки;
- без `X-Operator` — 200;
- менеджер своей книги — 200 (прогон менеджера на своём теле даст 400 `validation_error`, поэтому нужен отдельный
  тест);
- менеджер по чужому ISRC: `upcs = artists = reportTitle = null`, `meta` и `catalogTitle` есть; в мапах нет UPC и
  ников, на которые ссылается только этот ISRC;
- 1 001 ISRC — 400.

**D-запись:** POST-чтение как исключение из D-140; довод про CSRF (`originGuard` + JSON); список `readOnly`
заморожен; токен чтения (`MCP_READ_TOKEN`) вызывает операцию, как заменяемые GET, а инструментом MCP она не
становится (MCP берёт только GET, `api/mcp.ts:19`); ссылка на ник в ответе может вести менеджера на 404 (ник чужой
записи).

### T4. `TrackName` на `TrackView`

**Общее:**

- `src/api/client.ts`: `tracks.query(isrcs)`.
- `src/api/tracks-loader.ts` (новый, без React): **пакетный загрузчик**.
  - `load(isrc)` кладёт ISRC в очередь кадра (`setTimeout(0)`).
  - Одним `POST /tracks/query` (пачками по 1 000) он запрашивает собранные ISRC.
  - На каждый ISRC возвращает `{ track, releases, artists }` — трек и нужные ему записи мап.
  - Повторы в одном кадре склеиваются.
- `src/api/queries/tracks.ts`: `useTracks(isrcs)` = `useQueries` по ключам `['tracks', 'view', isrc]`, `queryFn` =
  `loader.load(isrc)`, `staleTime` 10 мин.
  - Неизвестный ISRC → `{ track: null, releases: {}, artists: {} }`: `queryFn` в TanStack v5 не может вернуть
    `undefined`.
  - Кеш по треку: TanStack сам не запрашивает то, что свежо в кеше. Значит, по сети идут только недостающие.
  - Сброс ключа заново вызывает `queryFn`, ключи без подписчиков живут обычный `gcTime`.
  - Хук отдаёт `{ track(isrc), release(upc), artist(id) }` из результатов запросов.
  - В `MONEY_KEYS` этих ключей нет.
  - Соседние вызовы одного кадра (несколько таблиц на странице) склеиваются в один запрос: очередь и
    `setTimeout(0)`, без библиотек.
  - Запрашиваются только показанные ISRC (строки на экране, как D-162).
  - Сброс: любая запись, которая может поменять трек (мета, площадки, каталог, сплиты, участия, реестр релизов),
    инвалидирует `['tracks', 'view']`. Это идёт через `useAction` с `invalidate: 'reference'` или `'all'`; проверить,
    что эти записи так и делают.
  - Тест загрузчика (vitest фронта, в node, `fetch` подменён):
    - три `load()` в одном кадре дают один запрос;
    - 1 500 ISRC дают два запроса;
    - каждый ISRC получает свой трек и свои записи мап.

    То, что повтор с тем же ключом не идёт в сеть, — поведение TanStack, а не наш тест.
- `lib/track-title.ts`: `displayTitle(track)` = `meta?.baseTitle ?? catalogTitle ?? reportTitle ?? null`.
  Единственное место выбора названия.
- `components/TrackName.tsx`: `TrackName({ isrc, track?, fallbackTitle? })`. Название — `displayTitle(track)`, без
  него — ISRC (не дважды, D-243). Без локального отрезания версии.
  - Пока `track` не пришёл, показывается `fallbackTitle` как есть, а без него — ISRC.
  - `fallbackTitle` передаёт только P5: её строки не в `TrackView`, пока не показаны. Остальные страницы его не
    передают.
- На P8, P10, P12, P15, P16, P36, P37 списки артистов и релизов трека строятся по `track.artists` / `track.upcs`
  через `artist(id)` / `release(upc)` хука.
- **P5** (25 854 ISRC в каталоге) вызывает `useTracks` только для показанных строк, как деньги (D-162).
  - Поиск и фильтр по названию работают, как сейчас: по `meta` / `title` строк `GET /tracks/catalog`, а в режиме
    «account / month» — по строкам `/tracks/summary`.
  - Эти два ответа не меняются.
  - Пока `TrackView` строки не пришёл, `TrackName` показывает `fallbackTitle` = название строки каталога.
    `valueGetter`, поиск и экспорт P5 берут текст из строки каталога (`TracksPage.tsx:114, 279`), как сейчас.
  - Колонка артистов P5, её поиск и экспорт остаются на строке каталога: `ArtistLinks artists={row.artists}
    reportName={row.artistName}` (`TracksPage.tsx:290`). Там есть строка отчёта для трека без ников; строка отчёта
    и поиск не меняются.
- Хуки `track-name-<isrc>` / `track-version-<isrc>` прежние.
- `valueGetter` гридов (кроме P5, см. выше) читают `TrackView`. Колонки, собранные в `useMemo`, зависят от данных
  кеша (иначе видят пустой кеш).
- e2e `golden/11-release`, в начале теста S11:
  `page.request.patch('/api/v1/tracks/' + i + '/meta', { headers: { 'X-Operator': 'e2e-operator' }, data: { title: 'S11 Song - Slowed', version: 'Slowed' } })`
  (повтор идемпотентен). Затем проверить `track-name-<i>`: ссылка «S11 Song», `track-version-<i>` = «Slowed».
  Строку `:44` заменить на `getByTestId('track-name-' + i).getByRole('link').click()`. Сид (`scripts/e2e/*`) мету
  не пишет; сейчас название и версию не проверяет ни одна спецификация.

**Группы**, по коммиту на каждую:

| Группа | Файлы |
|---|---|
| T4.1 | P8 `pages/catalog/ReleasePage.tsx`, P5 `pages/catalog/TracksPage.tsx`; `coverage.ts` — страница P8 вместо `refusal`, ключ убрать из `coverage.test.ts:36` |
| T4.2 | P10 `pages/owners/BalanceTab.tsx`, `pages/owners/tabs.tsx`, `pages/owners/OwnerPage.tsx`; P12 `pages/artists/ArtistBalanceTab.tsx`, `pages/artists/tabs.tsx`, `pages/artists/ArtistPage.tsx` (передают `trackMeta` в балансы, `:153`, `:86`) |
| T4.3 | P15 `pages/reference/splits/SplitsPage.tsx`, P16 `ParticipationsPage.tsx` |
| T4.4 | P36/P37 `pages/reference/sublabels/ReportTab.tsx`, `SuggestionsTab.tsx`, `TermsTab.tsx`; удаление старого пропса `meta` у `TrackName` и типа `TrackMetaLite` во фронте, если его читает только удалённый код. `fallbackTitle` остаётся (только P5) |

**Смены поведения** называются в D-записи своей группы:

- T4.2: P10 / P12 показывают название отчёта там, где по D-243 был ISRC;
- T4.4: P37 теряет подсказку «трека нет в каталоге» (`TermsTab.tsx:33`, `i18n/ru/sublabels.ts:67`).

**Ответы API.** Мета трека приходит только из `POST /tracks/query` через кеш. Поэтому в T4.4 из денежных и
справочных ответов снимаются `trackMeta` и `meta` строк, которые фронт больше не читает (проверить поиском по
`packages/frontend/src`). Это:

- `GET /releases/:upc` (`tracks[].meta`, `trackMeta`; `coverUrl` релиза строится из той же меты в фасаде и
  остаётся, `aggregates.ts:486`);
- `GET /owners/:id` и `GET /artists/:id` (`trackMeta`; в балансах меты нет);
- `GET /splits`, `GET /participations` (`meta` строк);
- условия, подсказки и отчёт саблейбла: снимаются **оба** поля `meta` отчёта и `meta` условий и подсказок;
  остальной ответ не трогается.

Схемы ответов и тесты, которые проверяли эти поля, обновляются в том же коммите. Среди них
`tests/sublabel-report.test.ts:108`.

Остаются `GET /tracks/catalog` и `/tracks/summary` с их `meta`: по ним P5 ищет по названию (`TracksPage.tsx:44,
114, 279`).

Проверка в браузере на частном стенде: обложка, название, версия на каждой странице группы.

## 3. Линия «Деньги»

### M1. `masterRows` в фасаде

**Перенос.** `calcScoped` переносится в `context.ts` (`ctx.calcScoped`), `aggregates.ts` берёт его оттуда. Это не
закрытая зона: поведение то же. `labelContext` уже в `ctx`. `groupBy` и `sortedMonths` (`aggregates.ts:65, 76`)
экспортируются из `aggregates.ts` или переносятся в `money.ts` (`sumUnits` уже экспортирован, `:51`).

`masterRows` подключается в `facade/index.ts`: это единственный общий файл фасада волны 3 (`tracksOf` подключён в
T2).

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

`viewer` нет: права — `can()` по `?label=` (сигнатура в план §6 здесь устарела).

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
  Комментарий D-XXX.
- Список `readOnly` дополняется.
- `tests/org-scope.test.ts`: строка в `CASES`
  `'POST /money/master/query': (x) => ({ body: { scope: { kind: 'release', upc: x.upc }, grain: 'isrc' } })` (если в
  `Ids` нет `upc`, то `{ kind: 'isrcs', isrcs: [x.isrc] }`). В `ID_LESS` не класть.
- `coverage.ts`: временный `refusal` и строка в `coverage.test.ts:36`. Убирается в M5.
- Сценарий в контракте, описания полей.

**Тесты:**

- контракт;
- менеджер: своя книга 200 (отдельный тест), без метки 400 `label_required`, чужая метка 403;
- в журнале ни одной новой строки.

**D-запись:** запрос; права = права заменяемых ответов (Р13); R2′ (Р12); токен чтения вызывает операцию, как
заменяемые GET, инструментом MCP она не становится (MCP берёт только GET).

### M3. Сверка и замер на живой базе

**Скрипт** `scripts/check-master-rows.ts [dataDir]`. Только чтение.

- Организация — `ERP_DEFAULT_ORG` из `.env`. `--org` не передавать: id в `CLAUDE.md` устарел.
- Первым делом скрипт проверяет `SHOW default_transaction_read_only` = `on`. Иначе — выход с кодом 1 и текстом
  «запусти с PGOPTIONS».
- Вызывает только `masterRows`, `release`, `trackSummary`, `releases(undefined, label)` (список UPC с `net` файлов,
  без расчёта, `aggregates.ts:385`) и список своих книг.
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
- `e2e/helpers.ts`:
  - в `MONEY_PATH` (`:112-113`) добавить альтернативу `money\/master\/query`;
  - фильтр в `openAs` (`:122`):
    `const p = new URL(r.url()).pathname; if ((r.method() === 'GET' || (r.method() === 'POST' && p.startsWith('/api/v1/money/'))) && MONEY_PATH.test(p)) calls.push(p);`

  `GET /releases/:upc` остаётся в `MONEY_PATH`: он по-прежнему считает. Проверка шага: временный прогон
  `11-release` с `expectMoneyCalls(page, 1)` зелёный и после M4 (экран ещё не переведён).
- `packages/frontend/CLAUDE.md` (R2′: R2 → «один денежный запрос на блок; баланс — отдельный ответ своей
  страницы») правит оркестратор при приёмке (§0).

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
  - разницу набора строк с прежним `all=1` записать в D-запись: каталог под лейблом включает ISRC открытого
    интервала без единиц.
- Строки без денег показывают «—» в обоих режимах (видимые строки и «Посчитать все»). Сегодня зарегистрированный
  трек без единиц показывает `0` (`trackSummary` отдаёт его нулями, `aggregates.ts:220`). Записать в D-запись.
- Режим «account / month» с P1 остаётся на `GET /tracks/summary`: этих фильтров в M1 нет. Записать в D-запись.

**e2e:**

- `golden/12-track.spec.ts:209-260`: ожидание запроса `:212-215` →
  `page.waitForRequest((r) => r.method() === 'POST' && r.url().includes('/api/v1/money/master/query'))`, затем
  `r.postDataJSON().scope.isrcs` = `[i]` (`searchParams.get('isrcs')` у POST пуст);
- `golden/40-catalog`.

### M7. Итог и пометка старого

**`GET /releases/:upc` без денег** — одним коммитом:

- `release()` больше не считает. ISRC — пары `(isrc, upc)` файлов книги (под `?label=` — только файлы `lc.book`; без
  метки — все файлы) ∪ `mine` (как сейчас, `aggregates.ts:451`). Менеджер не видит ничего нового.
  - Для этого `sources.pairAttributes` получает необязательный фильтр `labelIds`, как `netByUpc` (`SnapshotFilter`,
    `modules/sources/service.ts:35, 394`).
  - 404 — как раньше: нет ни `mine`, ни пар книги, ни строки реестра.
  - Ники — через `owners.artistIndex()` вместо `calc.artistIndex`.
  - Тест: менеджер лейбла A по UPC, который есть только в файлах B, получает 404, как до M7.
- Из ответа уходят денежные поля `tracks[]` и `months[]` (`net, B, C, ours, cByReason`), а также `months[]` целиком.
  Схема ответа обновляется.
- Тесты, которые читали эти деньги, переносятся на `masterRows` **с теми же числами**:
  - `scope.test.ts:98-99`, `:176-181` (вызов `f.release(UPC)` →
    `f.masterRows({ scope: { kind: 'release', upc: UPC }, grain: 'isrc' })`, ожидания `pub` / `idx` те же),
    `:665-667`, `:815-816`;
  - `aggregates.test.ts:350-366`.
- Тест равенства M1 по `release` переходит на фиксированные строки `expected` (они уже есть с M1).
- `scripts/check-master-rows.ts`: сравнение `release` со старым убирается. `isrcs` против `trackSummary` остаётся.
- Фронт:
  - `MONEY_PATH` без `releases/[^/]+`;
  - `MONEY_KEYS` без `['releases', 'detail']`;
  - P8 `expectMoneyCalls(page, 2)`.
- `ability` `GET /releases/:upc` остаётся прежним (ответ менеджера `L` не меняется), строки `manager-answers.ts` не
  трогать.

**`GET /tracks/summary` остаётся.** Его читает экран: режим P5 «account / month» с P1. Его читает и
`scripts/compare-reference.ts:546`. Параметр `isrcs` у `GET /tracks/summary` остаётся: его читают тест равенства M1 и
`scope.test.ts:177`. Снятие — в «Отложено».

**D-запись:** что снято, что осталось и почему (по экранам и скриптам).

## 4. Чего не делать

- Ничего из таблицы «Отложено» плана.
- Не трогать:
  - паблишинг;
  - рекламу;
  - срезы `owner` / `artist` / `track` / `book`;
  - `byArtist`;
  - P7 `net`;
  - `/sublabels/:id/report` (кроме снятия полей `meta` — `rows[]` и вложенного списка — в T4.4);
  - MCP (`api/mcp.ts`, `mcp-connection.ts`, `scripts/mcp-erp.ts`): вне задачи, не трогать и не учитывать;
  - `decimal.js` во фронте.
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
