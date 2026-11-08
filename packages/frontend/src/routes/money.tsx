import { Route } from 'react-router-dom';
import { ROUTE_PATHS } from './paths';
import { OperationsPage } from '../pages/operations/OperationsPage';
import { OperationImportPage } from '../pages/operations/import/OperationImportPage';
import { CutPage } from '../pages/operations/cuts/CutPage';
import { CutsPage } from '../pages/operations/cuts/CutsPage';
import { AdPage } from '../pages/ads/AdPage';
import { AdsPage } from '../pages/ads/AdsPage';
import { SourceLinesPage } from '../pages/reference/sources/SourceLinesPage';
import { SourcesPage } from '../pages/reference/sources/SourcesPage';

/** Деньги: source files and lines, operations, advertising. */
export const moneyRoutes = [
  <Route key="sources" path={ROUTE_PATHS.sources} element={<SourcesPage />} />,
  <Route key="source-lines" path={ROUTE_PATHS.sourceLines} element={<SourceLinesPage />} />,
  <Route key="operations" path={ROUTE_PATHS.operations} element={<OperationsPage />} />,
  <Route key="operation-import" path={ROUTE_PATHS.operationImport} element={<OperationImportPage />} />,
  <Route key="cuts" path={ROUTE_PATHS.cuts} element={<CutsPage />} />,
  <Route key="cut" path={ROUTE_PATHS.cut} element={<CutPage />} />,
  <Route key="ads" path={ROUTE_PATHS.ads} element={<AdsPage />} />,
  <Route key="ad" path={ROUTE_PATHS.ad} element={<AdPage />} />,
];
