import type { ClickHouseClient } from '@clickhouse/client';
import { note, timed } from '../../shared/timing';

/**
 * What a read of the units may be narrowed to: a month range on one basis, and (the unit scope of the facade, D-161)
 * a list of ISRCs and/or UPCs. `undefined` = no filter; an empty list = nothing.
 */
export interface UnitsFilter {
  from?: string;
  to?: string;
  basis?: 'report' | 'sales';
  isrcs?: string[];
  upcs?: string[];
}

/** The unit filters a read may be narrowed by, as `WHERE` clauses with their bound parameters. */
function unitsWhere(fileIds: string[], filter: UnitsFilter): { where: string; params: Record<string, unknown>; empty: boolean } {
  const column = (filter.basis ?? 'report') === 'report' ? 'reporting_month' : 'sales_month';
  const where = ['file_id IN {ids:Array(UUID)}'];
  const params: Record<string, unknown> = { ids: fileIds };
  let empty = fileIds.length === 0;
  if (filter.from) {
    where.push(`${column} >= {from:Date}`);
    params.from = `${filter.from}-01`;
  }
  if (filter.to) {
    where.push(`${column} <= {to:Date}`);
    params.to = `${filter.to}-01`;
  }
  // A unit scope of the facade (D-161): only these ISRCs / UPCs; an empty list means no unit.
  const list = (key: 'isrcs' | 'upcs', column: string) => {
    const v = filter[key];
    if (!v) return;
    if (v.length === 0) empty = true;
    where.push(`${column} IN {${key}:Array(String)}`);
    params[key] = v;
  };
  list('isrcs', 'isrc');
  list('upcs', 'upc');
  return { where: where.join(' AND '), params, empty };
}

/** UPCs in one ClickHouse parameter (D-195): an HTML form field of the HTTP interface has a size limit. */
const UPC_CHUNK = 1_000;

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

export interface StageTotals {
  /** Rows in the stage table, as exact integer text. */
  lines: string;
  gross: string;
  net: string;
  /** Distinct reporting months found in the stage table (a report has exactly one). */
  months: string[];
}

export interface LinesFilter {
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
}

export type LinesSort = 'net' | 'gross' | 'quantity' | 'reportingMonth' | 'salesMonth' | 'isrc';

/** Sort names the API accepts, mapped to columns of the `lines` view: nothing from the request becomes SQL text. */
const SORT_COLUMN: Record<LinesSort, string> = {
  net: 'net_revenue',
  gross: 'gross_revenue',
  quantity: 'quantity',
  reportingMonth: 'reporting_month',
  salesMonth: 'sales_month',
  isrc: 'isrc',
};

export interface LineRow {
  fileId: string;
  reportingMonth: string;
  salesMonth: string;
  platform: string;
  country: string;
  isrc: string;
  upc: string;
  currency: string;
  subscriptionType: string;
  salesType: string;
  releaseType: string;
  quantity: string;
  gross: string;
  net: string;
  mergedLines: string;
}

export interface LinesTotal {
  keys: string;
  quantity: string;
  gross: string;
  net: string;
  mergedLines: string;
}

export interface LinesFacets {
  platforms: string[];
  countries: string[];
  subscriptionTypes: string[];
  salesTypes: string[];
  releaseTypes: string[];
}

function linesWhere(fileIds: string[], f: LinesFilter): { where: string; params: Record<string, unknown> } {
  const where = ['file_id IN {ids:Array(UUID)}'];
  const params: Record<string, unknown> = { ids: fileIds };
  // An empty text is a real value of the subscription type (a download has none), so it can be asked for.
  const eq = (key: keyof LinesFilter, column: string, allowEmpty = false) => {
    const v = f[key];
    if (v !== undefined && (v !== '' || allowEmpty)) {
      where.push(`${column} = {${key}:String}`);
      params[key] = v;
    }
  };
  eq('isrc', 'isrc');
  eq('upc', 'upc');
  eq('platform', 'platform');
  eq('country', 'country_region');
  eq('subscriptionType', 'streaming_subscription_type', true);
  eq('salesType', 'sales_type');
  eq('releaseType', 'release_type');
  if (f.salesFrom) {
    where.push('sales_month >= {salesFrom:Date}');
    params.salesFrom = `${f.salesFrom}-01`;
  }
  if (f.salesTo) {
    where.push('sales_month <= {salesTo:Date}');
    params.salesTo = `${f.salesTo}-01`;
  }
  return { where: where.join(' AND '), params };
}

