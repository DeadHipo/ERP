import type { Scenario } from './index';

/**
 * S00: the labels and shared pseudonyms seeded once (19 §1): own labels 0to8 (aliases `Test Label`, `0to8`, `Ahh Music`)
 * and Echo8 (`Echo8`); sublabel `NoGhost Records` of 0to8, rule 50 -> NG from 2020-01-01 (approved contract); sublabel
 * `qaraqshy records` of Echo8, rule 50 -> QQ under an `assumption` document; the brand pseudonym `0to8` of a label owner.
 */
export const shared: Scenario[] = [
  {
    id: 'S00',
    async run(f, { seed }) {
      const labels = f.modules.labels;
      const zero = await labels.createLabel({ name: '0to8', kind: 'own' });
      for (const a of ['Test Label', '0to8', 'Ahh Music']) await labels.addAlias(zero.id, a);
      const echo = await labels.createLabel({ name: 'Echo8', kind: 'own' });
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
      const ngDoc = await sc.doc('contract', 'ng-rule-contract');
      const ng = await labels.createLabel({ name: 'NoGhost Records', kind: 'sublabel', ownLabelId: zero.id });
      await labels.addAlias(ng.id, 'NoGhost Records');
      const ngRule = await labels.setRule({
        labelId: ng.id,
        percent: '50',
        recipientArtistId: sc.id('NG'),
        validFrom: '2020-01-01',
        documentId: ngDoc,
      });
      const q12 = await sc.assumption('q12', 'Q12: the half rule for other imprints');
      const qq = await labels.createLabel({ name: 'qaraqshy records', kind: 'sublabel', ownLabelId: echo.id });
      await labels.addAlias(qq.id, 'qaraqshy records');
      const qqRule = await labels.setRule({
        labelId: qq.id,
        percent: '50',
        recipientArtistId: sc.id('QQ'),
        validFrom: '2020-01-01',
        documentId: q12,
      });
      Object.assign(sc.keys.labels, { '0to8': zero.id, Echo8: echo.id, 'NoGhost Records': ng.id, 'qaraqshy records': qq.id });
      Object.assign(sc.keys.labelRules, { 'NoGhost Records': ngRule.id, 'qaraqshy records': qqRule.id });
    },
  },
];
