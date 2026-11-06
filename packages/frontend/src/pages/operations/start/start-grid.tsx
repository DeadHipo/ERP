import type { ColDef } from 'ag-grid-community';
import type { StartImport, StartList } from '@erp/shared/api-responses';
import { EntityLink } from '../../../components/EntityLink';
import { IssueChips } from '../../../components/IssueChips';
import { Money } from '../../../components/Money';
import { ru } from '../../../i18n/ru';
import { compareDecimal } from '../../../lib/money';
import { centsToText } from '../../owners/components/cents';

const t = ru.operations.start;

export type StartRow = StartList['rows'][number];
export type ImportRow = StartImport['rows'][number];
type Issue = ImportRow['issues'][number];

/** The text of one class of the preview: the sentence, plus the amount the existing start carries (`start_exists`). */
export function issueText(issue: Issue): string {
  const base = t.import.issues[issue.code];
  const d = issue.details ?? {};
  if (issue.code === 'start_exists' && typeof d.masterCents === 'number' && typeof d.publishingCents === 'number')
    return `${base}: ${centsToText(d.masterCents)} / ${centsToText(d.publishingCents)}`;
  return base;
}

const kindText = (kind: string) => (kind === 'start' || kind === 'adjustment' ? t.kinds[kind] : kind);

/** The columns of the start list (P30): pseudonym, owner, kind, cut, master, publishing, missing, basis, document, advance, status. */
export function startColumns(): ColDef<StartRow>[] {
  const c = t.cols;
  const money = (colId: 'masterCents' | 'publishingCents', header: string): ColDef<StartRow> => ({
    colId,
    headerName: header,
    maxWidth: 140,
    type: 'rightAligned',
    valueGetter: (p) => (p.data ? centsToText(p.data[colId]) : ''),
    comparator: compareDecimal,
    cellRenderer: (p: { data?: StartRow }) => (p.data ? <span data-col={colId}><Money value={centsToText(p.data[colId])} /></span> : null),
  });
  return [
    {
      colId: 'pseudonym',
      headerName: c.pseudonym,
      minWidth: 150,
      valueGetter: (p) => p.data?.pseudonym ?? '',
      cellRenderer: (p: { data?: StartRow }) => (p.data ? <EntityLink kind="artist" id={p.data.artistId} label={p.data.pseudonym} /> : null),
    },
    {
      colId: 'owner',
      headerName: c.owner,
      minWidth: 150,
      valueGetter: (p) => p.data?.ownerName ?? '',
      cellRenderer: (p: { data?: StartRow }) =>
        p.data?.ownerId ? <EntityLink kind="owner" id={p.data.ownerId} label={p.data.ownerName ?? p.data.ownerId} /> : <span>—</span>,
    },
    {
      colId: 'kind',
      headerName: c.kind,
      maxWidth: 130,
      valueGetter: (p) => (p.data ? kindText(p.data.kind) : ''),
      cellRenderer: (p: { data?: StartRow }) => (p.data ? <span data-col="kind" data-kind={p.data.kind}>{kindText(p.data.kind)}</span> : null),
    },
    { colId: 'cutoff', headerName: c.cutoff, maxWidth: 110, valueGetter: (p) => p.data?.cutoffMonth ?? '' },
    money('masterCents', c.master),
    money('publishingCents', c.publishing),
    {
      colId: 'missing',
      headerName: c.missing,
      maxWidth: 110,
      valueGetter: (p) => (p.data?.missing ? '✓' : ''),
      cellRenderer: (p: { data?: StartRow }) => (p.data ? <span data-col="missing" data-value={String(p.data.missing)}>{p.data.missing ? '✓' : ''}</span> : null),
    },
    { colId: 'basis', headerName: c.basis, minWidth: 220, flex: 1, wrapText: true, autoHeight: true, valueGetter: (p) => p.data?.basis ?? '' },
    {
      colId: 'document',
      headerName: c.document,
      maxWidth: 110,
      valueGetter: (p) => p.data?.documentId ?? '',
      cellRenderer: (p: { data?: StartRow }) => (p.data?.documentId ? <EntityLink kind="document" id={p.data.documentId} label="→" /> : null),
    },
    {
      colId: 'operationRef',
      headerName: c.operationRef,
      maxWidth: 110,
      valueGetter: (p) => p.data?.operationRef ?? '',
      cellRenderer: (p: { data?: StartRow }) => (p.data?.operationRef ? <span data-col="operationRef" title={p.data.operationRef}>→</span> : null),
    },
    {
      colId: 'active',
      headerName: c.active,
      maxWidth: 120,
      valueGetter: (p) => (p.data ? (p.data.active ? t.active.yes : t.active.no) : ''),
      cellRenderer: (p: { data?: StartRow }) =>
        p.data ? (
          <span data-col="active" data-value={String(p.data.active)} title={p.data.deactivatedReason ?? undefined}>
            {p.data.active ? t.active.yes : t.active.no}
          </span>
        ) : null,
    },
  ];
}

/** The columns of the P30 preview (D-174): line, pseudonym, kind, master, publishing, missing, advance, decision, classes. */
export function importColumns(): ColDef<ImportRow>[] {
  const c = t.import.cols;
  return [
    { colId: 'line', headerName: c.line, maxWidth: 90, valueGetter: (p) => p.data?.line },
    {
      colId: 'pseudonym',
      headerName: c.pseudonym,
      minWidth: 150,
      valueGetter: (p) => p.data?.pseudonym ?? '',
      cellRenderer: (p: { data?: ImportRow }) =>
        p.data ? (p.data.artistId ? <EntityLink kind="artist" id={p.data.artistId} label={p.data.pseudonym} /> : <span>{p.data.pseudonym || '—'}</span>) : null,
    },
    {
      colId: 'kind',
      headerName: c.kind,
      maxWidth: 130,
      valueGetter: (p) => (p.data ? kindText(p.data.kind) : ''),
      cellRenderer: (p: { data?: ImportRow }) => (p.data ? <span data-col="kind">{kindText(p.data.kind)}</span> : null),
    },
    { colId: 'master', headerName: c.master, maxWidth: 130, valueGetter: (p) => p.data?.master ?? '' },
    { colId: 'publishing', headerName: c.publishing, maxWidth: 130, valueGetter: (p) => p.data?.publishing ?? '' },
    { colId: 'missing', headerName: c.missing, maxWidth: 110, valueGetter: (p) => (p.data?.missing ? '✓' : '') },
    { colId: 'operationRef', headerName: c.operationRef, maxWidth: 110, valueGetter: (p) => (p.data?.operationRef ? '→' : '') },
    {
      colId: 'action',
      headerName: c.action,
      maxWidth: 130,
      valueGetter: (p) => (p.data ? t.import.actions[p.data.action] : ''),
      cellRenderer: (p: { data?: ImportRow }) => (p.data ? <span data-col="action">{t.import.actions[p.data.action]}</span> : null),
    },
    {
      colId: 'issues',
      headerName: c.issues,
      minWidth: 300,
      flex: 1,
      autoHeight: true,
      wrapText: true,
      sortable: false,
      valueGetter: (p) => (p.data ? p.data.issues.map(issueText).join(', ') : ''),
      cellRenderer: (p: { data?: ImportRow }) => (p.data ? <IssueChips issues={p.data.issues} text={issueText} /> : null),
    },
  ];
}
