import { Route, Routes } from 'react-router-dom';
import { AppShell } from './components/AppShell';
import { workRoutes } from './routes/work';
import { catalogRoutes } from './routes/catalog';
import { ownersRoutes } from './routes/owners';
import { rulesRoutes } from './routes/rules';
import { moneyRoutes } from './routes/money';
import { devRoutes } from './routes/dev';
import { NotFoundPage } from './pages/NotFoundPage';

export function App() {
  return (
    <Routes>
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
