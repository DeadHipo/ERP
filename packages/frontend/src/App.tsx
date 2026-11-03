import { lazy, Suspense } from 'react';
import { Route, Routes } from 'react-router-dom';
import { AppShell } from './components/AppShell';
import { workRoutes } from './routes/work';
import { catalogRoutes } from './routes/catalog';
import { ownersRoutes } from './routes/owners';
import { rulesRoutes } from './routes/rules';
import { moneyRoutes } from './routes/money';
import { devRoutes } from './routes/dev';
import { NotFoundPage } from './pages/NotFoundPage';

// The pre-3.4 pages load only when someone opens /legacy/*, so their global stylesheet never reaches the new shell.
const LegacyApp = lazy(() => import('./legacy/LegacyApp').then((m) => ({ default: m.LegacyApp })));

export function App() {
  return (
    <Routes>
      <Route path="/legacy/*" element={<LegacyRoot />} />
      <Route element={<AppShell />}>
        {workRoutes}
        {catalogRoutes}
        {ownersRoutes}
        {rulesRoutes}
        {moneyRoutes}
        {devRoutes}
        <Route path="*" element={<NotFoundPage />} />
      </Route>
    </Routes>
  );
}

function LegacyRoot() {
  return (
    <Suspense fallback={null}>
      <LegacyApp />
    </Suspense>
  );
}
