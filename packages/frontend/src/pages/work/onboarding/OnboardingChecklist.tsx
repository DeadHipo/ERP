import { useQuery } from '@tanstack/react-query';
import { onboardingQueries } from '../../../api/queries/onboarding';
import { fmt, ru } from '../../../i18n/ru';
import { ChecklistCard, StepRow } from './steps';

const t = ru.onboarding;

/**
 * P1 under a label (D-172): the onboarding checklist of that label, one `GET /onboarding?label=` (no calculation, not a
 * money key). Each step says what is left and links to the page that fixes it; the backend decides done / todo / info.
 * Hooks: `onboarding-checklist` (`data-label-id`), `onboarding-step-<key>` (`data-state`), `[data-col=<counter>]`,
 * `onboarding-link-<key>`, `onboarding-gap-<account>-<month>`, `action-onboarding-collapse`.
 */
export function OnboardingChecklist({ labelId }: { labelId: string }) {
  const query = useQuery(onboardingQueries.label(labelId));
  const data = query.data;
  if (!data) return null;
  const done = data.steps.filter((s) => s.state === 'done').length;
  const total = data.steps.filter((s) => s.state !== 'info').length;
  return (
    <ChecklistCard
      testId="onboarding-checklist"
      storageKey={labelId}
      title={fmt(t.title, { label: data.label.name })}
      done={done}
      total={total}
      attrs={{ 'data-label-id': data.label.id }}
    >
      {data.steps.map((s) => (
        <StepRow
          key={s.key}
          testId={`onboarding-step-${s.key}`}
          linkTestId={`onboarding-link-${s.key}`}
          title={t.steps[s.key]}
          state={s.state}
          counts={s.counts}
          link={s.link}
        >
          {s.months && s.months.length > 0 ? (
            <ul className="ml-7 flex flex-col gap-0.5 text-xs text-muted">
              {s.months.map((m) => (
                <li key={m.account} data-testid={`onboarding-account-${m.account}`}>
                  {fmt(t.months, { account: m.account, first: m.first ?? '—', last: m.last ?? '—' })}
                  {m.gaps.length > 0 ? (
                    <span className="ml-2">
                      {t.gaps}:{' '}
                      {m.gaps.map((g) => (
                        <span key={g} className="mr-1 text-warning" data-testid={`onboarding-gap-${m.account}-${g}`} title={fmt(t.gap, { month: g })}>
                          {g}
                        </span>
                      ))}
                    </span>
                  ) : null}
                </li>
              ))}
            </ul>
          ) : null}
          {s.values && s.values.length > 0 ? (
            <p className="ml-7 text-xs text-muted" data-testid="onboarding-unmapped-values">
              {fmt(t.unmappedValues, { values: s.values.join(', ') })}
            </p>
          ) : null}
        </StepRow>
      ))}
    </ChecklistCard>
  );
}
