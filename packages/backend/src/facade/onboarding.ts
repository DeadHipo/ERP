import type { ONBOARDING_KEYS, ORG_ONBOARDING_KEYS } from '@erp/shared/api-responses';
import { ValidationError } from '../shared/errors';
import { normalizeLabelString } from '../modules/labels';
import type { FacadeContext } from './context';
import { labelAt, nextMonth } from './catalog';
import { labelBook } from './label-scope';
import { ALL_VIEWER, labelForbidden, viewerHolds, type Viewer } from './viewer';

/**
 * The onboarding checklists (D-172, plan «этап4_онбординг.md» §1.4): what is set up for a label and for the
 * organization, and what is left. Reads only, **no calculation** (`boundaries.test.ts`: this file never imports the
 * calculation): the PostgreSQL reads in one `db.snapshot()` and at most three ClickHouse reads over the loaded files of
 * the label (`isrcFilePairs`, `labelStringsOfFiles`, `isrcsOfUpcs` when the label has a release registry). The backend
 * decides the state of every step (R4): `done`, `todo`, or `info` (publishing: a label may have none).
 */

export type OnboardingKey = (typeof ONBOARDING_KEYS)[number];
export type OrgOnboardingKey = (typeof ORG_ONBOARDING_KEYS)[number];
export type OnboardingState = 'done' | 'todo' | 'info';

export interface AccountMonths {
  account: string;
  /** YYYY-MM of the first and the last loaded file of the account under the label; null without a file. */
  first: string | null;
  last: string | null;
  /** The months between `first` and `last` without a loaded file. */
  gaps: string[];
}

export interface OnboardingStep<K extends string = OnboardingKey> {
  key: K;
  state: OnboardingState;
  /** The headline number of the step: what is left to do (or, for `label`/`accounts`/`files`/`publishing`, what is there). */
  count: number;
  counts: Record<string, number>;
  /** The page of the client that fixes or shows the step (a route of the frontend, with its query). */
  link: string;
  /** `files`: the months per account. */
  months?: AccountMonths[];
  /** `unmapped`: the label strings (at most 100). */
  values?: string[];
}

const MAX_VALUES = 100;

/** The months from `first` to `last` (YYYY-MM) that are not in `have`. */
function gapsOf(first: string, last: string, have: ReadonlySet<string>): string[] {
  const out: string[] = [];
  for (let m = first; m < last; m = nextMonth(m)) if (!have.has(m)) out.push(m);
  return out;
}

