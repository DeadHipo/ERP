import { ConflictError } from '../shared/errors';
import { normalizeName } from '../shared/identifiers';
import type { LinksService } from '../modules/links';
import type { PubV2Service } from '../modules/pubv2';
import type { FacadeContext } from './context';

export type RecommendationReason = 'old_map' | 'exact_name' | 'same_words';

/**
 * The links of publishing v2 to owners (D-183). The facade only suggests: the old map of `pub_writers`, then one
 * person-owner with this name or alias, then one with the same words in another order. A link is written only by the
 * operator's confirmation; nothing here is set on its own.
 */
export function pubV2LinksApi(ctx: FacadeContext, m: { pubv2: PubV2Service; links: LinksService }) {
  const { owners, publishing } = ctx;
  const { pubv2, links } = m;

  async function recommend(
    name: string,
    aliases: string[],
    oldMap: Map<string, string | null>,
    isPerson: (id: string) => boolean,
  ): Promise<{ ownerId: string; reason: RecommendationReason } | null> {
    for (const alias of aliases) {
      const mapped = oldMap.get(normalizeName(alias));
      if (mapped) return { ownerId: await owners.resolveOwnerId(mapped), reason: 'old_map' };
    }
    const exact = (await owners.findOwnersByWriter(name)).filter(isPerson);
    if (exact.length === 1) return { ownerId: exact[0] as string, reason: 'exact_name' };
    if (exact.length > 1) return null;
    const similar = await owners.findSimilarOwners(name);
    const ids = [...new Set(await Promise.all(similar.map((o) => owners.resolveOwnerId(o.id))))].filter(isPerson);
    return ids.length === 1 ? { ownerId: ids[0] as string, reason: 'same_words' } : null;
  }

  const context = async () => {
    const all = await owners.listOwners();
    const byId = new Map(all.map((o) => [o.id, o]));
    return {
      byId,
      isPerson: (id: string) => byId.get(id)?.kind === 'person',
      oldMap: new Map((await publishing.listWriters()).map((w) => [w.writerNorm, w.ownerId])),
    };
  };

  return {
    /** Every songwriter with its link and its recommendation: the ones without a link first, largest first. */
    async pubV2Links(labelId?: string) {
      const { byId, isPerson, oldMap } = await context();
      const decided = new Map((await links.songwriterOwners()).map((l) => [l.songwriterId, l]));
      const rows = [];
      for (const w of await pubv2.listSongwriters(labelId)) {
        const link = decided.get(w.id);
        const hint = await recommend(w.name, w.aliases, oldMap, isPerson);
        const linkedOwner = link ? await owners.resolveOwnerId(link.ownerId) : null;
        rows.push({
          songwriterId: w.id,
          name: w.name,
          payable: w.payable,
          link:
            link && linkedOwner
              ? {
                  ownerId: linkedOwner,
                  ownerName: byId.get(linkedOwner)?.name ?? '',
                  source: link.source,
                  decidedBy: link.decidedBy,
                  decidedAt: link.decidedAt,
                }
              : null,
          recommendation: hint ? { ownerId: hint.ownerId, ownerName: byId.get(hint.ownerId)?.name ?? '', reason: hint.reason } : null,
        });
      }
      return [...rows.filter((r) => !r.link), ...rows.filter((r) => r.link)];
    },

    /** The operator's decision: this songwriter is this owner. A publishing owner is a person, never a label. */
    async linkSongwriter(input: { songwriterId: string; ownerId: string }, decidedBy: string) {
      const w = await pubv2.songwriter(input.songwriterId);
      const ownerId = await owners.resolveOwnerId(input.ownerId);
      const owner = await owners.getOwner(ownerId);
      if (owner.kind !== 'person') throw new ConflictError('Publishing goes only to a person, not to a label', 'owner_is_label');
      const { isPerson, oldMap } = await context();
      const hint = await recommend(w.name, w.aliases, oldMap, isPerson);
      const row = await links.setSongwriterOwner({
        songwriterId: w.id,
        ownerId,
        source: hint?.ownerId === ownerId ? 'recommended' : 'manual',
        decidedBy,
      });
      return { ...row, ownerName: owner.name };
    },
  };
}
