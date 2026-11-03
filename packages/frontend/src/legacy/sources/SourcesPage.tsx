import { useState } from 'react';
import { api, type ReconciliationRow, type Signals, type SourceFile } from '../api/client';
import { Card, ErrorBox, Money, Table, reasonLabel, useAction, useApi } from '../components/ui';
import { SourcesTabs } from './SourcesTabs';

/** Uploaded Believe and B17 files, upload, duplicate-period error, completeness check and unallocated amount. */
export function SourcesPage() {
  const files = useApi(() => api.files(), []);
  const recon = useApi(() => api.reconciliation({}), []);
  const signals = useApi(() => api.signals(), []);
  const action = useAction();
  const [kind, setKind] = useState<'believe' | 'b17'>('believe');
  const [file, setFile] = useState<File | null>(null);
  const [ok, setOk] = useState<string>();

  const upload = () =>
    action.run(async () => {
      setOk(undefined);
      if (!file) return;
      await api.upload(kind, file);
      setOk(`${file.name} loaded`);
      files.reload();
      recon.reload();
      signals.reload();
    });

  const fileCols = [
    { title: 'File', render: (f: SourceFile) => f.fileName },
    { title: 'Period', render: (f: SourceFile) => f.reportingMonth ?? f.periods?.join(', ') },
    { title: 'sha256', render: (f: SourceFile) => <code title={f.sha256}>{f.sha256.slice(0, 16)}…</code> },
    {
      title: 'Uploaded / generated',
      render: (f: SourceFile) =>
        f.createdAt
          ? f.createdAt.slice(0, 19)
          : f.generatedAt
            ? `${f.generatedAt.slice(0, 19)} (${(f.generatedAtSource ?? '').replace(/_/g, ' ')})`
            : '',
    },
    { title: 'Status', render: (f: SourceFile) => f.status },
    {
      title: 'Lines',
      render: (f: SourceFile) => f.lineCount?.toLocaleString('en-US') ?? '',
      className: 'num',
    },
    {
      title: 'Total',
      render: (f: SourceFile) => <Money value={f.netTotal ?? f.totalPayable} />,
      className: 'num',
    },
    { title: 'Warnings', render: (f: SourceFile) => (f.warnings ?? []).join('; ') },
  ];

  return (
    <>
      <h1>Sources</h1>
      <SourcesTabs />
      <Card title="Upload a report (streamed to the server)">
        <div className="row">
          <select value={kind} onChange={(e) => setKind(e.target.value as 'believe' | 'b17')}>
            <option value="believe">Believe monthly report (.csv / .csv.zip)</option>
            <option value="b17">B17 quarterly statement (.xlsx)</option>
          </select>
          <input type="file" onChange={(e) => setFile(e.target.files?.[0] ?? null)} />
          <button onClick={() => void upload()} disabled={!file || action.busy}>
            {action.busy ? 'Loading…' : 'Upload'}
          </button>
        </div>
        {ok && <p className="ok">{ok}</p>}
        <ErrorBox error={action.error} />
      </Card>
      <Card title="Believe files">
        <ErrorBox error={files.error} />
        <Table rows={files.data?.believe ?? []} keyOf={(f) => f.id} columns={fileCols} />
      </Card>
      <Card title="B17 statements">
        <Table rows={files.data?.b17 ?? []} keyOf={(f) => f.id} columns={fileCols} />
      </Card>
      <Card title="Completeness check: A received = B not ours + C waiting + our share">
        <ErrorBox error={recon.error} />
        <Table<ReconciliationRow>
          rows={recon.data ?? []}
          keyOf={(r) => r.source + r.account + r.month}
          columns={[
            { title: 'Source', render: (r) => r.source },
            { title: 'Account', render: (r) => r.account },
            { title: 'Month', render: (r) => r.month },
            { title: 'A received', render: (r) => <Money value={r.A_received} />, className: 'num' },
            { title: 'B not ours', render: (r) => <Money value={r.B_notOurs} />, className: 'num' },
            { title: 'C waiting', render: (r) => <Money value={r.C_waiting} />, className: 'num' },
            { title: 'Our share', render: (r) => <Money value={r.ourShare} />, className: 'num' },
            {
              title: 'Our share by label',
              render: (r) =>
                Object.entries(r.ourShareByLabel)
                  .map(([name, v]) => `${name} ${Number(v).toFixed(2)}`)
                  .join(' · ') || '—',
            },
            {
              title: '…of it, no split',
              render: (r) => <Money value={r.ourShareNoSplit} />,
              className: 'num',
            },
            {
              title: 'Check',
              render: (r) =>
                r.discrepancy === '0' && (r.fileDiscrepancy === null || r.fileDiscrepancy === '0') ? (
                  <span className="ok">reconciles</span>
                ) : (
                  <span className="error">ALARM {r.discrepancy}</span>
                ),
            },
          ]}
        />
        {(recon.data ?? []).map((r) => (
          <p key={r.source + r.account + r.month} className="muted">
            {r.source} {r.account} {r.month} C:{' '}
            {Object.entries(r.C_breakdown)
              .map(([k, v]) => `${reasonLabel(k)} ${Number(v).toFixed(2)}`)
              .join(' · ')}
          </p>
        ))}
      </Card>
      <Card title="Unallocated (ISRC/UPC pairs not in module 1, lines without ISRC)">
        {signals.data && (
          <>
            <p>
              Total unallocated <Money value={signals.data.unallocated.total} /> in{' '}
              {signals.data.unallocated.count} pairs (of which without ISRC{' '}
              <Money value={signals.data.unallocated.withoutIsrc} />
              ). ISRCs without split: {signals.data.isrcsWithoutSplit.count}. Writers to resolve:{' '}
              {signals.data.ambiguousWriters.length}.
            </p>
            <Table
              rows={signals.data.unallocated.pairs}
              keyOf={(p) => p.isrc + p.upc}
              columns={[
                { title: 'ISRC', render: (p) => <code>{p.isrc || '(none)'}</code> },
                { title: 'UPC', render: (p) => <code>{p.upc}</code> },
                { title: 'Title in report', render: (p) => p.reportTitle },
                { title: 'Months', render: (p) => p.months.join(', ') },
                { title: 'Net', render: (p) => <Money value={p.net} />, className: 'num' },
              ]}
            />
            <SignalLists s={signals.data} />
          </>
        )}
      </Card>
    </>
  );
}

