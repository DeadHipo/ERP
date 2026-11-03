import { Route } from 'react-router-dom';
import { ROUTE_PATHS } from './paths';
import { OperationsPage } from '../pages/operations/OperationsPage';
import { AdsPage } from '../pages/ads/AdsPage';
import { SourceLinesPage } from '../pages/reference/sources/SourceLinesPage';
import { SourcesPage } from '../pages/reference/sources/SourcesPage';

/** Деньги: source files and lines, operations, advertising. */
export const moneyRoutes = [
  <Route key="sources" path={ROUTE_PATHS.sources} element={<SourcesPage />} />,
  <Route key="source-lines" path={ROUTE_PATHS.sourceLines} element={<SourceLinesPage />} />,
  <Route key="operations" path={ROUTE_PATHS.operations} element={<OperationsPage />} />,
  <Route key="ads" path={ROUTE_PATHS.ads} element={<AdsPage />} />,
];
