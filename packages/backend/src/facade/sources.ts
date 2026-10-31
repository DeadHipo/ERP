import { RuleViolationError, ValidationError } from '../shared/errors';
import type { FacadeContext } from './context';

export function sourcesApi(ctx: FacadeContext) {
  const { owners, sources, publishing } = ctx;
  const api = {
    ingestBelieve: (input: { path: string; fileName: string; uploadedBy?: string }) =>
      sources.ingestBelieve(input),

    /** Loads a B17 statement and resolves its writers to owners (unknown author -> owner "waiting for documents"). */
    async ingestB17(input: { path: string; fileName: string; generatedAt?: string | null }) {
      const statement = await publishing.ingestB17(input);
      return { statement, writers: api.resolveWriters() };
    },

    /**
     * Writer -> owner: an exact alias of one person-owner is matched; a similar name (same words in another order)
     * goes to the operator ("the same" or "new"); otherwise a new owner without documents is created.
     */
    resolveWriters() {
      const out = { matched: 0, created: 0, ambiguous: 0, external: 0 };
      for (const w of publishing.unmappedWriters()) {
        const exact = owners.findOwnersByWriter(w.displayName);
        if (w.role === 'songwriter') {
          // A listed songwriter is ours only when it is one of our person-owners (by FIO alias or the same words);
          // otherwise it is an external co-writer: never created as an owner, re-checked on the next load.
          const similar = owners
            .findSimilarOwners(w.displayName)
            .filter((x) => owners.ownerKind(x.id) === 'person');
          const candidates =
            exact.length > 0 ? exact : [...new Set(similar.map((x) => owners.resolveOwnerId(x.id)))];
          if (candidates.length === 1) {
            publishing.mapWriter(w.writerNorm, candidates[0] as string, 'matched');
            out.matched++;
          } else if (candidates.length > 1) {
            publishing.markWriterAmbiguous(w.writerNorm);
            out.ambiguous++;
          } else {
            if (w.resolution !== 'external') publishing.markWriterExternal(w.writerNorm);
            out.external++;
          }
          continue;
        }
        if (w.resolution === 'ambiguous') continue;
        if (exact.length === 1) {
          publishing.mapWriter(w.writerNorm, exact[0] as string, 'matched');
          out.matched++;
          continue;
        }
        const similar = owners
          .findSimilarOwners(w.displayName)
          .filter((s) => owners.ownerKind(s.id) === 'person');
        if (exact.length > 1 || similar.length > 0) {
          publishing.markWriterAmbiguous(w.writerNorm);
          out.ambiguous++;
          continue;
        }
        const o = owners.createOwner({ name: w.displayName, kind: 'person', origin: 'publishing' });
        publishing.mapWriter(w.writerNorm, o.id, 'created_waiting_documents');
        out.created++;
      }
      return out;
    },

    /** Operator decision for an ambiguous writer: map to an existing person-owner or create a new owner. */
    mapWriter(writerNorm: string, input: { ownerId?: string | null; createNew?: boolean }) {
      const w = publishing.listWriters().find((x) => x.writerNorm === writerNorm);
      if (!w) throw new ValidationError(`Unknown writer ${writerNorm}`);
      if (input.ownerId) {
        const id = owners.resolveOwnerId(input.ownerId);
        if (owners.ownerKind(id) !== 'person')
          throw new RuleViolationError('Publishing goes only to a person, not to a label', 'owner_is_label');
        owners.addOwnerAlias(id, w.displayName);
        publishing.mapWriter(writerNorm, id, 'manual');
        return owners.getOwner(id);
      }
      if (!input.createNew) throw new ValidationError('Give ownerId or createNew');
      const o = owners.createOwner({ name: w.displayName, kind: 'person', origin: 'publishing' });
      publishing.mapWriter(writerNorm, o.id, 'manual');
      return o;
    },

    /** Contract terms of publishing: only for a person-owner, confirmed by that owner's document. */
    setPublishingTerms(input: {
      ownerId: string;
      percent: string;
      validFrom: string;
      documentId?: string | null;
    }) {
      const id = owners.resolveOwnerId(input.ownerId);
      owners.getOwner(id);
      if (owners.ownerKind(id) !== 'person')
        throw new RuleViolationError('Publishing goes only to a person, not to a label', 'owner_is_label');
      if (input.documentId) {
        const d = owners.getDocument(input.documentId);
        if (d.ownerId && d.ownerId !== id)
          throw new RuleViolationError('The document belongs to another owner', 'document_owner_mismatch');
      }
      return publishing.setTerms({ ...input, ownerId: id });
    },
  };
  return api;
}
