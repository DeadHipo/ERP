import { join } from 'node:path';
import { openOwnersModule, type OwnersService } from '../modules/owners';
import { openSplitsModule, type SplitsService } from '../modules/splits';
import type { SourcesService } from '../modules/sources';
import { openSettlementsModule, type SettlementsService } from '../modules/settlements';
import { openPublishingModule, type PublishingService } from '../modules/publishing';
import { createFacadeContext, type FacadeConfig } from './context';
import { splitsApi } from './splits';
import { sourcesApi } from './sources';
import { reportsApi } from './reports';
import { ownerViewApi } from './owner-view';
import { payoutsApi } from './payouts';

export type { FacadeConfig, ShareSpec } from './context';

/**
 * The facade: the only place that composes modules. It recalculates everything from scratch for every request.
 * Modules do not know about it. The methods are grouped by topic in the sibling files; this file only opens the
 * modules and puts the groups together.
 */
export function openFacade(config: FacadeConfig) {
  const mem = config.dataDir === ':memory:';
  const file = (name: string) => (mem ? ':memory:' : join(config.dataDir, `${name}.sqlite`));
  const files = (name: string) =>
    join(
      mem ? join(import.meta.dirname, '..', '..', '..', '..', 'data', 'test-files') : config.dataDir,
      'files',
      name,
    );
  const ownersM = openOwnersModule(file('owners'));
  const splitsM = openSplitsModule(file('splits'));
  const settlementsM = openSettlementsModule(file('settlements'));
  const publishingM = openPublishingModule(file('publishing'), files('publishing'));
  const owners: OwnersService = ownersM.service;
  const splits: SplitsService = splitsM.service;
  const sources: SourcesService = config.sources;
  const settlements: SettlementsService = settlementsM.service;
  const publishing: PublishingService = publishingM.service;
  const ctx = createFacadeContext(config, { owners, splits, sources, settlements, publishing });

  return {
    modules: { owners, splits, sources, settlements, publishing },

    close() {
      for (const m of [ownersM, splitsM, settlementsM, publishingM]) m.close();
    },

    ...splitsApi(ctx),
    ...sourcesApi(ctx),
    ...reportsApi(ctx),
    ...ownerViewApi(ctx),
    ...payoutsApi(ctx),
  };
}

export type Facade = ReturnType<typeof openFacade>;
export type { PeriodFilter } from './calculation';
