import { single } from '../lib';
import type { Scenario } from './index';

// S22 (G27, G27b payout), S23 (G29 sublabel advance), S24 (G28, G39 negative payable). Payout threshold 0 (seed.ts).

export const payouts: Scenario[] = [
  {
    id: 'S22',
    async run(_f, { seed }) {
      for (const [k, april] of [[1, '100'], [2, '-100']] as const) {
        const c = seed.sc(22, k); // G27 / G27b
        await c.person('A', 'P');
        await c.track(1);
        await c.split(1, [['A', '50']]);
        await c.part(1, 'P', '15', 'bucket', 'label_share');
        await c.load('2026-03', [{ j: 1, net: '100' }]);
        await c.load('2026-04', [{ j: 1, net: april }]);
        await c.advance('P', '10', { kind: 'any' });
      }
    },
  },
  {
    id: 'S23',
    async run(_f, { seed }) {
      const c = seed.sc(23, 1); // G29: the sublabel NoGhost Records 23 -> NG-231, advance 50
      await single(c, async () => {
        await c.person('A');
        await c.company('NG');
        await c.sublabel('NoGhost Records 23', '0to8', 'NG');
        await c.split(1, [['A', '50']]);
      }, '100', 'NoGhost Records 23');
      await c.advance('NG', '50', { kind: 'any' });
    },
  },
  {
    id: 'S24',
    async run(_f, { seed }) {
      const base = async (k: number) => {
        const c = seed.sc(24, k);
        await single(c, async () => {
          await c.person('A');
          await c.split(1, [['A', '50']]);
        });
        return c;
      };
      const c1 = await base(1); // G28: payout 30
      await c1.migrationPayout('A', '30');
      const c2 = await base(2); // G28: payouts 30 and 40
      await c2.migrationPayout('A', '30');
      await c2.migrationPayout('A', '40');
      const c3 = await base(3); // G39 before: payout 50 (the spec adds R 15 top)
      c3.keys.extra.rPseudonym = c3.pseud('R');
      await c3.person('R');
      await c3.migrationPayout('A', '50');
    },
  },
];
