import { Route } from 'react-router-dom';
import { ROUTE_PATHS } from './paths';
import { DocumentPage } from '../pages/reference/documents/DocumentPage';
import { DocumentsPage } from '../pages/reference/documents/DocumentsPage';
import { LabelPage } from '../pages/reference/labels/LabelPage';
import { LabelsPage } from '../pages/reference/labels/LabelsPage';
import { PublishingPage } from '../pages/reference/publishing/PublishingPage';
import { ParticipationsPage } from '../pages/reference/splits/ParticipationsPage';
import { SplitsPage } from '../pages/reference/splits/SplitsPage';

/** Правила: splits, participations, labels, publishing, documents (step 3.8). */
export const rulesRoutes = [
  <Route key="splits" path={ROUTE_PATHS.splits} element={<SplitsPage />} />,
  <Route key="participations" path={ROUTE_PATHS.participations} element={<ParticipationsPage />} />,
  <Route key="labels" path={ROUTE_PATHS.labels} element={<LabelsPage />} />,
  <Route key="label" path={ROUTE_PATHS.label} element={<LabelPage />} />,
  <Route key="publishing" path={ROUTE_PATHS.publishing} element={<PublishingPage />} />,
  <Route key="documents" path={ROUTE_PATHS.documents} element={<DocumentsPage />} />,
  <Route key="document" path={ROUTE_PATHS.document} element={<DocumentPage />} />,
];
