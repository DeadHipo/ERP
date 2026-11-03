import { ValidationError } from '../../shared/errors';
import { newId } from '../../shared/identifiers';
import type { Db } from '../../shared/pg-db';
import { createAuditRepository, type ActionRow } from './repository';

export interface AuditAction {
  id: string;
  at: string;
  operator: string;
  method: string;
  route: string;
  entityIds: string[];
  summary: Record<string, unknown>;
}

export interface RecordActionInput {
  operator: string;
  method: string;
  /** The route template (`/documents/:id/approve`), never the concrete path. */
  route: string;
  entityIds: string[];
  /** Ids, amounts and dates only: never names or free text. */
  summary: Record<string, unknown>;
}

const view = (r: ActionRow): AuditAction => ({
  id: r.id,
  at: r.at,
  operator: r.operator,
  method: r.method,
  route: r.route,
  entityIds: r.entityIds,
  summary: r.summary,
});

const clampLimit = (limit: number) => Math.min(Math.max(limit || 50, 1), 500);

export function createAuditService(db: Db) {
  const repo = createAuditRepository(db);
  return {
    async record(input: RecordActionInput): Promise<AuditAction> {
      const operator = input.operator.trim();
      if (!operator) throw new ValidationError('Operator is empty', undefined, 'operator_required');
      const row = await repo.insert({
        id: newId(),
        operator,
        method: input.method.toUpperCase(),
        route: input.route,
        entityIds: [...new Set(input.entityIds)],
        summary: input.summary,
      });
      return view(row);
    },
    async listByEntity(entityId: string, limit = 50): Promise<AuditAction[]> {
      return (await repo.byEntity(entityId, clampLimit(limit))).map(view);
    },
    async listRecent(limit = 50): Promise<AuditAction[]> {
      return (await repo.recent(clampLimit(limit))).map(view);
    },
  };
}

export type AuditService = ReturnType<typeof createAuditService>;
