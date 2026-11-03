import { useState, type FormEvent } from 'react';
import { Link, useParams } from 'react-router-dom';
import { api, type DocumentView } from '../client';
import { Card, ErrorBox, Status, Table, useAction, useApi } from '../ui';

/** The owner, its artists (pseudonyms), their tracks with ISRC, documents and their status. */
export function OwnerPage() {
  const { id = '' } = useParams();
  const { data, error, reload } = useApi(() => api.owner(id), [id]);
  const [pseudonym, setPseudonym] = useState('');
  const [track, setTrack] = useState({ artistId: '', title: '', isrc: '', upc: '' });
  const action = useAction();
  const [contract, setContract] = useState<{ documentId: string; number: string; artistIds: string[] }>({ documentId: '', number: '', artistIds: [] });

  const addArtist = (e: FormEvent) => {
    e.preventDefault();
    void action.run(async () => {
      await api.createArtist({ pseudonym, ownerId: id, force: true });
      setPseudonym('');
      reload();
    });
  };
  const addTrack = (e: FormEvent) => {
    e.preventDefault();
    void action.run(async () => {
      await api.createTrack({ title: track.title, isrc: track.isrc || null, upc: track.upc || null, artistIds: track.artistId ? [track.artistId] : [] });
      setTrack({ ...track, title: '', isrc: '', upc: '' });
      reload();
    });
  };

  const [terms, setTerms] = useState({ percent: '', validFrom: '', operationType: '', documentId: '' });
  const addTerms = (e: FormEvent) => {
    e.preventDefault();
    void action.run(async () => {
      await api.setPublishingTerms({
        ownerId: id,
        percent: terms.percent,
        validFrom: terms.validFrom,
        ...(terms.operationType.trim() ? { operationType: terms.operationType.trim() } : {}),
        documentId: terms.documentId || null,
      });
      setTerms({ percent: '', validFrom: '', operationType: '', documentId: '' });
      reload();
    });
  };

  const addContract = (e: FormEvent) => {
    e.preventDefault();
    void action.run(async () => {
      await api.createContract({ ownerId: id, documentId: contract.documentId, number: contract.number || null, artistIds: contract.artistIds });
      setContract({ documentId: '', number: '', artistIds: [] });
      reload();
    });
  };

  if (error) return <ErrorBox error={error} />;
  if (!data) return <p>Loading…</p>;
  const { owner, artists, documents, contracts, publishingTerms } = data;
  return (
    <>
      <h1>
        {owner.name} <Status value={owner.status} />
      </h1>
      <p>
        {owner.kind} · origin {owner.origin} · <Link to={`/legacy/owners/${owner.id}/balance`}>balance and payout →</Link>
      </p>
      <ErrorBox error={action.error} />
      <Card title={`Artists (pseudonyms): ${artists.length}`}>
        <form className="row" onSubmit={addArtist}>
          <input placeholder="New pseudonym" value={pseudonym} onChange={(e) => setPseudonym(e.target.value)} required />
          <button>Add artist</button>
        </form>
        {artists.map((a) => (
          <div key={a.id} className="artist">
            <h3>
              {a.pseudonym} <Status value={a.status} />
            </h3>
            <Table
              rows={a.tracks ?? []}
              keyOf={(t) => t.id}
              empty="No tracks linked (the artist-track link is informational)"
              columns={[
                { title: 'ISRC', render: (t) => <code>{t.isrc ?? '—'}</code> },
                { title: 'UPC', render: (t) => <code>{t.upc ?? '—'}</code> },
                { title: 'Title', render: (t) => t.title },
                { title: '', render: (t) => (t.isrc ? <Link to={`/legacy/splits?isrc=${t.isrc}`}>split</Link> : null) },
              ]}
            />
          </div>
        ))}
        <form className="row" onSubmit={addTrack}>
          <select value={track.artistId} onChange={(e) => setTrack({ ...track, artistId: e.target.value })}>
            <option value="">artist…</option>
            {artists.map((a) => (
              <option key={a.id} value={a.id}>
                {a.pseudonym}
              </option>
            ))}
          </select>
          <input placeholder="Title" value={track.title} onChange={(e) => setTrack({ ...track, title: e.target.value })} required />
          <input placeholder="ISRC (optional)" value={track.isrc} onChange={(e) => setTrack({ ...track, isrc: e.target.value })} />
          <input placeholder="UPC (optional)" value={track.upc} onChange={(e) => setTrack({ ...track, upc: e.target.value })} />
          <button>Add track</button>
        </form>
      </Card>
      <Card title="Documents">
        <Table<DocumentView>
          rows={documents}
          keyOf={(d) => d.id}
          columns={[
            { title: 'Kind', render: (d) => d.kind },
            { title: 'Title', render: (d) => d.title },
            { title: 'Status', render: (d) => <Status value={d.status} /> },
            { title: 'Needs approval', render: (d) => (d.requiresApproval ? 'yes' : 'no') },
            { title: 'UUID', render: (d) => <code>{d.id.slice(0, 8)}</code> },
          ]}
        />
        <p>
          Contracts: {contracts.length} · <Link to="/legacy/documents">document registry →</Link>
        </p>
        <form className="row" onSubmit={addContract}>
          <select value={contract.documentId} onChange={(e) => setContract({ ...contract, documentId: e.target.value })} required>
            <option value="">contract document…</option>
            {documents
              .filter((d) => d.kind === 'contract')
              .map((d) => (
                <option key={d.id} value={d.id}>
                  {d.title} ({d.status})
                </option>
              ))}
          </select>
          <input placeholder="Contract number" value={contract.number} onChange={(e) => setContract({ ...contract, number: e.target.value })} />
          {artists.map((a) => (
            <label key={a.id}>
              <input
                type="checkbox"
                checked={contract.artistIds.includes(a.id)}
                onChange={(e) =>
                  setContract({ ...contract, artistIds: e.target.checked ? [...contract.artistIds, a.id] : contract.artistIds.filter((x) => x !== a.id) })
                }
              />{' '}
              {a.pseudonym}
            </label>
          ))}
          <button>Register contract (owner + pseudonyms)</button>
        </form>
      </Card>
      <Card title="Publishing terms (author percent)">
        <Table
          rows={publishingTerms}
          keyOf={(t) => t.id}
          empty="No terms: the default 50% is used and the money waits for confirmation"
          columns={[
            { title: 'Operation type', render: (t) => t.operationType ?? 'all types' },
            { title: 'Percent', render: (t) => `${t.percent}%` },
            { title: 'From', render: (t) => t.validFrom },
            { title: 'To', render: (t) => t.validTo ?? 'open' },
            { title: 'Document', render: (t) => (t.documentId ? <code>{t.documentId.slice(0, 8)}</code> : '—') },
          ]}
        />
        <form className="row" onSubmit={addTerms}>
          <input placeholder="%" value={terms.percent} onChange={(e) => setTerms({ ...terms, percent: e.target.value })} required />
          <label>
            from <input type="date" value={terms.validFrom} onChange={(e) => setTerms({ ...terms, validFrom: e.target.value })} required />
          </label>
          <input placeholder="operation type (empty = all types)" value={terms.operationType} onChange={(e) => setTerms({ ...terms, operationType: e.target.value })} />
          <select value={terms.documentId} onChange={(e) => setTerms({ ...terms, documentId: e.target.value })}>
            <option value="">no document</option>
            {documents.map((d) => (
              <option key={d.id} value={d.id}>
                {d.kind}: {d.title} ({d.status})
              </option>
            ))}
          </select>
          <button>Set terms</button>
        </form>
      </Card>
    </>
  );
}
