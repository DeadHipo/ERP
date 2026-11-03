import { Route } from 'react-router-dom';
import { DocumentPage } from '../pages/reference/documents/DocumentPage';
import { DocumentsPage } from '../pages/reference/documents/DocumentsPage';
import { LabelPage } from '../pages/reference/labels/LabelPage';
import { LabelsPage } from '../pages/reference/labels/LabelsPage';
import { PublishingPage } from '../pages/reference/publishing/PublishingPage';
import { ParticipationsPage } from '../pages/reference/splits/ParticipationsPage';
import { SplitsPage } from '../pages/reference/splits/SplitsPage';

/** Правила: splits, participations, labels, publishing, documents (step 3.8). */
export const rulesRoutes = [
  <Route key="splits" path="splits" element={<SplitsPage />} />,
  <Route key="participations" path="participations" element={<ParticipationsPage />} />,
  <Route key="labels" path="labels" element={<LabelsPage />} />,
  <Route key="label" path="labels/:id" element={<LabelPage />} />,
  <Route key="publishing" path="publishing" element={<PublishingPage />} />,
  <Route key="documents" path="documents" element={<DocumentsPage />} />,
  <Route key="document" path="documents/:id" element={<DocumentPage />} />,
];
