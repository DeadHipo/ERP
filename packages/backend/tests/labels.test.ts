import { describe, expect, it } from 'vitest';
import { assumptionDoc, newFacade } from './helpers/fixtures';

describe('labels module (D-125)', () => {
  it('seeds the own labels; creates an own label', async () => {
    const f = await newFacade();
    const l = f.modules.labels;
    const list = await l.listLabels();
    expect(list.map((x) => x.name).sort()).toEqual(['0to8', 'Echo8']);
    const one = await l.createLabel({ name: 'Label One' });
    expect(one.name).toBe('Label One');
    // D-232: the sublabel rule model removed (a sublabel needed an existing own label)
  });

  it('a second label with the same name in the organization is refused (label_name_taken, D-170)', async () => {
    const f = await newFacade();
    const l = f.modules.labels;
    await expect(l.createLabel({ name: '0to8' })).rejects.toMatchObject({
      code: 'label_name_taken',
      statusCode: 409,
    });
    await expect(l.createLabel({ name: ' Echo8 ' })).rejects.toMatchObject({
      code: 'label_name_taken',
    });
    expect((await l.listLabels()).length).toBe(2);
  });

  it('normalises aliases and keeps them unique', async () => {
    const f = await newFacade();
    const l = f.modules.labels;
    const echo = (await l.listLabels()).find((x) => x.name === 'Echo8')!;
    const two = await l.createLabel({ name: 'Label Two' });
    await l.addAlias(two.id, '  Ｓub   Two Records ');
    await expect(l.addAlias(two.id, 'sub two records')).rejects.toMatchObject({ code: 'alias_taken' });
    await expect(l.addAlias(echo.id, 'ECHO8')).rejects.toMatchObject({ code: 'alias_taken' });
    expect((await l.index()).normalize('A  B')).toBe('a b');
  });

  // D-232: the sublabel rule model removed (rule_overlap / rule_for_own_label refusals, the D-130 floors of rule dates)

  it('labelOf resolves a string to its own label', async () => {
    const f = await newFacade();
    const l = f.modules.labels;
    const echo = (await l.listLabels()).find((x) => x.name === 'Echo8')!;
    await l.addAlias(echo.id, 'Echo Four Records');
    const idx = await l.index();
    expect(idx.labelOf('echo four  RECORDS')).toMatchObject({ id: echo.id, name: 'Echo8' });
    expect(idx.labelOf('Test Label')).toMatchObject({ name: '0to8' });
    expect(idx.labelOf('Unknown Imprint')).toBeUndefined();
    // D-232: the sublabel rule model removed (the rule in force at a date)
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
