import type { RecordActionInput } from '../modules/audit';
import type { FacadeContext } from './context';

/** The operator's trail (D-140): the API hook records every successful write, the entity pages read it. */
export function auditApi(ctx: FacadeContext) {
  const { audit, assertOwnLabel } = ctx;
  /** `?label=` must be an own label; the filter is strictly `label_id = L` (rows without a label only without it, D-169). */
  const checked = async (labelId: string | undefined) => {
    if (labelId !== undefined) await assertOwnLabel(labelId);
    return labelId;
  };
  return {
    recordAction: (input: RecordActionInput) => audit.record(input),
    auditOf: async (entityId: string, limit = 50, labelId?: string) =>
      audit.listByEntity(entityId, limit, await checked(labelId)),
    recentActions: async (limit = 50, labelId?: string) => audit.listRecent(limit, await checked(labelId)),
  };
}
