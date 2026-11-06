import { Route, Routes } from 'react-router-dom';
import { AppShell } from './components/AppShell';
import { workRoutes } from './routes/work';
import { catalogRoutes } from './routes/catalog';
import { ownersRoutes } from './routes/owners';
import { rulesRoutes } from './routes/rules';
import { moneyRoutes } from './routes/money';
import { devRoutes } from './routes/dev';
import { systemRoutes } from './routes/system';
import { ROUTE_PATHS } from './routes/paths';
import { LoginPage } from './pages/auth/LoginPage';
import { NotFoundPage } from './pages/NotFoundPage';

export function App() {
  return (
    <Routes>
      <Route path={ROUTE_PATHS.login} element={<LoginPage />} />
      <Route element={<AppShell />}>
        {workRoutes}
        {catalogRoutes}
        {ownersRoutes}
        {rulesRoutes}
        {moneyRoutes}
        {devRoutes}
        {systemRoutes}
        <Route path="*" element={<NotFoundPage />} />
      </Route>
    </Routes>
  );
}
