import { useState, type FormEvent } from 'react';
import { useSearchParams } from 'react-router-dom';
import { api, type SplitView } from '../api/client';
import { Card, ErrorBox, Status, Table, useAction, useApi } from '../components/ui';

interface ShareRow {
  artistId: string;
  newArtistPseudonym: string;
  percent: string;
}

/** Splits per ISRC with validity periods; our share is shown as the remainder; create or change with a document. */
export function SplitsPage() {
  const [params, setParams] = useSearchParams();
  const isrc = params.get('isrc') ?? '';
  const list = useApi(() => api.splits({ ...(isrc ? { isrc } : {}), limit: '100' }), [isrc]);
  const artists = useApi(() => api.artists(), []);
  const docs = useApi(() => api.documents(), []);
  const action = useAction();
  const [mode, setMode] = useState<'create' | 'change'>('create');
  const [form, setForm] = useState({ isrc: '', date: '', documentId: '' });
  const [shares, setShares] = useState<ShareRow[]>([{ artistId: '', newArtistPseudonym: '', percent: '' }]);

  const sum = shares.reduce((s, x) => s + (Number(x.percent) || 0), 0);
  const submit = (e: FormEvent) => {
    e.preventDefault();
    const spec = shares
      .filter((s) => s.percent !== '')
      .map((s) => (s.artistId ? { artistId: s.artistId, percent: s.percent } : { newArtistPseudonym: s.newArtistPseudonym, percent: s.percent }));
    void action.run(async () => {
      if (mode === 'create') await api.createSplit({ isrc: form.isrc, validFrom: form.date, shares: spec, documentId: form.documentId || null });
      else await api.changeSplit({ isrc: form.isrc, from: form.date, shares: spec, documentId: form.documentId });
      setParams({ isrc: form.isrc.replace(/-/g, '').toUpperCase() });
      list.reload();
    });
  };
  const splitDocs = (docs.data ?? []).filter((d) => ['appendix', 'contract', 'buyout'].includes(d.kind));

  return (
    <>
      <h1>Splits</h1>
      <Card title={mode === 'create' ? 'Create a split' : 'Change a split (needs a document)'}>
        <div className="row">
          <label>
            <input type="radio" checked={mode === 'create'} onChange={() => setMode('create')} /> create
          </label>
          <label>
            <input type="radio" checked={mode === 'change'} onChange={() => setMode('change')} /> change from a date
          </label>
        </div>
        <form onSubmit={submit}>
          <div className="row">
            <input placeholder="ISRC" value={form.isrc} onChange={(e) => setForm({ ...form, isrc: e.target.value })} required />
            <label>
              {mode === 'create' ? 'valid from' : 'from'} <input type="date" value={form.date} onChange={(e) => setForm({ ...form, date: e.target.value })} required />
            </label>
            <select value={form.documentId} onChange={(e) => setForm({ ...form, documentId: e.target.value })} required={mode === 'change'}>
              <option value="">{mode === 'create' ? 'no document (waits for confirmation)' : 'confirming document…'}</option>
              {splitDocs.map((d) => (
                <option key={d.id} value={d.id}>
                  {d.kind}: {d.title} ({d.status})
                </option>
              ))}
            </select>
          </div>
          {shares.map((s, i) => (
            <div className="row" key={i}>
              <select value={s.artistId} onChange={(e) => setShares(shares.map((x, j) => (j === i ? { ...x, artistId: e.target.value } : x)))}>
                <option value="">new artist (no owner) →</option>
                {(artists.data ?? []).slice(0, 2000).map((a) => (
                  <option key={a.id} value={a.id}>
                    {a.pseudonym}
                  </option>
                ))}
              </select>
              {!s.artistId && (
                <input placeholder="new pseudonym" value={s.newArtistPseudonym} onChange={(e) => setShares(shares.map((x, j) => (j === i ? { ...x, newArtistPseudonym: e.target.value } : x)))} />
              )}
              <input placeholder="%" value={s.percent} onChange={(e) => setShares(shares.map((x, j) => (j === i ? { ...x, percent: e.target.value } : x)))} />
            </div>
          ))}
          <div className="row">
            <button type="button" onClick={() => setShares([...shares, { artistId: '', newArtistPseudonym: '', percent: '' }])}>
              + share
            </button>
            <span className={sum > 100 ? 'warning' : 'muted'}>
              artists {sum}% · our share (remainder) {Math.round((100 - sum) * 1e6) / 1e6}%
            </span>
            <button disabled={action.busy || sum > 100}>Save</button>
          </div>
        </form>
        <ErrorBox error={action.error} />
      </Card>
      <Card title={`Splits ${isrc ? 'of ' + isrc : ''} (${list.data?.total ?? '…'})`}>
        <form className="row" onSubmit={(e) => (e.preventDefault(), setParams({ isrc: (new FormData(e.currentTarget).get('q') as string).trim() }))}>
          <input name="q" placeholder="ISRC" defaultValue={isrc} />
          <button>Search</button>
        </form>
        <ErrorBox error={list.error} />
        <Table<SplitView>
          rows={list.data?.items ?? []}
          keyOf={(s) => s.id}
          columns={[
            { title: 'ISRC', render: (s) => <code>{s.isrc}</code> },
            { title: 'Valid', render: (s) => `${s.validFrom} → ${s.validTo ?? 'open'}` },
            { title: 'Shares', render: (s) => s.shares.map((x) => `${x.pseudonym} ${x.percent}%${x.ownerId ? '' : ' (no owner)'}`).join(', ') || '—' },
            { title: 'Our share', render: (s) => `${s.ourShare}%`, className: 'num' },
            { title: 'Document', render: (s) => <Status value={s.documentId ? s.documentStatus : 'waiting_for_confirmation'} /> },
            { title: 'Origin', render: (s) => s.origin },
          ]}
        />
      </Card>
    </>
  );
}
