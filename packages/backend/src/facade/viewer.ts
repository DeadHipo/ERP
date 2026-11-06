import { ForbiddenError, NotFoundError } from '../shared/errors';
import type { SettlementsService } from '../modules/settlements';
import type { Modules } from './calculation';
import { labelBook, labelVisibility, type LabelVisibility } from './label-scope';

/**
 * Who reads or writes through the facade (D-171): every own label of the organization (`ALL_VIEWER`: the organization
 * administrator, `AUTH_MODE=off`, support), or only some own labels (a label manager). The facade owns this type and
 * never sees a role: the API adapter (`src/api/viewer.ts`) builds it from the principal of the request. A data-dependent
 * right (the label of a record, the book of an ISRC, the labels a person is visible under) is decided here; the
 * operation's own right (class, label of the request) is decided before the route by `authorize`.
 */
export type Viewer = { readonly kind: 'all' } | { readonly kind: 'labels'; readonly labelIds: readonly string[] };

/** Every label: the answers are those of the facade without a viewer, byte for byte. */
export const ALL_VIEWER: Viewer = Object.freeze({ kind: 'all' as const });

/** A viewer of some own labels (a label manager). */
export function labelsViewer(labelIds: Iterable<string>): Viewer {
  return { kind: 'labels', labelIds: [...new Set(labelIds)].sort() };
}

/** A record whose label may be «any label» (a document, D-169): `null` passes. */
export function viewerSees(viewer: Viewer, labelId: string | null): boolean {
  return viewer.kind === 'all' || labelId === null || viewer.labelIds.includes(labelId);
}

/** A record that sits in a book (an operation, an advertising record): `null` (no label) is seen only by `ALL_VIEWER`. */
export function viewerHolds(viewer: Viewer, labelId: string | null): boolean {
  return viewer.kind === 'all' || (labelId !== null && viewer.labelIds.includes(labelId));
}

/** `403 label_forbidden`: a record of another label. */
export const labelForbidden = () => new ForbiddenError('No access to this label', 'label_forbidden');

/** A write on a record of «any label» or one of the viewer's labels; else `403 label_forbidden`. */
export function assertViewerLabel(viewer: Viewer, labelId: string | null): void {
  if (!viewerSees(viewer, labelId)) throw labelForbidden();
}

/** A write on a record in one of the viewer's books; else `403 label_forbidden`. */
export function assertViewerHolds(viewer: Viewer, labelId: string | null): void {
  if (!viewerHolds(viewer, labelId)) throw labelForbidden();
}

type ScopeModules = Pick<Modules, 'owners' | 'splits' | 'labels' | 'sources' | 'ads' | 'publishing'> & {
  settlements: SettlementsService;
};

/**
 * What a viewer reaches, read once per call (every read is lazy and cached; `ALL_VIEWER` reads nothing):
 * - **the ISRC rule** (`mayTouchIsrc`): an ISRC of the files of the viewer's labels, or one in no loaded Believe file
 *   at all (a new track, no book yet); an ISRC only in other files is another book;
 * - **visibility** (`ownerVisible`, `artistVisible`): the union of `labelVisibility()` of the viewer's labels (D-168);
 *   an owner visible under no own label at all (a new one) is `ownerOrphan`.
 */
