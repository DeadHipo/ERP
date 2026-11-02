import { describe, expect, it } from 'vitest';
import { assumptionDoc, labelOwner, newFacade } from './helpers/fixtures';

describe('labels module (D-125)', () => {
  it('seeds the own labels; creates own and sublabel, a sublabel needs an own label', async () => {
    const f = await newFacade();
    const l = f.modules.labels;
    const list = await l.listLabels();
    expect(list.map((x) => x.name).sort()).toEqual(['0to8', 'Echo8']);
    const echo = list.find((x) => x.name === 'Echo8')!;
    const sub = await l.createLabel({ name: 'Sub One', kind: 'sublabel', ownLabelId: echo.id });
    expect(sub.ownLabelId).toBe(echo.id);
    await expect(l.createLabel({ name: 'Bad', kind: 'sublabel' })).rejects.toMatchObject({
      code: 'validation_error',
    });
    await expect(l.createLabel({ name: 'Bad', kind: 'sublabel', ownLabelId: sub.id })).rejects.toMatchObject({
      code: 'validation_error',
    });
    await expect(l.createLabel({ name: 'Bad', kind: 'sublabel', ownLabelId: 'nope' })).rejects.toMatchObject({
      code: 'not_found',
    });
  });

  it('normalises aliases and keeps them unique', async () => {
    const f = await newFacade();
    const l = f.modules.labels;
    const echo = (await l.listLabels()).find((x) => x.name === 'Echo8')!;
    const sub = await l.createLabel({ name: 'Sub Two', kind: 'sublabel', ownLabelId: echo.id });
    await l.addAlias(sub.id, '  Ｓub   Two Records ');
    await expect(l.addAlias(sub.id, 'sub two records')).rejects.toMatchObject({ code: 'alias_taken' });
    await expect(l.addAlias(echo.id, 'ECHO8')).rejects.toMatchObject({ code: 'alias_taken' });
    expect((await l.index()).normalize('A  B')).toBe('a b');
  });

  it('refuses overlapping rules and rules for an own label', async () => {
    const f = await newFacade();
    const l = f.modules.labels;
    const { artist } = await labelOwner(f, 'Sub Owner');
    const echo = (await l.listLabels()).find((x) => x.name === 'Echo8')!;
    const sub = await l.createLabel({ name: 'Sub Three', kind: 'sublabel', ownLabelId: echo.id });
    await expect(
      l.setRule({ labelId: echo.id, percent: '50', recipientArtistId: artist.id, validFrom: '2026-01-01' }),
    ).rejects.toMatchObject({ code: 'rule_for_own_label' });
    const r = await l.setRule({
      labelId: sub.id,
      percent: '50',
      recipientArtistId: artist.id,
      validFrom: '2026-01-01',
      validTo: '2026-06-01',
    });
    await expect(
      l.setRule({ labelId: sub.id, percent: '40', recipientArtistId: artist.id, validFrom: '2026-05-01' }),
    ).rejects.toMatchObject({ code: 'rule_overlap' });
    await l.setRule({ labelId: sub.id, percent: '40', recipientArtistId: artist.id, validFrom: '2026-06-01' });
    await expect(
      l.setRule({ labelId: sub.id, percent: '101', recipientArtistId: artist.id, validFrom: '2030-01-01' }),
    ).rejects.toMatchObject({ code: 'validation_error' });
    const closed = await l.closeRule(r.id, '2026-03-01');
    expect(closed.validTo).toBe('2026-03-01');
  });

  it('labelOf resolves a string at a date with the rule in force', async () => {
    const f = await newFacade();
    const l = f.modules.labels;
    const { artist } = await labelOwner(f, 'Sub Owner');
    const echo = (await l.listLabels()).find((x) => x.name === 'Echo8')!;
    const sub = await l.createLabel({ name: 'Sub Four', kind: 'sublabel', ownLabelId: echo.id });
    await l.addAlias(sub.id, 'Sub Four Records');
    const rule = await l.setRule({
      labelId: sub.id,
      percent: '50',
      recipientArtistId: artist.id,
      validFrom: '2026-03-01',
      validTo: '2026-09-01',
    });
    const idx = await l.index();
    const inForce = idx.labelOf('sub four  RECORDS', '2026-04-01');
    expect(inForce).toMatchObject({ id: sub.id, kind: 'sublabel', ownLabelId: echo.id });
    expect(inForce?.rule?.id).toBe(rule.id);
    expect(inForce?.rule?.percent.toFixed()).toBe('50');
    expect(inForce?.rule?.recipientArtistId).toBe(artist.id);
    expect(idx.labelOf('Sub Four Records', '2026-02-01')?.rule).toBeNull();
    expect(idx.labelOf('Sub Four Records', '2026-09-01')?.rule).toBeNull();
    expect(idx.labelOf('Test Label', '2026-04-01')).toMatchObject({ name: '0to8', kind: 'own', rule: null });
    expect(idx.labelOf('Unknown Imprint', '2026-04-01')).toBeUndefined();
  });

  it('a document of kind assumption is never approved', async () => {
    const f = await newFacade();
    const d = await assumptionDoc(f, null, 'Council decision');
    expect(d.status).toBe('not_approved');
    await expect(f.modules.owners.approveDocument(d.id, 'manager')).rejects.toMatchObject({
      code: 'assumption_not_approvable',
    });
  });

  it('a track note round-trips', async () => {
    const f = await newFacade();
    const o = f.modules.owners;
    const t = await o.createTrack({ title: 'T', isrc: 'QZTST2600001', upc: '123456789012', note: 'stream cap' });
    expect(t.note).toBe('stream cap');
    expect((await o.listTracks()).find((x) => x.id === t.id)?.note).toBe('stream cap');
    expect((await o.setTrackNote(t.id, null)).note).toBeNull();
    expect((await o.listTracks()).find((x) => x.id === t.id)?.note).toBeNull();
  });
});
