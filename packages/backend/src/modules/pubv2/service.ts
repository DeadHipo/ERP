import { copyFile, mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { nowIso } from '../../shared/dates';
import { ConflictError, NotFoundError } from '../../shared/errors';
import { sha256File } from '../../shared/files';
import { newId, normalizeName } from '../../shared/identifiers';
import { picoToString } from '../../shared/money';
import type { Db } from '../../shared/pg-db';
import type { OrgScope } from '../../shared/org-scope';
import { createPubV2Repository, type FileRow } from './repository';
import { readB17Summary, type SummaryRow } from './summary-format';

export interface PubV2File {
  id: string;
  labelId: string;
  fileName: string;
  sha256: string;
  source: 'b17';
  format: string;
  periods: string[];
  status: 'loaded' | 'superseded';
  replacedBy: string | null;
  rowCount: number;
  /** Σ of the rows, decimal USD. */
  payable: string;
  /** The total the file names itself, decimal USD; null when it names none. */
  declaredPayable: string | null;
  /** payable − declaredPayable; null without a declared total. */
  difference: string | null;
  uploadedAt: string;
}

const view = (f: FileRow): PubV2File => ({
  id: f.id,
  labelId: f.labelId,
  fileName: f.fileName,
  sha256: f.sha256,
  source: f.source,
  format: f.format,
  periods: f.periods,
  status: f.status,
  replacedBy: f.replacedBy,
  rowCount: f.rowCount,
  payable: picoToString(f.payablePico),
  declaredPayable: f.declaredPayablePico === null ? null : picoToString(f.declaredPayablePico),
  difference: f.declaredPayablePico === null ? null : picoToString(f.payablePico - f.declaredPayablePico),
  uploadedAt: f.uploadedAt,
});

const money = (v: string | null): string | null => (v === null ? null : picoToString(BigInt(v)));

/** Publishing v2 (D-182): the files, songwriters, songs and accruals of the report summaries. It computes no share. */
export function createPubV2Service(db: Db, org: OrgScope, storageDir: string) {
  const repo = createPubV2Repository(db, org);

  /** The songwriters and songs of the rows, created when new; a spelling with the same normal form is the same one. */
  async function resolve(rows: SummaryRow[]) {
    const writers = await repo.writerIndex();
    const songIds = await repo.songIndex();
    const newWriters: { id: string; name: string; createdAt: string }[] = [];
    const newWriterAliases: { id: string; songwriterId: string; name: string; nameNorm: string }[] = [];
    const newSongs: { id: string; songwriterId: string; title: string; titleNorm: string }[] = [];
    const newSongAliases: { id: string; songId: string; title: string; titleNorm: string }[] = [];
    const ids = rows.map((r) => {
      const nameNorm = normalizeName(r.writerName);
      let songwriterId = writers.get(nameNorm);
      if (!songwriterId) {
        songwriterId = newId();
        writers.set(nameNorm, songwriterId);
        newWriters.push({ id: songwriterId, name: r.writerName, createdAt: nowIso() });
        newWriterAliases.push({ id: newId(), songwriterId, name: r.writerName, nameNorm });
      }
      const titleNorm = normalizeName(r.title);
      const key = `${songwriterId}\0${titleNorm}`;
      let songId = songIds.get(key);
      if (!songId) {
        songId = newId();
        songIds.set(key, songId);
        newSongs.push({ id: songId, songwriterId, title: r.title, titleNorm });
        newSongAliases.push({ id: newId(), songId, title: r.title, titleNorm });
      }
      return { songwriterId, songId };
    });
    await repo.insertSongwriters(newWriters);
    await repo.insertSongwriterAliases(newWriterAliases);
    await repo.insertSongs(newSongs);
    await repo.insertSongAliases(newSongAliases);
    return ids;
  }

  return {
    /**
     * Loads one report as a partition of its own. The same bytes are `duplicate_file`; a quarter that a loaded file of
     * the label holds is `period_loaded` unless `replace`: then those files become `superseded` and stop counting.
     */
    async ingest(input: { path: string; fileName: string; labelId: string; replace?: boolean }): Promise<PubV2File> {
      const sha256 = await sha256File(input.path);
      const summary = await readB17Summary(input.path, input.fileName);
      await mkdir(storageDir, { recursive: true });
      const storedPath = join(storageDir, `${sha256}-${input.fileName.replace(/[^\w.() -]/g, '_')}`);
      await copyFile(input.path, storedPath);
      return repo.transaction(async () => {
        const same = await repo.fileBySha(sha256);
        if (same) throw new ConflictError(`This file was already loaded as ${same.fileName}`, 'duplicate_file');
        const taken = (await repo.loadedOfLabel(input.labelId)).filter((f) => f.periods.some((p) => summary.periods.includes(p)));
        if (taken.length > 0 && !input.replace)
          throw new ConflictError(`The quarters are already loaded from ${taken.map((f) => f.fileName).join(', ')}`, 'period_loaded', {
            files: taken.map((f) => f.id),
          });
        const id = newId();
        const ids = await resolve(summary.rows);
        await repo.insertFile({
          id,
          labelId: input.labelId,
          fileName: input.fileName,
          sha256,
          source: 'b17',
          format: summary.format,
          periods: summary.periods,
          status: 'loaded',
          replacedBy: null,
          rowCount: summary.rows.length,
          payablePico: summary.rows.reduce((s, r) => s + r.payablePico, 0n),
          declaredPayablePico: summary.declaredPayablePico,
          storedPath,
          uploadedAt: nowIso(),
        });
        await repo.insertAccruals(
          summary.rows.map((r, i) => ({
            id: newId(),
            fileId: id,
            songwriterId: (ids[i] as { songwriterId: string }).songwriterId,
            songId: (ids[i] as { songId: string }).songId,
            period: r.period,
            grossPico: r.grossPico,
            withholdingPico: r.withholdingPico,
            payablePico: r.payablePico,
          })),
        );
        if (taken.length > 0) await repo.supersede(taken.map((f) => f.id), id);
        return view((await repo.file(id)) as FileRow);
      });
    },

    /** Removes the partition of a file; the files it had replaced count again. Songwriters and songs stay. */
    async removeFile(id: string): Promise<{ id: string }> {
      return repo.transaction(async () => {
        if (!(await repo.file(id))) throw new NotFoundError('File', id);
        await repo.restoreReplacedBy(id);
        await repo.deleteFile(id);
        return { id };
      });
    },

    async getFile(id: string): Promise<PubV2File> {
      const f = await repo.file(id);
      if (!f) throw new NotFoundError('File', id);
      return view(f);
    },

    listFiles: async (labelId?: string): Promise<PubV2File[]> => (await repo.files(labelId)).map(view),

    async listSongwriters(labelId?: string) {
      const rows = await repo.songwriterSums(labelId);
      const aliases = new Map<string, string[]>();
      for (const a of await repo.aliasesOf()) aliases.set(a.songwriterId, [...(aliases.get(a.songwriterId) ?? []), a.name]);
      return rows.map((r) => ({
        id: r.id,
        name: r.name,
        aliases: aliases.get(r.id) ?? [],
        songs: r.songs,
        periods: r.periods ?? [],
        payable: money(r.payable) ?? '0',
      }));
    },

    async listSongs(labelId?: string) {
      return (await repo.songSums(labelId)).map((r) => ({
        id: r.id,
        title: r.title,
        songwriterId: r.songwriter_id,
        songwriter: r.songwriter,
        payable: money(r.payable) ?? '0',
      }));
    },

    async getSong(id: string) {
      const s = await repo.song(id);
      if (!s) throw new NotFoundError('Song', id);
      return { id: s.id, title: s.title, songwriterId: s.songwriterId };
    },

    async songwriter(id: string, labelId?: string) {
      const w = await repo.songwriter(id);
      if (!w) throw new NotFoundError('Songwriter', id);
      const rows = await repo.accrualsOf(id, labelId);
      const byPeriod = new Map<string, { gross: bigint | null; withholding: bigint | null; payable: bigint }>();
      const bySong = new Map<string, { id: string; title: string; payable: bigint; periods: { period: string; payable: string }[] }>();
      const plus = (a: bigint | null, b: string | null) => (b === null ? a : (a ?? 0n) + BigInt(b));
      for (const r of rows) {
        const p = byPeriod.get(r.period) ?? { gross: null, withholding: null, payable: 0n };
        byPeriod.set(r.period, {
          gross: plus(p.gross, r.gross),
          withholding: plus(p.withholding, r.withholding),
          payable: p.payable + BigInt(r.payable),
        });
        const s = bySong.get(r.song_id) ?? { id: r.song_id, title: r.title, payable: 0n, periods: [] };
        s.payable += BigInt(r.payable);
        s.periods.push({ period: r.period, payable: picoToString(BigInt(r.payable)) });
        bySong.set(r.song_id, s);
      }
      return {
        id: w.id,
        name: w.name,
        aliases: (await repo.aliasesOf([id])).map((a) => a.name),
        periods: [...byPeriod.entries()].map(([period, v]) => ({
          period,
          gross: v.gross === null ? null : picoToString(v.gross),
          withholding: v.withholding === null ? null : picoToString(v.withholding),
          payable: picoToString(v.payable),
        })),
        songs: [...bySong.values()]
          .sort((a, b) => (a.payable === b.payable ? a.title.localeCompare(b.title) : a.payable > b.payable ? -1 : 1))
          .map((s) => ({ id: s.id, title: s.title, payable: picoToString(s.payable), periods: s.periods })),
      };
    },
  };
}

export type PubV2Service = ReturnType<typeof createPubV2Service>;
