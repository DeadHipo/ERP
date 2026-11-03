import type { Scenario } from './index';

// S34: upload a Believe file (P19). The fixture CSV is in packages/frontend/e2e/fixtures; the seed has the track and row A 50.

export const sources: Scenario[] = [
  {
    id: 'S34',
    async run(_f, { seed }) {
      const c = seed.sc(34, 1);
      await c.person('A');
      await c.track(1);
      await c.split(1, [['A', '50']]);
      c.keys.accounts.push(c.account(0));
      c.keys.extra.fixtureFile = `9900001_${c.account(0)}_2026-03-01_2026-03-01.csv`;
    },
  },
];
