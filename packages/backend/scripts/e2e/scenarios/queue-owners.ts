import type { Scenario } from './index';

// S14 owner_unconfirmed, S15 artist_without_owner, S30 duplicate pseudonyms, S33 merge, S36 duplicate dialog.

export const queueOwners: Scenario[] = [
  {
    id: 'S14',
    async run(_f, { seed }) {
      const c = seed.sc(14, 1); // unconfirmed Owner A-141, row A 50
      await c.unconfirmed('A');
      await c.track(1);
      await c.split(1, [['A', '50']]);
      await c.load('2026-03', [{ j: 1, net: '100' }]);
    },
  },
  {
    id: 'S15',
    async run(_f, { seed }) {
      const c = seed.sc(15, 1); // artist A-151 without owner; confirmed Owner A-151 (contract on Z-151)
      await c.confirmed('A', ['Z']);
      await c.orphan('A');
      await c.track(1);
      await c.split(1, [['A', '50']]);
      await c.load('2026-03', [{ j: 1, net: '100' }]);
    },
  },
  {
    id: 'S30',
    async run(_f, { seed }) {
      const c = seed.sc(30, 1);
      await c.confirmed('DUP', ['DUP']); // Owner DUP-301 with pseudonym DUP-301
      await c.orphan('DUP2', c.pseud('DUP')); // a second artist DUP-301 without owner
      await c.track(1);
      await c.load('2026-03', [{ j: 1, net: '100', artist: c.pseud('DUP') }]);
    },
  },
  {
    id: 'S33',
    async run(_f, { seed }) {
      const c = seed.sc(33, 1); // confirmed Owner X-331 (pseudonym A), unconfirmed Owner Y-331 (pseudonym B), one file
      await c.confirmed('X', ['A']);
      await c.unconfirmed('Y', ['B']);
      await c.track(1);
      await c.track(2);
      await c.split(1, [['A', '50']]);
      await c.split(2, [['B', '50']]);
      await c.load('2026-03', [{ j: 1, net: '100' }, { j: 2, net: '100' }]);
    },
  },
  {
    id: 'S36',
    async run(f, { seed }) {
      const c = seed.sc(36, 1); // Owner DUP-361 and artist A-361 (no money)
      const owner = await f.modules.owners.createOwner({ name: 'Owner DUP-361', kind: 'person' });
      const artist = await f.modules.owners.createArtist({ pseudonym: c.pseud('A'), ownerId: owner.id });
      c.keys.owners.DUP = owner.id;
      c.keys.artists.A = artist.id;
      c.keys.names.A = c.pseud('A');
    },
  },
];