/**
 * Everything the loader asks of ClickHouse (migrations/clickhouse/0001_believe.sql, 0002_units_projection.sql, 0003_units_by_label.sql). A file is written to its own stage
 * table and joins believe.rows in one step (ATTACH PARTITION), so a half-loaded file is never visible.
 * Table names are built only from a checked UUID, never from user text.
 */
export function createBelieveColumnar(
  ch: ClickHouseClient,
  /** Database names; the defaults are the ones created by the migration. Tests use their own pair. */
  names: { database: string; stageDatabase: string } = {
    database: 'believe',
    stageDatabase: 'believe_stage',
  },
) {
  const DB = names.database;
  const STAGE_DB = names.stageDatabase;
  const select = async <T>(
    query: string,
    query_params: Record<string, unknown> | undefined,
    format: 'JSONEachRow' | 'JSONCompactEachRow',
  ): Promise<T[]> => {
    const rs = await timed('query (until the first bytes)', () => ch.query({ query, query_params, format }));
    // The server's own numbers (duration, rows and bytes read): system.query_log by this id.
    note('query_id', rs.query_id);
    return timed('read + parse JSON', () => rs.json<T>());
  };
  const json = <T>(query: string, query_params?: Record<string, unknown>) =>
    select<T>(query, query_params, 'JSONEachRow');
  /** Rows as arrays, without the column names: a fifth less to send and parse for large results. */
  const compact = <T extends unknown[]>(query: string, query_params?: Record<string, unknown>) =>
    select<T>(query, query_params, 'JSONCompactEachRow');
  const stageTable = (fileId: string) => {
    if (!UUID_RE.test(fileId)) throw new Error(`Not a file id: ${fileId}`);
    return `${STAGE_DB}.rows_${fileId.replaceAll('-', '')}`;
  };
  const partition = (fileId: string, reportingMonth: string) =>
    `(${reportingMonth.replace('-', '')}, '${fileId}')`;

  return {
    async createStage(fileId: string): Promise<void> {
      const t = stageTable(fileId);
      await ch.command({ query: `DROP TABLE IF EXISTS ${t}` });
      await ch.command({ query: `CREATE TABLE ${t} AS ${DB}.rows` });
    },

    async insertRows(fileId: string, rows: Record<string, string>[]): Promise<void> {
      if (rows.length === 0) return;
      await ch.insert({ table: stageTable(fileId), format: 'JSONEachRow', values: rows });
    },

    async stageTotals(fileId: string): Promise<StageTotals> {
      const t = stageTable(fileId);
      const total = await (
        await ch.query({
          query: `SELECT toString(count()) AS lines, toString(sum(gross_revenue)) AS gross, toString(sum(net_revenue)) AS net FROM ${t}`,
          format: 'JSONEachRow',
        })
      ).json<{ lines: string; gross: string; net: string }>();
      const months = await (
        await ch.query({
          query: `SELECT toString(reporting_month) AS m FROM ${t} GROUP BY reporting_month ORDER BY reporting_month`,
          format: 'JSONEachRow',
        })
      ).json<{ m: string }>();
      const [r] = total as { lines: string; gross: string; net: string }[];
      return {
        lines: r?.lines ?? '0',
        gross: r?.gross ?? '0',
        net: r?.net ?? '0',
        months: months.map((x) => x.m.slice(0, 7)),
      };
    },

    /** The file becomes part of believe.rows in one atomic step. */
    async attach(fileId: string, reportingMonth: string): Promise<void> {
      await ch.command({
        query: `ALTER TABLE ${DB}.rows ATTACH PARTITION ${partition(fileId, reportingMonth)} FROM ${stageTable(fileId)}`,
      });
    },

    /** Removes a file from believe.rows (rollback of a load, or deletion of a file). */
    async dropPartition(fileId: string, reportingMonth: string): Promise<void> {
      await ch.command({
        query: `ALTER TABLE ${DB}.rows DROP PARTITION ${partition(fileId, reportingMonth)}`,
      });
    },

    async dropStage(fileId: string): Promise<void> {
      await ch.command({ query: `DROP TABLE IF EXISTS ${stageTable(fileId)}` });
    },

    /**
     * Units of calculation (ISRC + UPC + report month + sales month, per file) of the given files, equal keys
     * summed by the `units` view. Months are 'YYYY-MM'; net is exact decimal text. An empty file list gives nothing.
     */
    async units(
      fileIds: string[],
      filter: UnitsFilter = {},
    ): Promise<
      {
        fileId: string;
        isrc: string;
        upc: string;
        reportingMonth: string;
        salesMonth: string;
        labelName: string;
        net: string;
      }[]
    > {
      const { where, params, empty } = unitsWhere(fileIds, filter);
      if (empty) return [];
      // Result aliases differ from the column names: ClickHouse would resolve a name in WHERE to the alias.
      // The view is answered from the `units_by_label` projection of believe.rows (D-122, D-124). Hundreds of thousands of units:
      // compact rows (arrays in the order of the SELECT).
      const rows = await compact<
        [fid: string, isrc: string, upc: string, rm: string, sm: string, label: string, net: string]
      >(
        `SELECT toString(file_id) AS fid, isrc, upc, toString(reporting_month) AS rm,
                toString(sales_month) AS sm, label_name AS label, toString(net_revenue) AS net
         FROM ${DB}.units WHERE ${where}
         ORDER BY isrc, upc, reporting_month, sales_month, label_name, file_id`,
        params,
      );
      return rows.map(([fid, isrc, upc, rm, sm, label, net]) => ({
        fileId: fid,
        isrc,
        upc,
        reportingMonth: rm.slice(0, 7),
        salesMonth: sm.slice(0, 7),
        labelName: label,
        net,
      }));
    },

    /** Every distinct label string of the given files (the owner reach of the facade, D-163). */
    async labelStrings(fileIds: string[]): Promise<string[]> {
      if (fileIds.length === 0) return [];
      const rows = await json<{ label: string }>(
        `SELECT DISTINCT label_name AS label FROM ${DB}.units WHERE file_id IN {ids:Array(UUID)} ORDER BY label`,
        { ids: fileIds },
      );
      return rows.map((r) => r.label);
    },

    /** The ISRCs whose units carry one of the given (raw) label strings, over the given files (D-163). */
    async isrcsOfLabelStrings(fileIds: string[], labels: string[]): Promise<string[]> {
      if (fileIds.length === 0 || labels.length === 0) return [];
      const rows = await json<{ isrc: string }>(
        `SELECT DISTINCT isrc FROM ${DB}.units WHERE file_id IN {ids:Array(UUID)} AND label_name IN {labels:Array(String)} ORDER BY isrc`,
        { ids: fileIds, labels },
      );
      return rows.map((r) => r.isrc);
    },

    /** Every distinct ISRC of the given files (the book of a label = the files loaded under it, D-169). */
    async isrcsOfFiles(fileIds: string[]): Promise<string[]> {
      if (fileIds.length === 0) return [];
      const rows = await json<{ code: string }>(
        `SELECT DISTINCT isrc AS code FROM ${DB}.units WHERE file_id IN {ids:Array(UUID)} ORDER BY code`,
        { ids: fileIds },
      );
      return rows.map((r) => r.code);
    },

    /**
     * The (ISRC, file, reporting month) pairs of the given files (D-172: the observations the label history of an ISRC
     * is derived from), one `GROUP BY`; optionally of some ISRCs only (an empty list = nothing). Units without an ISRC
     * are not observations.
     */
    async isrcFilePairs(
      fileIds: string[],
      isrcs?: string[],
    ): Promise<{ isrc: string; fileId: string; reportingMonth: string }[]> {
      if (fileIds.length === 0 || (isrcs && isrcs.length === 0)) return [];
      // aliases differ from the column names (an alias named like a column would change the WHERE)
      const rows = await compact<[code: string, fid: string, rm: string]>(
        `SELECT isrc AS code, toString(file_id) AS fid, toString(reporting_month) AS rm
         FROM ${DB}.units
         WHERE file_id IN {ids:Array(UUID)} AND isrc != ''${isrcs ? ' AND isrc IN {isrcs:Array(String)}' : ''}
         GROUP BY isrc, file_id, reporting_month
         ORDER BY code, rm, fid`,
        isrcs ? { ids: fileIds, isrcs } : { ids: fileIds },
      );
      return rows.map(([code, fid, rm]) => ({ isrc: code, fileId: fid, reportingMonth: rm.slice(0, 7) }));
    },

    /**
     * The distinct ISRCs of every UPC in the given files (D-172: a release of the registry is complete when its
     * `track_count` ISRCs are in the units), one `GROUP BY upc`; optionally of some UPCs only (an empty list = nothing).
     * Units without an ISRC or a UPC are not counted.
     */
    async isrcsOfUpcs(fileIds: string[], upcs?: string[]): Promise<{ upc: string; isrcs: string[] }[]> {
      if (fileIds.length === 0 || (upcs && upcs.length === 0)) return [];
      const read = async (some?: string[]) => {
        // aliases differ from the column names (an alias named like a column would change the WHERE)
        const rows = await compact<[code: string, list: string[]]>(
          `SELECT upc AS code, arraySort(groupUniqArray(isrc)) AS list
           FROM ${DB}.units
           WHERE file_id IN {ids:Array(UUID)} AND isrc != '' AND upc != ''${some ? ' AND upc IN {upcs:Array(String)}' : ''}
           GROUP BY upc
           ORDER BY code`,
          some ? { ids: fileIds, upcs: some } : { ids: fileIds },
        );
        return rows.map(([code, list]) => ({ upc: code, isrcs: list }));
      };
      if (!upcs || upcs.length <= UPC_CHUNK) return read(upcs);
      // D-195: a whole release registry (8 000 UPCs) is longer than one form field of the HTTP interface: in chunks
      const out: { upc: string; isrcs: string[] }[] = [];
      for (let i = 0; i < upcs.length; i += UPC_CHUNK) out.push(...(await read(upcs.slice(i, i + UPC_CHUNK))));
      return out.sort((a, b) => (a.upc < b.upc ? -1 : a.upc > b.upc ? 1 : 0));
    },

    /**
     * "Why this amount" for one ISRC: platform, country, subscription and sales type per month, over the given files.
     * Written against the rows (not the `breakdown` view) so that only the given files are counted.
     */
    async breakdown(
      fileIds: string[],
      isrc: string,
      /** 'YYYY-MM': only this report month. */
      reportingMonth?: string,
    ): Promise<
      {
        reportingMonth: string;
        salesMonth: string;
        platform: string;
        country: string;
        subscriptionType: string;
        salesType: string;
        upc: string;
        net: string;
        quantity: string;
      }[]
    > {
      if (fileIds.length === 0) return [];
      const rows = await json<{
        rm: string;
        sm: string;
        platform: string;
        country: string;
        subscription: string;
        sales_type: string;
        upc: string;
        net: string;
        qty: string;
      }>(
        `SELECT toString(reporting_month) AS rm, toString(sales_month) AS sm, platform,
                country_region AS country, streaming_subscription_type AS subscription, sales_type, upc,
                toString(sum(net_revenue)) AS net, toString(sum(quantity)) AS qty
         FROM ${DB}.rows WHERE isrc = {isrc:String} AND file_id IN {ids:Array(UUID)}${reportingMonth ? ' AND reporting_month = {month:Date}' : ''}
         GROUP BY reporting_month, sales_month, platform, country_region, streaming_subscription_type, sales_type, upc
         ORDER BY reporting_month, sales_month, sum(net_revenue) DESC, platform, country_region, streaming_subscription_type, sales_type, upc`,
        { isrc, ids: fileIds, ...(reportingMonth ? { month: `${reportingMonth}-01` } : {}) },
      );
      return rows.map((r) => ({
        reportingMonth: r.rm.slice(0, 7),
        salesMonth: r.sm.slice(0, 7),
        platform: r.platform,
        country: r.country,
        subscriptionType: r.subscription,
        salesType: r.sales_type,
        upc: r.upc,
        net: r.net,
        quantity: r.qty,
      }));
    },

    /**
     * Net per UPC over the given (loaded) files, from the `units` view (equal keys summed); exact decimal text. The
     * filter narrows the units summed.
     */
    async netByUpc(fileIds: string[], filter: UnitsFilter = {}): Promise<{ upc: string; net: string }[]> {
      const { where, params, empty } = unitsWhere(fileIds, filter);
      if (empty) return [];
      return json<{ upc: string; total: string }>(
        `SELECT upc, toString(sum(net_revenue)) AS total FROM ${DB}.units WHERE ${where} GROUP BY upc`,
        params,
      ).then((rows) => rows.map((r) => ({ upc: r.upc, net: r.total })));
    },

    /** Net per (ISRC, UPC) of the given ISRCs over the given files, from the `units` view; exact decimal text. */
    async netByIsrc(
      fileIds: string[],
      isrcs: string[],
    ): Promise<{ isrc: string; upc: string; net: string }[]> {
      if (fileIds.length === 0 || isrcs.length === 0) return [];
      return json<{ isrc: string; upc: string; total: string }>(
        `SELECT isrc, upc, toString(sum(net_revenue)) AS total FROM ${DB}.units
         WHERE file_id IN {ids:Array(UUID)} AND isrc IN {isrcs:Array(String)} GROUP BY isrc, upc ORDER BY isrc, upc`,
        { ids: fileIds, isrcs },
      ).then((rows) => rows.map((r) => ({ isrc: r.isrc, upc: r.upc, net: r.total })));
    },

    /** Names per (ISRC, UPC) from the latest report month in which the pair appears (metadata only). */
    async pairNames(fileIds: string[], filter: { isrcs?: string[]; upcs?: string[] } = {}): Promise<
      {
        isrc: string;
        upc: string;
        artistName: string;
        trackTitle: string;
        releaseTitle: string;
        labelName: string;
      }[]
    > {
      if (fileIds.length === 0 || filter.isrcs?.length === 0 || filter.upcs?.length === 0) return [];
      // the unit scope of the facade (D-162): only the pairs of these ISRCs / UPCs
      const where = ['file_id IN {ids:Array(UUID)}'];
      const params: Record<string, unknown> = { ids: fileIds };
      if (filter.isrcs) {
        where.push('isrc IN {isrcs:Array(String)}');
        params.isrcs = filter.isrcs;
      }
      if (filter.upcs) {
        where.push('upc IN {upcs:Array(String)}');
        params.upcs = filter.upcs;
      }
      const rows = await json<{
        isrc: string;
        upc: string;
        artist: string;
        track: string;
        release: string;
        label: string;
      }>(
        `SELECT isrc, upc, argMax(artist_name, reporting_month) AS artist, argMax(track_title, reporting_month) AS track,
                argMax(release_title, reporting_month) AS release, argMax(label_name, reporting_month) AS label
         FROM ${DB}.rows WHERE ${where.join(' AND ')} GROUP BY isrc, upc`,
        params,
      );
      return rows.map((r) => ({
        isrc: r.isrc,
        upc: r.upc,
        artistName: r.artist,
        trackTitle: r.track,
        releaseTitle: r.release,
        labelName: r.label,
      }));
    },

    /**
     * One page of the `lines` view (one record per key, equal keys of a file already summed) for the given files, with the
     * totals of everything that matches. Filters are exact matches; every value is bound as a query parameter. The page and
     * the totals are two scans of the view, run side by side. Result aliases never repeat a column name (see D-109).
     */
    async lines(
      fileIds: string[],
      filter: LinesFilter,
      page: { sort: LinesSort; dir: 'asc' | 'desc'; limit: number; offset: number },
    ): Promise<{ items: LineRow[]; total: LinesTotal }> {
      if (fileIds.length === 0)
        return { items: [], total: { keys: '0', quantity: '0', gross: '0', net: '0', mergedLines: '0' } };
      const { where, params } = linesWhere(fileIds, filter);
      const order = `${SORT_COLUMN[page.sort]} ${page.dir === 'asc' ? 'ASC' : 'DESC'}`;
      const [items, [total]] = await Promise.all([
        json<{
          fid: string;
          rm: string;
          sm: string;
          platform: string;
          country: string;
          isrc: string;
          upc: string;
          currency: string;
          subscription: string;
          sales_type: string;
          release_type: string;
          qty: string;
          gross: string;
          net: string;
          merged: string;
        }>(
          `SELECT toString(file_id) AS fid, toString(reporting_month) AS rm, toString(sales_month) AS sm, platform,
                  country_region AS country, isrc, upc, client_payment_currency AS currency,
                  streaming_subscription_type AS subscription, sales_type, release_type,
                  toString(quantity) AS qty, toString(gross_revenue) AS gross, toString(net_revenue) AS net,
                  toString(merged_lines) AS merged
           FROM ${DB}.lines WHERE ${where}
           ORDER BY ${order}, isrc, upc, reporting_month, sales_month, platform, country_region,
                    streaming_subscription_type, sales_type, release_type
           LIMIT {limit:UInt32} OFFSET {offset:UInt32}`,
          { ...params, limit: page.limit, offset: page.offset },
        ),
        json<{ keys: string; qty: string; gross: string; net: string; merged: string }>(
          `SELECT toString(count()) AS keys, toString(sum(quantity)) AS qty, toString(sum(gross_revenue)) AS gross,
                  toString(sum(net_revenue)) AS net, toString(sum(merged_lines)) AS merged
           FROM ${DB}.lines WHERE ${where}`,
          params,
        ),
      ]);
      return {
        items: items.map((r) => ({
          fileId: r.fid,
          reportingMonth: r.rm.slice(0, 7),
          salesMonth: r.sm.slice(0, 7),
          platform: r.platform,
          country: r.country,
          isrc: r.isrc,
          upc: r.upc,
          currency: r.currency,
          subscriptionType: r.subscription,
          salesType: r.sales_type,
          releaseType: r.release_type,
          quantity: r.qty,
          gross: r.gross,
          net: r.net,
          mergedLines: r.merged,
        })),
        total: {
          keys: total?.keys ?? '0',
          quantity: total?.qty ?? '0',
          gross: total?.gross ?? '0',
          net: total?.net ?? '0',
          mergedLines: total?.merged ?? '0',
        },
      };
    },

    /** Latest names of the given pairs (for the lines of one page): the pair is shown with its artist and track. */
    async namesOfPairs(
      fileIds: string[],
      pairs: { isrc: string; upc: string }[],
    ): Promise<{ isrc: string; upc: string; artistName: string; trackTitle: string }[]> {
      if (fileIds.length === 0 || pairs.length === 0) return [];
      const rows = await json<{ isrc: string; upc: string; artist: string; track: string }>(
        `SELECT isrc, upc, argMax(artist_name, reporting_month) AS artist, argMax(track_title, reporting_month) AS track
         FROM ${DB}.rows
         WHERE file_id IN {ids:Array(UUID)} AND isrc IN {isrcs:Array(String)} AND upc IN {upcs:Array(String)}
         GROUP BY isrc, upc`,
        {
          ids: fileIds,
          isrcs: [...new Set(pairs.map((p) => p.isrc))],
          upcs: [...new Set(pairs.map((p) => p.upc))],
        },
      );
      return rows.map((r) => ({ isrc: r.isrc, upc: r.upc, artistName: r.artist, trackTitle: r.track }));
    },

    /** The values a filter can take in the given files (for the drop-downs of the lines page). */
    async facets(fileIds: string[]): Promise<LinesFacets> {
      const empty: LinesFacets = {
        platforms: [],
        countries: [],
        subscriptionTypes: [],
        salesTypes: [],
        releaseTypes: [],
      };
      if (fileIds.length === 0) return empty;
      const [r] = await json<{ p: string[]; c: string[]; s: string[]; t: string[]; r: string[] }>(
        `SELECT groupUniqArray(platform) AS p, groupUniqArray(country_region) AS c,
                groupUniqArray(streaming_subscription_type) AS s, groupUniqArray(sales_type) AS t,
                groupUniqArray(release_type) AS r
         FROM ${DB}.rows WHERE file_id IN {ids:Array(UUID)}`,
        { ids: fileIds },
      );
      const sorted = (v: string[] | undefined) => [...(v ?? [])].sort((a, b) => a.localeCompare(b));
      return {
        platforms: sorted(r?.p),
        countries: sorted(r?.c),
        subscriptionTypes: sorted(r?.s),
        salesTypes: sorted(r?.t),
        releaseTypes: sorted(r?.r),
      };
    },

    /** Rows of one file in believe.rows (used by tests and checks). */
    async fileRows(fileId: string): Promise<string> {
      if (!UUID_RE.test(fileId)) throw new Error(`Not a file id: ${fileId}`);
      const rows = await (
        await ch.query({
          query: `SELECT toString(count()) AS n FROM ${DB}.rows WHERE file_id = {id:UUID}`,
          query_params: { id: fileId },
          format: 'JSONEachRow',
        })
      ).json<{ n: string }>();
      return (rows as { n: string }[])[0]?.n ?? '0';
    },
  };
}

export type BelieveColumnar = ReturnType<typeof createBelieveColumnar>;
