import { Route } from 'react-router-dom';
import { PlaceholderPage } from '../pages/PlaceholderPage';
import { ru } from '../i18n/ru';

const n = ru.nav.items;

/** Работа: overview, the C queue, signals, the open questions (step 3.5). The payouts view is `/owners?view=payouts`. */
export const workRoutes = [
  <Route key="overview" index element={<PlaceholderPage title={n.overview} step="3.5" />} />,
  <Route key="queue" path="queue" element={<PlaceholderPage title={n.queue} step="3.5" />} />,
  <Route key="queue-reason" path="queue/:reason" element={<PlaceholderPage title={n.queue} step="3.5" />} />,
  <Route key="signals" path="signals" element={<PlaceholderPage title={n.signals} step="3.5" />} />,
  <Route key="signals-name" path="signals/:name" element={<PlaceholderPage title={n.signals} step="3.5" />} />,
  <Route key="questions" path="questions" element={<PlaceholderPage title={n.questions} step="3.5" />} />,
];
