import { Route } from 'react-router-dom';
import { OverviewPage } from '../pages/work/OverviewPage';
import { QueuePage } from '../pages/work/QueuePage';
import { SignalsPage } from '../pages/work/SignalsPage';
import { QuestionsPage } from '../pages/work/QuestionsPage';

/** Работа: overview, the C queue, signals, the open questions (step 3.5). The payouts view is `/owners?view=payouts`. */
export const workRoutes = [
  <Route key="overview" index element={<OverviewPage />} />,
  <Route key="queue" path="queue" element={<QueuePage />} />,
  <Route key="queue-reason" path="queue/:reason" element={<QueuePage />} />,
  <Route key="signals" path="signals" element={<SignalsPage />} />,
  <Route key="signals-name" path="signals/:name" element={<SignalsPage />} />,
  <Route key="questions" path="questions" element={<QuestionsPage />} />,
];
