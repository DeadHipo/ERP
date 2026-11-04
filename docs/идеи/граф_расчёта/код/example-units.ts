// Один трек, четыре юнита: три отчётных месяца, два UPC, участие «сверху» заканчивается, сплит меняется.
// Показывает: граф запускается на каждом юните отдельно; «по треку и месяцу» — группировка результатов.
// Запуск: npx tsx docs/идеи/граф_расчёта/код/example-units.ts
import { makeContext, unit, I1, UPC } from '../../../../packages/backend/tests/layers/world';
import { allocateUnit } from '../../../../packages/backend/src/facade/layers';
import { sumOf } from '../../../../packages/backend/src/facade/layers/exact';
import { ZERO, type Decimal } from '../../../../packages/backend/src/shared/money';
import { runUnits } from './graph';
import { edgeLine, printChecks } from './print';

const UPC2 = '9876543210987';
const ctx = makeContext({
  pairs: [`${I1}|${UPC}`, `${I1}|${UPC2}`],
  splits: {
    [I1]: [
      { id: 's-2026-01', from: '2026-01-01', to: '2026-05-01', doc: 'ok', shares: [['A', '40'], ['B', '20']] }, // до мая: A 40 / B 20
      { id: 's-2026-05', from: '2026-05-01', doc: 'ok', shares: [['A', '50']] },                                // с мая: B выкуплен, A 50
    ],
  },
  parts: [{ id: 'p-top', artist: 'R', percent: '10', base: 'net', funded: 'top', validFrom: '2026-01-01', validTo: '2026-05-01', doc: 'ok' }],
});

const units = [
  unit('100', { reportingMonth: '2026-03', salesMonth: '2026-02' }),
  unit('80', { reportingMonth: '2026-04', salesMonth: '2026-03' }),
  unit('20', { reportingMonth: '2026-04', salesMonth: '2026-03', upc: UPC2 }), // второй UPC того же ISRC в том же месяце
  unit('50', { reportingMonth: '2026-05', salesMonth: '2026-04' }),
];

const runs = runUnits(units, ctx);
let allOk = true;
for (const r of runs) {
  const splitStep = r.steps.find((s) => s.node === 'split');
  const rows = splitStep?.out['rows'] as Map<string, { ruleId: string }> | undefined;
  const splitId = rows && rows.size ? [...rows.values()][0]?.ruleId : 'нет';
  console.log(`\nЮнит ${r.unit.reportingMonth} UPC ${r.unit.upc} net ${r.unit.net.toFixed(2)}  → сплит на дату: ${splitId}; узлов пройдено: ${r.steps.length}`);
  for (const e of r.edges.filter((x) => x.to.startsWith('artist:') || x.to === 'ours')) console.log('   ' + edgeLine(e));
  allOk = printChecks(r) && allOk;
}

// Группировка «трек × месяц × получатель»: сумма одинаковых стоков по всем юнитам месяца.
const byMonth = new Map<string, Decimal>();
for (const r of runs)
  for (const e of r.edges)
    if (e.to.startsWith('artist:') || e.to === 'ours') {
      const k = `${r.unit.isrc} ${r.unit.reportingMonth} ${e.to}`;
      byMonth.set(k, (byMonth.get(k) ?? ZERO).add(e.amount));
    }
console.log('\nПо треку и месяцу (сумма по юнитам месяца):');
for (const [k, v] of [...byMonth].sort()) console.log(`   ${k.padEnd(40)} ${v.toFixed(2).padStart(10)}`);

// Сверка каждого юнита с настоящими слоями.
let same = true;
for (const r of runs) {
  const real = allocateUnit(r.unit, ctx).state;
  for (const a of new Set(real.rows.map((x) => x.artistId))) {
    const mine = sumOf(r.edges.filter((e) => e.to === `artist:${a}`).map((e) => e.amount));
    const theirs = sumOf(real.rows.filter((x) => x.artistId === a).map((x) => x.amount));
    if (!mine.eq(theirs)) { same = false; console.log('расхождение', r.unit.reportingMonth, a, mine.toFixed(12), theirs.toFixed(12)); }
  }
}
console.log('\nсовпадает с настоящими слоями по всем юнитам:', same ? 'да' : 'НЕТ');
if (!allOk || !same) process.exit(1);