export function onboardingApi(ctx: FacadeContext) {
  const { db, owners, splits, labels, sources, publishing, modules } = ctx;

  return {
    /**
     * The checklist of one own label (`GET /onboarding?label=`): label → accounts → files (months, gaps) → label
     * strings without an alias → catalog (label history, release registry) → ISRCs without a split → pseudonyms
     * without an owner → rows without an approved document and owners without a contract under the label →
     * publishing. 400 `label_required` without a label, 404 unknown, 400 `label_not_own`, 403 `label_forbidden` for
     * a viewer without the label.
     */
    async labelChecklist(labelId: string | undefined, viewer: Viewer = ALL_VIEWER) {
      if (!labelId) throw new ValidationError('Choose a label: ?label=', undefined, 'label_required');
      if (!viewerHolds(viewer, labelId)) throw labelForbidden();
      const pg = await db.snapshot(async () => {
        const book = await labelBook(modules, labelId);
        const label = await labels.getLabel(labelId);
        const allLabels = await labels.listLabels();
        const files = (await sources.listFiles({ labelId })).filter((f) => f.status === 'loaded' && f.source === 'believe');
        const splitList = await splits.listSplits();
        const participations = await splits.listParticipations();
        const index = await owners.artistIndex();
        const confirmed = await owners.confirmedContracts();
        const resolveOwner = await owners.ownerResolver();
        const history = await owners.trackLabels.list();
        const registry = await owners.releases.list({ labelId });
        const statements = (await publishing.listStatements()).filter((s) => s.labelId === labelId && s.status === 'loaded');
        const docIds = splitList.flatMap((s) => s.shares.map((sh) => sh.documentId ?? s.documentId)).filter((d): d is string => d !== null);
        const statusOf = await owners.documentStatuses(docIds);
        return { book, label, allLabels, files, splitList, participations, index, confirmed, resolveOwner, history, registry, statements, statusOf };
      });
      const { book, label, files, index } = pg;
      const fileIds = book.fileIds;

      // ClickHouse: (1) the (ISRC, file, month) observations of the label's files, (2) their label strings,
      // (3) the ISRCs of the registry's UPCs
      const pairs = await sources.isrcFilePairs(fileIds);
      const strings = await sources.labelStringsOfFiles(fileIds);
      const upcIsrcs = pg.registry.length > 0 && fileIds.length > 0 ? await sources.isrcsOfUpcs(fileIds, pg.registry.map((r) => r.upc)) : [];

      const hasFiles = files.length > 0;
      const steps: OnboardingStep[] = [];
      steps.push({ key: 'label', state: 'done', count: 1, counts: {}, link: `/labels/${label.id}` });
      steps.push({
        key: 'accounts',
        state: label.accounts.length > 0 ? 'done' : 'todo',
        count: label.accounts.length,
        counts: { accounts: label.accounts.length },
        link: `/labels/${label.id}`,
      });

      // files: per account the first and the last month and the months without a file between them
      const monthsOf = new Map<string, Set<string>>(label.accounts.map((a) => [a, new Set<string>()]));
      for (const f of files) (monthsOf.get(f.account) ?? monthsOf.set(f.account, new Set()).get(f.account))?.add(f.reportingMonth);
      const months: AccountMonths[] = [...monthsOf.entries()]
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([account, set]) => {
          const sorted = [...set].sort();
          const first = sorted[0] ?? null;
          const last = sorted[sorted.length - 1] ?? null;
          return { account, first, last, gaps: first && last ? gapsOf(first, last, set) : [] };
        });
      const gapCount = months.reduce((n, m) => n + m.gaps.length, 0);
      steps.push({
        key: 'files',
        state: hasFiles && gapCount === 0 ? 'done' : 'todo',
        count: files.length,
        counts: { files: files.length, months: new Set(files.map((f) => `${f.account}|${f.reportingMonth}`)).size, gaps: gapCount },
        link: '/sources',
        months,
      });

      // unmapped: the label strings of the label's files that are an alias of no label (the same strings as the
      // signal `labelUnmapped` under the label, which lists them with their money)
      const aliases = new Set(pg.allLabels.flatMap((l) => l.aliases.map(normalizeLabelString)));
      const unmapped = strings.filter((s) => !aliases.has(normalizeLabelString(s)));
      steps.push({
        key: 'unmapped',
        state: hasFiles && unmapped.length === 0 ? 'done' : 'todo',
        count: unmapped.length,
        counts: { strings: strings.length, unmapped: unmapped.length },
        link: '/signals/labelUnmapped',
        values: unmapped.slice(0, MAX_VALUES),
      });

      // catalog: the ISRCs of the files, those with an open interval of the label in their history, those whose
      // last month in the label's files has no interval (`tracksWithoutLabel` of the label), the release registry
      const lastMonth = new Map<string, string>();
      for (const p of pairs) {
        const m = lastMonth.get(p.isrc);
        if (m === undefined || p.reportingMonth > m) lastMonth.set(p.isrc, p.reportingMonth);
      }
      const isrcs = new Set(lastMonth.keys());
      const historyOf = new Map<string, typeof pg.history>();
      for (const h of pg.history) if (isrcs.has(h.isrc)) (historyOf.get(h.isrc) ?? historyOf.set(h.isrc, []).get(h.isrc))?.push(h);
      let withOpen = 0;
      let withoutLabel = 0;
      for (const [isrc, last] of lastMonth) {
        const hist = historyOf.get(isrc) ?? [];
        if (hist.some((h) => h.labelId === labelId && h.validTo === null)) withOpen += 1;
        if (!labelAt(hist, last)) withoutLabel += 1;
      }
      const isrcsOfUpc = new Map(upcIsrcs.map((u) => [u.upc, u.isrcs.length]));
      const incomplete = pg.registry.filter((r) => (r.trackCount ?? 0) > (isrcsOfUpc.get(r.upc) ?? 0)).length;
      steps.push({
        key: 'catalog',
        state: isrcs.size > 0 && withoutLabel === 0 ? 'done' : 'todo',
        count: withoutLabel,
        counts: { isrcs: isrcs.size, withOpenInterval: withOpen, tracksWithoutLabel: withoutLabel, releases: pg.registry.length, releasesIncomplete: incomplete },
        link: '/tracks?catalog=current',
      });

      // splits: ISRCs of the files with no split and no participation at any time
      const labelSplits = pg.splitList.filter((s) => isrcs.has(s.isrc));
      const labelParts = pg.participations.filter((p) => isrcs.has(p.isrc));
      const covered = new Set([...labelSplits.map((s) => s.isrc), ...labelParts.map((p) => p.isrc)]);
      const withoutSplit = [...isrcs].filter((i) => !covered.has(i)).length;
      steps.push({
        key: 'splits',
        state: isrcs.size > 0 && withoutSplit === 0 ? 'done' : 'todo',
        count: withoutSplit,
        counts: { isrcs: isrcs.size, withoutSplit },
        link: '/tracks?hasSplit=no',
      });

      // owners: the pseudonyms (merged ids resolved) of the split rows and participations on those ISRCs
      const canon = (id: string) => index.get(id)?.id ?? id;
      const pseudonyms = new Set<string>();
      for (const s of labelSplits) for (const sh of s.shares) pseudonyms.add(canon(sh.artistId));
      for (const p of labelParts) {
        pseudonyms.add(canon(p.artistId));
        if (p.fromArtistId !== null) pseudonyms.add(canon(p.fromArtistId));
      }
      const withoutOwner = [...pseudonyms].filter((id) => !index.get(id)?.ownerId).length;
      steps.push({
        key: 'owners',
        state: pseudonyms.size > 0 && withoutOwner === 0 ? 'done' : 'todo',
        count: withoutOwner,
        counts: { pseudonyms: pseudonyms.size, withoutOwner },
        link: '/artists?status=no_owner',
      });

      // documents: split rows without a document (their own or the split's), rows whose document is not approved
      // (an assumption never is), owners of the pseudonyms without an approved contract under the label
      const statusOf = pg.statusOf;
      let rows = 0;
      let rowsWithoutDocument = 0;
      let rowsUnapproved = 0;
      for (const s of labelSplits)
        for (const sh of s.shares) {
          rows += 1;
          const doc = sh.documentId ?? s.documentId;
          if (doc === null) rowsWithoutDocument += 1;
          else if (statusOf.get(doc) !== 'approved') rowsUnapproved += 1;
        }
      const confirmedHere = new Set(pg.confirmed.filter((c) => c.labelId === null || c.labelId === labelId).map((c) => pg.resolveOwner(c.ownerId)));
      const ownerIds = new Set([...pseudonyms].map((id) => index.get(id)?.ownerId).filter((o): o is string => !!o));
      const ownersWithoutContract = [...ownerIds].filter((o) => !confirmedHere.has(o)).length;
      const docTodo = rowsWithoutDocument + rowsUnapproved + ownersWithoutContract;
      steps.push({
        key: 'documents',
        state: rows > 0 && docTodo === 0 ? 'done' : 'todo',
        count: docTodo,
        counts: { rows, rowsWithoutDocument, rowsUnapproved, owners: ownerIds.size, ownersWithoutContract },
        link: '/splits?status=unconfirmed',
      });

      steps.push({
        key: 'publishing',
        state: 'info',
        count: pg.statements.length,
        counts: { statements: pg.statements.length, quarters: new Set(pg.statements.flatMap((s) => s.periods)).size },
        link: '/publishing',
      });
      return { label: { id: label.id, name: label.name }, steps };
    },

    /**
     * The checklist of the organization (`GET /onboarding/organization`, the administrator's): the organization →
     * own labels → members → Believe accounts. The member counts come from the caller (the route has the auth service;
     * the facade never imports it).
     */
    async organizationChecklist(users: { members: number; admins: number }) {
      const list = await db.snapshot(() => labels.listLabels());
      const own = list.filter((l) => l.kind === 'own');
      const accounts = own.reduce((n, l) => n + l.accounts.length, 0);
      const ownWithoutAccount = own.filter((l) => l.accounts.length === 0).length;
      const steps: OnboardingStep<OrgOnboardingKey>[] = [
        { key: 'org', state: 'done', count: 1, counts: {}, link: '/' },
        {
          key: 'labels',
          state: own.length > 0 ? 'done' : 'todo',
          count: own.length,
          counts: { own: own.length, sublabels: list.length - own.length },
          link: '/labels',
        },
        {
          key: 'users',
          state: users.members > 0 ? 'done' : 'todo',
          count: users.members,
          counts: { members: users.members, admins: users.admins },
          link: '/users',
        },
        {
          key: 'accounts',
          state: own.length > 0 && ownWithoutAccount === 0 ? 'done' : 'todo',
          count: accounts,
          counts: { accounts, ownWithoutAccount },
          link: '/labels',
        },
      ];
      return { steps };
    },
  };
}
