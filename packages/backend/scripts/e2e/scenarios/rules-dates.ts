import { single } from '../lib';
import type { Scenario } from './index';

// S25 buy-out (G09), S26 assignment (G13, G17), S27 close a participation (G14), S28 M52 (G25), S29 refusals (G23).

export const rulesDates: Scenario[] = [
  {
    id: 'S25',
    async run(_f, { seed }) {
      const c = seed.sc(25, 1);
      await c.person('A');
      await c.track(1);
      await c.split(1, [['A', '50']]);
      await c.doc('buyout', 'buyout');
      for (const m of ['2026-02', '2026-03', '2026-05']) await c.load(m, [{ j: 1, net: '100' }]);
    },
  },
  {
    id: 'S26',
    async run(f, { seed }) {
      const c1 = seed.sc(26, 1); // G13: the assignment (a change from 2026-06-01 to A2) is the spec's action
      await c1.person('A', 'A2');
      await c1.track(1);
      await c1.split(1, [['A', '50']]);
      await c1.doc('other', 'assignment');
      await c1.load('2026-05', [{ j: 1, net: '100' }]);
      await c1.load('2026-06', [{ j: 1, net: '100' }]);

      const c2 = seed.sc(26, 2); // G17: a sale to DU from 2026-06-01 (read-only)
      await c2.person('A');
      await c2.company('DU');
      await c2.track(1);
      await c2.split(1, [['A', '50']]);
      const sale = await c2.doc('contract', 'sale');
      await f.changeSplit({ isrc: c2.isrc(1), from: '2026-06-01', shares: [{ artistId: c2.id('DU'), percent: '100' }], documentId: sale });
      await c2.load('2026-05', [{ j: 1, net: '100' }]);
      await c2.load('2026-06', [{ j: 1, net: '100' }]);
    },
  },
  {
    id: 'S27',
    async run(_f, { seed }) {
      const c = seed.sc(27, 1);
      await c.person('A', 'P');
      await c.track(1);
      await c.split(1, [['A', '50']]);
      await c.part(1, 'P', '15', 'bucket', 'label_share', { validFrom: '2026-01-01' });
      await c.load('2026-03', [{ j: 1, net: '100' }]);
      await c.load('2026-04', [{ j: 1, net: '100' }]);
    },
  },
  {
    id: 'S28',
    async run(_f, { seed }) {
      const c = seed.sc(28, 1); // P exists (confirmed) for the spec to create the participation with validFrom 2026-03-15
      await single(c, async () => {
        await c.person('A', 'P');
        await c.split(1, [['A', '50']]);
      });
    },
  },
  {
    id: 'S29',
    async run(_f, { seed }) {
      const c = seed.sc(29, 1); // no Believe unit; row A 50, P 10 (bucket, label_share), R1 60 (net, top); R2 for the refusal
      await c.person('A', 'P', 'R1', 'R2');
      await c.track(1);
      await c.split(1, [['A', '50']]);
      await c.part(1, 'P', '10', 'bucket', 'label_share');
      await c.part(1, 'R1', '60', 'net', 'top');
    },
  },
];
