import type { RecordActionInput } from '../modules/audit';
import type { FacadeContext } from './context';

/** The operator's trail (D-140): the API hook records every successful write, the entity pages read it. */
export function auditApi(ctx: FacadeContext) {
  const { audit } = ctx;
  return {
    recordAction: (input: RecordActionInput) => audit.record(input),
    auditOf: (entityId: string, limit = 50) => audit.listByEntity(entityId, limit),
    recentActions: (limit = 50) => audit.listRecent(limit),
  };
}
