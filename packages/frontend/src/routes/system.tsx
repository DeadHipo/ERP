import { Route } from 'react-router-dom';
import { ROUTE_PATHS } from './paths';
import { OrgPage } from '../pages/system/OrgPage';
import { OrgsPage } from '../pages/system/OrgsPage';

/** Система (D-170): the organizations of the system administrator; no money. */
export const systemRoutes = [
  <Route key="system-orgs" path={ROUTE_PATHS.systemOrgs} element={<OrgsPage />} />,
  <Route key="system-org" path={ROUTE_PATHS.systemOrg} element={<OrgPage />} />,
];
