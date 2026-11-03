import type { Facade } from '../../../src/facade';

/** What a scenario may use besides the facade: the names of the private stores and the directory of original files. */
export interface ScenarioHelpers {
  names: { pg: string; ch: string; chStage: string };
  dataDir: string;
}

export interface Scenario {
  id: string;
  run(f: Facade, helpers: ScenarioHelpers): Promise<void>;
}

/** The seed scenarios of the e2e database, run in order by `scripts/e2e/seed.ts`. Empty until step 3.2 of 18_frontend_plan.md. */
export const scenarios: Scenario[] = [];
