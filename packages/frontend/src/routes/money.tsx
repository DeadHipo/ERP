import { Route } from 'react-router-dom';
import { PlaceholderPage } from '../pages/PlaceholderPage';
import { ru } from '../i18n/ru';
import { OperationsPage } from '../pages/operations/OperationsPage';

const n = ru.nav.items;

/** Деньги: source files and lines (step 3.8), operations (step 3.7). */
export const moneyRoutes = [
  <Route key="sources" path="sources" element={<PlaceholderPage title={n.sources} step="3.8" />} />,
  <Route key="source-lines" path="sources/lines" element={<PlaceholderPage title={ru.nav.subpages.sourceLines} step="3.8" />} />,
  <Route key="operations" path="operations" element={<OperationsPage />} />,
];
