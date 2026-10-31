import { NavLink, Navigate, Route, Routes } from 'react-router-dom';
import { OwnersPage } from './owners/OwnersPage';
import { OwnerPage } from './owners/OwnerPage';
import { OwnerBalancePage } from './owners/OwnerBalancePage';
import { DocumentsPage } from './documents/DocumentsPage';
import { SplitsPage } from './splits/SplitsPage';
import { SourcesPage } from './sources/SourcesPage';
import { SourceLinesPage } from './sources/SourceLinesPage';
import { SettlementsPage } from './settlements/SettlementsPage';

export function App() {
  return (
    <>
      <nav>
        <strong>Royalty ERP</strong>
        <NavLink to="/owners">Owners</NavLink>
        <NavLink to="/documents">Documents</NavLink>
        <NavLink to="/splits">Splits</NavLink>
        <NavLink to="/sources">Sources</NavLink>
        <NavLink to="/settlements">Settlements</NavLink>
      </nav>
      <main>
        <Routes>
          <Route path="/" element={<Navigate to="/sources" replace />} />
          <Route path="/owners" element={<OwnersPage />} />
          <Route path="/owners/:id" element={<OwnerPage />} />
          <Route path="/owners/:id/balance" element={<OwnerBalancePage />} />
          <Route path="/documents" element={<DocumentsPage />} />
          <Route path="/splits" element={<SplitsPage />} />
          <Route path="/sources" element={<SourcesPage />} />
          <Route path="/sources/lines" element={<SourceLinesPage />} />
          <Route path="/settlements" element={<SettlementsPage />} />
        </Routes>
      </main>
    </>
  );
}
