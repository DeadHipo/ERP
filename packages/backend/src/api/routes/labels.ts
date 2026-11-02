import { Router } from 'express';
import * as S from '@erp/shared/api-schemas';
import type { Facade } from '../../facade';
import { param, parse } from '../http';

/** Labels: own labels, sublabels, Believe label strings (aliases) and sublabel rules (D-125). */
export function labelsRouter(facade: Facade) {
  const { labels } = facade.modules;
  const r = Router();

  r.get('/labels', async (_req, res) => res.json(await facade.listLabels()));
  r.post('/labels', async (req, res) =>
    res.status(201).json(await labels.createLabel(parse(S.createLabelBody, req.body))),
  );
  // Before `/labels/:id/...` so that `rules` is never read as an id.
  r.post('/labels/rules/:id/close', async (req, res) =>
    res.json(await facade.closeLabelRule(param(req, 'id'), parse(S.closeValidToBody, req.body).validTo)),
  );
  r.post('/labels/:id/aliases', async (req, res) =>
    res.status(201).json(await labels.addAlias(param(req, 'id'), parse(S.addAliasBody, req.body).alias)),
  );
  r.post('/labels/:id/rules', async (req, res) =>
    res
      .status(201)
      .json(
        await facade.createLabelRule({ labelId: param(req, 'id'), ...parse(S.createLabelRuleBody, req.body) }),
      ),
  );

  return r;
}
