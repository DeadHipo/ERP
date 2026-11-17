import { single } from '../lib';
import type { Scenario } from './index';

// S08 (G21) and S09 (G34, G44). D-232: the sublabel rule model removed (S08/1 G18, S08/2 G18b with Q11, S08/3 G20 the
// QQ rule under an assumption).

export const assumptionsExactness: Scenario[] = [
  {
    id: 'S08',
    async run(_f, { seed }) {
      const c4 = seed.sc(8, 4); // G21: an ISRC without a split (D-232: its string an alias of 0to8, no sublabel rule)
      await single(c4, async () => {
        await c4.company('NG');
        await c4.labelString('NoGhost Records 08d', '0to8');
      }, '100', 'NoGhost Records 08d');
    },
  },
  {
    id: 'S09',
    async run(_f, { seed }) {
      const c1 = seed.sc(9, 1); // G34: ids ascend A < B < C
      await single(c1, async () => {
        await c1.ordered('A', 'B', 'C');
        await c1.person('M');
        await c1.split(1, [['A', '16.6'], ['B', '16.6'], ['C', '16.6']]);
        await c1.part(1, 'M', '13', 'net', 'artist_pool');
      });
      const c2 = seed.sc(9, 2); // G44: three carves of 13 on a pool of 10
      await single(c2, async () => {
        await c2.person('A');
        await c2.ordered('M1', 'M2', 'M3');
        await c2.split(1, [['A', '10']]);
        for (const m of ['M1', 'M2', 'M3']) await c2.part(1, m, '13', 'net', 'artist_pool');
      });
    },
  },
];
