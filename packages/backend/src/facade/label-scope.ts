import { ValidationError } from '../shared/errors';
import { normalizeLabelString } from '../modules/labels';
import type { SettlementsService } from '../modules/settlements';
import type { Modules } from './calculation';

/**
 * The label as a book (D-168). An own label L is seen in the data at one place only: the label string of a Believe
 * unit (string → alias → L, or → a sublabel whose `own_label_id` is L). The book of L is therefore the set of raw label
 * strings of the loaded files that normalise to an alias of L or of one of its sublabels; a read under L narrows the
 * units to those strings (`SnapshotFilter.labelStrings`, over the unit scope of D-161), and the reference lists to the
 * ISRCs that carry them.
 */
export interface LabelBook {
  id: string;
  name: string;
  /** The raw label strings of the loaded files that belong to the label (its aliases and its sublabels' aliases). */
  labelStrings: string[];
}

/** The book of an own label; 404 for an unknown id, 400 `label_not_own` for a sublabel. */
export async function labelBook(modules: Pick<Modules, 'labels' | 'sources'>, labelId: string): Promise<LabelBook> {
  const { labels, sources } = modules;
  const l = await labels.getLabel(labelId);
  if (l.kind !== 'own')
    throw new ValidationError(`Label "${l.name}" is a sublabel; a label view takes an own label`, { labelId }, 'label_not_own');
  const aliases = (await labels.listLabels())
    .filter((x) => x.id === l.id || x.ownLabelId === l.id)
    .flatMap((x) => x.aliases.map(normalizeLabelString));
  return { id: l.id, name: l.name, labelStrings: await sources.labelStringsOfAliases(aliases, normalizeLabelString) };
}

/** The ISRCs whose units carry one of the label's strings (the catalog of the label). */
export async function labelIsrcs(modules: Pick<Modules, 'sources'>, book: LabelBook): Promise<string[]> {
  return modules.sources.isrcsOfLabelStrings(book.labelStrings);
}

export interface LabelVisibility {
  isrcs: Set<string>;
  /** Surviving ids of the pseudonyms visible under the label. */
  artistIds: Set<string>;
  ownerIds: Set<string>;
}

/**
 * Who is visible under a label (D-168, derived, never stored): a pseudonym that has a split row or a participation on
 * an ISRC of the label, is the recipient of a sublabel rule of the label, or carries an operation or an advertising
 * record under it; an owner whose pseudonym is visible, or that carries an operation under the label.
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
  for (const s of await splits.listSplits()) if (isrcs.has(s.isrc)) for (const sh of s.shares) artistIds.add(canon(sh.artistId));
  for (const p of await splits.listParticipations()) {
    if (!isrcs.has(p.isrc)) continue;
    artistIds.add(canon(p.artistId));
    if (p.fromArtistId !== null) artistIds.add(canon(p.fromArtistId));
  }
  for (const l of await labels.listLabels())
    if (l.ownLabelId === book.id) for (const r of l.rules) artistIds.add(canon(r.recipientArtistId));
  for (const ad of await ads.list({ active: true })) if (ad.labelId === book.id && ad.artistId) artistIds.add(canon(ad.artistId));
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
