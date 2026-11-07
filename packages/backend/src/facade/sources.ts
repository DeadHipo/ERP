import { ConflictError, NotFoundError, RuleViolationError, ValidationError } from '../shared/errors';
import { parseBelieveFileName, type LinesQuery } from '../modules/sources';
import type { FacadeContext } from './context';
import { ALL_VIEWER, assertViewerHolds, type Viewer } from './viewer';

/** A Believe file or a B17 statement is loaded under an own label (D-169): `?label=` of the upload. */
const LABEL_REQUIRED = 'Choose a label: a file is loaded under an own label (label=)';

export function sourcesApi(ctx: FacadeContext) {
  const { db, owners, labels, sources, publishing, assertOwnLabel } = ctx;
  /** D-189: with the source v2 the old module takes no writes: they would not reach the money. */
  const oldPublishingClosed = () => {
    if (ctx.config.publishingSource === 'v2')
      throw new ConflictError('Publishing v2 is the source of the money: load and link on /publishing-v2', 'publishing_v2_active');
  };
  /** Keeps the person-owners of a list (publishing never goes to a label). */
  async function personsOnly<T extends { id: string }>(list: T[]): Promise<T[]> {
    const kinds = await Promise.all(list.map((x) => owners.ownerKind(x.id)));
    return list.filter((_, i) => kinds[i] === 'person');
  }
  const api = {
    /**
     * The label of an upload (D-169): 400 `label_required` without one, 404 for an unknown id, 400 `label_not_own` for
     * a sublabel. The upload routes call it before the body is received.
     */
    async assertUploadLabel(labelId: string | undefined) {
      if (!labelId) throw new ValidationError(LABEL_REQUIRED, undefined, 'label_required');
      return assertOwnLabel(labelId);
    },

    /**
     * Loads a Believe report under an own label (D-169). Refused before the module's serial load (no registry row, no
     * ClickHouse rows): the label, the file name, then the account of the file name must be registered under that
     * label (422 `account_unregistered`, `account_of_other_label`). The module's own order follows: `duplicate_period`,
     * sha256, `duplicate_file`.
     */
    async ingestBelieve(input: { path: string; fileName: string; uploadedBy?: string }, labelId: string | undefined) {
      const label = await api.assertUploadLabel(labelId);
      const { account } = parseBelieveFileName(input.fileName);
      const index = await labels.index();
      const registered = index.labelOfAccount(account);
      if (!registered)
        throw new RuleViolationError(
          `Believe account ${account} is not registered under any label: register it on the label page and repeat`,
          'account_unregistered',
          { account },
        );
      if (registered !== label.id) {
        const labelName = index.labelName(registered) ?? registered;
        throw new RuleViolationError(
          `Believe account ${account} belongs to label ${labelName}`,
          'account_of_other_label',
          { account, labelId: registered, labelName },
        );
      }
      return sources.ingestBelieve({ ...input, labelId: label.id });
    },

    /**
     * Loads a B17 statement under an own label (D-169) and resolves its writers to owners (unknown author -> owner
     * "waiting for documents").
     */
    async ingestB17(
      input: { path: string; fileName: string; generatedAt?: string | null },
      labelId: string | undefined,
    ) {
      oldPublishingClosed();
      const label = await api.assertUploadLabel(labelId);
      const statement = await publishing.ingestB17({ ...input, labelId: label.id });
      return { statement, writers: await api.resolveWriters() };
    },

    /**
     * Replaces a loaded B17 statement of an own label by a corrected file of the same quarters (D-173) and resolves the
     * writers like `ingestB17`; the module refuses `replace_not_loaded`, `replace_label_differs`, `periods_differ`,
     * `duplicate_file`. The old statement stays `superseded` with its lines (the payout snapshots reference its sha).
     */
    async replaceB17(
      oldId: string,
      input: { path: string; fileName: string; generatedAt?: string | null },
      labelId: string | undefined,
      viewer: Viewer = ALL_VIEWER,
    ) {
      oldPublishingClosed();
      const label = await api.assertUploadLabel(labelId);
      assertViewerHolds(viewer, label.id);
      const { superseded, statement } = await publishing.replaceStatement(oldId, input, label.id);
      return { superseded, statement, writers: await api.resolveWriters() };
    },

    /**
     * The Believe files (without the server path) and the B17 statements, each with its label (D-169); under a label
     * only those loaded under it.
     */
    async sourceFiles(labelId?: string) {
      if (labelId !== undefined) await assertOwnLabel(labelId);
      const [files, statements] = await Promise.all([
        sources.listFiles(labelId === undefined ? {} : { labelId }),
        publishing.listStatements(),
      ]);
      return {
        believe: files.map(({ storedPath: _p, ...f }) => f),
        b17: labelId === undefined ? statements : statements.filter((s) => s.labelId === labelId),
      };
    },

    /** The lines of the Believe reports; under a label over the files of that label only (D-169). */
    async sourceLines(query: LinesQuery) {
      if (query.labelId !== undefined) await assertOwnLabel(query.labelId);
      return sources.lines(query);
    },

    /** The values of the filters of the lines page; under a label over the files of that label only (D-169). */
    async sourceFacets(query: { fileIds?: string[]; labelId?: string }) {
      if (query.labelId !== undefined) await assertOwnLabel(query.labelId);
      return sources.linesFacets(query.fileIds, query.labelId);
    },

    /**
     * Removes a Believe account from an own label (D-169), only while the account has no file being loaded or loaded:
     * 404 when the account is not registered under that label, 409 `account_has_files` otherwise.
     */
    removeLabelAccount(labelId: string, account: string) {
      return db.transaction(async () => {
        await labels.getLabel(labelId);
        const registered = (await labels.listAccounts()).find((a) => a.account === account);
        if (!registered || registered.labelId !== labelId) throw new NotFoundError(`Believe account of label ${labelId}`, account);
        const files = await sources.activeFilesOfAccount(account);
        if (files.length > 0)
          throw new ConflictError(
            `Believe account ${account} has ${files.length} file(s) loaded or being loaded: it cannot be removed`,
            'account_has_files',
            { account, files: files.length },
          );
        return labels.removeAccount(labelId, account);
      });
    },

    /**
     * Writer -> owner: an exact alias of one person-owner is matched; a similar name (same words in another order)
     * goes to the operator ("the same" or "new"); otherwise a new owner without documents is created.
     */
    async resolveWriters() {
      oldPublishingClosed();
      return await db.transaction(async () => {
        const out = { matched: 0, created: 0, ambiguous: 0, external: 0 };
        for (const w of await publishing.unmappedWriters()) {
          const exact = await owners.findOwnersByWriter(w.displayName);
          if (w.role === 'songwriter') {
            // A listed songwriter is ours only when it is one of our person-owners (by FIO alias or the same words);
            // otherwise it is an external co-writer: never created as an owner, re-checked on the next load.
            const similar = await personsOnly(await owners.findSimilarOwners(w.displayName));
            const candidates =
              exact.length > 0
                ? exact
                : [...new Set(await Promise.all(similar.map((x) => owners.resolveOwnerId(x.id))))];
            if (candidates.length === 1) {
              await publishing.mapWriter(w.writerNorm, candidates[0] as string, 'matched');
              out.matched++;
            } else if (candidates.length > 1) {
              await publishing.markWriterAmbiguous(w.writerNorm);
              out.ambiguous++;
            } else {
              if (w.resolution !== 'external') await publishing.markWriterExternal(w.writerNorm);
              out.external++;
            }
            continue;
          }
          if (w.resolution === 'ambiguous') continue;
          if (exact.length === 1) {
            await publishing.mapWriter(w.writerNorm, exact[0] as string, 'matched');
            out.matched++;
            continue;
          }
          const similar = await personsOnly(await owners.findSimilarOwners(w.displayName));
          if (exact.length > 1 || similar.length > 0) {
            await publishing.markWriterAmbiguous(w.writerNorm);
            out.ambiguous++;
            continue;
          }
          const o = await owners.createOwner({ name: w.displayName, kind: 'person', origin: 'publishing' });
          await publishing.mapWriter(w.writerNorm, o.id, 'created_waiting_documents');
          out.created++;
        }
        return out;
      });
    },

    /** Operator decision for an ambiguous writer: map to an existing person-owner or create a new owner. */
    async mapWriter(writerNorm: string, input: { ownerId?: string | null; createNew?: boolean }) {
      oldPublishingClosed();
      return await db.transaction(async () => {
        const w = (await publishing.listWriters()).find((x) => x.writerNorm === writerNorm);
        if (!w) throw new ValidationError(`Unknown writer ${writerNorm}`);
        if (input.ownerId) {
          const id = await owners.resolveOwnerId(input.ownerId);
          if ((await owners.ownerKind(id)) !== 'person')
            throw new RuleViolationError(
              'Publishing goes only to a person, not to a label',
              'owner_is_label',
            );
          await owners.addOwnerAlias(id, w.displayName);
          await publishing.mapWriter(writerNorm, id, 'manual');
          return owners.getOwner(id);
        }
        if (!input.createNew) throw new ValidationError('Give ownerId or createNew');
        const o = await owners.createOwner({ name: w.displayName, kind: 'person', origin: 'publishing' });
        await publishing.mapWriter(writerNorm, o.id, 'manual');
        return o;
      });
    },

    /** Contract terms of publishing: only for a person-owner, confirmed by that owner's document. */
    async setPublishingTerms(input: {
      ownerId: string;
      percent: string;
      validFrom: string;
      documentId?: string | null;
      operationType?: string | null;
    }) {
      oldPublishingClosed();
      return await db.transaction(async () => {
        const id = await owners.resolveOwnerId(input.ownerId);
        await owners.getOwner(id);
        if ((await owners.ownerKind(id)) !== 'person')
          throw new RuleViolationError('Publishing goes only to a person, not to a label', 'owner_is_label');
        if (input.documentId) {
          const d = await owners.getDocument(input.documentId);
          if (d.ownerId && d.ownerId !== id)
            throw new RuleViolationError('The document belongs to another owner', 'document_owner_mismatch');
        }
        return publishing.setTerms({ ...input, ownerId: id });
      });
    },
  };
  return api;
}
