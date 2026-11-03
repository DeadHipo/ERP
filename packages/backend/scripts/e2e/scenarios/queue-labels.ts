import type { Scenario } from './index';

// S16 label_unmapped -> alias, S17 label_unmapped -> sublabel + rule, S37 close a label rule.

export const queueLabels: Scenario[] = [
  {
    id: 'S16',
    async run(_f, { seed }) {
      const c = seed.sc(16, 1); // G08c: the string Mystery Records is in no dictionary; row A 50
      await c.person('A');
      await c.track(1);
      await c.split(1, [['A', '50']]);
      await c.load('2026-03', [{ j: 1, net: '100', label: 'Mystery Records' }]);
      c.keys.extra.labelString = 'Mystery Records';
    },
  },
  {
    id: 'S17',
    async run(_f, { seed }) {
      const c = seed.sc(17, 1); // string Mystery Records B; row A 50; company NG-171
      await c.person('A');
      await c.company('NG');
      await c.track(1);
      await c.split(1, [['A', '50']]);
      await c.load('2026-03', [{ j: 1, net: '100', label: 'Mystery Records B' }]);
      c.keys.extra.labelString = 'Mystery Records B';
    },
  },
  {
    id: 'S37',
    async run(_f, { seed }) {
      const c = seed.sc(37, 1); // Close Label 37: sublabel of 0to8, rule 50 -> NG-371 from 2020-01-01
      await c.person('A');
      await c.company('NG');
      await c.sublabel('Close Label 37', '0to8', 'NG');
      await c.track(1);
      await c.split(1, [['A', '50']]);
      await c.load('2026-03', [{ j: 1, net: '100', label: 'Close Label 37' }]);
      await c.load('2026-04', [{ j: 1, net: '100', label: 'Close Label 37' }]);
    },
  },
];
