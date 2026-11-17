import { Router } from 'express';
import * as S from '@erp/shared/api-schemas';
import type { Facade } from '../../facade';
import { param, parse } from '../http';

/** Labels: own labels, their Believe label strings (aliases) and accounts (D-125, D-168; no sublabel since D-232). */
export function labelsRouter(facade: Facade) {
  const { labels } = facade.modules;
  const r = Router();

  r.get('/labels', async (_req, res) => res.json(await facade.listLabels()));
  r.post('/labels', async (req, res) =>
    res.status(201).json(await labels.createLabel(parse(S.createLabelBody, req.body))),
  );
  r.post('/labels/:id/accounts', async (req, res) =>
    res.status(201).json(await labels.addAccount(param(req, 'id'), parse(S.addAccountBody, req.body).account)),
  );
  r.post('/labels/:id/accounts/:account/remove', async (req, res) =>
    res.json(await facade.removeLabelAccount(param(req, 'id'), param(req, 'account'))),
  );
  r.post('/labels/:id/aliases', async (req, res) =>
    res.status(201).json(await labels.addAlias(param(req, 'id'), parse(S.addAliasBody, req.body).alias)),
  );

  return r;
}
