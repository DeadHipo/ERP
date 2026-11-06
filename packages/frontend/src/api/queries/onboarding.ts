import { queryOptions } from '@tanstack/react-query';
import * as api from '../client';

// The onboarding checklists of P1 (D-172): reads of reference data, no calculation, so not money keys.
export const onboardingKeys = {
  label: (labelId: string) => ['onboarding', 'label', labelId] as const,
  org: () => ['onboarding', 'org'] as const,
};

export const onboardingQueries = {
  /** The checklist of one own label (`GET /onboarding?label=`). */
  label: (labelId: string) =>
    queryOptions({ queryKey: onboardingKeys.label(labelId), queryFn: () => api.reports.onboarding({ label: labelId }), staleTime: 0 }),
  /** The checklist of the organization (`GET /onboarding/organization`), its administrator's. */
  org: () => queryOptions({ queryKey: onboardingKeys.org(), queryFn: () => api.reports.orgOnboarding(), staleTime: 0 }),
};
