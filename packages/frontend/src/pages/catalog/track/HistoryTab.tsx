import { useQuery } from '@tanstack/react-query';
import { trackQueries } from '../../../api/queries/tracks';
import { AuditTable } from '../../../components/AuditTable';
import { QueryView } from '../../../components/PageState';
import { ru } from '../../../i18n/ru';

/** The audit trail of the ISRC (`GET /audit?entityId=<isrc>`): who did what through the interface, and when. */
export function HistoryTab({ isrc }: { isrc: string }) {
  const query = useQuery(trackQueries.audit(isrc));
  return (
    <QueryView query={query} isEmpty={(d) => d.items.length === 0} emptyMessage={ru.audit.empty}>
      {(data) => <AuditTable items={data.items} testId="track-history" />}
    </QueryView>
  );
}
