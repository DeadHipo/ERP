import { TrackName } from '../../../components/TrackName';
import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { sublabelQueries } from '../../../api/queries/sublabels';
import { useTracks } from '../../../api/queries/tracks';
import { ActionButton } from '../../../components/ActionButton';
import { Money } from '../../../components/Money';
import { QueryView } from '../../../components/PageState';
import { fmt, ru } from '../../../i18n/ru';
import { formatCount } from '../../../lib/money';
import { SimpleTable, Td } from '../../../components/MoneyTable';
import { AddTermsDialog } from './dialogs';

const t = ru.sublabels;

const span = (from: string, to: string) => (from === to ? from : `${from} — ${to}`);

/**
 * «Подсказки» (D-219, D-224): over every loaded month, the tracks under a sublabel's Believe string in months no term
 * covers, with the strings and their months. «Добавить отмеченные» starts each track from its first such month. A
 * hint, never money. The name of a track (title, version, cover) comes from the track directory (`useTracks`,
 * D-256), asked for the tracks of the shown groups.
 */
export function SuggestionsTab() {
  const [chosen, setChosen] = useState<Record<string, Set<string>>>({});
  const [adding, setAdding] = useState<{ sublabelId: string; items: string[] } | null>(null);
  const query = useQuery(sublabelQueries.suggestions(''));
  const isrcs = useMemo(() => (query.data?.groups ?? []).flatMap((g) => g.items.map((x) => x.isrc)), [query.data]);
  const { track } = useTracks(isrcs);
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
      <QueryView query={query} isEmpty={(d) => d.groups.length === 0} emptyMessage={t.suggestionsEmpty}>
        {(d) => (
          <div className="flex flex-col gap-6">
            {d.groups.map((g) => {
              const picked = chosen[g.sublabelId] ?? new Set<string>();
              const all = g.items.length > 0 && picked.size === g.items.length;
              return (
                <section key={g.sublabelId} data-testid={`suggestion-group-${g.sublabelId}`} className="flex flex-col gap-2">
                  <div className="flex flex-wrap items-center gap-3">
                    <h2 className="text-sm font-medium">
                      <Link className="text-accent hover:underline" to={`/sublabels/${g.sublabelId}`}>
                        {g.sublabelName}
                      </Link>{' '}
                      · {fmt(t.suggestionsCount, { n: formatCount(g.items.length) })} · <Money value={g.net} />
                    </h2>
                    <ActionButton
                      name="add-suggestions"
                      op="POST /sublabels/:id/terms"
                      isDisabled={picked.size === 0}
                      reason={t.selectFirst}
                      onPress={() =>
                        setAdding({
                          sublabelId: g.sublabelId,
                          items: g.items.filter((x) => picked.has(x.isrc)).map((x) => `${x.isrc};;${x.from}`),
                        })
                      }
                    >
                      {t.addSelected}
                    </ActionButton>
                  </div>
                  <SimpleTable headers={['', t.cols.title, t.cols.labelString, t.cols.uncovered, t.cols.monthsCount, t.cols.net]}>
                    <tr>
                      <Td>
                        <input
                          type="checkbox"
                          aria-label={t.pickAll}
                          data-testid={`suggestion-pick-all-${g.sublabelId}`}
                          checked={all}
                          onChange={() => setChosen((c) => ({ ...c, [g.sublabelId]: all ? new Set() : new Set(g.items.map((x) => x.isrc)) }))}
                        />
                      </Td>
                      <Td colSpan={5} className="text-xs text-muted">
                        {t.pickAll}
                      </Td>
                    </tr>
                    {g.items.map((x) => (
                      <tr key={x.isrc} data-testid={`suggestion-${x.isrc}`} data-from={x.from} data-to={x.to}>
                        <Td>
                          <input type="checkbox" data-testid={`suggestion-pick-${x.isrc}`} checked={picked.has(x.isrc)} onChange={() => toggle(g.sublabelId, x.isrc)} />
                        </Td>
                        <Td col="title">
                          <TrackName isrc={x.isrc} track={track(x.isrc)} />
                        </Td>
                        <Td col="labelStrings">
                          {x.labelStrings.map((l) => (
                            <div key={l.labelString}>
                              {l.labelString} <span className="text-muted">({span(l.from, l.to)})</span>
                            </div>
                          ))}
                        </Td>
                        <Td col="span">{span(x.from, x.to)}</Td>
                        <Td col="months">{formatCount(x.months)}</Td>
                        <Td col="net">
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
      {adding ? (
        <AddTermsDialog
          sublabelId={adding.sublabelId}
          isrcs={adding.items}
          month={adding.items.map((x) => x.split(';')[2] ?? '').sort()[0]}
          onClose={() => {
            setAdding(null);
            setChosen({});
          }}
        />
      ) : null}
    </div>
  );
}
