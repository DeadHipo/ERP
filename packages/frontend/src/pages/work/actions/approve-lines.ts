import { useQuery } from '@tanstack/react-query';
import { documentQueries } from '../../../api/queries/documents';
import { statusLabel } from '../../../components/StatusChip';
import { formatMoney } from '../../../lib/money';
import { ru } from '../../../i18n/ru';

const c = ru.actions.confirm;

/**
 * The lines of the approve confirmation (17 §6): the document, «ждёт этого документа: X» and what it confirms from
 * `GET /documents/:id/uses` (N13); until that answers (or if it fails) the money of the queue group stands in.
 */
export function useApproveLines(doc: { id: string; title: string; kind: string } | null, groupAmount: string | undefined, open: boolean): string[] {
  const uses = useQuery({ ...documentQueries.uses(doc?.id ?? ''), enabled: open && doc !== null });
  if (!doc) return [];
  const kind = statusLabel('documentKind', doc.kind);
  if (uses.data) {
    const u = uses.data;
    return [
      ...c.approveUsesLines(
        doc.title,
        kind,
        formatMoney(u.waiting.amount),
        c.confirms(u.splits.length, u.rowsOnly.length, u.participations.length, u.labelRules.length, u.contracts.length),
      ),
    ];
  }
  return [...c.approveLines(doc.title, kind, groupAmount ? formatMoney(groupAmount) : '—')];
}
