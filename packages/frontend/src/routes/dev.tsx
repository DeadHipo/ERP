import { Route } from 'react-router-dom';
import { ROUTE_PATHS } from './paths';
import { StatesPage } from '../pages/dev/StatesPage';

/** The states fixture page (documented in packages/frontend/CLAUDE.md); not in the sidebar. */
export const devRoutes = [<Route key="dev-states" path={ROUTE_PATHS.devStates} element={<StatesPage />} />];
