import { single } from '../lib';
import type { Scenario } from './index';

// S01-S04: master rows (docs/agents/19_golden_screens.md §4, read-only). Every number comes from 12_golden_cases.md.

export const masterRows: Scenario[] = [
  {
    id: 'S01',
    async run(_f, { seed }) {
      // k1 G01: row A 50
      const c1 = seed.sc(1, 1);
      await single(c1, async () => {
        await c1.person('A');
        await c1.split(1, [['A', '50']]);
      });
      // k2 G42: the brand pseudonym 0to8 is linked to the track, no row; row A 50
      const c2 = seed.sc(1, 2);
      await c2.person('A');
      await c2.track(1, { artists: ['0to8'] });
      await c2.split(1, [['A', '50']]);
      await c2.load('2026-03', [{ j: 1, net: '100' }]);
    },
  },
  {
    id: 'S02',
    async run(_f, { seed }) {
      const c1 = seed.sc(2, 1); // G02
      await single(c1, async () => {
        await c1.person('A', 'B', 'C');
        await c1.split(1, [['A', '16.6'], ['B', '16.6'], ['C', '16.6']]);
      });
      const c2 = seed.sc(2, 2); // G03a
      await single(c2, async () => {
        await c2.person('A', 'B');
        await c2.split(1, [['A', '33.333333'], ['B', '16.666667']]);
      });
      const c3 = seed.sc(2, 3); // G03c
      await single(c3, async () => {
        await c3.person('A', 'B', 'C');
        await c3.split(1, [['A', '29.761905'], ['B', '10.119048'], ['C', '10.119047']]);
      });
      const c4 = seed.sc(2, 4); // G06: label-kind owner RX
      await single(c4, async () => {
        await c4.company('RX');
        await c4.split(1, [['RX', '66.6']]);
      });
      const c5 = seed.sc(2, 5); // G07: label-kind owner LL
      await single(c5, async () => {
        await c5.company('LL');
        await c5.split(1, [['LL', '25']]);
      });
    },
  },
  {
    id: 'S03',
    async run(_f, { seed }) {
      const c1 = seed.sc(3, 1); // G03b
      await single(c1, async () => {
        await c1.person('A', 'B', 'M1', 'M2');
        await c1.split(1, [['A', '25'], ['B', '25']]);
        await c1.part(1, 'M1', '13', 'net', 'artist_pool');
        await c1.part(1, 'M2', '13', 'net', 'artist_pool');
      });
      const c2 = seed.sc(3, 2); // G04
      await single(c2, async () => {
        await c2.person('A', 'B', 'R');
        await c2.split(1, [['A', '25'], ['B', '25']]);
        await c2.part(1, 'R', '15', 'net', 'top');
      });
      const c3 = seed.sc(3, 3); // G11
      await single(c3, async () => {
        await c3.person('A', 'P');
        await c3.split(1, [['A', '50']]);
        await c3.part(1, 'P', '15', 'bucket', 'label_share');
      });
      const c4 = seed.sc(3, 4); // G12
      await single(c4, async () => {
        await c4.person('A', 'E');
        await c4.split(1, [['A', '50']]);
        await c4.part(1, 'E', '10', 'bucket', 'artist_share', { from: 'A' });
      });
      const c5 = seed.sc(3, 5); // G32
      await single(c5, async () => {
        await c5.person('A', 'R');
        await c5.split(1, [['A', '100']]);
        await c5.part(1, 'R', '15', 'net', 'top');
      });
      const c6 = seed.sc(3, 6); // G35
      await single(c6, async () => {
        await c6.person('A', 'P1', 'P2');
        await c6.split(1, [['A', '50']]);
        await c6.part(1, 'P1', '10', 'bucket', 'label_share');
        await c6.part(1, 'P2', '15', 'bucket', 'label_share');
      });
      const c7 = seed.sc(3, 7); // G36
      await single(c7, async () => {
        await c7.person('A', 'B', 'S');
        await c7.split(1, [['A', '25'], ['B', '25']]);
        await c7.part(1, 'S', '15', 'net', 'label_share');
      });
      const c8 = seed.sc(3, 8); // G37
      await single(c8, async () => {
        await c8.person('A', 'P');
        await c8.split(1, [['A', '50']]);
        await c8.part(1, 'P', '70', 'net', 'label_share');
      });
    },
  },
  {
    id: 'S04',
    async run(f, { seed }) {
      // k1 G45: the settlement window; the loader step settlement-prestart is seeded as the golden test does
      const c1 = seed.sc(4, 1);
      await c1.person('A', 'S');
      await c1.track(1);
      await c1.split(1, [['A', '35'], ['S', '15']], { to: '2026-02-01' });
      await c1.split(1, [['A', '35']], { from: '2026-02-01' });
      const settlement1 = await c1.doc('contract', 'settlement');
      await c1.part(1, 'S', '15', 'net', 'label_share', { validFrom: '2026-02-01', doc: settlement1 });
      const decision1 = await c1.doc('other', 'decision');
      await f.changeSplit({ isrc: c1.isrc(1), from: '2026-01-01', shares: [{ artistId: c1.id('A'), percent: '50' }], documentId: decision1 });
      await c1.load('2026-01', [{ j: 1, net: '100' }]);
      await c1.load('2026-03', [{ j: 1, net: '100' }]);

      // k2 G46: Main carve 16.66 % (8.33 % / 8.33 %) entered per source artist (12 as stated)
      const c2 = seed.sc(4, 2);
      await c2.person('A', 'B', 'M1', 'M2');
      await c2.track(1);
      await c2.split(1, [['A', '25'], ['B', '25']]);
      for (const m of ['M1', 'M2'])
        for (const src of ['A', 'B'])
          await c2.part(1, m, '16.66', 'bucket', 'artist_share', { from: src, validFrom: '2026-01-01', key: `${m}-${src}` });
      await c2.load('2026-01', [{ j: 1, net: '100' }]);
      await c2.load('2026-03', [{ j: 1, net: '100' }]);

      // k3 G47: the settlement share before its start goes to the co-artists pro rata
      const c3 = seed.sc(4, 3);
      await c3.person('A', 'B', 'S');
      await c3.track(1);
      await c3.split(1, [['A', '17.5'], ['B', '17.5'], ['S', '15']], { to: '2026-02-01' });
      await c3.split(1, [['A', '17.5'], ['B', '17.5']], { from: '2026-02-01' });
      const settlement3 = await c3.doc('contract', 'settlement');
      await c3.part(1, 'S', '15', 'net', 'label_share', { validFrom: '2026-02-01', doc: settlement3 });
      const decision3 = await c3.doc('other', 'decision');
      await f.changeSplit({
        isrc: c3.isrc(1),
        from: '2026-01-01',
        shares: [{ artistId: c3.id('A'), percent: '25' }, { artistId: c3.id('B'), percent: '25' }],
        documentId: decision3,
      });
      await c3.load('2026-01', [{ j: 1, net: '100' }]);
      await c3.load('2026-02', [{ j: 1, net: '100' }]);
    },
  },
];
