import { join } from 'node:path';
import type { Router } from 'express';
import { openFacade, type Facade } from '../facade';
import type { PaymentService } from '../facade/payment-service';
import { createOrgRouter } from '../api/org-router';
import { sourcesFor, type Stores } from '../connect-sources';
import { createOrgsService, OrgNotFoundError } from './service';

/** The facade of an organization and its routes (`createOrgRouter`). */
export interface OrgEntry {
  orgId: string;
  facade: Facade;
  router: Router;
}

/**
 * The facades of the organizations of one process (D-170), opened lazily on first use and kept (an entry holds no
 * connection of its own: closures over the shared stores and the upload queue of its services). `get` is single-flight
 * per organization; an organization that is not in `orgs.organizations` is `404 org_not_found` and is not remembered.
 */
export function createOrgFacades(opts: {
  stores: Pick<Stores, 'db' | 'pool' | 'columnar'> & { close?: () => Promise<void> };
  dataDir: string;
  payoutThresholdCents: number;
  paymentService?: PaymentService;
}) {
  const { stores, dataDir } = opts;
  const service = createOrgsService(stores.db);
  const entries = new Map<string, Promise<OrgEntry>>();

  async function open(orgId: string): Promise<OrgEntry> {
    const org = await service.findOrganization(orgId);
    if (!org) throw new OrgNotFoundError(orgId);
    const facade = openFacade({
      db: stores.db,
      orgId: org.id,
      dataDir,
      payoutThresholdCents: opts.payoutThresholdCents,
      sources: sourcesFor(stores, org.id, dataDir),
      ...(opts.paymentService ? { paymentService: opts.paymentService } : {}),
    });
    return { orgId: org.id, facade, router: createOrgRouter(facade, { tmpDir: join(dataDir, 'orgs', org.id, 'tmp') }) };
  }

  return {
    /** The organizations service (list, create, get) over the same database. */
    service,
    get(orgId: string): Promise<OrgEntry> {
      let entry = entries.get(orgId);
      if (!entry) {
        entry = open(orgId);
        entries.set(orgId, entry);
        void entry.catch(() => entries.delete(orgId));
      }
      return entry;
    },
    /** Waits for the entries being opened and closes the stores. */
    async close(): Promise<void> {
      await Promise.allSettled(entries.values());
      await stores.close?.();
    },
  };
}

export type OrgFacades = ReturnType<typeof createOrgFacades>;
