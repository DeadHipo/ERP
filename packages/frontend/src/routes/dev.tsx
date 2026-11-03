import { Route } from 'react-router-dom';
import { StatesPage } from '../pages/dev/StatesPage';

/** The states fixture page (documented in packages/frontend/CLAUDE.md); not in the sidebar. */
export const devRoutes = [<Route key="dev-states" path="dev/states" element={<StatesPage />} />];
