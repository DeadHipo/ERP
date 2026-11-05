import { Route } from 'react-router-dom';
import { ROUTE_PATHS } from './paths';
import { OverviewPage } from '../pages/work/OverviewPage';
import { QueuePage } from '../pages/work/QueuePage';
import { SignalsPage } from '../pages/work/signals/SignalsPage';
import { QuestionsPage } from '../pages/work/QuestionsPage';

/** Работа: overview, the C queue, signals, the open questions. The payouts view is `/owners?view=payouts`. */
export const workRoutes = [
  <Route key="overview" index element={<OverviewPage />} />,
  <Route key="queue" path={ROUTE_PATHS.queue} element={<QueuePage />} />,
  <Route key="queue-reason" path={ROUTE_PATHS.queueReason} element={<QueuePage />} />,
  <Route key="signals" path={ROUTE_PATHS.signals} element={<SignalsPage />} />,
  <Route key="signals-name" path={ROUTE_PATHS.signalsName} element={<SignalsPage />} />,
  <Route key="questions" path={ROUTE_PATHS.questions} element={<QuestionsPage />} />,
];