/** The signal lists of the layered calculation (D-127): shortfalls, unmapped labels, notes, participants, assumptions. */
function SignalLists({ s }: { s: Signals }) {
  return (
    <>
      <h3>Unfunded carves ({s.unfunded.length})</h3>
      <Table
        rows={s.unfunded}
        keyOf={(u) => u.ruleId + u.isrc + u.month}
        empty="None"
        columns={[
          { title: 'ISRC', render: (u) => <code>{u.isrc}</code> },
          { title: 'Month', render: (u) => u.month },
          { title: 'Rule', render: (u) => <code>{u.ruleId.slice(0, 8)}</code> },
          { title: 'Why', render: (u) => u.why.replace(/_/g, ' ') },
          { title: 'Missing', render: (u) => <Money value={u.missing} />, className: 'num' },
        ]}
      />
      <h3>Label strings not mapped ({s.labelUnmapped.length})</h3>
      <Table
        rows={s.labelUnmapped}
        keyOf={(l) => l.labelName}
        empty="None"
        columns={[
          { title: 'Label string', render: (l) => l.labelName || '(empty)' },
          { title: 'Net', render: (l) => <Money value={l.net} />, className: 'num' },
        ]}
      />
      <h3>Sublabel without a rule in force ({s.sublabelWithoutRule.length})</h3>
      <Table
        rows={s.sublabelWithoutRule}
        keyOf={(l) => l.label + l.month}
        empty="None"
        columns={[
          { title: 'Sublabel', render: (l) => l.label },
          { title: 'Month', render: (l) => l.month },
          { title: 'Net', render: (l) => <Money value={l.net} />, className: 'num' },
        ]}
      />
      <h3>Rule recipient is also a split row ({s.ruleRecipientIsRow.length})</h3>
      <Table
        rows={s.ruleRecipientIsRow}
        keyOf={(r) => r.isrc + r.artistId + r.month}
        empty="None"
        columns={[
          { title: 'ISRC', render: (r) => <code>{r.isrc}</code> },
          { title: 'Recipient', render: (r) => r.pseudonym },
          { title: 'Month', render: (r) => r.month },
        ]}
      />
      <h3>Two rows, one owner ({s.twoRowsOneOwner.length})</h3>
      <Table
        rows={s.twoRowsOneOwner}
        keyOf={(r) => r.isrc + r.ownerId + r.month}
        empty="None"
        columns={[
          { title: 'ISRC', render: (r) => <code>{r.isrc}</code> },
          { title: 'Month', render: (r) => r.month },
          { title: 'Pseudonyms', render: (r) => r.pseudonyms.join(', ') },
        ]}
      />
      <h3>Tracks with a note ({s.tracksWithNote.length})</h3>
      <Table
        rows={s.tracksWithNote}
        keyOf={(t) => t.trackId}
        empty="None"
        columns={[
          { title: 'ISRC', render: (t) => <code>{t.isrc ?? '—'}</code> },
          { title: 'Title', render: (t) => t.title },
          { title: 'Note', render: (t) => t.note },
        ]}
      />
      <h3>Participants without an owner ({s.participantsWithoutOwner.length})</h3>
      <Table
        rows={s.participantsWithoutOwner}
        keyOf={(p) => p.participationId}
        empty="None"
        columns={[
          { title: 'ISRC', render: (p) => <code>{p.isrc}</code> },
          { title: 'Recipient', render: (p) => p.pseudonym },
          { title: 'Funded from', render: (p) => p.fundedFrom.replace(/_/g, ' ') },
          { title: 'Amount', render: (p) => <Money value={p.amount} />, className: 'num' },
        ]}
      />
      <h3>Assumptions ({s.assumptions.length})</h3>
      <Table
        rows={s.assumptions}
        keyOf={(a) => (a.documentId ?? '-') + a.basis}
        empty="None"
        columns={[
          { title: 'Basis', render: (a) => a.basis },
          {
            title: 'Document',
            render: (a) => (a.documentId ? <code>{a.documentId.slice(0, 8)}</code> : '—'),
          },
          { title: 'ISRCs', render: (a) => a.isrcs.length },
          { title: 'Amount', render: (a) => <Money value={a.amount} />, className: 'num' },
        ]}
      />
    </>
  );
}
