import { useQuery } from '@tanstack/react-query';
import { trackQueries } from '../../../api/queries/tracks';
import { QueryView } from '../../../components/PageState';
import { ru } from '../../../i18n/ru';
import { SimpleTable, Td } from '../components/MoneyTable';

const t = ru.catalog.history;

/** The audit trail of the ISRC (`GET /audit?entityId=<isrc>`): who did what through the interface, and when. */
export function HistoryTab({ isrc }: { isrc: string }) {
  const query = useQuery(trackQueries.audit(isrc));
  const c = t.cols;
  return (
    <QueryView query={query} isEmpty={(d) => d.items.length === 0} emptyMessage={t.empty}>
      {(data) => (
        <SimpleTable testId="track-history" headers={[c.at, c.operator, c.method, c.route, c.summary]}>
          {data.items.map((a) => (
            <tr key={a.id} data-testid={`audit-${a.id}`} className="border-t border-border">
              <Td>{a.at}</Td>
              <Td col="operator">{a.operator}</Td>
              <Td>{a.method}</Td>
              <Td col="route">{a.route}</Td>
              <Td className="text-xs text-muted">{JSON.stringify(a.summary)}</Td>
            </tr>
          ))}
        </SimpleTable>
      )}
    </QueryView>
  );
}
