import { ValidationError } from '../shared/errors';
import type { SettlementsService } from '../modules/settlements';
import type { Modules } from './calculation';

/**
 * The label as a book (D-168, D-169). The book of an own label L is the set of the `loaded` Believe files loaded under L
 * (`source_files.label_id = L`, R6): the money of a unit sits in the book of its file, whatever its label string says
 * (the string still decides the sublabel rule and «ours / label_unmapped»). A read under L narrows the units to those
 * files (`SnapshotFilter.labelIds`, over the unit scope of D-161), and the reference lists to the ISRCs of those files.
 */
export interface LabelBook {
  id: string;
  name: string;
  /** The loaded Believe files loaded under the label. */
  fileIds: string[];
}

/** The book of an own label; 404 for an unknown id, 400 `label_not_own` for a sublabel. */
export async function labelBook(modules: Pick<Modules, 'labels' | 'sources'>, labelId: string): Promise<LabelBook> {
  const { labels, sources } = modules;
  const l = await labels.getLabel(labelId);
  if (l.kind !== 'own')
    throw new ValidationError(`Label "${l.name}" is a sublabel; a label view takes an own label`, { labelId }, 'label_not_own');
  return { id: l.id, name: l.name, fileIds: (await sources.filesOfLabel(l.id)).map((f) => f.id) };
}

/** The ISRCs of the label's files (the catalog of the label). */
export async function labelIsrcs(modules: Pick<Modules, 'sources'>, book: LabelBook): Promise<string[]> {
  return modules.sources.isrcsOfFiles(book.fileIds);
}

export interface LabelVisibility {
  isrcs: Set<string>;
  /** Surviving ids of the pseudonyms visible under the label. */
  artistIds: Set<string>;
  ownerIds: Set<string>;
}

/**
 * Who is visible under a label (D-168, derived, never stored): a pseudonym that has a split row or a participation on
 * an ISRC of the label's files (D-169), is the recipient of a sublabel rule of the label, or carries an operation or an advertising
 * record under it; an owner whose pseudonym is visible, or that carries an operation under the label. An advertising
 * record paid by the label (D-169, R9) makes visible its pseudonym and the split rows of its ISRC (a superset of the
 * pseudonyms it charges), even when the ISRC is in another label's files.
 */
export async function labelVisibility(
  modules: Pick<Modules, 'owners' | 'splits' | 'labels' | 'sources' | 'ads'> & { settlements: SettlementsService },
  book: LabelBook,
): Promise<LabelVisibility> {
  const { owners, splits, labels, ads, settlements } = modules;
  const isrcs = new Set(await labelIsrcs(modules, book));
  const idx = await owners.artistIndex();
  const canon = (id: string) => idx.get(id)?.id ?? id;
  const artistIds = new Set<string>();
  const paid = await ads.list({ active: true, labelId: book.id });
  const adIsrcs = new Set(paid.map((ad) => ad.isrc).filter((x): x is string => x !== null));
  for (const s of await splits.listSplits())
    if (isrcs.has(s.isrc) || adIsrcs.has(s.isrc)) for (const sh of s.shares) artistIds.add(canon(sh.artistId));
  for (const p of await splits.listParticipations()) {
    if (!isrcs.has(p.isrc)) continue;
    artistIds.add(canon(p.artistId));
    if (p.fromArtistId !== null) artistIds.add(canon(p.fromArtistId));
  }
  for (const l of await labels.listLabels())
    if (l.ownLabelId === book.id) for (const r of l.rules) artistIds.add(canon(r.recipientArtistId));
  for (const ad of paid) if (ad.artistId) artistIds.add(canon(ad.artistId));
  const ownerIds = new Set<string>();
  for (const o of await settlements.listOperations({ labelId: book.id, active: true })) {
    if (o.artistId) artistIds.add(canon(o.artistId));
    if (o.ownerId) ownerIds.add(o.ownerId);
  }
  for (const id of artistIds) {
    const owner = idx.get(id)?.ownerId;
    if (owner) ownerIds.add(owner);
  }
  return { isrcs, artistIds, ownerIds };
}
