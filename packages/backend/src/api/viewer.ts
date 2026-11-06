import type { Response } from 'express';
import { UnauthenticatedError } from '../shared/errors';
import { ALL_VIEWER, labelsViewer, type Viewer } from '../facade/viewer';
import { principalOf } from './authorize';

/**
 * The facade's `Viewer` of a request (D-171): every label for a principal with all labels (`org_admin`, `local`,
 * support), the principal's own labels for a label manager. Routes pass it to the methods whose right depends on the
 * label of a record; they never see roles. No principal = the chain did not build one: 401 (fail closed).
 */
export function viewerOf(res: Response): Viewer {
  const p = principalOf(res);
  if (!p) throw new UnauthenticatedError();
  return p.labelIds === 'all' ? ALL_VIEWER : labelsViewer(p.labelIds);
}
