import { useEffect, useMemo, useState } from 'react';
import { api, type SourceFile, type SourceLine, type SourceLinesPage as Page } from '../api/client';
import { Card, ErrorBox, Money, Table, useApi } from '../components/ui';
import { SourcesTabs } from './SourcesTabs';

const PAGE_SIZES = ['50', '100', '250', '500'];
const SORTS: [string, string][] = [
  ['net', 'Net'],
  ['gross', 'Gross'],
  ['quantity', 'Quantity'],
  ['reportingMonth', 'Report month'],
  ['salesMonth', 'Sales month'],
  ['isrc', 'ISRC'],
];

interface Filters {
  isrc: string;
  upc: string;
  platform: string;
  country: string;
  subscriptionType: string;
  salesType: string;
  releaseType: string;
  salesFrom: string;
  salesTo: string;
  sort: string;
  dir: string;
  limit: string;
}
const EMPTY: Filters = {
  isrc: '',
  upc: '',
  platform: '',
  country: '',
  subscriptionType: '',
  salesType: '',
  releaseType: '',
  salesFrom: '',
  salesTo: '',
  sort: 'net',
  dir: 'desc',
  limit: '100',
};

/** A per-line amount: the lines are tiny (fractions of a cent), so up to 6 decimals; the exact value is in the tooltip. */
function Amount({ value }: { value: string }) {
  const n = Number(value);
  const shown = n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 6 });
  return (
    <span className={`money${n < 0 ? ' negative' : ''}`} title={value}>
      {shown}
    </span>
  );
}
const count = (v: string) => Number(v).toLocaleString('en-US');

/**
 * Lines of the Believe reports: choose report files, filter, sort and page. One record per key of a file (equal keys
 * summed); the totals cover everything that matches, not only the page.
 */
