import type { Scenario } from './index';

// S10 (G33, G40: reconciliation per account) and S11 (G24: one ISRC under two UPCs).

export const overviewRelease: Scenario[] = [
  {
    id: 'S10',
    async run(_f, { seed }) {
      const c1 = seed.sc(10, 1); // G33: two accounts
      await c1.person('A');
      await c1.track(1);
      await c1.track(2);
      await c1.split(1, [['A', '50']]);
      await c1.split(2, [['A', '50']]);
      await c1.load('2026-03', [{ j: 1, net: '100' }], 0);
      await c1.load('2026-03', [{ j: 2, net: '50', label: 'Echo8' }], 1);

      const c2 = seed.sc(10, 2); // G40: the same ISRC in both accounts under Echo8, an unknown pair in the second
      await c2.person('A');
      await c2.track(1);
      await c2.split(1, [['A', '50']]);
      await c2.load('2026-03', [{ j: 1, net: '100', label: 'Echo8' }], 0);
      await c2.load('2026-03', [{ j: 1, net: '50', label: 'Echo8' }, { j: 9, net: '7', label: 'Echo8' }], 1);
    },
  },
  {
    id: 'S11',
    async run(_f, { seed }) {
      const c = seed.sc(11, 1); // G24: QZTST2711101 under UPC1 and UPC2
      await c.person('A', 'P');
      await c.track(1, { upc: 1 });
      await c.track(1, { upc: 2 });
      await c.split(1, [['A', '50']]);
      await c.part(1, 'P', '10', 'bucket', 'label_share');
      await c.load('2026-03', [{ j: 1, upc: 1, net: '100' }, { j: 1, upc: 2, net: '50' }]);
    },
  },
];
