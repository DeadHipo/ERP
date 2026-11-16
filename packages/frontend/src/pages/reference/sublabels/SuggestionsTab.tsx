import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { sublabelQueries } from '../../../api/queries/sublabels';
import { ActionButton } from '../../../components/ActionButton';
import { Money } from '../../../components/Money';
import { QueryView } from '../../../components/PageState';
import { TextField } from '../../../components/fields/TextField';
import { ru } from '../../../i18n/ru';
import { SimpleTable, Td } from '../../catalog/components/MoneyTable';
import { AddTermsDialog } from './dialogs';

const t = ru.sublabels;

/** «Подсказки» (D-219): the tracks under a sublabel's Believe string without a term in the month; a hint, never money. */
export function SuggestionsTab() {
  const [month, setMonth] = useState('');
  const [chosen, setChosen] = useState<Record<string, Set<string>>>({});
  const [adding, setAdding] = useState<{ sublabelId: string; isrcs: string[] } | null>(null);
  const query = useQuery(sublabelQueries.suggestions(month));
  const toggle = (group: string, isrc: string) =>
    setChosen((c) => {
      const next = new Set(c[group] ?? []);
      if (next.has(isrc)) next.delete(isrc);
      else next.add(isrc);
      return { ...c, [group]: next };
    });
  return (
    <div className="flex flex-col gap-3" data-testid="sublabel-suggestions">
      <p className="text-sm text-muted">{t.suggestionsHint}</p>
      <TextField name="suggestions-month" label={t.suggestionsMonth} type="month" value={month} onChange={setMonth} />
      {month === '' ? (
        <p className="text-sm text-muted">{t.pickMonth}</p>
      ) : (
        <QueryView query={query} isEmpty={(d) => d.groups.length === 0} emptyMessage={t.suggestionsEmpty}>
          {(d) => (
            <div className="flex flex-col gap-6">
              {d.groups.map((g) => {
                const picked = chosen[g.sublabelId] ?? new Set<string>();
                return (
                  <section key={g.sublabelId} data-testid={`suggestion-group-${g.sublabelId}`} className="flex flex-col gap-2">
                    <div className="flex flex-wrap items-center gap-3">
                      <h2 className="text-sm font-medium">
                        {g.sublabelName} · <Money value={g.net} />
                      </h2>
                      <ActionButton
                        name={`add-suggestions-${g.sublabelId}`}
                        op="POST /sublabels/:id/terms"
                        isDisabled={picked.size === 0}
                        reason={t.selectFirst}
                        onPress={() => setAdding({ sublabelId: g.sublabelId, isrcs: [...picked] })}
                      >
                        {t.addSelected}
                      </ActionButton>
                    </div>
                    <SimpleTable headers={['', t.cols.isrc, t.cols.title, t.cols.labelString, t.cols.net]}>
                      {g.items.map((x) => (
                        <tr key={x.isrc} data-testid={`suggestion-${x.isrc}`}>
                          <Td>
                            <input
                              type="checkbox"
                              data-testid={`suggestion-pick-${x.isrc}`}
                              checked={picked.has(x.isrc)}
                              onChange={() => toggle(g.sublabelId, x.isrc)}
                            />
                          </Td>
                          <Td>{x.isrc}</Td>
                          <Td>{x.title ?? ''}</Td>
                          <Td>{x.labelString}</Td>
                          <Td>
                            <Money value={x.net} />
                          </Td>
                        </tr>
                      ))}
                    </SimpleTable>
                  </section>
                );
              })}
            </div>
          )}
        </QueryView>
      )}
      {adding ? (
        <AddTermsDialog
          sublabelId={adding.sublabelId}
          isrcs={adding.isrcs}
          month={month}
          onClose={() => {
            setAdding(null);
            setChosen({});
          }}
        />
      ) : null}
    </div>
  );
}
