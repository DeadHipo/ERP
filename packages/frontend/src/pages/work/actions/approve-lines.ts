import { useQuery } from '@tanstack/react-query';
import { documentQueries } from '../../../api/queries/documents';
import { statusLabel } from '../../../components/StatusChip';
import { errorText } from '../../../i18n/ru/errors';
import { formatMoney } from '../../../lib/money';
import { ru } from '../../../i18n/ru';

const c = ru.actions.confirm;

/**
 * The lines of the approve confirmation (17 §6): the document, «ждёт этого документа: X» and what it confirms, both from
 * `GET /documents/:id/uses` (N13). Until that answers `loading` is true: the dialog keeps OK disabled and shows no
 * amount (no stand-in number that changes under the operator's finger, stage 3 product finding 1). If the call fails
 * the lines say so and OK is usable (approving does not depend on the amount).
 */
export function useApproveLines(
  doc: { id: string; title: string; kind: string } | null,
  open: boolean,
): { lines: string[]; loading: boolean } {
  const uses = useQuery({ ...documentQueries.uses(doc?.id ?? ''), enabled: open && doc !== null });
  if (!doc) return { lines: [], loading: false };
  const kind = statusLabel('documentKind', doc.kind);
  if (uses.data) {
    const u = uses.data;
    return {
      lines: [
        ...c.approveUsesLines(
          doc.title,
          kind,
          formatMoney(u.waiting.amount),
          c.confirms(u.splits.length, u.rowsOnly.length, u.participations.length, u.labelRules.length, u.contracts.length),
        ),
      ],
      loading: false,
    };
  }
  if (uses.isError) {
    const code = 'code' in uses.error && typeof uses.error.code === 'string' ? uses.error.code : 'error';
    return { lines: [...c.approveFailedLines(doc.title, kind, errorText(code) ?? uses.error.message)], loading: false };
  }
  return { lines: [...c.approvePendingLines(doc.title, kind)], loading: true };
}
