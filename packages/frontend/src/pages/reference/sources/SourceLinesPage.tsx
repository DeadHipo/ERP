import { useEffect, useMemo, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { sourceQueries } from '../../../api/queries/sources';
import { ActionButton } from '../../../components/ActionButton';
import { EntityLink } from '../../../components/EntityLink';
import { Money } from '../../../components/Money';
import { PageHeader } from '../../../components/PageHeader';
import { QueryView } from '../../../components/PageState';
import { DateField } from '../../../components/fields/DateField';
import { SelectField } from '../../../components/fields/SelectField';
import { TextField } from '../../../components/fields/TextField';
import { fmt, ru } from '../../../i18n/ru';
import { SimpleTable, Td } from '../../catalog/components/MoneyTable';
import { toInt } from '../shared';

const t = ru.reference.lines;
const SIZES = ['50', '100', '250', '500'];
const SORTS = ['net', 'gross', 'quantity', 'reportingMonth', 'salesMonth', 'isrc'] as const;
const FILTER_KEYS = ['isrc', 'upc', 'platform', 'country', 'subscriptionType', 'salesType', 'releaseType', 'salesFrom', 'salesTo', 'sort', 'dir', 'limit'] as const;
type FilterKey = (typeof FILTER_KEYS)[number];
type Draft = Record<FilterKey, string>;
const ANY = '__any__';

const sortOf = (v: string) => SORTS.find((s) => s === v);

/**
 * P19 `/sources/lines?fileId&isrc&upc&account&month&platform&country&…`: the raw lines of the loaded Believe files,
 * server paging and sorting (`GET /sources/lines`), the totals row is the API's `total`. `account&month` (the link
 * from the overview) resolves to the file ids of that account and month.
 */
export function SourceLinesPage() {
  const [params, setParams] = useSearchParams();
  const files = useQuery(sourceQueries.files());
  const loaded = useMemo(() => (files.data?.believe ?? []).filter((f) => f.status === 'loaded'), [files.data]);
  const account = params.get('account') ?? '';
  const month = params.get('month') ?? '';
  const fileParam = params.get('fileId') ?? '';
  const get = (k: string) => params.get(k) ?? '';
  const offset = get('offset');

  const newest = loaded.reduce((m, f) => (f.reportingMonth > m ? f.reportingMonth : m), '');
  const searching = get('isrc').trim() !== '' || get('upc').trim() !== '';
  // The files of the query: explicit ids, else the account/month of the overview link, else the newest month (unless searching all files).
  const ids = useMemo(() => {
    if (fileParam) return fileParam.split(',').filter((x) => x !== '');
    if (account || month) return loaded.filter((f) => (!account || f.account === account) && (!month || f.reportingMonth === month)).map((f) => f.id);
    if (searching) return [];
    return loaded.filter((f) => f.reportingMonth === newest).map((f) => f.id);
  }, [fileParam, account, month, searching, loaded, newest]);
  const idsText = ids.join(',');

  const [chosen, setChosen] = useState<Set<string>>(new Set());
  useEffect(() => setChosen(new Set(idsText ? idsText.split(',') : [])), [idsText]);
  const [draft, setDraft] = useState<Draft>(() => Object.fromEntries(FILTER_KEYS.map((k) => [k, params.get(k) ?? (k === 'sort' ? 'net' : k === 'dir' ? 'desc' : k === 'limit' ? '100' : '')])) as Draft);
  const set = (k: FilterKey, v: string) => setDraft((d) => ({ ...d, [k]: v }));

  const waitingForFiles = (account !== '' || month !== '') && !fileParam && files.data === undefined;
  const ready = !waitingForFiles && (ids.length > 0 || searching);
  const facets = useQuery({ ...sourceQueries.facets(idsText || undefined), enabled: !waitingForFiles });
  const lines = useQuery({
    ...sourceQueries.lines({
      fileId: idsText || undefined,
      isrc: get('isrc').trim() || undefined,
      upc: get('upc').trim() || undefined,
      platform: get('platform') || undefined,
      country: get('country') || undefined,
      subscriptionType: get('subscriptionType') || undefined,
      salesType: get('salesType') || undefined,
      releaseType: get('releaseType') || undefined,
      salesFrom: get('salesFrom') || undefined,
      salesTo: get('salesTo') || undefined,
      sort: sortOf(get('sort')),
      dir: get('dir') === 'asc' ? 'asc' : 'desc',
      limit: toInt(get('limit') || '100'),
      offset: toInt(offset),
    }),
    enabled: ready,
  });

  const apply = (extra: Record<string, string> = {}) =>
    setParams(() => {
      const next = new URLSearchParams();
      for (const k of FILTER_KEYS) if (draft[k].trim() !== '') next.set(k, draft[k].trim());
      const picked = [...chosen].join(',');
      if (picked) next.set('fileId', picked);
      for (const [k, v] of Object.entries(extra)) if (v) next.set(k, v);
      return next;
    });
  const go = (o: number) => apply({ offset: o > 0 ? String(o) : '' });
  const reset = () => {
    setDraft(Object.fromEntries(FILTER_KEYS.map((k) => [k, k === 'sort' ? 'net' : k === 'dir' ? 'desc' : k === 'limit' ? '100' : ''])) as Draft);
    setParams(() => new URLSearchParams());
  };
  const toggle = (id: string) =>
    setChosen((c) => {
      const n = new Set(c);
      if (n.has(id)) n.delete(id);
      else n.add(id);
      return n;
    });

  const facetSelect = (k: FilterKey, label: string, options: readonly string[] | undefined) => (
    <div className="w-44">
      <SelectField
        name={`lines-${k}`}
        label={label}
        value={draft[k] || ANY}
        onChange={(v) => set(k, v === ANY ? '' : v)}
        options={[{ id: ANY, label: t.any }, ...(options ?? []).slice(0, 49).map((o) => ({ id: o, label: o || t.noIsrc }))]}
      />
    </div>
  );
  const slow = chosen.size > 4 && !searching;

  return (
    <div data-testid="source-lines-page">
      <PageHeader
        title={t.title}
        subtitle={t.subtitle}
        toolbar={
          <Link to="/sources" className="text-sm text-accent hover:underline">
            {ru.reference.sources.title}
          </Link>
        }
      />
      <div className="flex flex-col gap-4">
        <section className="rounded-xl border border-border p-3">
          <div className="mb-2 flex flex-wrap items-center gap-2">
            <h2 className="text-sm font-medium">{t.files}</h2>
            <ActionButton name="files-newest" write={false} variant="secondary" onPress={() => setChosen(new Set(loaded.filter((f) => f.reportingMonth === newest).map((f) => f.id)))}>
              {t.newest}
            </ActionButton>
            <ActionButton name="files-all" write={false} variant="secondary" onPress={() => setChosen(new Set(loaded.map((f) => f.id)))}>
              {t.allFiles}
            </ActionButton>
            <ActionButton name="files-none" write={false} variant="secondary" onPress={() => setChosen(new Set())}>
              {t.noFiles}
            </ActionButton>
            <span className="text-xs text-muted" data-testid="files-chosen">
              {fmt(t.chosen, { n: chosen.size })}
            </span>
          </div>
          {loaded.length === 0 ? (
            <p className="text-sm text-muted">{t.noLoaded}</p>
          ) : (
            <div className="max-h-60 overflow-y-auto">
              <SimpleTable testId="lines-files" headers={['', ru.reference.sources.cols.account, ru.reference.sources.cols.month, ru.reference.sources.cols.fileName, ru.reference.sources.cols.lineCount]}>
                {loaded.map((f) => (
                  <tr key={f.id} data-testid={`lines-file-${f.id}`} className="border-t border-border">
                    <Td>
                      <input type="checkbox" data-testid={`lines-file-check-${f.id}`} checked={chosen.has(f.id)} onChange={() => toggle(f.id)} />
                    </Td>
                    <Td>{f.account}</Td>
                    <Td>{f.reportingMonth}</Td>
                    <Td>{f.fileName}</Td>
                    <Td>{f.lineCount}</Td>
                  </tr>
                ))}
              </SimpleTable>
            </div>
          )}
        </section>
        <section className="flex flex-wrap items-end gap-3 rounded-xl border border-border p-3" data-testid="lines-filters">
          <div className="w-44">
            <TextField name="lines-isrc" label={t.isrc} value={draft.isrc} onChange={(v) => set('isrc', v)} />
          </div>
          <div className="w-44">
            <TextField name="lines-upc" label={t.upc} value={draft.upc} onChange={(v) => set('upc', v)} />
          </div>
          {facetSelect('platform', t.platform, facets.data?.platforms)}
          {facetSelect('country', t.country, facets.data?.countries)}
          {facetSelect('subscriptionType', t.subscriptionType, facets.data?.subscriptionTypes)}
          {facetSelect('salesType', t.salesType, facets.data?.salesTypes)}
          {facetSelect('releaseType', t.releaseType, facets.data?.releaseTypes)}
          <div className="w-40">
            <DateField name="lines-sales-from" label={t.salesFrom} value={draft.salesFrom} onChange={(v) => set('salesFrom', v)} month />
          </div>
          <div className="w-40">
            <DateField name="lines-sales-to" label={t.salesTo} value={draft.salesTo} onChange={(v) => set('salesTo', v)} month />
          </div>
          <div className="w-44">
            <SelectField name="lines-sort" label={t.sort} value={draft.sort} onChange={(v) => set('sort', v)} options={SORTS.map((s) => ({ id: s, label: t.sorts[s] }))} />
          </div>
          <div className="w-44">
            <SelectField name="lines-dir" label={t.dir} value={draft.dir} onChange={(v) => set('dir', v)} options={[{ id: 'desc', label: t.desc }, { id: 'asc', label: t.asc }]} />
          </div>
          <div className="w-28">
            <SelectField name="lines-limit" label={t.perPage} value={draft.limit} onChange={(v) => set('limit', v)} options={SIZES.map((s) => ({ id: s, label: s }))} />
          </div>
          <ActionButton name="show-lines" write={false} onPress={() => apply()} isDisabled={chosen.size === 0 && draft.isrc.trim() === '' && draft.upc.trim() === ''} reason={t.pickFile}>
            {t.show}
          </ActionButton>
          <ActionButton name="reset-lines" write={false} variant="secondary" onPress={reset}>
            {t.reset}
          </ActionButton>
          {slow ? (
            <p className="w-full text-xs text-muted" data-testid="slow-hint">
              {t.slow}
            </p>
          ) : null}
        </section>
        {!ready ? (
          <p className="text-sm text-muted" data-testid="lines-pick">{t.pickFile}</p>
        ) : (
          <QueryView query={lines} money isEmpty={(d) => d.items.length === 0 && d.offset === 0} emptyMessage={t.empty}>
            {(page) => {
              const from = page.items.length === 0 ? 0 : page.offset + 1;
              const to = page.offset + page.items.length;
              const last = BigInt(page.total.keys) <= BigInt(to);
              return (
                <div className="flex flex-col gap-3">
                  <div className="rounded-xl border border-border p-3 text-sm" data-testid="lines-totals">
                    <div className="font-medium">{t.totals}</div>
                    <div>{fmt(t.totalsText, { keys: page.total.keys, merged: page.total.mergedLines, files: page.files.length })}</div>
                    <div className="flex flex-wrap gap-4">
                      <span>{t.quantity}: <b data-testid="total-quantity">{page.total.quantity}</b></span>
                      <span data-col="gross">{t.gross}: <Money value={page.total.gross} /></span>
                      <span data-col="net">{t.net}: <Money value={page.total.net} /></span>
                    </div>
                  </div>
                  <div className="flex items-center gap-3 text-sm">
                    <ActionButton name="page-prev" write={false} variant="secondary" isDisabled={page.offset === 0} onPress={() => go(page.offset > page.limit ? page.offset - page.limit : 0)}>
                      {t.prev}
                    </ActionButton>
                    <span data-testid="lines-range">{fmt(t.range, { from, to, total: page.total.keys })}</span>
                    <ActionButton name="page-next" write={false} variant="secondary" isDisabled={last} onPress={() => go(page.offset + page.limit)}>
                      {t.next}
                    </ActionButton>
                  </div>
                  <div className="overflow-x-auto">
                    <SimpleTable
                      testId="lines-table"
                      headers={[t.cols.reportingMonth, t.cols.account, t.cols.salesMonth, t.cols.platform, t.cols.country, t.cols.isrc, t.cols.upc, t.cols.artist, t.cols.subscription, t.cols.salesType, t.cols.quantity, t.cols.gross, t.cols.net, t.cols.merged]}
                    >
                      {page.items.map((l, i) => (
                        <tr key={`${page.offset}-${i}`} data-testid={`source-line-${i}`} className="border-t border-border">
                          <Td>{l.reportingMonth}</Td>
                          <Td>{l.account}</Td>
                          <Td>{l.salesMonth}</Td>
                          <Td>{l.platform}</Td>
                          <Td>{l.country}</Td>
                          <Td col="isrc">{l.isrc ? <EntityLink kind="isrc" id={l.isrc} /> : t.noIsrc}</Td>
                          <Td>{l.upc}</Td>
                          <Td>
                            {l.artistName}
                            <div className="text-xs text-muted">{l.trackTitle}</div>
                          </Td>
                          <Td>{l.subscriptionType || '—'}</Td>
                          <Td>{l.salesType}</Td>
                          <Td col="quantity">{l.quantity}</Td>
                          <Td col="gross"><Money value={l.gross} /></Td>
                          <Td col="net"><Money value={l.net} /></Td>
                          <Td>{l.mergedLines}</Td>
                        </tr>
                      ))}
                    </SimpleTable>
                  </div>
                </div>
              );
            }}
          </QueryView>
        )}
      </div>
    </div>
  );
}
