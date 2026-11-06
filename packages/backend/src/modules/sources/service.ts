import { assertMonth } from '../../shared/dates';
import { NotFoundError, ValidationError } from '../../shared/errors';
import { normalizeIsrc, normalizeUpc } from '../../shared/identifiers';
import { parsePico, picoToString } from '../../shared/money';
import { timed, timedSync } from '../../shared/timing';
import type { BelieveColumnar, LinesFacets, LinesSort, LineRow, LinesTotal, UnitsFilter } from './columnar';
import { createBelieveLoader, type LoadInput } from './loader';
import type { SourceFileRecord, SourceFilesRegistry } from './registry';

/** Unit of calculation: ISRC + UPC + report month (+ sales month for the sales-date filter). */
export interface SourceUnit {
  source: 'believe';
  /** Believe account of the file (several accounts may be loaded). */
  account: string;
  isrc: string;
  upc: string;
  reportingMonth: string;
  salesMonth: string;
  /** Label string of the report line (`Label Name`); part of the unit key (D-124). */
  labelName: string;
  /** The own label the file of the unit was loaded under (`source_files.label_id`, D-169): the book; null = none. */
  labelId: string | null;
  netPico: bigint;
}

/**
 * What `snapshot()` may be narrowed to (the unit scope of the facade, D-161): a month range on one basis, ISRCs, UPCs,
 * Believe accounts, the labels the files were loaded under (D-169). The files in force are always all of them; only
 * the units read are fewer.
 */
export interface SnapshotFilter extends UnitsFilter {
  accounts?: string[];
  /** Only the units of the files loaded under one of these labels (`source_files.label_id`, D-169); [] = nothing. */
  labelIds?: string[];
}

/** The part of a snapshot filter ClickHouse applies to the units (the accounts and labels choose the files). */
function unitsOf(filter: SnapshotFilter): UnitsFilter {
  const { from, to, basis, isrcs, upcs } = filter;
  return { from, to, basis, isrcs, upcs };
}

/** The files a filtered read takes: the loaded files of the accounts and labels asked for (D-161, D-169). */
function filesOfFilter(files: SourceFileRecord[], filter: SnapshotFilter): SourceFileRecord[] {
  const { accounts, labelIds } = filter;
  return files.filter(
    (f) =>
      (!accounts || accounts.includes(f.account)) &&
      (!labelIds || (f.labelId !== null && labelIds.includes(f.labelId))),
  );
}

/** A file in force, as stored with every payout for reproducibility. */
export interface ActiveFile {
  id: string;
  sha256: string;
  reportingMonth: string;
  fileName: string;
}

/** What the lines page asks for. Filters are exact; empty values are ignored. */
export interface LinesQuery {
  /** Files to read (loaded ones). Without it: all loaded files if an ISRC or UPC is given, else the newest report month. */
  fileIds?: string[];
  /** Only the files loaded under this label (D-169): opaque text, the facade has checked it. */
  labelId?: string;
  isrc?: string;
  upc?: string;
  platform?: string;
  country?: string;
  subscriptionType?: string;
  salesType?: string;
  releaseType?: string;
  /** 'YYYY-MM', inclusive. */
  salesFrom?: string;
  salesTo?: string;
  sort?: LinesSort;
  dir?: 'asc' | 'desc';
  limit?: number;
  offset?: number;
}

export interface FileRef {
  id: string;
  account: string;
  reportingMonth: string;
  fileName: string;
}

export interface SourceLine extends LineRow {
  account: string;
  artistName: string;
  trackTitle: string;
}

export interface SourceLinesPage {
  /** The files the lines were read from. */
  files: FileRef[];
  items: SourceLine[];
  /** Everything that matches the filters, not only this page. Counts and money are exact text. */
  total: LinesTotal;
  limit: number;
  offset: number;
  sort: LinesSort;
  dir: 'asc' | 'desc';
}

/** In a filter or a drop-down, the empty subscription type of a report line (a download has none). */
export const NO_VALUE = '(none)';

export const DEFAULT_LINES_LIMIT = 100;
export const MAX_LINES_LIMIT = 1000;

export interface SourcesDeps {
  registry: SourceFilesRegistry;
  columnar: BelieveColumnar;
  /** Original report files are kept here as <sha256>-<name>. */
  storageDir: string;
}

