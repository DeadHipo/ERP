// Печать для примеров: рёбра, выходы узлов, баланс. Не часть дизайна.
import type { Decimal } from '../../../../packages/backend/src/shared/money';
import type { Edge } from './types';
import type { Step, UnitRun } from './graph';
import { nodeBalance, sinkTotal } from './state';

const isDec = (v: unknown): v is Decimal => typeof v === 'object' && v !== null && 'toFixed' in v && 'isZero' in v;
const show = (v: unknown): string =>
  isDec(v) ? v.toFixed(12).replace(/\.?0+$/, '')
  : v instanceof Map ? `{${[...v].map(([k, x]) => `${k}: ${show(isDec(x) ? x : (x as { amount?: unknown }).amount ?? x)}`).join(', ')}}`
  : typeof v === 'object' && v !== null ? ('id' in v ? `rule ${String((v as { id: unknown }).id)}` : JSON.stringify(v))
  : String(v);

export const edgeLine = (e: Edge) =>
  `${e.from.padEnd(13)} → ${e.to.padEnd(13)} ${e.amount.toFixed(12).padStart(17)}  ${e.kind.padEnd(12)} ${(e.percent?.toString() ?? '').padStart(4)} ${(e.base?.toFixed(2) ?? '').padStart(8)}  ${e.category ?? ''} ${e.reason ?? ''}${e.assumption ? ` (${e.assumption})` : ''}`;

export function printSteps(steps: Step[]) {
  for (const s of steps) {
    const out = Object.entries(s.out).map(([k, v]) => `${k} = ${show(v)}`).join('; ');
    console.log(`  ▸ ${s.node}`);
    console.log(`      выход: ${out || '—'}`);
    for (const e of s.edges) console.log(`      ребро: ${edgeLine(e)}`);
    for (const n of s.notes) console.log(`      подпись: ${n.node} ${n.why} ${n.ruleId} missing ${n.missing.toFixed(12)}`);
  }
}

export function printChecks(r: UnitRun): boolean {
  const sinks = sinkTotal(r.edges);
  const balance = nodeBalance(r.unit.net, r.edges);
  const ok = sinks.eq(r.unit.net) && balance.every((b) => b.ok);
  console.log(`  Σ стоков ${sinks.toFixed(12)} = net ${r.unit.net.toFixed(12)} ${sinks.eq(r.unit.net) ? 'OK' : 'ОШИБКА'}; баланс узлов: ${balance.map((b) => `${b.node} ${b.ok ? 'OK' : 'ОШИБКА'}`).join(', ')}`);
  return ok;
}
