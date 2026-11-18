/**
 * D-241: the track meta (D-238) from the isrc-lookup collector (`~/Desktop/isrc-lookup/data/isrc.db`, read only).
 * Every ISRC the collector finished (`status = 'done'`) since the last run: a found one sets the meta (the platform
 * title, the version = the tail after « - » when the title is ours plus it, the artists, the cover, primary platform
 * spotify) and its Spotify entry (the album link, source `isrc-lookup`); a not found one gets only a Spotify entry
 * with the status `not_found`. Through the facade (the same code as the API), each write in the audit under the
 * operator `isrc-lookup`; a meta edited by a person (another `updated_by`) is never overwritten. The last `fetched_at`
 * taken is kept in a state file, so a run takes only what is new (`--all` takes everything again). Dry run by
 * default; nothing here reads or changes money.
 *
 *   npx tsx packages/backend/scripts/catalog/load-isrc-lookup.ts <isrc.db> [--apply] [--all] [--state <file>] [--org <id>] [dataDir]
 */
import { DatabaseSync } from 'node:sqlite';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { openFacade } from '../../src/facade';
import { connectOrg, takeOrgArgument } from '../../src/connect-sources';

const ORG = takeOrgArgument();
const args = process.argv.slice(2);
const apply = args.includes('--apply');
const all = args.includes('--all');
const valueOf = (flag: string) => {
  const i = args.indexOf(flag);
  return i >= 0 ? args[i + 1] : undefined;
};
const positional = args.filter((a, i) => !a.startsWith('--') && args[i - 1] !== '--state');
const [dbPath, dataDirArg] = positional;
if (!dbPath) {
  console.error('usage: load-isrc-lookup.ts <isrc.db> [--apply] [--all] [--state <file>] [--org <id>] [dataDir]');
  process.exit(1);
}
const root = resolve(import.meta.dirname, '..', '..', '..', '..');
const dataDir = resolve(dataDirArg ?? join(root, 'data'));
const statePath = resolve(valueOf('--state') ?? join(root, 'data', 'mvp-load', 'isrc-lookup', 'state.json'));
const OP = 'isrc-lookup';

type State = { lastFetchedAt: number; lastRunAt: string };
const state: State = existsSync(statePath) ? (JSON.parse(readFileSync(statePath, 'utf8')) as State) : { lastFetchedAt: 0, lastRunAt: '' };
const since = all ? 0 : state.lastFetchedAt;

interface Row {
  isrc: string;
  found: number | null;
  title: string | null;
  artist: string | null;
  spotify_url: string | null;
  cover: string | null;
  data: string | null;
  fetched_at: number;
}
const src = new DatabaseSync(resolve(dbPath), { readOnly: true });
const rows = src
  .prepare("SELECT isrc, found, title, artist, spotify_url, cover, data, fetched_at FROM isrcs WHERE status = 'done' AND fetched_at > ? ORDER BY fetched_at")
  .all(since) as unknown as Row[];
src.close();

const stack = await connectOrg({ dataDir, org: ORG });
const f = openFacade({ db: stack.db, orgId: stack.orgId, dataDir, payoutThresholdCents: 5000, sources: stack.sources });
const stats = { mode: apply ? 'apply' : 'dry-run', since: since ? new Date(since).toISOString() : null, rows: rows.length, found: 0, notFound: 0, notInCatalog: 0, withVersion: 0, skippedManual: 0, metaWritten: 0, platformAdded: 0, platformUpdated: 0 };
try {
  const ours = new Map<string, string>();
  if (rows.length > 0) for (const t of await f.modules.owners.listTracks({ isrcs: rows.map((r) => r.isrc) })) if (t.isrc && !ours.has(t.isrc)) ours.set(t.isrc, t.title);
  for (const r of rows) {
    const d = JSON.parse(r.data ?? '{}') as { spotifyType?: string; spotifyId?: string; message?: string };
    const our = ours.get(r.isrc);
    if (!our) stats.notInCatalog += 1;
    const cur = await f.trackMeta(r.isrc);
    const existing = cur.platforms.find((p) => p.platform === 'spotify' && p.source === OP);
    const fetchedAt = new Date(r.fetched_at).toISOString();
    const savePlatform = async (entry: Record<string, unknown>) => {
      if (!apply) return;
      if (existing) {
        await f.updateTrackPlatform(existing.id, entry, OP);
        stats.platformUpdated += 1;
      } else {
        const p = await f.addTrackPlatform(r.isrc, { platform: 'spotify', ...entry }, OP);
        await f.recordAction({ operator: OP, method: 'POST', route: '/tracks/:isrc/platforms', entityIds: [p.id], summary: { isrc: r.isrc, platform: 'spotify', status: p.status }, labelId: null });
        stats.platformAdded += 1;
      }
    };
    if (r.found !== 1) {
      stats.notFound += 1;
      await savePlatform({ status: 'not_found', source: OP, raw: { message: d.message ?? null }, fetchedAt });
      continue;
    }
    stats.found += 1;
    let version: string | null = null;
    if (r.title && our && r.title.toLowerCase().startsWith(`${our.toLowerCase()} - `)) version = r.title.slice(our.length + 3).trim() || null;
    if (version) stats.withVersion += 1;
    if (cur.meta && cur.meta.updatedBy && cur.meta.updatedBy !== OP) {
      stats.skippedManual += 1;
    } else if (apply) {
      await f.setTrackMeta(r.isrc, { title: r.title, version, artists: r.artist, coverUrl: r.cover, primaryPlatform: 'spotify' }, OP);
      await f.recordAction({ operator: OP, method: 'PATCH', route: '/tracks/:isrc/meta', entityIds: [r.isrc], summary: { isrc: r.isrc }, labelId: null });
      stats.metaWritten += 1;
    }
    const isAlbum = d.spotifyType === 'album';
    await savePlatform({
      albumId: isAlbum ? (d.spotifyId ?? null) : null,
      albumUrl: isAlbum ? r.spotify_url : null,
      platformId: d.spotifyType === 'track' ? (d.spotifyId ?? null) : null,
      url: d.spotifyType === 'track' ? r.spotify_url : null,
      title: r.title,
      artists: r.artist,
      coverUrl: r.cover,
      status: 'found',
      source: OP,
      raw: { spotifyType: d.spotifyType ?? null, spotifyId: d.spotifyId ?? null, spotifyUrl: r.spotify_url },
      fetchedAt,
    });
  }
  if (apply && rows.length > 0) {
    mkdirSync(dirname(statePath), { recursive: true });
    const last = rows[rows.length - 1] as Row;
    writeFileSync(statePath, JSON.stringify({ lastFetchedAt: Math.max(state.lastFetchedAt, last.fetched_at), lastRunAt: new Date().toISOString() } satisfies State, null, 2));
  }
  console.log(JSON.stringify({ at: new Date().toISOString(), ...stats }));
} finally {
  await stack.close();
}
