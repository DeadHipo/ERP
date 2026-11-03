import { NavLink, Navigate, Route, Routes } from 'react-router-dom';
import './styles.css';
import { OwnersPage } from './owners/OwnersPage';
import { OwnerPage } from './owners/OwnerPage';
import { OwnerBalancePage } from './owners/OwnerBalancePage';
import { DocumentsPage } from './documents/DocumentsPage';
import { SplitsPage } from './splits/SplitsPage';
import { LabelsPage } from './labels/LabelsPage';
import { ParticipationsPage } from './splits/ParticipationsPage';
import { SourcesPage } from './sources/SourcesPage';
import { SourceLinesPage } from './sources/SourceLinesPage';
import { SettlementsPage } from './settlements/SettlementsPage';

/** The pre-3.4 pages, mounted under `/legacy/*` until step 3.9 removes them. Their stylesheet is imported only here. */
export function LegacyApp() {
  return (
    <div className="legacy">
      <nav>
        <strong>Royalty ERP (legacy)</strong>
        <NavLink to="/legacy/owners">Owners</NavLink>
        <NavLink to="/legacy/documents">Documents</NavLink>
        <NavLink to="/legacy/splits">Splits</NavLink>
        <NavLink to="/legacy/participations">Participations</NavLink>
        <NavLink to="/legacy/labels">Labels</NavLink>
        <NavLink to="/legacy/sources">Sources</NavLink>
        <NavLink to="/legacy/settlements">Settlements</NavLink>
        <NavLink to="/">New UI</NavLink>
      </nav>
      <main>
        <Routes>
          <Route index element={<Navigate to="/legacy/sources" replace />} />
          <Route path="owners" element={<OwnersPage />} />
          <Route path="owners/:id" element={<OwnerPage />} />
          <Route path="owners/:id/balance" element={<OwnerBalancePage />} />
          <Route path="documents" element={<DocumentsPage />} />
          <Route path="splits" element={<SplitsPage />} />
          <Route path="participations" element={<ParticipationsPage />} />
          <Route path="labels" element={<LabelsPage />} />
          <Route path="sources" element={<SourcesPage />} />
          <Route path="sources/lines" element={<SourceLinesPage />} />
          <Route path="settlements" element={<SettlementsPage />} />
        </Routes>
      </main>
    </div>
  );
}
