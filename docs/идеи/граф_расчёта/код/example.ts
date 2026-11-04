// Один юнит, пример README §5 на 100.00: что каждый узел получил, что вернул, какие рёбра провёл.
// Запуск: npx tsx docs/идеи/граф_расчёта/код/example.ts
import { makeContext, unit } from '../../../../packages/backend/tests/layers/world';
import { allocateUnit } from '../../../../packages/backend/src/facade/layers';
import { sumOf } from '../../../../packages/backend/src/facade/layers/exact';
import { runUnit } from './graph';
import { printChecks, printSteps } from './print';

const ctx = makeContext({
  labels: [
    { id: 'L0', name: '0to8', kind: 'own', aliases: ['0to8'] },
    { id: 'LS', name: 'S Records', kind: 'sublabel', own: 'L0', aliases: ['S Records'], rule: { id: 'r1', percent: '50', recipient: 'S', doc: 'ok' } },
  ],
  splits: { QZTST2600001: [{ id: 's1', doc: 'ok', shares: [['A', '40'], ['B', '20']] }] },
  parts: [
    { id: 'p1', artist: 'R', percent: '10', base: 'net', funded: 'top', doc: 'ok' },
    { id: 'p2', artist: 'MC', percent: '5', base: 'net', funded: 'artist_pool', doc: 'ok' },
    { id: 'p3', artist: 'AR', percent: '15', base: 'bucket', funded: 'label_share', doc: 'ok' },
  ],
});
const u = unit('100', { labelName: 'S Records' });

const r = runUnit(u, ctx);
console.log(`Юнит ${u.isrc} ${u.upc} ${u.reportingMonth} net ${u.net.toFixed(2)}, лейбл «${u.labelName}»`);
printSteps(r.steps);
const ok = printChecks(r);

// Сверка с настоящими слоями.
const real = allocateUnit(u, ctx).state;
let same = true;
for (const a of new Set(real.rows.map((x) => x.artistId))) {
  const mine = sumOf(r.edges.filter((e) => e.to === `artist:${a}`).map((e) => e.amount));
  const theirs = sumOf(real.rows.filter((x) => x.artistId === a).map((x) => x.amount));
  if (!mine.eq(theirs)) { same = false; console.log('расхождение', a, mine.toFixed(12), theirs.toFixed(12)); }
}
const ours = sumOf(r.edges.filter((e) => e.to === 'ours').map((e) => e.amount));
if (!ours.eq(real.labelShare)) { same = false; console.log('расхождение ours', ours.toFixed(12), real.labelShare.toFixed(12)); }
console.log('совпадает с настоящими слоями:', same ? 'да' : 'НЕТ');
if (!ok || !same) process.exit(1);
