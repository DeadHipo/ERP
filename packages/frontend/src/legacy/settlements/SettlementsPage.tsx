import { useState, type FormEvent } from 'react';
import { Link } from 'react-router-dom';
import { api, type Operation } from '../api/client';
import { Card, ErrorBox, Money, Status, Table, useAction, useApi } from '../components/ui';

const SCOPES = ['any', 'master', 'publishing', 'master_publishing', 'isrcs'] as const;

/** Operations in/out; create an adjustment or an advance with a scope; payouts blocked while a proof is missing. */
export function SettlementsPage() {
  const owners = useApi(() => api.owners(), []);
  const [ownerId, setOwnerId] = useState('');
  const ops = useApi(() => api.operations(ownerId || undefined), [ownerId]);
  const detail = useApi(() => (ownerId ? api.owner(ownerId) : Promise.resolve(undefined)), [ownerId]);
  const action = useAction();
  const [proof, setProof] = useState<Record<string, string>>({});
  const [form, setForm] = useState({
    kind: 'deduction' as 'deduction' | 'credit' | 'advance',
    artistId: '',
    amount: '',
    date: new Date().toISOString().slice(0, 10),
    scope: 'any' as (typeof SCOPES)[number],
    isrcs: '',
    exclude: '',
    documentId: '',
    comment: '',
  });

  const create = (e: FormEvent) => {
    e.preventDefault();
    const list = (s: string) => s.split(/[\s,]+/).filter(Boolean);
    void action.run(async () => {
      await api.createOperation({
        direction: form.kind === 'advance' ? 'out' : 'in',
        amount: form.kind === 'credit' ? `-${form.amount}` : form.amount,
        artistId: form.artistId,
        date: form.date,
        scope:
          form.kind === 'credit'
            ? null
            : { kind: form.scope, ...(form.scope === 'isrcs' ? { isrcs: list(form.isrcs) } : {}), ...(form.exclude ? { excludeIsrcs: list(form.exclude) } : {}) },
        documentId: form.documentId || null,
        comment: form.comment,
      });
      ops.reload();
    });
  };

  const ownerName = new Map((owners.data ?? []).map((o) => [o.id, o.name]));
  const artists = detail.data?.artists ?? [];
  const artistName = new Map(artists.map((a) => [a.id, a.pseudonym]));
  const blocking = (ops.data ?? []).filter((o) => o.direction === 'out' && o.active && (!o.paymentProofId || o.deferred));
  return (
    <>
      <h1>Settlements and payouts</h1>
      <div className="row">
        <select value={ownerId} onChange={(e) => setOwnerId(e.target.value)}>
          <option value="">all owners</option>
          {(owners.data ?? []).map((o) => (
            <option key={o.id} value={o.id}>
              {o.name}
            </option>
          ))}
        </select>
        {ownerId && <Link to={`/owners/${ownerId}/balance`}>balance and payout button →</Link>}
      </div>
      {blocking.length > 0 && (
        <p className="warning">
          {blocking.length} payout(s) without payment proof: new payouts of {ownerId ? 'this owner' : 'these owners'} are blocked until the proof is attached.
        </p>
      )}
      {ownerId && (
        <Card title="New adjustment or advance (tied to an artist)">
          <form className="row" onSubmit={create}>
            <select value={form.kind} onChange={(e) => setForm({ ...form, kind: e.target.value as typeof form.kind })}>
              <option value="deduction">deduction (in, recouped within scope)</option>
              <option value="credit">credit (in, adds to the balance)</option>
              <option value="advance">advance (out, recoupable, needs scope)</option>
            </select>
            <select value={form.artistId} onChange={(e) => setForm({ ...form, artistId: e.target.value })} required>
              <option value="">artist…</option>
              {artists.map((a) => (
                <option key={a.id} value={a.id}>
                  {a.pseudonym}
                </option>
              ))}
            </select>
            <input placeholder="USD" value={form.amount} onChange={(e) => setForm({ ...form, amount: e.target.value })} required />
            <input type="date" value={form.date} onChange={(e) => setForm({ ...form, date: e.target.value })} />
            {form.kind !== 'credit' && (
              <select value={form.scope} onChange={(e) => setForm({ ...form, scope: e.target.value as typeof form.scope })}>
                {SCOPES.map((s) => (
                  <option key={s}>{s}</option>
                ))}
              </select>
            )}
            {form.scope === 'isrcs' && form.kind !== 'credit' && <input placeholder="ISRCs" value={form.isrcs} onChange={(e) => setForm({ ...form, isrcs: e.target.value })} />}
            {form.kind !== 'credit' && <input placeholder="exclude ISRCs" value={form.exclude} onChange={(e) => setForm({ ...form, exclude: e.target.value })} />}
            <select value={form.documentId} onChange={(e) => setForm({ ...form, documentId: e.target.value })}>
              <option value="">basis document…</option>
              {(detail.data?.documents ?? []).map((d) => (
                <option key={d.id} value={d.id}>
                  {d.kind}: {d.title} ({d.status})
                </option>
              ))}
            </select>
            <input placeholder="Comment: what and how" value={form.comment} onChange={(e) => setForm({ ...form, comment: e.target.value })} required />
            <button disabled={action.busy}>Save</button>
          </form>
          <p className="muted">A payout of earned money is made with the Payout button on the balance page (one amount per owner).</p>
        </Card>
      )}
      <ErrorBox error={action.error} />
      <Card title={`Operations (${ops.data?.length ?? '…'})`}>
        <ErrorBox error={ops.error} />
        <Table<Operation>
          rows={(ops.data ?? []).slice(0, 300)}
          keyOf={(o) => o.id}
          columns={[
            { title: 'Date', render: (o) => o.date },
            { title: 'Dir', render: (o) => o.direction },
            { title: 'Meaning', render: (o) => o.meaning.replace(/_/g, ' ') },
            { title: 'Amount', render: (o) => <Money value={(o.amountCents / 100).toFixed(2)} />, className: 'num' },
            { title: 'Owner', render: (o) => (o.ownerId ? ownerName.get(o.ownerId) ?? '?' : '—') },
            { title: 'Artist', render: (o) => (o.artistId ? artistName.get(o.artistId) ?? o.artistId.slice(0, 8) : '—') },
            { title: 'Scope', render: (o) => o.scope?.kind ?? '—' },
            { title: 'Comment', render: (o) => o.comment },
            {
              title: 'Proof',
              render: (o) =>
                o.direction !== 'out' ? null : o.paymentProofId ? (
                  <Status value={o.deferred ? 'deferred' : 'approved'} />
                ) : (
                  <span className="row">
                    <Status value="not_attached" />
                    <input placeholder="proof file ref" value={proof[o.id] ?? ''} onChange={(e) => setProof({ ...proof, [o.id]: e.target.value })} />
                    <button onClick={() => void action.run(async () => (await api.proof(o.id, proof[o.id] ?? ''), ops.reload()))}>Attach proof</button>
                  </span>
                ),
            },
          ]}
        />
      </Card>
    </>
  );
}
