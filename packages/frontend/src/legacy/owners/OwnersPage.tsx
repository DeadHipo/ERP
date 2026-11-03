import { useState, type FormEvent } from 'react';
import { Link } from 'react-router-dom';
import { api, ApiError, type Owner } from '../client';
import { Card, ErrorBox, Status, Table, useAction, useApi } from '../ui';

export function OwnersPage() {
  const { data, error, reload } = useApi(() => api.owners(), []);
  const [q, setQ] = useState('');
  const [name, setName] = useState('');
  const [kind, setKind] = useState<'person' | 'label'>('person');
  const [similar, setSimilar] = useState<{ id: string; name: string }[]>([]);
  const action = useAction();

  const create = async (e: FormEvent, force = false) => {
    e.preventDefault();
    setSimilar([]);
    await action.run(async () => {
      try {
        await api.createOwner({ name, kind, force });
        setName('');
        reload();
      } catch (err) {
        if (err instanceof ApiError && err.code === 'possible_duplicate') {
          setSimilar((err.details as { similar: { id: string; name: string }[] }).similar);
          return;
        }
        throw err;
      }
    });
  };

  const rows = (data ?? []).filter((o) => o.name.toLowerCase().includes(q.toLowerCase()));
  return (
    <>
      <h1>Owners</h1>
      <Card title="Create an owner">
        <form className="row" onSubmit={(e) => create(e)}>
          <input placeholder="Name (person or label)" value={name} onChange={(e) => setName(e.target.value)} required />
          <select value={kind} onChange={(e) => setKind(e.target.value as 'person' | 'label')}>
            <option value="person">person</option>
            <option value="label">label</option>
          </select>
          <button disabled={action.busy}>Create</button>
        </form>
        {similar.length > 0 && (
          <div className="warning">
            Similar records exist:{' '}
            {similar.map((s) => (
              <Link key={s.id} to={`/legacy/owners/${s.id}`}>
                {s.name}{' '}
              </Link>
            ))}
            — this is "the same" (open it) or <button onClick={(e) => create(e, true)}>add a new one</button>
          </div>
        )}
        <ErrorBox error={action.error} />
      </Card>
      <Card title={`Owners (${data?.length ?? '…'})`}>
        <input placeholder="Filter by name" value={q} onChange={(e) => setQ(e.target.value)} />
        <ErrorBox error={error} />
        <Table<Owner>
          rows={rows.slice(0, 300)}
          keyOf={(o) => o.id}
          columns={[
            { title: 'Name', render: (o) => <Link to={`/legacy/owners/${o.id}`}>{o.name}</Link> },
            { title: 'Kind', render: (o) => o.kind },
            { title: 'Status', render: (o) => <Status value={o.status} /> },
            { title: 'Origin', render: (o) => o.origin },
            { title: 'Balance', render: (o) => <Link to={`/legacy/owners/${o.id}/balance`}>balance →</Link> },
          ]}
        />
        {rows.length > 300 && <p className="muted">Showing 300 of {rows.length}; refine the filter.</p>}
      </Card>
    </>
  );
}