export function viewerScope(modules: ScopeModules, viewer: Viewer) {
  const once = <T>(f: () => Promise<T>) => {
    let p: Promise<T> | undefined;
    return () => (p ??= f());
  };
  const labelIds = viewer.kind === 'all' ? [] : viewer.labelIds;
  const books = once(() => Promise.all(labelIds.map((id) => labelBook(modules, id))));
  const ownIsrcs = once(async () => {
    const ids = (await books()).flatMap((b) => b.fileIds);
    return new Set(await modules.sources.isrcsOfFiles(ids));
  });
  const otherIsrcs = once(async () => {
    const own = new Set((await books()).flatMap((b) => b.fileIds));
    const others = (await modules.sources.listFiles()).filter((f) => f.status === 'loaded' && !own.has(f.id)).map((f) => f.id);
    return new Set(await modules.sources.isrcsOfFiles(others));
  });
  const merge = (list: LabelVisibility[]): LabelVisibility => ({
    isrcs: new Set(list.flatMap((v) => [...v.isrcs])),
    artistIds: new Set(list.flatMap((v) => [...v.artistIds])),
    ownerIds: new Set(list.flatMap((v) => [...v.ownerIds])),
  });
  const visibility = once(async () => {
    const list = [];
    for (const b of await books()) list.push(await labelVisibility(modules, b));
    return merge(list);
  });
  const resolver = once(() => modules.owners.ownerResolver());
  const visibleOwners = once(async () => {
    const resolve = await resolver();
    return new Set([...(await visibility()).ownerIds].map(resolve));
  });
  /** The owners visible under any own label of the organization (for `ownerOrphan`). */
  const ownersOfAnyLabel = once(async () => {
    const resolve = await resolver();
    const out = new Set<string>();
    for (const l of await modules.labels.listLabels()) {
      if (l.kind !== 'own') continue;
      for (const id of (await labelVisibility(modules, await labelBook(modules, l.id))).ownerIds) out.add(resolve(id));
    }
    return out;
  });
  const artistIndex = once(() => modules.owners.artistIndex());

  const api = {
    viewer,
    all: viewer.kind === 'all',
    /** The ISRC rule: the viewer may read and write rows on this ISRC (null = no ISRC: passes). */
    async mayTouchIsrc(isrc: string | null | undefined): Promise<boolean> {
      if (viewer.kind === 'all' || !isrc) return true;
      return (await ownIsrcs()).has(isrc) || !(await otherIsrcs()).has(isrc);
    },
    /** A predicate of the ISRC rule for filtering a list (one read). */
    async isrcFilter(): Promise<(isrc: string | null | undefined) => boolean> {
      if (viewer.kind === 'all') return () => true;
      const [own, other] = [await ownIsrcs(), await otherIsrcs()];
      return (isrc) => !isrc || own.has(isrc) || !other.has(isrc);
    },
    async assertIsrc(isrc: string | null | undefined): Promise<void> {
      if (!(await api.mayTouchIsrc(isrc))) throw labelForbidden();
    },
    /** An owner (any id, a merged one resolves) visible under one of the viewer's labels. */
    async ownerVisible(ownerId: string): Promise<boolean> {
      if (viewer.kind === 'all') return true;
      return (await visibleOwners()).has((await resolver())(ownerId));
    },
    /** A visible owner, or one visible under no own label (a new owner); else another label's. */
    async ownerReachable(ownerId: string): Promise<boolean> {
      if (await api.ownerVisible(ownerId)) return true;
      return !(await ownersOfAnyLabel()).has((await resolver())(ownerId));
    },
    /** A pseudonym (any id, a merged one resolves) visible under one of the viewer's labels. */
    async artistVisible(artistId: string): Promise<boolean> {
      if (viewer.kind === 'all') return true;
      const canon = (await artistIndex()).get(artistId)?.id ?? artistId;
      return (await visibility()).artistIds.has(canon);
    },
    /** Filters for lists: the visible owners and pseudonyms (surviving ids); `undefined` = everything. */
    async visibleSets(): Promise<{ ownerIds: Set<string>; artistIds: Set<string> } | undefined> {
      if (viewer.kind === 'all') return undefined;
      return { ownerIds: await visibleOwners(), artistIds: (await visibility()).artistIds };
    },
    /** A read of a record the viewer does not see answers as an unknown id. */
    async assertOwnerVisible(ownerId: string): Promise<void> {
      if (!(await api.ownerVisible(ownerId))) throw new NotFoundError('Owner', ownerId);
    },
    async assertArtistVisible(artistId: string): Promise<void> {
      if (!(await api.artistVisible(artistId))) throw new NotFoundError('Artist', artistId);
    },
  };
  return api;
}

export type ViewerScope = ReturnType<typeof viewerScope>;

/** The ISRCs of the files of the viewer's labels; `'all'` for `ALL_VIEWER`. */
export async function viewerIsrcs(modules: Pick<Modules, 'labels' | 'sources'>, viewer: Viewer): Promise<Set<string> | 'all'> {
  if (viewer.kind === 'all') return 'all';
  const ids: string[] = [];
  for (const l of viewer.labelIds) ids.push(...(await labelBook(modules, l)).fileIds);
  return new Set(await modules.sources.isrcsOfFiles(ids));
}
