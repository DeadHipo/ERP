import { single } from '../lib';
import type { Scenario } from './index';

// S31 (G43 i-iii and the operations k4): owner A earns master 50 and publishing 30 (a B17 holder line of 60, terms 50).

export const operations: Scenario[] = [
  {
    id: 'S31',
    async run(f, { seed }) {
      for (const k of [1, 2, 3]) {
        const c = seed.sc(31, k);
        const holder = `OWNER, ${c.pseud('A')}`;
        await single(c, async () => {
          await c.confirmed('A', ['A'], { aliases: [holder] });
          await c.track(2); // a second track without income
          await c.split(1, [['A', '50']]);
        });
        await f.setPublishingTerms({
          ownerId: c.owner('A'),
          percent: '50',
          validFrom: '2020-01-01',
          documentId: await c.doc('contract', 'terms-A', 'A'),
        });
        c.b17({ title: `Song-31${k}`, writer: holder, payable: '60', period: '2Q26' });
        if (k === 3) await c.migrationPayout('A', '20');
      }
      const c4 = seed.sc(31, 4); // G01 base, Owner A-314 payable 50
      await single(c4, async () => {
        await c4.person('A');
        await c4.split(1, [['A', '50']]);
      });
    },
  },
];
