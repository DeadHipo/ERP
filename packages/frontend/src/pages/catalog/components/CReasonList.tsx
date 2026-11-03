import { Link } from 'react-router-dom';
import type { CReason } from '@erp/shared/api-responses';
import { Money } from '../../../components/Money';
import { ru } from '../../../i18n/ru';

/** Category C by reason (`cByReason` of a response), each a link to its queue: `data-testid="c-reason-<reason>"`. */
export function CReasonList({ byReason }: { byReason: Partial<Record<CReason, string>> }) {
  const entries = Object.entries(byReason) as [CReason, string][];
  if (entries.length === 0) return null;
  return (
    <ul className="mt-1 flex flex-col gap-0.5 text-xs" aria-label={ru.overview.cBreakdown}>
      {entries.map(([reason, amount]) => (
        <li key={reason} data-testid={`c-reason-${reason}`}>
          <Link to={`/queue/${reason}`} className="text-accent hover:underline">
            {ru.reasons[reason]}: <Money value={amount} />
          </Link>
        </li>
      ))}
    </ul>
  );
}
