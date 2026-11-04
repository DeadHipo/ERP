import { Link } from 'react-router-dom';
import type { ReactNode } from 'react';

export type EntityKind = 'isrc' | 'upc' | 'owner' | 'artist' | 'document' | 'label' | 'ad';

/** The card route of every entity kind (R3: keys only, never a name). */
export function entityPath(kind: EntityKind, key: string): string {
  const k = encodeURIComponent(key);
  switch (kind) {
    case 'ad':
      return `/ads/${k}`;
    case 'isrc':
      return `/tracks/${k}`;
    case 'upc':
      return `/releases/${k}`;
    case 'owner':
      return `/owners/${k}`;
    case 'artist':
      return `/artists/${k}`;
    case 'document':
      return `/documents/${k}`;
    case 'label':
      return `/labels/${k}`;
  }
}

/** A link to an entity card. `label` is the text (name, pseudonym, title); the key is the route. */
export function EntityLink({ kind, id, label }: { kind: EntityKind; id: string; label?: ReactNode }) {
  return (
    <Link to={entityPath(kind, id)} className="text-accent hover:underline" data-entity={`${kind}:${id}`}>
      {label ?? id}
    </Link>
  );
}
