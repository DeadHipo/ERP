import { useMemo } from 'react';
import type { UseQueryResult } from '@tanstack/react-query';
import type { ArtistView, MasterRows, TrackView } from '@erp/shared/api-responses';
import { ArtistLinks } from '../ArtistLinks';
import { QueryView } from '../PageState';
import { TrackName } from '../TrackName';
import { ru } from '../../i18n/ru';
import { SimpleTable, Td } from '../MoneyTable';
import { MoneyCells, NO_UNITS } from './MoneyCells';
import { rowsByIsrc } from './rows';

const t = ru.catalog.release;
const m = ru.catalog.money;

/**
 * The block «by tracks» of the master money (D-253): one row per ISRC with its name, pseudonyms and B, C, ours.
 *
 * - `query` is the block's own money request (`useMasterRows(scope, 'isrc')`): the block has its own states (the long
 *   panel, the error with a retry, the stale badge). The money of a row is the row of the answer with its ISRC; the
 *   footer is `totals` of the same answer, so the footer always belongs to the rows above it. Nothing is added here (R1).
 * - `isrcs` is the list of the page (it may name tracks without units, which have no money row); an ISRC that only
 *   the money answer has is shown too. The order is by ISRC, ascending, as the answer's.
 * - `noUnits` says what a listed track without a money row shows: `zero` = the sums of no units, `dash` = «—».
 * - `tracks` is the directory of the page (`useTracks`): the name of the row and its pseudonyms.
 *
 * Hooks: the table `<prefix>-tracks`, rows `<prefix>-track-<isrc>` with `[data-col="title" | "artists" | "net" | "B" |
 * "C" | "ours"]`, the footer `<prefix>-tracks-total`.
 */
export function TracksMoneyBlock(props: {
  prefix: string;
  query: UseQueryResult<MasterRows, Error>;
  isrcs: readonly string[];
  noUnits: 'zero' | 'dash';
  tracks: { track: (isrc: string) => TrackView | null | undefined; artist: (id: string) => ArtistView | undefined };
}) {
  const { prefix, tracks } = props;
  const rows = props.query.data?.rows;
  const rowOf = useMemo(() => rowsByIsrc(rows), [rows]);
  const isrcs = useMemo(() => [...new Set([...props.isrcs, ...rowOf.keys()])].sort(), [props.isrcs, rowOf]);
  return (
    <QueryView query={props.query} money>
      {(data) => (
        <SimpleTable
          testId={`${prefix}-tracks`}
          headers={[t.cols.title, t.cols.artists, m.net, m.B, m.C, m.ours]}
          footer={
            <tr data-testid={`${prefix}-tracks-total`} className="border-t border-border font-medium">
              <Td colSpan={2}>{m.total}</Td>
              <MoneyCells sums={data.totals} />
            </tr>
          }
        >
          {isrcs.map((isrc) => {
            const track = tracks.track(isrc);
            return (
              <tr key={isrc} data-testid={`${prefix}-track-${isrc}`} className="border-t border-border">
                <Td col="title">
                  <TrackName isrc={isrc} track={track} />
                </Td>
                <Td col="artists">
                  {/* the pseudonyms of the track in the directory's order; nothing until its track arrives */}
                  {track === undefined ? null : <ArtistLinks artists={(track?.artists ?? []).flatMap((id) => tracks.artist(id) ?? [])} />}
                </Td>
                <MoneyCells sums={rowOf.get(isrc)?.sums ?? (props.noUnits === 'zero' ? NO_UNITS : undefined)} />
              </tr>
            );
          })}
        </SimpleTable>
      )}
    </QueryView>
  );
}