export function SourceLinesPage() {
  const files = useApi(() => api.files(), []);
  const loaded = useMemo(
    () => (files.data?.believe ?? []).filter((f) => f.status === 'loaded'),
    [files.data],
  );

  // chosen files (checkboxes), the filters being typed, and the query that is applied
  const [chosen, setChosen] = useState<Set<string>>(new Set());
  const [draft, setDraft] = useState<Filters>(EMPTY);
  const [applied, setApplied] = useState<{ ids: string[]; f: Filters; offset: number } | undefined>();

  // first time: the files of the newest report month
  useEffect(() => {
    if (applied || loaded.length === 0) return;
    const newest = loaded.reduce((m, f) => ((f.reportingMonth ?? '') > m ? (f.reportingMonth ?? '') : m), '');
    const ids = loaded.filter((f) => f.reportingMonth === newest).map((f) => f.id);
    setChosen(new Set(ids));
    setApplied({ ids, f: EMPTY, offset: 0 });
  }, [loaded, applied]);

  const key = applied ? JSON.stringify(applied) : '';
  const facets = useApi(
    () => (applied ? api.sourceFacets(applied.ids) : Promise.resolve(undefined)),
    [applied?.ids.join(',')],
  );

  const [page, setPage] = useState<Page | undefined>();
  const [error, setError] = useState<string | undefined>();
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    if (!applied) return;
    let alive = true;
    setBusy(true);
    setError(undefined);
    const f = applied.f;
    api
      .sourceLines({
        fileId: applied.ids.join(','),
        isrc: f.isrc.trim(),
        upc: f.upc.trim(),
        platform: f.platform,
        country: f.country,
        subscriptionType: f.subscriptionType,
        salesType: f.salesType,
        releaseType: f.releaseType,
        salesFrom: f.salesFrom,
        salesTo: f.salesTo,
        sort: f.sort,
        dir: f.dir,
        limit: f.limit,
        offset: String(applied.offset),
      })
      .then((p) => alive && setPage(p))
      .catch((e: unknown) => alive && setError(e instanceof Error ? e.message : String(e)))
      .finally(() => alive && setBusy(false));
    return () => {
      alive = false;
    };
  }, [key]);

  const set = (k: keyof Filters, v: string) => setDraft((d) => ({ ...d, [k]: v }));
  const toggle = (id: string) =>
    setChosen((c) => {
      const n = new Set(c);
      if (n.has(id)) n.delete(id);
      else n.add(id);
      return n;
    });
  const choose = (pick: (f: SourceFile) => boolean) =>
    setChosen(new Set(loaded.filter(pick).map((f) => f.id)));
  const newest = loaded.reduce((m, f) => ((f.reportingMonth ?? '') > m ? (f.reportingMonth ?? '') : m), '');
  const show = () => setApplied({ ids: [...chosen], f: draft, offset: 0 });
  const go = (offset: number) => applied && setApplied({ ...applied, offset: Math.max(0, offset) });
  const reset = () => {
    setDraft(EMPTY);
    if (applied) setApplied({ ...applied, f: EMPTY, offset: 0 });
  };

  const select = (k: keyof Filters, label: string, options: string[] | undefined) => (
    <label>
      {label}{' '}
      <select value={draft[k]} onChange={(e) => set(k, e.target.value)}>
        <option value="">any</option>
        {(options ?? []).map((o) => (
          <option key={o} value={o}>
            {o}
          </option>
        ))}
      </select>
    </label>
  );

  const slow = chosen.size > 4 && !draft.isrc.trim() && !draft.upc.trim();
  const total = page ? Number(page.total.keys) : 0;
  const from = page && total > 0 ? page.offset + 1 : 0;
  const to = page ? Math.min(page.offset + page.limit, total) : 0;

  const columns = [
    { title: 'Report', render: (l: SourceLine) => l.reportingMonth },
    { title: 'Account', render: (l: SourceLine) => l.account },
    { title: 'Sales', render: (l: SourceLine) => l.salesMonth },
    { title: 'Platform', render: (l: SourceLine) => l.platform },
    { title: 'Country', render: (l: SourceLine) => l.country },
    { title: 'ISRC', render: (l: SourceLine) => <code>{l.isrc || '(none)'}</code> },
    { title: 'UPC', render: (l: SourceLine) => <code>{l.upc}</code> },
    {
      title: 'Artist / track',
      render: (l: SourceLine) => (
        <>
          {l.artistName}
          <div className="muted">{l.trackTitle}</div>
        </>
      ),
    },
    {
      title: 'Subscription',
      render: (l: SourceLine) => l.subscriptionType || <span className="muted">(none)</span>,
    },
    { title: 'Type', render: (l: SourceLine) => l.salesType },
    { title: 'Qty', render: (l: SourceLine) => count(l.quantity), className: 'num' },
    { title: 'Gross', render: (l: SourceLine) => <Amount value={l.gross} />, className: 'num' },
    { title: 'Net', render: (l: SourceLine) => <Amount value={l.net} />, className: 'num' },
    {
      title: 'Lines',
      render: (l: SourceLine) => (Number(l.mergedLines) > 1 ? `×${l.mergedLines}` : '1'),
      className: 'num',
    },
  ];

  return (
    <>
      <h1>Sources</h1>
      <SourcesTabs />
      <Card title="Report files">
        <ErrorBox error={files.error} />
        <div className="row">
          <button onClick={() => choose((f) => f.reportingMonth === newest)}>Newest month</button>
          <button onClick={() => choose(() => true)}>All files</button>
          <button onClick={() => setChosen(new Set())}>None</button>
          <span className="muted">
            {chosen.size} of {loaded.length} chosen
          </span>
        </div>
        <div className="scroll">
          <Table<SourceFile>
            rows={loaded}
            keyOf={(f) => f.id}
            columns={[
              {
                title: '',
                render: (f) => (
                  <input type="checkbox" checked={chosen.has(f.id)} onChange={() => toggle(f.id)} />
                ),
              },
              { title: 'Period', render: (f) => f.reportingMonth },
              { title: 'File', render: (f) => f.fileName },
              { title: 'Lines', render: (f) => f.lineCount?.toLocaleString('en-US') ?? '', className: 'num' },
              { title: 'Total', render: (f) => <Money value={f.netTotal} />, className: 'num' },
            ]}
          />
        </div>
      </Card>

      <Card title="Filters">
        <div className="row">
          <label>
            ISRC{' '}
            <input
              value={draft.isrc}
              onChange={(e) => set('isrc', e.target.value)}
              placeholder="any spelling"
            />
          </label>
          <label>
            UPC <input value={draft.upc} onChange={(e) => set('upc', e.target.value)} />
          </label>
          {select('platform', 'Platform', facets.data?.platforms)}
          {select('country', 'Country', facets.data?.countries)}
        </div>
        <div className="row">
          {select('subscriptionType', 'Subscription', facets.data?.subscriptionTypes)}
          {select('salesType', 'Sales type', facets.data?.salesTypes)}
          {select('releaseType', 'Release type', facets.data?.releaseTypes)}
          <label>
            Sales from{' '}
            <input type="month" value={draft.salesFrom} onChange={(e) => set('salesFrom', e.target.value)} />
          </label>
          <label>
            to <input type="month" value={draft.salesTo} onChange={(e) => set('salesTo', e.target.value)} />
          </label>
        </div>
        <div className="row">
          <label>
            Sort by{' '}
            <select value={draft.sort} onChange={(e) => set('sort', e.target.value)}>
              {SORTS.map(([v, t]) => (
                <option key={v} value={v}>
                  {t}
                </option>
              ))}
            </select>
          </label>
          <select value={draft.dir} onChange={(e) => set('dir', e.target.value)}>
            <option value="desc">largest first</option>
            <option value="asc">smallest first</option>
          </select>
          <label>
            Per page{' '}
            <select value={draft.limit} onChange={(e) => set('limit', e.target.value)}>
              {PAGE_SIZES.map((s) => (
                <option key={s}>{s}</option>
              ))}
            </select>
          </label>
          <button
            onClick={show}
            disabled={busy || (chosen.size === 0 && !draft.isrc.trim() && !draft.upc.trim())}
          >
            {busy ? 'Loading…' : 'Show lines'}
          </button>
          <button onClick={reset} disabled={busy}>
            Reset filters
          </button>
        </div>
        {slow && (
          <p className="muted">
            Many files without an ISRC or UPC take a while to read (about 2 s per file).
          </p>
        )}
        {chosen.size === 0 && !draft.isrc.trim() && !draft.upc.trim() && (
          <p className="muted">Choose at least one file, or type an ISRC or UPC to search all files.</p>
        )}
      </Card>

      <Card title="Lines">
        <ErrorBox error={error} />
        {page && (
          <>
            <p>
              {total.toLocaleString('en-US')} keys from {count(page.total.mergedLines)} report lines in{' '}
              {page.files.length} file{page.files.length === 1 ? '' : 's'}: quantity{' '}
              {count(page.total.quantity)}, gross <Money value={page.total.gross} />, net{' '}
              <Money value={page.total.net} />
            </p>
            <div className="row">
              <button onClick={() => go(page.offset - page.limit)} disabled={busy || page.offset === 0}>
                ‹ Previous
              </button>
              <span>
                {from.toLocaleString('en-US')}–{to.toLocaleString('en-US')} of {total.toLocaleString('en-US')}
              </span>
              <button
                onClick={() => go(page.offset + page.limit)}
                disabled={busy || page.offset + page.limit >= total}
              >
                Next ›
              </button>
              {busy && <span className="muted">Loading…</span>}
            </div>
            <div className="scroll wide">
              <Table<SourceLine>
                rows={page.items}
                keyOf={(l) =>
                  [
                    l.fileId,
                    l.reportingMonth,
                    l.salesMonth,
                    l.platform,
                    l.country,
                    l.isrc,
                    l.upc,
                    l.subscriptionType,
                    l.salesType,
                    l.releaseType,
                  ].join('|')
                }
                columns={columns}
                empty="No lines match these filters"
              />
            </div>
          </>
        )}
        {!page && !error && <p className="muted">Loading…</p>}
      </Card>
    </>
  );
}
