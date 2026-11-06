import type { ColDef } from 'ag-grid-community';
import { possibleDuplicateDetailsSchema } from '@erp/shared/api-responses';
import { DuplicateCandidates } from '../../../../components/DuplicateDialog';
import { EntityLink } from '../../../../components/EntityLink';
import { fmt, ru } from '../../../../i18n/ru';
import { IssueChips, issueText } from './IssueChips';
import type { ImportGroup, ImportRow } from './types';

const t = ru.splitImport;
const c = t.cols;

/** A row of the preview grid: the file row with the decision of its group. */
export type PreviewRow = ImportRow & { action: ImportGroup['action'] };

type P = { data?: PreviewRow };

/** A date as the backend floored it (M52), the file's text in the tooltip when it differs. */
const dateCell = (floored: string | null, raw: string | null) => (
  <span title={raw && raw !== floored ? fmt(t.original, { value: raw }) : undefined}>{floored ?? raw ?? '—'}</span>
);

/** The pseudonyms the backend found similar to a new or ambiguous one (read-only: the fix is `artist_id` in the file). */
function Candidates({ row }: { row: ImportRow }) {
  const issue = row.issues.find((i) => i.code === 'new_pseudonym' || i.code === 'pseudonym_ambiguous');
  const parsed = possibleDuplicateDetailsSchema.safeParse(issue?.details);
  if (!parsed.success || parsed.data.similar.length === 0) return null;
  return (
    <details className="text-xs">
      <summary className="cursor-pointer text-muted">{t.candidates}</summary>
      <DuplicateCandidates testId={`import-similar-${row.line}`} similar={parsed.data.similar} matchedBy={t.matchedBy} />
    </details>
  );
}

/** The columns of the P28 preview (D-172): line, ISRC, pseudonym, %, from/to (floored), owner, document, group, decision, classes. */
export function importColumns(): ColDef<PreviewRow>[] {
  return [
    { colId: 'line', headerName: c.line, maxWidth: 90, valueGetter: (p) => p.data?.line },
    {
      colId: 'isrc',
      headerName: c.isrc,
      minWidth: 140,
      valueGetter: (p) => p.data?.isrc,
      cellRenderer: (p: P) => (p.data ? <EntityLink kind="isrc" id={p.data.isrc} /> : null),
    },
    {
      colId: 'pseudonym',
      headerName: c.pseudonym,
      minWidth: 180,
      autoHeight: true,
      wrapText: true,
      valueGetter: (p) => p.data?.pseudonym,
      cellRenderer: (p: P) =>
        p.data ? (
          <div className="flex flex-col py-1">
            {p.data.artistId ? <EntityLink kind="artist" id={p.data.artistId} label={p.data.pseudonym} /> : <span>{p.data.pseudonym}</span>}
            <Candidates row={p.data} />
          </div>
        ) : null,
    },
    { colId: 'percent', headerName: c.percent, maxWidth: 90, valueGetter: (p) => p.data?.percent },
    {
      colId: 'from',
      headerName: c.from,
      maxWidth: 130,
      valueGetter: (p) => p.data?.fromFloored ?? p.data?.from,
      cellRenderer: (p: P) => (p.data ? dateCell(p.data.fromFloored, p.data.from) : null),
    },
    {
      colId: 'to',
      headerName: c.to,
      maxWidth: 130,
      valueGetter: (p) => p.data?.toFloored ?? p.data?.to ?? '',
      cellRenderer: (p: P) => (p.data ? dateCell(p.data.toFloored, p.data.to) : null),
    },
    { colId: 'owner', headerName: c.owner, minWidth: 140, valueGetter: (p) => p.data?.owner ?? '' },
    {
      colId: 'document',
      headerName: c.document,
      minWidth: 120,
      valueGetter: (p) => p.data?.documentId ?? '',
      cellRenderer: (p: P) => (p.data?.documentId ? <EntityLink kind="document" id={p.data.documentId} label="→" /> : null),
    },
    { colId: 'group', headerName: c.group, minWidth: 180, valueGetter: (p) => p.data?.group },
    {
      colId: 'action',
      headerName: c.action,
      maxWidth: 140,
      valueGetter: (p) => (p.data ? t.actions[p.data.action] : ''),
      cellRenderer: (p: P) => (p.data ? <span data-col="action">{t.actions[p.data.action]}</span> : null),
    },
    {
      colId: 'issues',
      headerName: c.issues,
      minWidth: 320,
      flex: 1,
      autoHeight: true,
      wrapText: true,
      sortable: false,
      valueGetter: (p) => (p.data ? p.data.issues.map(issueText).join(', ') : ''),
      cellRenderer: (p: P) => (p.data ? <IssueChips issues={p.data.issues} /> : null),
    },
  ];
}
