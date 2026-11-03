import { single } from '../lib';
import type { Scenario } from './index';

// S20 (G30 perimeter), S21 (G22 unfunded carve), S35 (signals without a golden number).

export const perimeterSignals: Scenario[] = [
  {
    id: 'S20',
    async run(_f, { seed }) {
      const c = seed.sc(20, 1); // no track, no split: a line without ISRC (net 2) and an unregistered ISRC (net 7)
      await c.load('2026-03', [{ isrc: '', upc: 1, net: '2' }, { j: 9, net: '7' }]);
    },
  },
  {
    id: 'S21',
    async run(_f, { seed }) {
      const c = seed.sc(21, 1);
      await single(c, async () => {
        await c.person('A', 'P');
        await c.split(1, [['A', '10']]);
        await c.part(1, 'P', '20', 'net', 'artist_pool');
      });
    },
  },
  {
    id: 'S35',
    async run(_f, { seed }) {
      // k1 G21b: a sublabel without a rule in force in 2026-03, a rule recipient that is a row from 2026-06
      const c1 = seed.sc(35, 1);
      await c1.person('A', 'R');
      await c1.sublabel('Ghost Label 35', '0to8', 'R', { validFrom: '2026-06-01' });
      await c1.track(1);
      await c1.track(2);
      await c1.split(1, [['A', '40'], ['R', '10']]);
      await c1.split(2, [['A', '50']]);
      const rows = [
        { j: 1, net: '100', label: 'Ghost Label 35' },
        { j: 2, net: '40', label: 'Ghost Label 35' },
      ];
      await c1.load('2026-03', rows);
      await c1.load('2026-06', rows);

      // k2 G21c: two split rows of one ISRC belong to pseudonyms of one owner
      const c2 = seed.sc(35, 2);
      await c2.person('A');
      await c2.second('A2', 'A');
      await single(c2, async () => {
        await c2.split(1, [['A', '30'], ['A2', '20']]);
      });

      // k3: a track to put a note on
      const c3 = seed.sc(35, 3);
      await single(c3, async () => {
        await c3.person('A');
        await c3.split(1, [['A', '50']]);
      });

      // k4: a participant without an owner; a confirmed Owner P-354 exists to be assigned
      const c4 = seed.sc(35, 4);
      await c4.person('A');
      await c4.confirmed('P', ['Z']); // Owner P-354 (pseudonym Z-354)
      await c4.orphan('P'); // the participant pseudonym P-354 without owner
      await single(c4, async () => {
        await c4.split(1, [['A', '50']]);
        await c4.part(1, 'P', '10', 'bucket', 'label_share');
      });
    },
  },
];
