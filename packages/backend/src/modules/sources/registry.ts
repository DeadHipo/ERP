import type pg from 'pg';
import { ConflictError, NotFoundError } from '../../shared/errors';
import { Decimal } from '../../shared/money';
import { orgQuery, type OrgScope } from '../../shared/org-scope';

/** One row of source_files (migrations/postgres/0001_source_files.sql). Months are 'YYYY-MM', money is exact text. */
export interface SourceFileRecord {
  id: string;
  source: string;
  account: string;
  reportingMonth: string;
  reportId: string | null;
  fileName: string;
  storedPath: string;
  sha256: string;
  status: 'loading' | 'loaded' | 'failed' | 'superseded';
  lineCount: number | null;
  netTotal: string | null;
  grossTotal: string | null;
  uploadedBy: string;
  /** The own label the file was loaded under (D-169): opaque text here, the facade checks it; null = before the labels. */
  labelId: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface NewSourceFile {
  id: string;
  source: string;
  account: string;
  reportingMonth: string;
  reportId: string | null;
  fileName: string;
  storedPath: string;
  sha256: string;
  uploadedBy: string;
  labelId: string | null;
}

const COLUMNS = `id, source, account, to_char(reporting_month, 'YYYY-MM') AS reporting_month, report_id, file_name,
  stored_path, sha256, status, line_count::text AS line_count, net_total::text AS net_total,
  gross_total::text AS gross_total, uploaded_by, label_id, created_at, updated_at`;

interface Row {
  id: string;
  source: string;
  account: string;
  reporting_month: string;
  report_id: string | null;
  file_name: string;
  stored_path: string;
  sha256: string;
  status: SourceFileRecord['status'];
  line_count: string | null;
  net_total: string | null;
  gross_total: string | null;
  uploaded_by: string;
  label_id: string | null;
  created_at: string;
  updated_at: string;
}

/** PostgreSQL pads numeric(38,12) with zeros; the application shows money without them. */
const canonical = (v: string | null): string | null => (v === null ? null : new Decimal(v).toFixed());

const record = (r: Row): SourceFileRecord => ({
  id: r.id,
  source: r.source,
  account: r.account,
  reportingMonth: r.reporting_month,
  reportId: r.report_id,
  fileName: r.file_name,
  storedPath: r.stored_path,
  sha256: r.sha256,
  status: r.status,
  lineCount: r.line_count === null ? null : Number(r.line_count),
  netTotal: canonical(r.net_total),
  grossTotal: canonical(r.gross_total),
  uploadedBy: r.uploaded_by,
  labelId: r.label_id,
  createdAt: r.created_at,
  updatedAt: r.updated_at,
});

/**
 * All SQL of the file registry in PostgreSQL. Only `loading` and `loaded` files are "active": the unique indexes of
 * the migration apply to them, so a failed or replaced file never blocks a new upload. Every statement is of the
 * organization `org` (`$1`, D-170): its keys (`source_files_scope`, `source_files_sha`) are per organization (0016),
 * and `loaded()` gives only its files, so every ClickHouse read of the organization starts from them.
 */
export function createSourceFilesRegistry(pool: pg.Pool, org: OrgScope) {
  const q = orgQuery({ query: (text, values) => pool.query(text, values) }, org);
  const one = async (sql: string, params: unknown[]): Promise<SourceFileRecord | null> => {
    const { rows } = await q<Row>(sql, params);
    return rows[0] ? record(rows[0]) : null;
  };

  return {
    /** The organization of this registry (opaque here, D-170). */
    orgId: org.id,
    activeByScope: (source: string, account: string, reportingMonth: string) =>
      one(
        `SELECT ${COLUMNS} FROM source_files
         WHERE org_id = $1 AND source = $2 AND account = $3 AND reporting_month = ($4 || '-01')::date
           AND status IN ('loading', 'loaded')`,
        [source, account, reportingMonth],
      ),

    activeBySha: (sha256: string) =>
      one(
        `SELECT ${COLUMNS} FROM source_files WHERE org_id = $1 AND sha256 = $2 AND status IN ('loading', 'loaded')`,
        [sha256],
      ),

    /** Creates the `loading` row. A race with another upload ends on the unique indexes and becomes a 409. */
    async insertLoading(f: NewSourceFile): Promise<SourceFileRecord> {
      try {
        const { rows } = await q<Row>(
          `INSERT INTO source_files (org_id, id, source, account, reporting_month, report_id, file_name, stored_path, sha256, uploaded_by, label_id)
           VALUES ($1, $2, $3, $4, ($5 || '-01')::date, $6, $7, $8, $9, $10, $11) RETURNING ${COLUMNS}`,
          [
            f.id,
            f.source,
            f.account,
            f.reportingMonth,
            f.reportId,
            f.fileName,
            f.storedPath,
            f.sha256,
            f.uploadedBy,
            f.labelId,
          ],
        );
        return record(rows[0] as Row);
      } catch (e) {
        const err = e as { code?: string; constraint?: string };
        if (err.code === '23505' && err.constraint === 'source_files_scope')
          throw new ConflictError(
            `A Believe report for account ${f.account}, month ${f.reportingMonth} is already being loaded or loaded`,
            'duplicate_period',
          );
        if (err.code === '23505' && err.constraint === 'source_files_sha')
          throw new ConflictError('This file is already being loaded or loaded', 'duplicate_file');
        throw e;
      }
    },

    async markLoaded(
      id: string,
      totals: { lineCount: number; netTotal: string; grossTotal: string },
    ): Promise<SourceFileRecord> {
      const r = await one(
        `UPDATE source_files SET status = 'loaded', line_count = $3, net_total = $4, gross_total = $5
         WHERE org_id = $1 AND id = $2 AND status = 'loading' RETURNING ${COLUMNS}`,
        [id, totals.lineCount, totals.netTotal, totals.grossTotal],
      );
      if (!r) throw new NotFoundError('Loading source file', id);
      return r;
    },

    async markFailed(id: string): Promise<void> {
      await q(
        `UPDATE source_files SET status = 'failed', line_count = NULL, net_total = NULL, gross_total = NULL
         WHERE org_id = $1 AND id = $2 AND status = 'loading'`,
        [id],
      );
    },

    get: (id: string) => one(`SELECT ${COLUMNS} FROM source_files WHERE org_id = $1 AND id = $2`, [id]),

    /** Every file, newest month first; with `labelId` only the files loaded under that label (D-169). */
    async list(filter: { labelId?: string } = {}): Promise<SourceFileRecord[]> {
      const { rows } =
        filter.labelId === undefined
          ? await q<Row>(
              `SELECT ${COLUMNS} FROM source_files WHERE org_id = $1
               ORDER BY reporting_month DESC, account, created_at DESC`,
            )
          : await q<Row>(
              `SELECT ${COLUMNS} FROM source_files WHERE org_id = $1 AND label_id = $2
               ORDER BY reporting_month DESC, account, created_at DESC`,
              [filter.labelId],
            );
      return rows.map(record);
    },

    /** The files of an account that are being loaded or loaded (D-169: an account with files is not removed). */
    async activeOfAccount(source: string, account: string): Promise<SourceFileRecord[]> {
      const { rows } = await q<Row>(
        `SELECT ${COLUMNS} FROM source_files
         WHERE org_id = $1 AND source = $2 AND account = $3 AND status IN ('loading', 'loaded')
         ORDER BY reporting_month, created_at`,
        [source, account],
      );
      return rows.map(record);
    },

    /** Sets the label of a file that has none (D-169, a migration script only); true when the row changed. */
    async assignLabel(id: string, labelId: string): Promise<boolean> {
      const r = await q(`UPDATE source_files SET label_id = $3 WHERE org_id = $1 AND id = $2 AND label_id IS NULL`, [
        id,
        labelId,
      ]);
      return (r.rowCount ?? 0) > 0;
    },

    /** The files a calculation may read: exactly the `loaded` ones. */
    async loaded(): Promise<SourceFileRecord[]> {
      const { rows } = await q<Row>(
        `SELECT ${COLUMNS} FROM source_files WHERE org_id = $1 AND status = 'loaded' ORDER BY reporting_month, account`,
      );
      return rows.map(record);
    },
  };
}

export type SourceFilesRegistry = ReturnType<typeof createSourceFilesRegistry>;
