import { Router } from 'express';
import * as S from '@erp/shared/api-schemas';
import type { Facade } from '../../facade';
import { parse } from '../http';
import { viewerOf } from '../viewer';

/** The onboarding checklist of one own label (D-172): reads only, no calculation; without `label` 400 `label_required`. */
export function onboardingRouter(facade: Facade) {
  const r = Router();
  r.get('/onboarding', async (req, res) => {
    const { label } = parse(S.onboardingQuery, req.query);
    res.json(await facade.labelChecklist(label, viewerOf(res)));
  });
  return r;
}
