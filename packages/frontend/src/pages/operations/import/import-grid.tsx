import type { ColDef } from 'ag-grid-community';
import type { OperationImport } from '@erp/shared/api-responses';
import { isOperationKind } from '@erp/shared/operation-kinds';
import { EntityLink } from '../../../components/EntityLink';
import { IssueChips } from '../../../components/IssueChips';
import { statusLabel } from '../../../components/StatusChip';
import { ru } from '../../../i18n/ru';

const t = ru.operations.import;
const c = t.cols;

export type ImportRow = OperationImport['rows'][number];
type Issue = ImportRow['issues'][number];
type P = { data?: ImportRow };

/** The text of one class: the sentence, plus the number or list it carries (the available publishing, the allowed kinds). */
export function issueText(issue: Issue): string {
  const base = t.issues[issue.code];
  const d = issue.details ?? {};
  const value = (k: string) => (typeof d[k] === 'string' || typeof d[k] === 'number' ? String(d[k]) : null);
  const list = (k: string) => (Array.isArray(d[k]) ? (d[k] as unknown[]).map(String).join(', ') : null);
  if (value('available')) return `${base}: ${value('available')}`;
  if (list('allowed')) return `${base}: ${list('allowed')}`;
  return base;
}

/** The kind as the file wrote it: the Russian kind when it is one, else the cell as it is. */
const kindText = (kind: string) => (isOperationKind(kind) ? statusLabel('operationKind', kind) : kind);

/** The columns of the P29 preview (D-173): line, kind, owner, pseudonym, date, amount, external id, document, decision, classes. */
export function importColumns(): ColDef<ImportRow>[] {
  return [
    { colId: 'line', headerName: c.line, maxWidth: 90, valueGetter: (p) => p.data?.line },
    {
      colId: 'kind',
      headerName: c.kind,
      minWidth: 120,
      valueGetter: (p) => (p.data ? kindText(p.data.kind) : ''),
      cellRenderer: (p: P) => (p.data ? <span data-col="kind" data-kind={p.data.kind}>{kindText(p.data.kind)}</span> : null),
    },
    {
      colId: 'owner',
      headerName: c.owner,
      minWidth: 150,
      valueGetter: (p) => p.data?.owner ?? '',
      cellRenderer: (p: P) =>
        p.data ? (
          p.data.ownerId ? <EntityLink kind="owner" id={p.data.ownerId} label={p.data.owner ?? p.data.ownerId} /> : <span>{p.data.owner ?? '—'}</span>
        ) : null,
    },
    {
      colId: 'pseudonym',
      headerName: c.pseudonym,
      minWidth: 130,
      valueGetter: (p) => p.data?.pseudonym ?? '',
      cellRenderer: (p: P) =>
        p.data ? (
          p.data.artistId ? (
            <EntityLink kind="artist" id={p.data.artistId} label={p.data.pseudonym ?? p.data.artistId} />
          ) : (
            <span>{p.data.pseudonym ?? '—'}</span>
          )
        ) : null,
    },
    { colId: 'date', headerName: c.date, maxWidth: 130, valueGetter: (p) => p.data?.date },
    { colId: 'amount', headerName: c.amount, maxWidth: 130, valueGetter: (p) => p.data?.amount },
    { colId: 'externalId', headerName: c.externalId, minWidth: 120, valueGetter: (p) => p.data?.externalId ?? '' },
    {
      colId: 'document',
      headerName: c.document,
      maxWidth: 110,
      valueGetter: (p) => p.data?.documentId ?? '',
      cellRenderer: (p: P) => (p.data?.documentId ? <EntityLink kind="document" id={p.data.documentId} label="→" /> : null),
    },
    {
      colId: 'action',
      headerName: c.action,
      maxWidth: 130,
      valueGetter: (p) => (p.data ? t.actions[p.data.action] : ''),
      cellRenderer: (p: P) => (p.data ? <span data-col="action">{t.actions[p.data.action]}</span> : null),
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
      cellRenderer: (p: P) => (p.data ? <IssueChips issues={p.data.issues} text={issueText} /> : null),
    },
  ];
}