/**
 * The sources module (Believe): the file registry in PostgreSQL and the report lines in ClickHouse.
 *
 * Every read first takes the list of `loaded` files from the registry and asks ClickHouse only for those files, so a
 * file that is still loading, failed or replaced never reaches a calculation.
 */
export function createSourcesService(deps: SourcesDeps) {
  const { registry, columnar } = deps;
  const loader = createBelieveLoader(deps);

  /**
   * The requested files, which must be loaded; else all loaded files (ISRC or UPC given) or the newest month. With a
   * label (D-169) only the loaded files of that label count: a requested file of another label is not a loaded file here.
   */
  async function chooseFiles(requested: string[] | undefined, anchored: boolean, labelId?: string) {
    const all = await registry.loaded();
    const loaded = labelId === undefined ? all : all.filter((f) => f.labelId === labelId);
    if (requested && requested.length > 0) {
      const byId = new Map(loaded.map((f) => [f.id, f]));
      const unknown = requested.filter((id) => !byId.has(id));
      if (unknown.length) throw new ValidationError(`Not a loaded Believe file: ${unknown.join(', ')}`);
      return [...new Set(requested)].map((id) => byId.get(id) as SourceFileRecord);
    }
    if (anchored || loaded.length === 0) return loaded;
    const newest = loaded.reduce((m, f) => (f.reportingMonth > m ? f.reportingMonth : m), '');
    return loaded.filter((f) => f.reportingMonth === newest);
  }

  const service = {
    /** The organization of the registry this service reads (D-170); the facade checks it is its own. */
    orgId: registry.orgId,
    /**
     * Loads one Believe report (CSV or zipped CSV) by streaming it: the file is never held in memory.
     * A second file for an already loaded (account, reporting month) is rejected; so is the same file (sha256) again.
     */
    ingestBelieve: (input: LoadInput): Promise<SourceFileRecord> => loader.ingestBelieve(input),

    /**
     * Every file in the registry, newest month first, including failed and replaced ones; with `labelId` only the
     * files loaded under that label (D-169).
     */
    listFiles: (filter: { labelId?: string } = {}): Promise<SourceFileRecord[]> => registry.list(filter),

    /** The files of a Believe account that are being loaded or loaded (D-169). */
    activeFilesOfAccount: (account: string): Promise<SourceFileRecord[]> =>
      registry.activeOfAccount('believe', account),

    async getFile(id: string): Promise<SourceFileRecord> {
      const f = await registry.get(id);
      if (!f) throw new NotFoundError('Source file', id);
      return f;
    },

    /** Files in force (loaded), with their hashes: stored with every payout for reproducibility. */
    async activeFiles(): Promise<ActiveFile[]> {
      return (await registry.loaded()).map(({ id, sha256, reportingMonth, fileName }) => ({
        id,
        sha256,
        reportingMonth,
        fileName,
      }));
    },

    /**
     * The files in force and their units, read together: the units belong to exactly these files. A calculation
     * and the payout snapshot that records its files use one snapshot.
     */
    async snapshot(filter: SnapshotFilter = {}): Promise<{ files: ActiveFile[]; units: SourceUnit[] }> {
      const files = await timed(
        'pg: registry.loaded',
        () => registry.loaded(),
        (r) => `${r.length} files`,
      );
      const accountOf = new Map(files.map((f) => [f.id, f.account]));
      const labelOf = new Map(files.map((f) => [f.id, f.labelId]));
      // The unit scope (D-161) narrows the units read, never the list of files in force.
      const unitsFilter = unitsOf(filter);
      const read = filesOfFilter(files, filter);
      const rows = await timed(
        'clickhouse: units',
        () =>
          columnar.units(
            read.map((f) => f.id),
            unitsFilter,
          ),
        (r) => `${r.length} units`,
      );
      return timedSync('map units (parsePico)', () => ({
        files: files.map(({ id, sha256, reportingMonth, fileName }) => ({
          id,
          sha256,
          reportingMonth,
          fileName,
        })),
        units: rows.map((r) => ({
          source: 'believe',
          account: accountOf.get(r.fileId) as string,
          isrc: r.isrc,
          upc: r.upc,
          reportingMonth: r.reportingMonth,
          salesMonth: r.salesMonth,
          labelName: r.labelName,
          labelId: labelOf.get(r.fileId) ?? null,
          netPico: parsePico(r.net),
        })),
      }));
    },

    /** Units grouped by ISRC + UPC + report month + sales month, optionally filtered by month range. */
    async units(filter: SnapshotFilter = {}): Promise<SourceUnit[]> {
      return (await service.snapshot(filter)).units;
    },

    /** The ISRCs of the loaded files whose label string normalises to one of `normalizedAliases` (D-163). */
    async isrcsOfLabelAliases(normalizedAliases: string[], normalize: (raw: string) => string): Promise<string[]> {
      if (normalizedAliases.length === 0) return [];
      const files = await registry.loaded();
      const ids = files.map((f) => f.id);
      const wanted = new Set(normalizedAliases);
      const raw = (await columnar.labelStrings(ids)).filter((s) => wanted.has(normalize(s)));
      return columnar.isrcsOfLabelStrings(ids, raw);
    },

    /** The loaded files of one label (`source_files.label_id = labelId`, D-169): the files of its book. */
    async filesOfLabel(labelId: string): Promise<SourceFileRecord[]> {
      return (await registry.loaded()).filter((f) => f.labelId === labelId);
    },

    /** Every ISRC of the given files (D-169: the tracks of a label = the ISRCs of its files). */
    isrcsOfFiles: (fileIds: string[]): Promise<string[]> => columnar.isrcsOfFiles(fileIds),

    /** Every distinct label string of the given files, raw (D-172: the onboarding checklist's strings without an alias). */
    labelStringsOfFiles: (fileIds: string[]): Promise<string[]> => columnar.labelStrings(fileIds),

    /**
     * The (ISRC, file, reporting month) pairs of the given files, optionally of some ISRCs (D-172: the observations of
     * the label history of an ISRC). The caller passes `loaded` files of the registry.
     */
    isrcFilePairs: (fileIds: string[], isrcs?: string[]) => columnar.isrcFilePairs(fileIds, isrcs),

    /**
     * The distinct ISRCs of every UPC in the given files, optionally of some UPCs (D-172: the completeness of a release
     * of the registry). The caller passes `loaded` files of the registry.
     */
    isrcsOfUpcs: (fileIds: string[], upcs?: string[]) => columnar.isrcsOfUpcs(fileIds, upcs),

    /**
     * Marks the label of a file that has none (D-169, the script `assign-label-books` only): the label of a file is never
     * changed. Returns whether the row changed.
     */
    assignFileLabel: (fileId: string, labelId: string): Promise<boolean> => registry.assignLabel(fileId, labelId),

    /** Explanation of one ISRC: platforms, countries, subscription and sales types per month. */
    async breakdown(isrc: string, reportingMonth?: string) {
      const files = await registry.loaded();
      const rows = await columnar.breakdown(
        files.map((f) => f.id),
        isrc,
        reportingMonth ? assertMonth(reportingMonth) : undefined,
      );
      // net as canonical decimal text (no padding zeros), quantity as a plain number
      return rows.map((b) => ({ ...b, net: picoToString(parsePico(b.net)), quantity: Number(b.quantity) }));
    },

    /**
     * Lines of the chosen report files: one record per key (the `lines` view), filtered, sorted and paged, with the
     * totals of everything that matches. Reading all history without a filter takes about 20 s, so without files and
     * without an ISRC or UPC the newest report month is read.
     */
    async lines(q: LinesQuery = {}): Promise<SourceLinesPage> {
      const limit = q.limit ?? DEFAULT_LINES_LIMIT;
      if (!Number.isInteger(limit) || limit < 1 || limit > MAX_LINES_LIMIT)
        throw new ValidationError(`limit must be a whole number from 1 to ${MAX_LINES_LIMIT}`);
      const offset = q.offset ?? 0;
      if (!Number.isInteger(offset) || offset < 0)
        throw new ValidationError('offset must be a whole number, 0 or more');
      const sort = q.sort ?? 'net';
      const dir = q.dir ?? 'desc';
      const isrc = normalizeIsrc(q.isrc);
      const upc = normalizeUpc(q.upc);
      const files = await chooseFiles(q.fileIds, Boolean(isrc || upc), q.labelId);
      const salesFrom = q.salesFrom ? assertMonth(q.salesFrom) : undefined;
      const salesTo = q.salesTo ? assertMonth(q.salesTo) : undefined;
      const filter = {
        ...(isrc ? { isrc } : {}),
        ...(upc ? { upc } : {}),
        ...(q.platform ? { platform: q.platform } : {}),
        ...(q.country ? { country: q.country } : {}),
        ...(q.subscriptionType
          ? { subscriptionType: q.subscriptionType === NO_VALUE ? '' : q.subscriptionType }
          : {}),
        ...(q.salesType ? { salesType: q.salesType } : {}),
        ...(q.releaseType ? { releaseType: q.releaseType } : {}),
        ...(salesFrom ? { salesFrom } : {}),
        ...(salesTo ? { salesTo } : {}),
      };
      const ids = files.map((f) => f.id);
      const { items, total } = await columnar.lines(ids, filter, { sort, dir, limit, offset });
      const names = await columnar.namesOfPairs(ids, items);
      const nameOf = new Map(names.map((n) => [`${n.isrc}|${n.upc}`, n]));
      const accountOf = new Map(files.map((f) => [f.id, f.account]));
      return {
        files: files.map(({ id, account, reportingMonth, fileName }) => ({
          id,
          account,
          reportingMonth,
          fileName,
        })),
        items: items.map((l) => ({
          ...l,
          account: accountOf.get(l.fileId) as string,
          artistName: nameOf.get(`${l.isrc}|${l.upc}`)?.artistName ?? '',
          trackTitle: nameOf.get(`${l.isrc}|${l.upc}`)?.trackTitle ?? '',
        })),
        total,
        limit,
        offset,
        sort,
        dir,
      };
    },

    /**
     * The values the filters of the lines page can take in the chosen files (newest report month by default); with
     * `labelId` over the files of that label only (D-169).
     */
    async linesFacets(fileIds?: string[], labelId?: string): Promise<{ files: FileRef[] } & LinesFacets> {
      const files = await chooseFiles(fileIds, false, labelId);
      const facets = await columnar.facets(files.map((f) => f.id));
      return {
        files: files.map(({ id, account, reportingMonth, fileName }) => ({
          id,
          account,
          reportingMonth,
          fileName,
        })),
        ...facets,
        subscriptionTypes: facets.subscriptionTypes.map((t) => t || NO_VALUE),
      };
    },

    /** Net per UPC over the loaded files (exact decimal text), one ClickHouse GROUP BY; the filter narrows the units (D-168). */
    async netByUpc(filter: SnapshotFilter = {}): Promise<Map<string, string>> {
      const files = await registry.loaded();
      const unitsFilter = unitsOf(filter);
      const read = filesOfFilter(files, filter);
      const rows = await columnar.netByUpc(read.map((f) => f.id), unitsFilter);
      return new Map(rows.map((r) => [r.upc, picoToString(parsePico(r.net))]));
    },

    /** Net per (ISRC, UPC) of the given ISRCs over the loaded files (exact decimal text). */
    async netByIsrc(isrcs: string[]): Promise<{ isrc: string; upc: string; net: string }[]> {
      const files = await registry.loaded();
      const rows = await columnar.netByIsrc(
        files.map((f) => f.id),
        isrcs,
      );
      return rows.map((r) => ({ isrc: r.isrc, upc: r.upc, net: picoToString(parsePico(r.net)) }));
    },

    /** Names from the report per (ISRC, UPC): metadata only, never used to decide who gets paid. */
    async pairAttributes(
      filter: { isrcs?: string[]; upcs?: string[] } = {},
    ): Promise<Map<string, { artistName: string; trackTitle: string; releaseTitle: string; labelName: string }>> {
      const files = await registry.loaded();
      const rows = await columnar.pairNames(
        files.map((f) => f.id),
        filter,
      );
      return new Map(
        rows.map((p) => [
          `${p.isrc}|${p.upc}`,
          {
            artistName: p.artistName,
            trackTitle: p.trackTitle,
            releaseTitle: p.releaseTitle,
            labelName: p.labelName,
          },
        ]),
      );
    },
  };
  return service;
}

export type SourcesService = ReturnType<typeof createSourcesService>;
