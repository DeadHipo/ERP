import { useState, type FormEvent } from 'react';
import { useSearchParams } from 'react-router-dom';
import { api, type ParticipationListItem } from '../client';
import { Card, ErrorBox, Status, Table, useAction, useApi } from '../ui';

type Base = 'net' | 'bucket';
type Funded = 'top' | 'artist_pool' | 'artist_share' | 'label_share';

const empty = { isrc: '', artistId: '', percent: '', base: 'net' as Base, fundedFrom: 'top' as Funded, fromArtistId: '', validFrom: '', validTo: '', documentId: '', note: '' };

/** Participations: off-the-top, artist pool, artist share and label share carves per ISRC (D-126). */
export function ParticipationsPage() {
  const [params, setParams] = useSearchParams();
  const isrc = params.get('isrc') ?? '';
  const list = useApi(() => api.participations(isrc ? { isrc } : {}), [isrc]);
  const artists = useApi(() => api.artists(), []);
  const docs = useApi(() => api.documents(), []);
  const action = useAction();
  const [form, setForm] = useState(empty);
  const [closing, setClosing] = useState<Record<string, string>>({});

  const submit = (e: FormEvent) => {
    e.preventDefault();
    void action.run(async () => {
      await api.createParticipation({
        isrc: form.isrc,
        artistId: form.artistId,
        percent: form.percent,
        base: form.base,
        fundedFrom: form.fundedFrom,
        fromArtistId: form.fundedFrom === 'artist_share' ? form.fromArtistId : null,
        validFrom: form.validFrom,
        validTo: form.validTo || null,
        documentId: form.documentId || null,
        note: form.note || null,
      });
      setForm(empty);
      list.reload();
    });
  };
  const close = (id: string) =>
    void action.run(async () => {
      await api.closeParticipation(id, closing[id] ?? '');
      list.reload();
    });

  const docOptions = (docs.data ?? []).filter((d) => ['appendix', 'contract', 'buyout', 'other', 'assumption'].includes(d.kind));
  const artistOptions = (artists.data ?? []).slice(0, 2000);

  return (
    <>
      <h1>Participations</h1>
      <Card title="Create a participation">
        <form onSubmit={submit}>
          <div className="row">
            <input placeholder="ISRC" value={form.isrc} onChange={(e) => setForm({ ...form, isrc: e.target.value })} required />
            <select value={form.artistId} onChange={(e) => setForm({ ...form, artistId: e.target.value })} required>
              <option value="">recipient pseudonym…</option>
              {artistOptions.map((a) => (
                <option key={a.id} value={a.id}>
                  {a.pseudonym}
                </option>
              ))}
            </select>
            <input placeholder="%" value={form.percent} onChange={(e) => setForm({ ...form, percent: e.target.value })} required />
            <select value={form.base} onChange={(e) => setForm({ ...form, base: e.target.value as Base })}>
              <option value="net">base: net</option>
              <option value="bucket">base: bucket</option>
            </select>
            <select value={form.fundedFrom} onChange={(e) => setForm({ ...form, fundedFrom: e.target.value as Funded })}>
              <option value="top">funded from: top (off the top)</option>
              <option value="artist_pool">funded from: artist pool</option>
              <option value="artist_share">funded from: artist share</option>
              <option value="label_share">funded from: label share</option>
            </select>
            {form.fundedFrom === 'artist_share' && (
              <select value={form.fromArtistId} onChange={(e) => setForm({ ...form, fromArtistId: e.target.value })} required>
                <option value="">from artist…</option>
                {artistOptions.map((a) => (
                  <option key={a.id} value={a.id}>
                    {a.pseudonym}
                  </option>
                ))}
              </select>
            )}
          </div>
          <div className="row">
            <label>
              from <input type="date" value={form.validFrom} onChange={(e) => setForm({ ...form, validFrom: e.target.value })} required />
            </label>
            <label>
              to (exclusive) <input type="date" value={form.validTo} onChange={(e) => setForm({ ...form, validTo: e.target.value })} />
            </label>
            <select value={form.documentId} onChange={(e) => setForm({ ...form, documentId: e.target.value })}>
              <option value="">no document (waits for confirmation)</option>
              {docOptions.map((d) => (
                <option key={d.id} value={d.id}>
                  {d.kind}: {d.title} ({d.status})
                </option>
              ))}
            </select>
            <input placeholder="note" value={form.note} onChange={(e) => setForm({ ...form, note: e.target.value })} />
            <button disabled={action.busy}>Save</button>
          </div>
        </form>
        <ErrorBox error={action.error} />
      </Card>
      <Card title={`Participations ${isrc ? 'of ' + isrc : ''} (${list.data?.total ?? '…'})`}>
        <form className="row" onSubmit={(e) => (e.preventDefault(), setParams({ isrc: (new FormData(e.currentTarget).get('q') as string).trim() }))}>
          <input name="q" placeholder="ISRC" defaultValue={isrc} />
          <button>Search</button>
        </form>
        <ErrorBox error={list.error} />
        <Table<ParticipationListItem>
          rows={list.data?.items ?? []}
          keyOf={(p) => p.id}
          columns={[
            { title: 'ISRC', render: (p) => <code>{p.isrc}</code> },
            { title: 'Recipient', render: (p) => `${p.pseudonym}${p.ownerId ? '' : ' (no owner)'}` },
            { title: 'Percent', render: (p) => `${p.percent}%`, className: 'num' },
            { title: 'Base', render: (p) => p.base },
            { title: 'Funded from', render: (p) => p.fundedFrom.replace(/_/g, ' ') },
            { title: 'From artist', render: (p) => p.fromPseudonym ?? '—' },
            { title: 'Period', render: (p) => `${p.validFrom} → ${p.validTo ?? 'open'}` },
            { title: 'Document', render: (p) => <Status value={p.documentStatus} /> },
            {
              title: 'Close',
              render: (p) =>
                p.validTo ? null : (
                  <span className="row">
                    <input type="date" value={closing[p.id] ?? ''} onChange={(e) => setClosing({ ...closing, [p.id]: e.target.value })} />
                    <button type="button" disabled={!closing[p.id] || action.busy} onClick={() => close(p.id)}>
                      Close
                    </button>
                  </span>
                ),
            },
          ]}
        />
      </Card>
    </>
  );
}
