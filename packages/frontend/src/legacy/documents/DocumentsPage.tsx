import { useState, type FormEvent } from 'react';
import { api, type DocumentView } from '../api/client';
import { Card, ErrorBox, Status, Table, useAction, useApi } from '../components/ui';

const KINDS = ['contract', 'appendix', 'buyout', 'advance_basis', 'adjustment_basis', 'payment_proof', 'return_proof', 'other'] as const;

/** Document registry: attach a file, approve documents that require manager approval. */
export function DocumentsPage() {
  const docs = useApi(() => api.documents(), []);
  const owners = useApi(() => api.owners(), []);
  const action = useAction();
  const [filter, setFilter] = useState<'all' | 'not_attached' | 'not_approved' | 'approved'>('all');
  const [form, setForm] = useState({ kind: 'contract' as (typeof KINDS)[number], title: '', ownerId: '', fileRef: '', requiresApproval: true, uploadDeadline: '' });
  const [files, setFiles] = useState<Record<string, string>>({});

  const create = (e: FormEvent) => {
    e.preventDefault();
    void action.run(async () => {
      await api.createDocument({
        kind: form.kind,
        title: form.title,
        ownerId: form.ownerId || null,
        fileRef: form.fileRef || null,
        requiresApproval: form.requiresApproval,
        uploadDeadline: form.uploadDeadline || null,
      });
      setForm({ ...form, title: '', fileRef: '' });
      docs.reload();
    });
  };

  const ownerName = new Map((owners.data ?? []).map((o) => [o.id, o.name]));
  const rows = (docs.data ?? []).filter((d) => filter === 'all' || d.status === filter).slice().reverse();
  return (
    <>
      <h1>Document registry</h1>
      <Card title="Register a document">
        <form className="row" onSubmit={create}>
          <select value={form.kind} onChange={(e) => setForm({ ...form, kind: e.target.value as (typeof KINDS)[number] })}>
            {KINDS.map((k) => (
              <option key={k}>{k}</option>
            ))}
          </select>
          <input placeholder="Title" value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} required />
          <select value={form.ownerId} onChange={(e) => setForm({ ...form, ownerId: e.target.value })}>
            <option value="">owner…</option>
            {(owners.data ?? []).map((o) => (
              <option key={o.id} value={o.id}>
                {o.name}
              </option>
            ))}
          </select>
          <input placeholder="File reference (optional)" value={form.fileRef} onChange={(e) => setForm({ ...form, fileRef: e.target.value })} />
          <label>
            <input type="checkbox" checked={form.requiresApproval} onChange={(e) => setForm({ ...form, requiresApproval: e.target.checked })} /> requires manager approval
          </label>
          <label>
            upload deadline <input type="date" value={form.uploadDeadline} onChange={(e) => setForm({ ...form, uploadDeadline: e.target.value })} />
          </label>
          <button disabled={action.busy}>Register</button>
        </form>
        <ErrorBox error={action.error} />
      </Card>
      <Card title={`Documents (${docs.data?.length ?? '…'})`}>
        <select value={filter} onChange={(e) => setFilter(e.target.value as typeof filter)}>
          <option value="all">all statuses</option>
          <option value="not_attached">not attached</option>
          <option value="not_approved">not approved</option>
          <option value="approved">approved</option>
        </select>
        <ErrorBox error={docs.error} />
        <Table<DocumentView>
          rows={rows.slice(0, 300)}
          keyOf={(d) => d.id}
          columns={[
            { title: 'UUID', render: (d) => <code>{d.id.slice(0, 8)}</code> },
            { title: 'Kind', render: (d) => d.kind },
            { title: 'Title', render: (d) => d.title },
            { title: 'Owner', render: (d) => (d.ownerId ? ownerName.get(d.ownerId) ?? d.ownerId.slice(0, 8) : '—') },
            { title: 'File', render: (d) => (d.fileRef ? <code>{d.fileRef}</code> : '—') },
            { title: 'Deadline', render: (d) => d.uploadDeadline ?? '—' },
            { title: 'Status', render: (d) => <Status value={d.status} /> },
            {
              title: 'Action',
              render: (d) =>
                d.status === 'not_attached' ? (
                  <span className="row">
                    <input placeholder="file ref" value={files[d.id] ?? ''} onChange={(e) => setFiles({ ...files, [d.id]: e.target.value })} />
                    <button onClick={() => void action.run(async () => (await api.attachFile(d.id, files[d.id] ?? ''), docs.reload()))}>Attach</button>
                  </span>
                ) : d.status === 'not_approved' ? (
                  <button onClick={() => void action.run(async () => (await api.approve(d.id), docs.reload()))}>Approve</button>
                ) : (
                  d.migration ? <span className="muted">migration</span> : null
                ),
            },
          ]}
        />
      </Card>
    </>
  );
}
