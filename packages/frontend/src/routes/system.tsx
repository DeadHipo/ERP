import { Route } from 'react-router-dom';
import { ROUTE_PATHS } from './paths';
import { OrgPage } from '../pages/system/OrgPage';
import { OrgsPage } from '../pages/system/OrgsPage';
import { SystemUsersPage } from '../pages/system/UsersPage';
import { UsersPage } from '../pages/users/UsersPage';

/** Система (D-170): the organizations of the system administrator; no money. */
export const systemRoutes = [
  <Route key="system-orgs" path={ROUTE_PATHS.systemOrgs} element={<OrgsPage />} />,
  <Route key="system-org" path={ROUTE_PATHS.systemOrg} element={<OrgPage />} />,
  <Route key="system-users" path={ROUTE_PATHS.systemUsers} element={<SystemUsersPage />} />,
  // P26: the organization's own users (its administrator, D-171)
  <Route key="users" path={ROUTE_PATHS.users} element={<UsersPage />} />,
];
