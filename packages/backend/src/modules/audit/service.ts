import { ValidationError } from '../../shared/errors';
import { newId } from '../../shared/identifiers';
import type { Db } from '../../shared/pg-db';
import type { OrgScope } from '../../shared/org-scope';
import { createAuditRepository, type ActionRow } from './repository';

export interface AuditAction {
  id: string;
  at: string;
  operator: string;
  method: string;
  route: string;
  entityIds: string[];
  summary: Record<string, unknown>;
  /** The own label of the write (D-169); null = none. History is never back-filled. */
  labelId: string | null;
}

export interface RecordActionInput {
  operator: string;
  method: string;
  /** The route template (`/documents/:id/approve`), never the concrete path. */
  route: string;
  entityIds: string[];
  /** Ids, amounts and dates only: never names or free text. */
  summary: Record<string, unknown>;
  /** The own label of the write (D-169); the module stores it as given. */
  labelId?: string | null;
}

const view = (r: ActionRow): AuditAction => ({
  id: r.id,
  at: r.at,
  operator: r.operator,
  method: r.method,
  route: r.route,
  entityIds: r.entityIds,
  summary: r.summary,
  labelId: r.labelId,
});

const clampLimit = (limit: number) => Math.min(Math.max(limit || 50, 1), 500);

export function createAuditService(db: Db, org: OrgScope) {
  const repo = createAuditRepository(db, org);
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
        labelId: input.labelId ?? null,
      });
      return view(row);
    },
    /** With `labelId`: only the rows recorded under that label (strictly `label_id = L`). */
    async listByEntity(entityId: string, limit = 50, labelId?: string): Promise<AuditAction[]> {
      return (await repo.byEntity(entityId, clampLimit(limit), labelId)).map(view);
    },
    async listRecent(limit = 50, labelId?: string): Promise<AuditAction[]> {
      return (await repo.recent(clampLimit(limit), labelId)).map(view);
    },
    /**
     * The operations relabelled by the operator (D-173): one entry per operation with at least one row of
     * `PATCH /settlements/operations/:id`, with every label it was moved from (`fromLabelId` of the summary; the rows
     * before D-173 have none).
     */
    async relabelledOperations(): Promise<{ operationId: string; fromLabelIds: string[] }[]> {
      const byId = new Map<string, Set<string>>();
      for (const summary of await repo.summariesOf('PATCH', '/settlements/operations/:id')) {
        const params = summary.params as Record<string, unknown> | undefined;
        const body = summary.body as Record<string, unknown> | undefined;
        const id = params?.id;
        if (typeof id !== 'string' || !id) continue;
        const from = byId.get(id) ?? new Set<string>();
        if (typeof body?.fromLabelId === 'string' && body.fromLabelId) from.add(body.fromLabelId);
        byId.set(id, from);
      }
      return [...byId.entries()].map(([operationId, from]) => ({ operationId, fromLabelIds: [...from].sort() }));
    },
  };
}

export type AuditService = ReturnType<typeof createAuditService>;
