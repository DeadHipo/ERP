import { eq, inArray } from 'drizzle-orm';
import type { Db } from '../../shared/pg-db';
import { orgFree, orgQuery, orgRows, orgWhere, type OrgFree, type OrgScope } from '../../shared/org-scope';
import { accruals, files, songAliases, songs, songwriterAliases, songwriters } from './schema';

export type FileRow = OrgFree<typeof files.$inferSelect>;

const CHUNK = 2000;

/** All SQL of the pubv2 module lives here (schema `pubv2`); every statement is of the organization `org` (D-170). */
export function createPubV2Repository(db: Db, org: OrgScope) {
  const orm = () => db.orm();
  const q = orgQuery(db, org);
  const F = orgFree(files);
  const inChunks = async <R extends object>(rows: R[], write: (part: R[]) => Promise<unknown>) => {
    for (let i = 0; i < rows.length; i += CHUNK) await write(rows.slice(i, i + CHUNK));
  };
  return {
    transaction: <T>(fn: () => Promise<T>): Promise<T> => db.transaction(fn),

    file: async (id: string): Promise<FileRow | undefined> =>
      (await orm().select(F).from(files).where(orgWhere(org, files, eq(files.id, id))))[0],
    fileBySha: async (sha256: string): Promise<FileRow | undefined> =>
      (await orm().select(F).from(files).where(orgWhere(org, files, eq(files.sha256, sha256))))[0],
    files: (labelId?: string): Promise<FileRow[]> =>
      orm()
        .select(F)
        .from(files)
        .where(orgWhere(org, files, labelId ? eq(files.labelId, labelId) : undefined))
        .orderBy(files.uploadedAt),
    loadedOfLabel: (labelId: string): Promise<FileRow[]> =>
      orm()
        .select(F)
        .from(files)
        .where(orgWhere(org, files, eq(files.labelId, labelId), eq(files.status, 'loaded'))),
    insertFile: async (row: OrgFree<typeof files.$inferInsert>) => {
      await orm().insert(files).values(orgRows(org, [row]));
    },
    supersede: async (ids: string[], replacedBy: string) => {
      await orm()
        .update(files)
        .set({ status: 'superseded', replacedBy })
        .where(orgWhere(org, files, inArray(files.id, ids)));
    },
    /** The files a removed file had replaced count again. */
    restoreReplacedBy: async (id: string) => {
      await orm()
        .update(files)
        .set({ status: 'loaded', replacedBy: null })
        .where(orgWhere(org, files, eq(files.replacedBy, id)));
    },
    deleteFile: async (id: string) => {
      await orm().delete(accruals).where(orgWhere(org, accruals, eq(accruals.fileId, id)));
      await orm().delete(files).where(orgWhere(org, files, eq(files.id, id)));
    },

    /** name_norm -> songwriter id. */
    writerIndex: async (): Promise<Map<string, string>> => {
      const rows = await orm()
        .select({ norm: songwriterAliases.nameNorm, id: songwriterAliases.songwriterId })
        .from(songwriterAliases)
        .where(orgWhere(org, songwriterAliases));
      return new Map(rows.map((r) => [r.norm, r.id]));
    },
    /** `songwriter id \0 title_norm` -> song id, through the aliases of the songs. */
    songIndex: async (): Promise<Map<string, string>> => {
      const rows = await orm()
        .select({ writer: songs.songwriterId, norm: songAliases.titleNorm, id: songAliases.songId })
        .from(songAliases)
        .innerJoin(songs, orgWhere(org, songs, eq(songs.id, songAliases.songId)))
        .where(orgWhere(org, songAliases));
      return new Map(rows.map((r) => [`${r.writer}\0${r.norm}`, r.id]));
    },
    insertSongwriters: (rows: OrgFree<typeof songwriters.$inferInsert>[]) =>
      inChunks(rows, (part) => orm().insert(songwriters).values(orgRows(org, part))),
    insertSongwriterAliases: (rows: OrgFree<typeof songwriterAliases.$inferInsert>[]) =>
      inChunks(rows, (part) => orm().insert(songwriterAliases).values(orgRows(org, part))),
    insertSongs: (rows: OrgFree<typeof songs.$inferInsert>[]) =>
      inChunks(rows, (part) => orm().insert(songs).values(orgRows(org, part))),
    insertSongAliases: (rows: OrgFree<typeof songAliases.$inferInsert>[]) =>
      inChunks(rows, (part) => orm().insert(songAliases).values(orgRows(org, part))),
    insertAccruals: (rows: OrgFree<typeof accruals.$inferInsert>[]) =>
      inChunks(rows, (part) => orm().insert(accruals).values(orgRows(org, part))),

    /** The songwriters with the sums of the loaded files, largest first; `labelId` keeps the files of one label. */
    songwriterSums: async (labelId?: string) =>
      (
        await q<{ id: string; name: string; songs: number; periods: string[] | null; payable: string | null }>(
          `SELECT w.id, w.name,
                  COUNT(DISTINCT a.song_id)::int AS songs,
                  ARRAY_AGG(DISTINCT a.period ORDER BY a.period) FILTER (WHERE a.period IS NOT NULL) AS periods,
                  SUM(a.payable_pico) AS payable
           FROM pubv2.songwriters w
           LEFT JOIN (
             SELECT x.* FROM pubv2.accruals x
             JOIN pubv2.files f ON f.id = x.file_id AND f.org_id = x.org_id
             WHERE x.org_id = $1 AND f.status = 'loaded' AND ($2::text IS NULL OR f.label_id = $2)
           ) a ON a.songwriter_id = w.id
           WHERE w.org_id = $1
           GROUP BY w.id, w.name
           HAVING $2::text IS NULL OR COUNT(a.id) > 0
           ORDER BY COALESCE(SUM(a.payable_pico), 0) DESC, w.name`,
          [labelId ?? null],
        )
      ).rows,
    songwriter: async (id: string) =>
      (await orm().select(orgFree(songwriters)).from(songwriters).where(orgWhere(org, songwriters, eq(songwriters.id, id))))[0],
    aliasesOf: async (ids?: string[]) =>
      orm()
        .select({ songwriterId: songwriterAliases.songwriterId, name: songwriterAliases.name })
        .from(songwriterAliases)
        .where(orgWhere(org, songwriterAliases, ids ? inArray(songwriterAliases.songwriterId, ids) : undefined))
        .orderBy(songwriterAliases.name),
    /** Song × quarter of one songwriter over the loaded files. */
    accrualsOf: async (songwriterId: string, labelId?: string) =>
      (
        await q<{
          song_id: string;
          title: string;
          period: string;
          gross: string | null;
          withholding: string | null;
          payable: string;
        }>(
          `SELECT s.id AS song_id, s.title, a.period,
                  SUM(a.gross_pico) AS gross, SUM(a.withholding_pico) AS withholding, SUM(a.payable_pico) AS payable
           FROM pubv2.accruals a
           JOIN pubv2.files f ON f.id = a.file_id AND f.org_id = a.org_id
           JOIN pubv2.songs s ON s.id = a.song_id AND s.org_id = a.org_id
           WHERE a.org_id = $1 AND a.songwriter_id = $2 AND f.status = 'loaded' AND ($3::text IS NULL OR f.label_id = $3)
           GROUP BY s.id, s.title, a.period
           ORDER BY a.period, s.title`,
          [songwriterId, labelId ?? null],
        )
      ).rows,
  };
}
