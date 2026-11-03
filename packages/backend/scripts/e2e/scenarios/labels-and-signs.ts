import { single } from '../lib';
import type { Scenario } from './index';

// S05-S07: sublabel halves, labels of record, negative and zero units. NoGhost Records / NG are the shared seed (S00).

const NG = 'NoGhost Records';

export const labelsAndSigns: Scenario[] = [
  {
    id: 'S05',
    async run(_f, { seed }) {
      for (const [k, a] of [[1, '50'], [2, '70'], [3, '100'], [4, '0']] as const) {
        const c = seed.sc(5, k); // G05a, G05b, G31, G41
        await single(
          c,
          async () => {
            await c.person('A');
            await c.split(1, [['A', a]]);
          },
          '100',
          NG,
        );
      }
    },
  },
  {
    id: 'S06',
    async run(_f, { seed }) {
      const c1 = seed.sc(6, 1); // G08a
      await single(c1, async () => {
        await c1.person('A');
        await c1.split(1, [['A', '50']]);
      }, '100', 'Ahh Music');
      const c2 = seed.sc(6, 2); // G08b
      await single(c2, async () => {
        await c2.person('A');
        await c2.split(1, [['A', '50']]);
      }, '100', 'Echo8');
      const c3 = seed.sc(6, 3); // G38: the label string decides per month
      await c3.person('A');
      await c3.track(1);
      await c3.split(1, [['A', '50']]);
      await c3.load('2026-03', [{ j: 1, net: '100', label: NG }]);
      await c3.load('2026-04', [{ j: 1, net: '100' }]);
    },
  },
  {
    id: 'S07',
    async run(_f, { seed }) {
      for (const [k, net] of [[1, '-100'], [2, '0']] as const) {
        const c = seed.sc(7, k); // G15, G16
        await single(
          c,
          async () => {
            await c.person('A', 'B', 'R');
            await c.split(1, [['A', '25'], ['B', '25']]);
            await c.part(1, 'R', '15', 'net', 'top');
          },
          net,
          NG,
        );
      }
    },
  },
];
