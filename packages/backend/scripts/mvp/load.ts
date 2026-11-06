/**
 * Stage 4 data loader (docs/agents/11_plan.md, steps 4.1 to 4.7).
 *
 * Usage: npx tsx packages/backend/scripts/mvp/load.ts <step> [--apply]
 *   steps: labels, tracks, splits, normalise-dates, participations, exclusions, echo8, main, terms, contracts,
 *   pairs, label-fixes, lunar, b17-holders, carves (stage 6 fixes, D-135; carves reworked by D-137),
 *   settlement-prestart, assumption-rows, hygiene (stage 6 rework, D-137), ads (advertising history, D-156), all
 * Without --apply it is a dry run: nothing is written to the database; the log is prefixed "DRY RUN".
 * `all` runs the steps in dependency order in one process (a dry run of `all` shows the combined effect):
 *   labels, tracks, normalise-dates, splits, participations, exclusions, echo8, main, terms.
 * The database is the one of <repo>/.env (DB_DATABASE). Logs: data/mvp-load/log/<step>-<timestamp>.md.
 */
import { Ctx, LOAD_DIR, Log, errText } from './lib';
import { connectOrg, takeOrgArgument } from '../../src/connect-sources';
import {
  stepExclusions,
  stepLabels,
  stepNormalise,
  stepParticipations,
  stepSplits,
  stepTracks,
} from './steps-annex';
import {
  stepB17Holders,
  stepCarves,
  stepContracts,
  stepEcho8,
  stepLabelFixes,
  stepLunar,
  stepMain,
  stepPairs,
  stepTerms,
} from './steps-main';
import { stepAssumptionRows, stepHygiene, stepSettlementPrestart } from './steps-stage6';
import { stepAds } from './steps-ads';

const STEPS: Record<string, (ctx: Ctx) => Promise<void>> = {
  labels: stepLabels,
  tracks: (c) => stepTracks(c),
  splits: stepSplits,
  'normalise-dates': stepNormalise,
  participations: stepParticipations,
  exclusions: stepExclusions,
  echo8: stepEcho8,
  main: stepMain,
  terms: stepTerms,
  contracts: stepContracts,
  pairs: stepPairs,
  'label-fixes': stepLabelFixes,
  lunar: stepLunar,
  'b17-holders': stepB17Holders,
  carves: stepCarves,
  'settlement-prestart': stepSettlementPrestart,
  'assumption-rows': stepAssumptionRows,
  hygiene: stepHygiene,
  ads: stepAds,
};
const ALL = ['labels', 'tracks', 'normalise-dates', 'splits', 'participations', 'exclusions', 'echo8', 'main', 'terms', 'contracts', 'pairs', 'label-fixes', 'lunar', 'b17-holders', 'carves', 'settlement-prestart', 'assumption-rows', 'hygiene', 'ads'];

// the organization (D-170): --org <id> anywhere on the line, else ERP_ORG / ERP_DEFAULT_ORG
const ORG = takeOrgArgument();
const args = process.argv.slice(2);
const apply = args.includes('--apply');
const step = args.find((a) => !a.startsWith('--'));
if (!step || (step !== 'all' && !STEPS[step])) {
  console.error(`usage: load.ts <${[...Object.keys(STEPS), 'all'].join('|')}> [--apply]`);
  process.exit(2);
}

const ctx = new Ctx(apply, await connectOrg({ dataDir: LOAD_DIR, org: ORG }));
let failed = false;
try {
  await ctx.load();
  for (const name of step === 'all' ? ALL : [step]) {
    ctx.log = new Log(name, apply);
    console.log(`${apply ? 'APPLY' : 'DRY RUN'} ${name} ...`);
    try {
      await (STEPS[name] as (c: Ctx) => Promise<void>)(ctx);
    } catch (e) {
      failed = true;
      ctx.log.event('STEP_FAILED', errText(e));
      console.error(`step ${name} failed: ${errText(e)}`);
    }
    const file = ctx.log.write();
    console.log(`  ${ctx.log.summary() || '(nothing)'}\n  log: ${file}`);
    if (failed && apply) break;
  }
} finally {
  await ctx.close();
}
process.exit(failed ? 1 : 0);
