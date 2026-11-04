// Что ловит компилятор. Каждая строка под @ts-expect-error — настоящая ошибка (tsc упал бы на лишней директиве).
import { Decimal } from '../../../../packages/backend/src/shared/money';
import { chain } from './graph';
import { labelOfRecord } from './label-of-record';
import { perimeter } from './perimeter';
import { offTheTop } from './off-the-top';
import { split } from './split';
import { pool } from './pool';
import { node, type Remainder } from './types';
import { pct, remainderEdge, transfer } from './state';
import type { Participation } from './rules';

// 1. Неверный порядок: пул до сплита. Пулу нужны rows, а в состоянии их ещё нет.
// @ts-expect-error узлу не хватает входов: carve:pool, ему нужно rows
chain(labelOfRecord, perimeter, offTheTop, pool, split);

// 2. Узел читает то, чего не объявил во входах: In = { net }, а код просит scaledNet.
node<{ net: Decimal }, { x: 1 }>({
  name: 'bad-input',
  run(input) {
    // @ts-expect-error scaledNet нет во входах узла
    void input.scaledNet;
    return { out: { x: 1 }, edges: [] };
  },
});

// 3. Остаток процентом: поле типа Remainder нельзя заполнить результатом pct или произведением.
node<{ net: Decimal }, { scaledNet: Remainder }>({
  name: 'bad-remainder',
  // @ts-expect-error Quantised — не Remainder: остаток только через minus()
  run({ net }) {
    return { out: { scaledNet: pct(net, new Decimal(90)) }, edges: [] };
  },
});

// 4. Ребро с неквантованной суммой.
// @ts-expect-error Decimal без квантования не принимается
transfer('net', 'artist:R', new Decimal(100).mul(10).div(100), { kind: 'top' });
// @ts-expect-error ребро-остаток принимает только Remainder
remainderEdge('net', 'scaledNet', new Decimal(90));

// 5. Правило неверной формы.
// @ts-expect-error у artist_share fromArtistId обязателен (string)
const p1: Participation = { fundedFrom: 'artist_share', base: 'bucket', fromArtistId: null, id: 'x', artistId: 'E', percent: new Decimal(10), documentId: null };
// @ts-expect-error у top база только net
const p2: Participation = { fundedFrom: 'top', base: 'bucket', fromArtistId: null, id: 'y', artistId: 'R', percent: new Decimal(10), documentId: null };
void p1; void p2;
