import { Router } from 'express';
import * as S from '@erp/shared/api-schemas';
import type { Facade } from '../../facade';
import { param, parse } from '../http';
import { drain, receiveUpload } from '../upload';
import { viewerOf } from '../viewer';
import { AppError } from '../../shared/errors';
import { RELEASE_IMPORT_MAX_BYTES } from '@erp/shared/release-import';

/** Money aggregates for the screens (D-142): payables, tracks, releases, document uses. Mounted before the owner routes. */
export function aggregatesRouter(facade: Facade, opts: { tmpDir: string }) {
  const r = Router();

  r.get('/owners/payables', async (req, res) =>
    res.json(await facade.ownerPayables(parse(S.payablesAsOfQuery, req.query))),
  );
  // the payroll of a label (D-173 §1.4): json (every sheet) or one sheet as csv; before /owners/:id
  r.get('/owners/payroll', async (req, res) => {
    const q = parse(S.payrollQuery, req.query);
    if (q.format === 'csv') {
      const { fileName, text } = await facade.payrollCsv(q.label, { asOf: q.asOf, area: q.area, sheet: q.sheet }, viewerOf(res));
      const ascii = fileName.replace(/[^A-Za-z0-9._-]/g, '_');
      res.setHeader('Content-Type', 'text/csv; charset=utf-8');
      res.setHeader('Content-Disposition', `attachment; filename="${ascii}"; filename*=UTF-8''${encodeURIComponent(fileName)}`);
      res.send(text);
      return;
    }
    res.json(await facade.payroll(q.label, { asOf: q.asOf, area: q.area }, viewerOf(res)));
  });
  r.get('/tracks/summary', async (req, res) =>
    res.json(await facade.trackSummary(parse(S.trackSummaryQuery, req.query))),
  );
  r.get('/tracks/catalog', async (req, res) => res.json(await facade.trackCatalog(parse(S.trackCatalogQuery, req.query))));
  // the label history of an ISRC (D-172): navigation, not money
  r.get('/tracks/:isrc/labels', async (req, res) => res.json(await facade.trackLabels(param(req, 'isrc'))));
  r.post('/tracks/:isrc/label', async (req, res) =>
    res.status(201).json(await facade.setTrackLabel(param(req, 'isrc'), parse(S.setTrackLabelBody, req.body), viewerOf(res))),
  );
  r.get('/tracks/:isrc/money', async (req, res) => res.json(await facade.trackMoney(param(req, 'isrc'))));
  r.get('/tracks/:isrc/breakdown/:month', async (req, res) =>
    res.json(await facade.trackBreakdown(param(req, 'isrc'), param(req, 'month'))),
  );
  r.get('/releases', async (req, res) => {
    const q = parse(S.releasesQuery, req.query);
    res.json(await facade.releases(q.q, q.label));
  });
  // the release registry (D-172, no money): before /releases/:upc (a static segment before the parameter)
  r.get('/releases/registry', async (req, res) => res.json(await facade.releaseRegistry(parse(S.releaseRegistryQuery, req.query))));
  // the Believe release export of a label (D-172): the label is checked before the body is received
  r.post('/releases/import', async (req, res) => {
    let label: string | undefined;
    try {
      label = parse(S.uploadLabelQuery, req.query).label;
      await facade.assertUploadLabel(label);
    } catch (e) {
      await drain(req);
      throw e;
    }
    const up = await receiveUpload(req, opts.tmpDir, {
      maxBytes: RELEASE_IMPORT_MAX_BYTES,
      error: () => new AppError('The release export is larger than 10 MB', 413, 'import_too_large', { maxBytes: RELEASE_IMPORT_MAX_BYTES }),
    });
    try {
      res.status(201).json(await facade.importReleases({ path: up.path, fileName: up.fileName, labelId: label }, viewerOf(res)));
    } finally {
      await up.cleanup();
    }
  });
  r.get('/releases/:upc', async (req, res) =>
    res.json(await facade.release(param(req, 'upc'), parse(S.releaseQuery, req.query).label)),
  );
  r.get('/documents/:id/uses', async (req, res) => res.json(await facade.documentUses(param(req, 'id'), viewerOf(res))));

  return r;
}
