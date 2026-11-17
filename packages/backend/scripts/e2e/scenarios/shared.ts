import type { Scenario } from './index';

/**
 * S00: the labels and shared pseudonyms seeded once (19 §1): own labels 0to8 (aliases `Test Label`, `0to8`, `Ahh Music`)
 * and Echo8 (`Echo8`); the strings `NoGhost Records` (an alias of 0to8) and `qaraqshy records` (an alias of Echo8; D-232:
 * before, sublabels with rules 50 -> NG and QQ); the pseudonyms NG, QQ and the brand `0to8` of label owners.
 */
export const shared: Scenario[] = [
  {
    id: 'S00',
    async run(f, { seed }) {
      const labels = f.modules.labels;
      const zero = await labels.createLabel({ name: '0to8' });
      for (const a of ['Test Label', '0to8', 'Ahh Music']) await labels.addAlias(zero.id, a);
      const echo = await labels.createLabel({ name: 'Echo8' });
      await labels.addAlias(echo.id, 'Echo8');
      seed.shared['label:0to8'] = zero.id;
      seed.shared['label:Echo8'] = echo.id;

      // The shared recipients live in the case S00/k0, keyed like any other case.
      const sc = seed.sc(0, 0);
      const pseud = (n: string) => n; // shared pseudonyms are not numbered
      for (const n of ['NG', 'QQ', '0to8']) {
        const o = f.modules.owners;
        const owner = await o.createOwner({ name: n === '0to8' ? 'Company 0to8' : `Company ${n}`, kind: 'label' });
        const artist = await o.createArtist({ pseudonym: pseud(n), ownerId: owner.id });
        const doc = await o.createDocument({
          kind: 'contract',
          title: `Contract Company ${n}`,
          fileRef: `dummy://contract-company-${n}.pdf`,
          ownerId: owner.id,
          requiresApproval: false,
        });
        await o.createContract({ ownerId: owner.id, documentId: doc.id, artistIds: [artist.id] });
        seed.shared[`artist:${n}`] = artist.id;
        seed.shared[`owner:${n}`] = owner.id;
        sc.keys.artists[n] = artist.id;
        sc.keys.owners[n] = owner.id;
        sc.keys.names[n] = n;
      }
      // D-232: the sublabel rule model removed (the sublabels NoGhost Records -> NG and qaraqshy records -> QQ with their rules): the strings are
      // aliases of the own labels
      await labels.addAlias(zero.id, 'NoGhost Records');
      await labels.addAlias(echo.id, 'qaraqshy records');
      Object.assign(sc.keys.labels, { '0to8': zero.id, Echo8: echo.id, 'NoGhost Records': zero.id, 'qaraqshy records': echo.id });
    },
  },
];
