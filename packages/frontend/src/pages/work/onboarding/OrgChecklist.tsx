import { useQuery } from '@tanstack/react-query';
import { onboardingQueries } from '../../../api/queries/onboarding';
import { ru } from '../../../i18n/ru';
import { ChecklistCard, StepRow } from './steps';

const t = ru.onboarding;

/**
 * P1 under «Все» for the organization's administrator (D-172): `GET /onboarding/organization` (shown only when the
 * session may call it, `me.abilities`). Hooks: `org-checklist`, `org-step-<key>` (`data-state`), `org-link-<key>`.
 */
export function OrgChecklist() {
  const query = useQuery(onboardingQueries.org());
  const data = query.data;
  if (!data) return null;
  const done = data.steps.filter((s) => s.state === 'done').length;
  const total = data.steps.filter((s) => s.state !== 'info').length;
  return (
    <ChecklistCard testId="org-checklist" storageKey="org" title={t.orgTitle} done={done} total={total} attrs={{ 'data-org-id': data.org.id }}>
      {data.steps.map((s) => (
        <StepRow
          key={s.key}
          testId={`org-step-${s.key}`}
          linkTestId={`org-link-${s.key}`}
          title={t.orgSteps[s.key]}
          state={s.state}
          counts={s.counts}
          link={s.link}
        />
      ))}
    </ChecklistCard>
  );
}
