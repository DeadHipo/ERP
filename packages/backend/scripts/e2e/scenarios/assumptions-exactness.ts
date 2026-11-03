import type { Sc } from '../lib';
import { single } from '../lib';
import type { Scenario } from './index';

// S08 (G18, G18b, G20, G21) and S09 (G34, G44).

async function g18(c: Sc, str: string, withE: boolean) {
  await c.person('A', 'B', 'R', 'M', 'P');
  if (withE) await c.person('E');
  await c.company('NG');
  await c.sublabel(str, '0to8', 'NG');
  await c.split(1, [['A', '25'], ['B', '25']]);
  await c.part(1, 'R', '15', 'net', 'top');
  await c.part(1, 'M', '13', 'net', 'artist_pool');
  await c.part(1, 'P', '10', 'bucket', 'label_share');
  if (withE) await c.part(1, 'E', '10', 'bucket', 'artist_share', { from: 'A' });
}

export const assumptionsExactness: Scenario[] = [
  {
    id: 'S08',
    async run(_f, { seed }) {
      const c1 = seed.sc(8, 1); // G18 (string NoGhost Records 08a -> NG-081)
      await single(c1, () => g18(c1, 'NoGhost Records 08a', false), '100', 'NoGhost Records 08a');
      const c2 = seed.sc(8, 2); // G18b
      await single(c2, () => g18(c2, 'NoGhost Records 08b', true), '100', 'NoGhost Records 08b');
      const c3 = seed.sc(8, 3); // G20: the shared QQ rule under an assumption document
      await single(c3, async () => {
        await c3.person('A');
        await c3.split(1, [['A', '50']]);
      }, '100', 'qaraqshy records');
      const c4 = seed.sc(8, 4); // G21: a sublabel on an ISRC without a split
      await single(c4, async () => {
        await c4.company('NG');
        await c4.sublabel('NoGhost Records 08d', '0to8', 'NG');
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
