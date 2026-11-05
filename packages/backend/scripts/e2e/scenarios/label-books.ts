import type { Scenario } from './index';

// S38 (G50, D-168, D-169): one owner under both labels. A: rows 50 on j1 (`Test Label` → 0to8, unit 100) in the file
// of account 0 (0to8) and on j2 (`Echo8`, unit 60) in the file of account 1 (Echo8), one month; an advance 40 without a label (migrated, recouped from any income: 0to8 first)
// and an advance 10 under Echo8 (its income only). Books: 0to8 earned 50, recouped 40, payable 10; Echo8 earned 30,
// recouped 10, payable 20; the whole owner payable 30. The spec 35 pays under 0to8 and labels the old advance.

export const labelBooks: Scenario[] = [
  {
    id: 'S38',
    async run(_f, { seed }) {
      const c = seed.sc(38, 1);
      await c.person('A');
      await c.track(1);
      await c.track(2);
      await c.split(1, [['A', '50']]);
      await c.split(2, [['A', '50']]);
      // the book of a unit is the label of its file (R6): one file per account
      await c.load('2026-03', [{ j: 1, net: '100' }]);
      await c.load('2026-03', [{ j: 2, net: '60', label: 'Echo8' }], 1);
      const old = await c.advance('A', '40', { kind: 'any' }, '2026-03-01', null);
      c.keys.extra['advance-unlabelled'] = old.id;
      const echo = await c.advance('A', '10', { kind: 'any' }, '2026-03-01', 'Echo8');
      c.keys.extra['advance-echo8'] = echo.id;
      c.keys.labels['0to8'] = seed.label('0to8');
      c.keys.labels.Echo8 = seed.label('Echo8');
    },
  },
];
