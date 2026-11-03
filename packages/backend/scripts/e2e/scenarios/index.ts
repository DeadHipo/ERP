import type { Facade } from '../../../src/facade';
import type { Seed } from '../lib';
import { shared } from './shared';
import { masterRows } from './master-rows';
import { labelsAndSigns } from './labels-and-signs';
import { assumptionsExactness } from './assumptions-exactness';
import { overviewRelease } from './overview-release';
import { queueDocuments } from './queue-documents';
import { queueOwners } from './queue-owners';
import { queueLabels } from './queue-labels';
import { publishing } from './publishing';
import { perimeterSignals } from './perimeter-signals';
import { payouts } from './payouts';
import { operations } from './operations';
import { rulesDates } from './rules-dates';
import { sources } from './sources';

/** What a scenario may use besides the facade: the names of the private stores, the data directory and the seed toolkit. */
export interface ScenarioHelpers {
  names: { pg: string; ch: string; chStage: string };
  dataDir: string;
  seed: Seed;
}

export interface Scenario {
  id: string;
  run(f: Facade, helpers: ScenarioHelpers): Promise<void>;
}

/**
 * The seed scenarios of the e2e database, run in order by `scripts/e2e/seed.ts`: the shared seed S00 first (labels, NG,
 * QQ, the brand), then S01..S37 by id. The B17 statement collected by the scenarios is loaded by seed.ts after the last one.
 */
export const scenarios: Scenario[] = [
  ...shared,
  ...masterRows,
  ...labelsAndSigns,
  ...assumptionsExactness,
  ...overviewRelease,
  ...queueDocuments,
  ...publishing,
  ...queueOwners,
  ...queueLabels,
  ...perimeterSignals,
  ...payouts,
  ...operations,
  ...rulesDates,
  ...sources,
].sort((a, b) => a.id.localeCompare(b.id));
