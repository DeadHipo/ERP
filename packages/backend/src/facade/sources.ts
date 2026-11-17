import { ConflictError, NotFoundError, RuleViolationError, ValidationError } from '../shared/errors';
import { parseBelieveFileName, type LinesQuery } from '../modules/sources';
import type { FacadeContext } from './context';

/** A Believe file or a B17 statement is loaded under an own label (D-169): `?label=` of the upload. */
const LABEL_REQUIRED = 'Choose a label: a file is loaded under an own label (label=)';

export function sourcesApi(ctx: FacadeContext) {
  const { db, labels, sources, publishing, assertOwnLabel } = ctx;
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
  };
  return api;
}
