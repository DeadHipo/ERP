import { useQuery } from '@tanstack/react-query';
import type { TrackMoney } from '@erp/shared/api-responses';
import { documentQueries } from '../../../api/queries/documents';
import { labelQueries } from '../../../api/queries/labels';
import { EntityLink } from '../../../components/EntityLink';
import { PageState, QueryView } from '../../../components/PageState';
import { StatusChip } from '../../../components/StatusChip';
import { ru } from '../../../i18n/ru';
import { SimpleTable, Td } from '../components/MoneyTable';

const t = ru.catalog.documents;
type Use = keyof typeof t.used;

/** The documents the rules of this ISRC refer to (splits, rows, participations, sublabel rules, allocations). */
export function DocumentsTab({ data }: { data: TrackMoney }) {
  const documents = useQuery(documentQueries.list());
  const labels = useQuery(labelQueries.list());
  const uses = new Map<string, Set<Use>>();
  const add = (id: string | null, use: Use) => {
    if (!id) return;
    const set = uses.get(id) ?? new Set<Use>();
    set.add(use);
    uses.set(id, set);
  };
  for (const s of data.splits) {
    add(s.documentId, 'split');
    for (const sh of s.shares) add(sh.documentId, 'row');
  }
  for (const p of data.participations) add(p.documentId, 'participation');
  const ruleIds = new Set(data.months.flatMap((m) => (m.rule ? [m.rule] : [])));
  for (const l of labels.data ?? []) for (const rule of l.rules) if (ruleIds.has(rule.id)) add(rule.documentId, 'labelRule');
  for (const m of data.months) for (const a of m.allocations) add(a.documentId, 'allocation');
  if (uses.size === 0) return <PageState variant="empty" message={t.empty} />;
  return (
    <QueryView query={documents}>
      {(list) => {
        const byId = new Map(list.map((d) => [d.id, d]));
        const c = t.cols;
        return (
          <SimpleTable testId="track-documents" headers={[c.title, c.kind, c.status, c.approvedAt, c.usedBy]}>
            {[...uses.entries()].map(([id, used]) => {
              const d = byId.get(id);
              return (
                <tr key={id} data-testid={`document-${id}`} className="border-t border-border">
                  <Td>
                    <EntityLink kind="document" id={id} label={d?.title ?? t.missing} />
                  </Td>
                  <Td>{d ? <StatusChip kind="documentKind" value={d.kind} /> : null}</Td>
                  <Td>
                    <StatusChip kind="documentStatus" value={d?.status ?? 'missing'} />
                  </Td>
                  <Td>{d?.approvedAt ?? '—'}</Td>
                  <Td>{[...used].map((u) => t.used[u]).join(', ')}</Td>
                </tr>
              );
            })}
          </SimpleTable>
        );
      }}
    </QueryView>
  );
}
