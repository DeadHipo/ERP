import { useState } from 'react';
import { Button } from '@heroui/react';
import { MagnifyingGlassIcon } from '@heroicons/react/24/outline';
import { useQuery } from '@tanstack/react-query';
import { artistQueries } from '../../api/queries/artists';
import { TextField } from '../../components/fields/TextField';
import { fmt, ru } from '../../i18n/ru';
import { formatCount } from '../../lib/money';
import { parseIsrcList } from './scope-text';

const t = ru.money.actions.picker;

/**
 * A list of ISRCs typed or pasted into one field (D-227), with a magnifier that opens the tracks of the pseudonym
 * below the field (`GET /artists/:id`: its registry links, split rows and participations, features included) to tick
 * them. The text stays the one value: a tick adds or removes the ISRC in it, so typing and ticking never disagree.
 * Hooks: `field-<name>`, `action-<name>-pick` (`aria-expanded`), `<name>-picker`, `field-<name>-filter`,
 * `<name>-pick-<isrc>`, `action-<name>-pick-all`, `action-<name>-pick-none`, `<name>-picked` (`data-count`),
 * `action-<name>-pick-done`.
 */
export function IsrcListField(props: {
  name: string;
  label: string;
  value: string;
  onChange: (value: string) => void;
  artistId: string | null;
  pseudonym: string;
  hint?: string;
  isRequired?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [filter, setFilter] = useState('');
  const detail = useQuery({ ...artistQueries.detail(props.artistId ?? ''), enabled: open && props.artistId !== null });
  const chosen = parseIsrcList(props.value);
  const tracks: { isrc: string; title: string; upc: string }[] = [];
  for (const tr of detail.data?.tracks ?? []) {
    const isrc = tr.isrc?.toUpperCase();
    if (isrc && !tracks.some((x) => x.isrc === isrc)) tracks.push({ isrc, title: tr.title, upc: tr.upc ?? '' });
  }
  const needle = filter.trim().toLowerCase();
  const shown = needle
    ? tracks.filter((x) => x.isrc.toLowerCase().includes(needle) || x.title.toLowerCase().includes(needle) || x.upc.includes(needle))
    : tracks;
  const write = (list: string[]) => props.onChange(list.join(', '));
  const toggle = (isrc: string) => write(chosen.includes(isrc) ? chosen.filter((x) => x !== isrc) : [...chosen, isrc]);

  return (
    <div className="flex flex-col gap-1">
      <div className="flex items-end gap-2">
        <div className="flex-1">
          <TextField name={props.name} label={props.label} value={props.value} onChange={props.onChange} isRequired={props.isRequired} />
        </div>
        <Button
          isIconOnly
          variant="secondary"
          aria-label={t.open}
          aria-expanded={open}
          data-testid={`action-${props.name}-pick`}
          isDisabled={props.artistId === null}
          onPress={() => setOpen((o) => !o)}
        >
          <MagnifyingGlassIcon className="size-4" />
        </Button>
      </div>
      {props.hint ? <p className="text-xs text-muted">{props.hint}</p> : null}
      {open ? (
        <div className="flex flex-col gap-2 rounded-lg border border-border p-2" data-testid={`${props.name}-picker`}>
          <div className="text-sm font-medium">{fmt(t.title, { pseudonym: props.pseudonym })}</div>
          {props.artistId === null ? (
            <span className="text-sm text-muted">{t.noArtist}</span>
          ) : detail.isPending ? (
            <span className="text-sm text-muted">{t.loading}</span>
          ) : tracks.length === 0 ? (
            <span className="text-sm text-muted">{t.empty}</span>
          ) : (
            <>
              <TextField name={`${props.name}-filter`} label={t.filter} value={filter} onChange={setFilter} type="search" />
              <div className="flex flex-wrap items-center gap-3 text-xs">
                <button
                  type="button"
                  className="text-accent hover:underline"
                  data-testid={`action-${props.name}-pick-all`}
                  onClick={() => write([...chosen, ...shown.map((x) => x.isrc).filter((x) => !chosen.includes(x))])}
                >
                  {t.all}
                </button>
                <button type="button" className="text-accent hover:underline" data-testid={`action-${props.name}-pick-none`} onClick={() => write([])}>
                  {t.none}
                </button>
                <span className="text-muted" data-testid={`${props.name}-picked`} data-count={chosen.length}>
                  {fmt(t.chosen, { count: formatCount(chosen.length) })}
                </span>
              </div>
              {shown.length === 0 ? (
                <span className="text-sm text-muted">{t.noMatch}</span>
              ) : (
                <div className="max-h-64 overflow-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="text-left text-xs text-muted">
                        <th className="px-2 py-1" />
                        <th className="px-2 py-1">{t.cols.isrc}</th>
                        <th className="px-2 py-1">{t.cols.title}</th>
                        <th className="px-2 py-1">{t.cols.upc}</th>
                      </tr>
                    </thead>
                    <tbody>
                      {shown.map((x) => (
                        <tr key={x.isrc} className="cursor-pointer hover:bg-default" onClick={() => toggle(x.isrc)}>
                          <td className="border-t border-border px-2 py-1">
                            <input
                              type="checkbox"
                              aria-label={x.isrc}
                              data-testid={`${props.name}-pick-${x.isrc}`}
                              checked={chosen.includes(x.isrc)}
                              onClick={(e) => e.stopPropagation()}
                              onChange={() => toggle(x.isrc)}
                            />
                          </td>
                          <td className="border-t border-border px-2 py-1 font-mono text-xs">{x.isrc}</td>
                          <td className="border-t border-border px-2 py-1">{x.title}</td>
                          <td className="border-t border-border px-2 py-1 text-xs text-muted">{x.upc}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </>
          )}
          <div className="flex justify-end">
            <Button size="sm" variant="secondary" data-testid={`action-${props.name}-pick-done`} onPress={() => setOpen(false)}>
              {t.apply}
            </Button>
          </div>
        </div>
      ) : null}
    </div>
  );
}
