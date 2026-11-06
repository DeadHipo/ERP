import { randomBytes } from 'node:crypto';
import { mkdirSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { createBelieveColumnar, createSourcesService, createSourceFilesRegistry } from '../../src/modules/sources';
import { createPrivateStores } from '../../src/shared/private-stores';
import { orgScope } from '../../src/shared/org-scope';
import { TMP } from './tmp-root';
import './stack';

/**
 * A private PostgreSQL database and private ClickHouse databases with the real migrations applied, for one test file
 * (`createPrivateStores`, D-140). Nothing of the development data is touched. `close()` drops them.
 */
export async function createIsolatedSources() {
  const id = randomBytes(5).toString('hex');
  const stores = await createPrivateStores(`t_${id}`);
  const { pg, ch, db, reset, resetModules } = stores;
  const database = stores.names.ch;
  const stageDatabase = stores.names.chStage;
  const storageDir = join(TMP, `sources-${id}`);
  mkdirSync(storageDir, { recursive: true });

  const registry = createSourceFilesRegistry(pg.pool, orgScope(stores.orgId));
  const columnar = createBelieveColumnar(ch, { database, stageDatabase });
  const service = createSourcesService({ registry, columnar, storageDir });

  return {
    pg,
    ch,
    db,
    /** The organization of the private stores (D-170): every facade and the registry here are opened under it. */
    orgId: stores.orgId,
    registry,
    columnar,
    service,
    storageDir,
    database,
    stageDatabase,
    /** Empties the sources: no files, no rows, no stage tables. */
    reset,
    /** Empties every table of the modules owners, splits, labels, settlements, publishing and audit. */
    resetModules,
    async close() {
      await stores.drop();
      rmSync(storageDir, { recursive: true, force: true });
    },
  };
}
