import type { ArtistRef } from '@erp/shared/api-responses';
import { EntityLink } from './EntityLink';
import { ru } from '../i18n/ru';

/**
 * The pseudonyms of a catalog row (D-166), each a link to P12: the registry pseudonyms the backend found on the ISRC
 * (split rows, participations, registry links; merged ids already resolved). When the registry names none, the
 * artist string of the report (`reportName`) is shown as muted text with the hint «нет в реестре»: it is a text of
 * the Believe pair, never matched here (R1). Hooks: `artist-links`, `artist-link-<id>`, `artist-unregistered`.
 */
export function ArtistLinks(props: { artists: readonly ArtistRef[]; reportName?: string; className?: string }) {
  const t = ru.common.artistLinks;
  if (props.artists.length === 0) {
    const name = props.reportName?.trim() ?? '';
    return name === '' ? (
      <span data-testid="artist-links" data-empty="true">
        —
      </span>
    ) : (
      <span data-testid="artist-links" className={props.className}>
        <span data-testid="artist-unregistered" className="text-muted" title={t.notInRegistry}>
          {name}
        </span>
      </span>
    );
  }
  return (
    <span data-testid="artist-links" className={props.className}>
      {props.artists.map((a, i) => (
        <span key={a.id} data-testid={`artist-link-${a.id}`}>
          {i > 0 ? ', ' : ''}
          <EntityLink kind="artist" id={a.id} label={a.pseudonym} />
        </span>
      ))}
    </span>
  );
}

/** The text of the column (the grid filter and sort, the quick search): the pseudonyms, else the report string. */
export const artistsText = (artists: readonly ArtistRef[], reportName?: string) =>
  artists.length > 0 ? artists.map((a) => a.pseudonym).join(', ') : (reportName ?? '');
