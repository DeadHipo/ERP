# Эскизы кода узлов графа (не основной код)

Дата: 2026-11-04, третья редакция: **входы и выходы узлов — интерфейсы**. Узел получает ровно свои входы и
возвращает ровно свои выходы; состояние юнита — пересечение `Seed` и выходов пройденных узлов; порядок узлов
проверяет компилятор; остаток — отдельный тип, который можно получить только вычитанием.
Это набросок для обсуждения, не реализация шага 1 (там слои не меняются, рёбра выводятся функцией `edgesOf`;
`../консилиум/итог.md` Р1). Основной код под `packages/` не тронут; эскиз импортирует из него `exact.ts`,
`Decimal`, типы контекста и тестовый мир, поэтому компилируется и считает те же цифры.

Проверить:
- `npx tsc -p docs/идеи/граф_расчёта/код/tsconfig.json` — чисто, включая `compile-errors.ts` (семь намеренных
  ошибок под `@ts-expect-error`; tsc упал бы, если бы хоть одна не ловилась);
- `npx tsx docs/идеи/граф_расчёта/код/example.ts` — один юнит на 100.00: что каждый узел получил, что вернул,
  какие рёбра провёл; сверка с настоящим `allocateUnit`;
- `npx tsx docs/идеи/граф_расчёта/код/explain-artist.ts` — история одного псевдонима внутри юнита из рёбер:
  путь от net до его стока по каждому приходу, что ушло из его строки другим, подписи;
- `npx tsx docs/идеи/граф_расчёта/код/example-units.ts` — один трек, четыре юнита (три месяца, два UPC, участие
  «сверху» заканчивается в мае, сплит меняется с мая): каждый юнит считается отдельно, потом группировка «трек × месяц».

## Как работает один юнит

```
Seed { unit, net, stopped }
  → label-of-record   { ourLabelId, rule, labelMapped }
  → perimeter         { perimeter, stopped }                       stopped → цепочка прерывается
  → off-the-top       { scaledNet: Remainder }                     рёбра net → artist:*, net → scaledNet
  → split             { splitStatus, rows, labelShareAfterSplit }   рёбра scaledNet → row:*, scaledNet → labelShare
  → carve:pool        { rowsAfterPool }                            рёбра row:* → pool → artist:*
  → carve:artist_share{ rowsAfterShares }                          рёбра row:X → artist:E
  → rows-to-artists   { rowsClosed }                               рёбра row:X → artist:X (остаток строки)
  → carve:label_share { labelShareAfterCarve }                     рёбра labelShare → artist:*
  → sublabel          { ours, waitingReason }                      рёбра labelShare → artist:S, labelShare → ours | c:*
  → categorise        { categorised }                              перекрашивает рёбра в artist:* (B / C, причина)
```

Состояние растёт: после `split` в нём есть и `scaledNet`, и `rows`, и `labelShareAfterSplit`. Узел объявляет
входом `Pick<Seed, 'unit'> & Pick<Split, 'rows'>` и физически не видит остального. Между юнитами памяти нет:
`runUnits` просто вызывает `runUnit` на каждом. «По треку и месяцу» — группировка рёбер всех юнитов по
`(isrc, reportingMonth, to)`, см. конец `example-units.ts`; выбор сплита по месяцу делает `splitAt(isrc, дата юнита)`
ещё до узла.

## Типовые приёмы

| Приём | Где | Что ловит компилятор |
|---|---|---|
| `Node<In, Out>`: входы и выходы — интерфейсы; `chain` в `graph.ts` проверяет `Acc extends In` для каждого узла, где `Acc` = `Seed & Out₁ & … & Outₙ₋₁` | `types.ts`, `graph.ts` | неверный порядок: ошибка называет узел и поле, которого не хватает (`carve:pool`, `rows`) |
| Узел видит только `In` | `types.ts` | чтение поля, не объявленного во входах |
| `Remainder = Decimal & { __remainder }`: единственный вход — `minus(base, взятое)` | `types.ts`, `state.ts` | остаток, посчитанный процентом или произведением |
| `Quantised = Decimal & { __quantised }`: единственный вход — `asQ` / `pct`; `transfer` принимает только его, `remainderEdge` — только `Remainder` | `state.ts` | ребро с неквантованной суммой |
| `Participation` — размеченное объединение; `rulesOf(ctx, unit, kind)` сужает тип на границе с модулем | `rules.ts` | забытый `fromArtistId` у artist_share, невозможная база у top |
| Разные имена полей для разных моментов: `labelShareAfterSplit` и `labelShareAfterCarve`, `rows` / `rowsAfterPool` / `rowsAfterShares` | узлы | взять «бегущий остаток» не в тот момент (замечание архитектора) |

Что типами не ловится и остаётся тестам: сходится ли Σ стоков с net и баланс узлов (`nodeBalance`), процент от
не той базы, арифметика.

## Файлы

| Файл | Узел | In | Out |
|---|---|---|---|
| `types.ts` | — | — | `Node<In, Out>`, `NodeResult`, `Edge`, `Quantised`, `Remainder`, `Seed` |
| `state.ts` | — | — | `asQ`, `pct`, `minus`, `transfer`, `remainderEdge`, `fund`, `nodeBalance` |
| `rules.ts` | — | — | `Participation`, `rulesOf` |
| `label-of-record.ts` | 0 | `unit` | `ourLabelId`, `rule`, `labelMapped` |
| `perimeter.ts` | 0' | `unit`, `net` | `perimeter`, `stopped` |
| `off-the-top.ts` | 1 | `unit`, `net` | `scaledNet` |
| `split.ts` | 2 | `unit`, `scaledNet` | `splitStatus`, `rows`, `labelShareAfterSplit` |
| `pool.ts` | 3a | `unit`, `rows` | `rowsAfterPool` |
| `artist-share.ts` | 3b | `unit`, `rowsAfterPool` | `rowsAfterShares` |
| `rows-to-artists.ts` | 3b' | `rows`, `rowsAfterShares` | `rowsClosed` |
| `label-share.ts` | 3c | `unit`, `labelShareAfterSplit` | `labelShareAfterCarve` |
| `sublabel.ts` | 3d | `unit`, `rule`, `labelMapped`, `labelShareAfterCarve` | `ours`, `waitingReason` |
| `categorise.ts` | 4 | `splitStatus` (+ рёбра на чтение) | `categorised`; рёбра перекрашены |
| `graph.ts` | — | — | `chain`, `MASTER_GRAPH`, `runUnit`, `runUnits`, `nodesFor` |
| `explain-artist.ts` | — | — | `storyOf(run, artist)`: приходы, пути вверх до net, уходы из строки, подписи |
| `print.ts`, `example.ts`, `example-units.ts`, `compile-errors.ts` | — | — | печать, примеры, намеренные ошибки |

## Чего в эскизе нет

- `Allocation` в старой форме: баланс, выплаты, сигналы и API читают `rows[]`; переход на рёбра как основной
  результат — отдельное решение.
- Полного прогона золотых кейсов: только два примера; поведение при недостаче и ровно 100 % взято из `exact.ts`.
- Слияние псевдонимов: строки одного канонического id склеиваются в `rows` (последняя побеждает), особенность
  `carve.ts:99` не воспроизводится — расхождение Р7, его решает D-запись.
- Паблишинга и рекламы: это другие списки узлов и уровень владельца.
