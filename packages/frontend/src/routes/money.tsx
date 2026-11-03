import { Route } from 'react-router-dom';
import { OperationsPage } from '../pages/operations/OperationsPage';
import { SourceLinesPage } from '../pages/reference/sources/SourceLinesPage';
import { SourcesPage } from '../pages/reference/sources/SourcesPage';

/** Деньги: source files and lines (step 3.8), operations (step 3.7). */
export const moneyRoutes = [
  <Route key="sources" path="sources" element={<SourcesPage />} />,
  <Route key="source-lines" path="sources/lines" element={<SourceLinesPage />} />,
  <Route key="operations" path="operations" element={<OperationsPage />} />,
];
