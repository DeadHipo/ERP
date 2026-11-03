import { Route } from 'react-router-dom';
import { PlaceholderPage } from '../pages/PlaceholderPage';
import { ru } from '../i18n/ru';

const n = ru.nav.items;

/** Владельцы (step 3.7): the list with the payouts view and the owner card. */
export const ownersRoutes = [
  <Route key="owners" path="owners" element={<PlaceholderPage title={n.owners} step="3.7" />} />,
  <Route key="owner" path="owners/:id" element={<PlaceholderPage title={n.owners} step="3.7" />} />,
];
