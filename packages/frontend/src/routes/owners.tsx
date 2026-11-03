import { Route } from 'react-router-dom';
import { ROUTE_PATHS } from './paths';
import { OwnersPage } from '../pages/owners/OwnersPage';
import { OwnerPage } from '../pages/owners/OwnerPage';

/** Владельцы: the list with the payouts view and the owner card. */
export const ownersRoutes = [
  <Route key="owners" path={ROUTE_PATHS.owners} element={<OwnersPage />} />,
  <Route key="owner" path={ROUTE_PATHS.owner} element={<OwnerPage />} />,
];
