import { single } from '../lib';
import type { Scenario } from './index';

// S06: labels of record. D-232: the sublabel rule model removed (S05 the sublabel halves G05a, G05b, G31, G41; S06/3 G38
// the sublabel string per month; S07 G15, G16 the negative and zero units through the sublabel).

export const labelsAndSigns: Scenario[] = [
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
      // D-232: the sublabel rule model removed (S06/3 G38: the sublabel string decides per month)
    },
  },
];
