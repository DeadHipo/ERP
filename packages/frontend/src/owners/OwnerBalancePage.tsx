import { useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { api } from '../api/client';
import { Card, ErrorBox, Money, Stat, Status, Table, reasonLabel, useAction, useApi } from '../components/ui';

/** Facade view of an owner: period filter, report/sales date switch, A/B/C, payable, per-artist and per-track. */
export function OwnerBalancePage() {
  const { id = '' } = useParams();
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [basis, setBasis] = useState<'report' | 'sales'>('report');
  const q = { ...(from ? { from } : {}), ...(to ? { to } : {}), basis };
  const { data: b, error, reload } = useApi(() => api.balance(id, q), [id, from, to, basis]);
  const action = useAction();
  const [done, setDone] = useState<string>();

  const payout = () =>
    action.run(async () => {
      const op = await api.payout(id);
      setDone(`Payout ${(op.amountCents / 100).toFixed(2)} USD recorded (${op.externalRef ?? op.id}); it counts once the payment proof is attached.`);
      reload();
    });

  if (error) return <ErrorBox error={error} />;
  if (!b) return <p>Calculating from scratch…</p>;
  const blocked = b.blockingPayouts.length > 0;
  return (
    <>
      <h1>
        <Link to={`/owners/${id}`}>{b.owner.name}</Link>: balance <Status value={b.owner.status} />
      </h1>
      <div className="row filters">
        <label>
          From <input type="month" value={from} onChange={(e) => setFrom(e.target.value)} />
        </label>
        <label>
          To <input type="month" value={to} onChange={(e) => setTo(e.target.value)} />
        </label>
        <label>
          Date basis{' '}
          <select value={basis} onChange={(e) => setBasis(e.target.value as 'report' | 'sales')}>
            <option value="report">report date</option>
            <option value="sales">sales date</option>
          </select>
        </label>
      </div>
      <Card title={`Period ${b.period.from ?? 'start'} – ${b.period.to ?? 'today'} (${b.period.basis} date)`}>
        <div className="stats">
          <Stat label="A · received" value={b.period.received} hint="Source money on items where the owner participates" />
          <Stat label="B · not ours (owner's, confirmed)" value={b.period.notOurs} />
          <Stat label="C · waiting for confirmation" value={b.period.waiting} />
          <Stat label="Other participants" value={b.period.otherParticipants} />
          <Stat label="Our share" value={b.period.ourShare} />
          <Stat label="Paid" value={b.period.paid} />
          <Stat label="Advances paid" value={b.period.advancesPaid} />
          <Stat label="Recouped" value={b.period.recouped} />
        </div>
        {Object.keys(b.period.waitingBreakdown).length > 0 && (
          <p className="muted">
            Waiting:{' '}
            {Object.entries(b.period.waitingBreakdown).map(([k, v]) => (
              <span key={k}>
                <span title={k}>{reasonLabel(k)}</span> <Money value={v} />;{' '}
              </span>
            ))}
          </p>
        )}
      </Card>
      <Card title="All time, as of today">
        <div className="stats">
          <Stat label="Earned (B)" value={b.total.earned} />
          <Stat label="Waiting (C)" value={b.total.waiting} />
          <Stat label="Recouped" value={b.total.recouped} />
          <Stat label="Paid" value={b.total.paid} />
          <Stat label="Payable" value={b.total.payableShown} hint={`exact: ${b.total.payable}`} />
        </div>
        {b.total.payable.startsWith('-') && <p className="warning">Balance is negative ({b.total.payable}); the owner sees 0.</p>}
        <div className="row">
          <button onClick={() => void payout()} disabled={!b.confirmed || blocked || action.busy || Number(b.total.payable) < 0.01}>
            Payout
          </button>
          {!b.confirmed && <span className="warning">No approved contract: payout is not possible.</span>}
          {b.confirmed && Number(b.total.payable) < 0.01 && <span className="muted">Nothing to pay.</span>}
          {blocked && <span className="warning">Blocked: a payout has no payment proof yet ({b.blockingPayouts.length}). <Link to="/settlements">settlements →</Link></span>}
        </div>
        {done && <p className="ok">{done}</p>}
        <ErrorBox error={action.error} />
      </Card>
      <Card title="Per artist">
        <Table
          rows={b.artists}
          keyOf={(a) => a.artistId}
          columns={[
            { title: 'Artist', render: (a) => a.pseudonym },
            { title: 'Earned', render: (a) => <Money value={a.earned} />, className: 'num' },
            { title: 'Waiting', render: (a) => <Money value={a.waiting} />, className: 'num' },
            { title: 'Recouped', render: (a) => <Money value={a.recouped} />, className: 'num' },
            { title: 'Unrecouped', render: (a) => <Money value={a.unrecouped} />, className: 'num' },
            { title: 'Tracks', render: (a) => a.tracks.length, className: 'num' },
          ]}
        />
      </Card>
      <Card title="Per track (top 50)">
        <Table
          rows={b.artists.flatMap((a) => a.tracks.map((t) => ({ ...t, artist: a.pseudonym }))).slice(0, 50)}
          keyOf={(t) => t.artist + t.isrc}
          columns={[
            { title: 'ISRC', render: (t) => <code>{t.isrc}</code> },
            { title: 'Artist', render: (t) => t.artist },
            { title: 'Track net', render: (t) => <Money value={t.net} />, className: 'num' },
            { title: 'Owner share', render: (t) => <Money value={t.amount} />, className: 'num' },
            { title: 'Waiting', render: (t) => <Money value={t.waiting} />, className: 'num' },
          ]}
        />
      </Card>
      {b.publishing.length > 0 && (
        <Card title="Publishing (accrued to the owner)">
          <Table
            rows={b.publishing.slice(0, 50)}
            keyOf={(p) => p.period + p.workTitle}
            columns={[
              { title: 'Quarter', render: (p) => p.period },
              { title: 'Work', render: (p) => p.workTitle },
              { title: 'Total Payable', render: (p) => <Money value={p.payable} />, className: 'num' },
              { title: '%', render: (p) => p.percent, className: 'num' },
              { title: 'Author', render: (p) => <Money value={p.amount} />, className: 'num' },
              { title: 'Category', render: (p) => `${p.category}${p.reason ? ' · ' + p.reason : ''}` },
            ]}
          />
        </Card>
      )}
      {b.positions.length > 0 && (
        <Card title="Positions to recoup (advances, deductions)">
          <Table
            rows={b.positions}
            keyOf={(p) => p.operationId}
            columns={[
              { title: 'Date', render: (p) => p.date },
              { title: 'Scope', render: (p) => p.scope.kind },
              { title: 'Amount', render: (p) => <Money value={p.amount} />, className: 'num' },
              { title: 'Recouped', render: (p) => <Money value={p.recouped} />, className: 'num' },
              { title: 'Remaining', render: (p) => <Money value={p.remaining} />, className: 'num' },
            ]}
          />
        </Card>
      )}
    </>
  );
}
