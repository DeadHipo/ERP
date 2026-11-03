import { useState, type FormEvent } from 'react';
import { api, type LabelListItem } from '../client';
import { Card, ErrorBox, Status, Table, useAction, useApi } from '../ui';

type Rule = LabelListItem['rules'][number];

/** Own labels and sublabels with their Believe label strings (aliases) and sublabel rules (D-125). */
export function LabelsPage() {
  const labels = useApi(() => api.labels(), []);
  const artists = useApi(() => api.artists(), []);
  const docs = useApi(() => api.documents(), []);
  const action = useAction();
  const [label, setLabel] = useState({ name: '', kind: 'own' as 'own' | 'sublabel', ownLabelId: '' });
  const [alias, setAlias] = useState({ labelId: '', alias: '' });
  const [rule, setRule] = useState({ labelId: '', percent: '', recipientArtistId: '', validFrom: '', validTo: '', documentId: '', note: '' });
  const [close, setClose] = useState({ ruleId: '', validTo: '' });

  const list = labels.data ?? [];
  const own = list.filter((l) => l.kind === 'own');
  const subs = list.filter((l) => l.kind === 'sublabel');
  const allRules = list.flatMap((l) => l.rules.map((r) => ({ ...r, labelName: l.name })));
  const run = (fn: () => Promise<unknown>, after?: () => void) =>
    void action.run(async () => {
      await fn();
      after?.();
      labels.reload();
    });

  const createLabel = (e: FormEvent) => {
    e.preventDefault();
    run(
      () => api.createLabel({ name: label.name, kind: label.kind, ownLabelId: label.kind === 'sublabel' ? label.ownLabelId : null }),
      () => setLabel({ ...label, name: '' }),
    );
  };
  const addAlias = (e: FormEvent) => {
    e.preventDefault();
    run(() => api.addAlias(alias.labelId, alias.alias), () => setAlias({ ...alias, alias: '' }));
  };
  const addRule = (e: FormEvent) => {
    e.preventDefault();
    run(
      () =>
        api.createLabelRule(rule.labelId, {
          percent: rule.percent,
          recipientArtistId: rule.recipientArtistId,
          validFrom: rule.validFrom,
          validTo: rule.validTo || null,
          documentId: rule.documentId || null,
          note: rule.note || null,
        }),
      () => setRule({ ...rule, percent: '', validFrom: '', validTo: '', note: '' }),
    );
  };
  const closeRule = (e: FormEvent) => {
    e.preventDefault();
    run(() => api.closeLabelRule(close.ruleId, close.validTo), () => setClose({ ruleId: '', validTo: '' }));
  };

  const docOptions = (docs.data ?? []).filter((d) => ['appendix', 'contract', 'other', 'assumption'].includes(d.kind));

  return (
    <>
      <h1>Labels</h1>
      <ErrorBox error={action.error ?? labels.error} />
      <Card title="Create a label">
        <form className="row" onSubmit={createLabel}>
          <input placeholder="name" value={label.name} onChange={(e) => setLabel({ ...label, name: e.target.value })} required />
          <select value={label.kind} onChange={(e) => setLabel({ ...label, kind: e.target.value as 'own' | 'sublabel' })}>
            <option value="own">own label</option>
            <option value="sublabel">sublabel</option>
          </select>
          {label.kind === 'sublabel' && (
            <select value={label.ownLabelId} onChange={(e) => setLabel({ ...label, ownLabelId: e.target.value })} required>
              <option value="">own label of its money…</option>
              {own.map((l) => (
                <option key={l.id} value={l.id}>
                  {l.name}
                </option>
              ))}
            </select>
          )}
          <button disabled={action.busy}>Create</button>
        </form>
      </Card>
      <Card title="Add an alias (Believe label string)">
        <form className="row" onSubmit={addAlias}>
          <select value={alias.labelId} onChange={(e) => setAlias({ ...alias, labelId: e.target.value })} required>
            <option value="">label…</option>
            {list.map((l) => (
              <option key={l.id} value={l.id}>
                {l.name} ({l.kind})
              </option>
            ))}
          </select>
          <input placeholder="label string as in the report" value={alias.alias} onChange={(e) => setAlias({ ...alias, alias: e.target.value })} required />
          <button disabled={action.busy}>Add alias</button>
        </form>
      </Card>
      <Card title="Add a sublabel rule">
        <form onSubmit={addRule}>
          <div className="row">
            <select value={rule.labelId} onChange={(e) => setRule({ ...rule, labelId: e.target.value })} required>
              <option value="">sublabel…</option>
              {subs.map((l) => (
                <option key={l.id} value={l.id}>
                  {l.name}
                </option>
              ))}
            </select>
            <input placeholder="% of the label share" value={rule.percent} onChange={(e) => setRule({ ...rule, percent: e.target.value })} required />
            <select value={rule.recipientArtistId} onChange={(e) => setRule({ ...rule, recipientArtistId: e.target.value })} required>
              <option value="">recipient pseudonym…</option>
              {(artists.data ?? []).slice(0, 2000).map((a) => (
                <option key={a.id} value={a.id}>
                  {a.pseudonym}
                </option>
              ))}
            </select>
          </div>
          <div className="row">
            <label>
              from <input type="date" value={rule.validFrom} onChange={(e) => setRule({ ...rule, validFrom: e.target.value })} required />
            </label>
            <label>
              to (exclusive) <input type="date" value={rule.validTo} onChange={(e) => setRule({ ...rule, validTo: e.target.value })} />
            </label>
            <select value={rule.documentId} onChange={(e) => setRule({ ...rule, documentId: e.target.value })}>
              <option value="">no document (waits for confirmation)</option>
              {docOptions.map((d) => (
                <option key={d.id} value={d.id}>
                  {d.kind}: {d.title} ({d.status})
                </option>
              ))}
            </select>
            <input placeholder="note" value={rule.note} onChange={(e) => setRule({ ...rule, note: e.target.value })} />
            <button disabled={action.busy}>Add rule</button>
          </div>
        </form>
      </Card>
      <Card title="Close a rule">
        <form className="row" onSubmit={closeRule}>
          <select value={close.ruleId} onChange={(e) => setClose({ ...close, ruleId: e.target.value })} required>
            <option value="">rule…</option>
            {allRules.map((r) => (
              <option key={r.id} value={r.id}>
                {r.labelName}: {r.percent}% to {r.recipientPseudonym} from {r.validFrom}
              </option>
            ))}
          </select>
          <label>
            to (exclusive) <input type="date" value={close.validTo} onChange={(e) => setClose({ ...close, validTo: e.target.value })} required />
          </label>
          <button disabled={action.busy}>Close</button>
        </form>
      </Card>
      <Card title={`Labels (${list.length})`}>
        <Table<LabelListItem>
          rows={list}
          keyOf={(l) => l.id}
          columns={[
            { title: 'Name', render: (l) => l.name },
            { title: 'Kind', render: (l) => l.kind },
            { title: 'Own label', render: (l) => list.find((x) => x.id === l.ownLabelId)?.name ?? '—' },
            { title: 'Aliases', render: (l) => l.aliases.join(', ') || '—' },
            { title: 'Rules', render: (l) => l.rules.length, className: 'num' },
          ]}
        />
      </Card>
      <Card title="Sublabel rules">
        <Table<Rule & { labelName: string }>
          rows={allRules}
          keyOf={(r) => r.id}
          columns={[
            { title: 'Sublabel', render: (r) => r.labelName },
            { title: 'Percent', render: (r) => `${r.percent}%`, className: 'num' },
            { title: 'Recipient', render: (r) => r.recipientPseudonym },
            { title: 'Period', render: (r) => `${r.validFrom} → ${r.validTo ?? 'open'}` },
            { title: 'Document', render: (r) => <Status value={r.documentStatus} /> },
            { title: 'Note', render: (r) => r.note ?? '' },
          ]}
        />
      </Card>
    </>
  );
}
