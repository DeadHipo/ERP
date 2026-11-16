import { Router } from 'express';
import * as S from '@erp/shared/api-schemas';
import type { Facade } from '../../facade';
import { param, parse } from '../http';

/**
 * The sublabels (D-217, D-218): the register of names and the terms of a sublabel on a track, by the rules of the
 * publishing terms. The money does not read them yet. The routes of the terms come before `/sublabels/:id`.
 */
export function sublabelsRouter(facade: Facade) {
  const r = Router();
  const operator = (res: { locals: Record<string, unknown> }) => res.locals.operator as string;

  r.get('/sublabels/terms', async (req, res) => {
    const q = parse(S.sublabelTermsQuery, req.query);
    res.json(
      await facade.listSublabelTerms({
        sublabel: q.sublabel,
        isrc: q.isrc,
        month: q.month,
        noDocument: q.noDocument === '1',
        withCancelled: q.withCancelled === '1',
      }),
    );
  });
  r.post('/sublabels/terms/document', async (req, res) => {
    const b = parse(S.sublabelTermsDocumentBody, req.body);
    res.json(await facade.attachSublabelTermsDocument(b.ids, b.documentId, operator(res)));
  });
  r.post('/sublabels/terms/:id/close', async (req, res) =>
    res.json(await facade.closeSublabelTerm(param(req, 'id'), parse(S.sublabelTermCloseBody, req.body).validTo)),
  );
  r.post('/sublabels/terms/:id/cancel', async (req, res) =>
    res.json(await facade.cancelSublabelTerm(param(req, 'id'), operator(res), parse(S.sublabelTermCancelBody, req.body).reason)),
  );

  r.get('/sublabels/suggestions', async (req, res) =>
    res.json(await facade.sublabelSuggestions(parse(S.sublabelSuggestionsQuery, req.query).month)),
  );
  r.get('/sublabels', async (_req, res) => res.json(await facade.listSublabels()));
  r.post('/sublabels', async (req, res) => res.status(201).json(await facade.createSublabel(parse(S.sublabelNameBody, req.body).name)));
  r.patch('/sublabels/:id', async (req, res) =>
    res.json(await facade.renameSublabel(param(req, 'id'), parse(S.sublabelNameBody, req.body).name)),
  );
  // the report of a sublabel by its terms (D-219): json, or one csv sheet
  r.get('/sublabels/:id/report', async (req, res) => {
    const q = parse(S.sublabelReportQuery, req.query);
    const period = { from: q.from, to: q.to };
    if (q.format === 'csv') {
      const { fileName, text } = await facade.sublabelReportCsv(param(req, 'id'), period);
      const ascii = fileName.replace(/[^A-Za-z0-9._-]/g, '_');
      res.setHeader('Content-Type', 'text/csv; charset=utf-8');
      res.setHeader('Content-Disposition', `attachment; filename="${ascii}"; filename*=UTF-8''${encodeURIComponent(fileName)}`);
      res.send(text);
      return;
    }
    res.json(await facade.sublabelReport(param(req, 'id'), period));
  });
  r.post('/sublabels/:id/terms', async (req, res) => {
    const { dryRun } = parse(S.sublabelTermsAddQuery, req.query);
    const body = parse(S.sublabelTermsBody, req.body);
    const out = await facade.addSublabelTerms(param(req, 'id'), body, { dryRun: dryRun !== '0' }, operator(res));
    res.status(out.applied ? 201 : 200).json(out);
  });
  return r;
}
