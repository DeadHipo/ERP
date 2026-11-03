import { Route } from 'react-router-dom';
import { PlaceholderPage } from '../pages/PlaceholderPage';
import { ru } from '../i18n/ru';

const n = ru.nav.items;

/** Правила: splits, participations, labels, publishing, documents (step 3.8). */
export const rulesRoutes = [
  <Route key="splits" path="splits" element={<PlaceholderPage title={n.splits} step="3.8" />} />,
  <Route key="participations" path="participations" element={<PlaceholderPage title={n.participations} step="3.8" />} />,
  <Route key="labels" path="labels" element={<PlaceholderPage title={n.labels} step="3.8" />} />,
  <Route key="label" path="labels/:id" element={<PlaceholderPage title={n.labels} step="3.8" />} />,
  <Route key="publishing" path="publishing" element={<PlaceholderPage title={n.publishing} step="3.8" />} />,
  <Route key="documents" path="documents" element={<PlaceholderPage title={n.documents} step="3.8" />} />,
  <Route key="document" path="documents/:id" element={<PlaceholderPage title={n.documents} step="3.8" />} />,
];
