import { useState } from 'react';
import { useParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { sublabelQueries } from '../../../api/queries/sublabels';
import { ActionButton } from '../../../components/ActionButton';
import { useBreadcrumbLabel } from '../../../components/breadcrumb-label';
import { CardTabs } from '../../../components/EntityCard';
import { PageHeader } from '../../../components/PageHeader';
import { QueryView } from '../../../components/PageState';
import { ru } from '../../../i18n/ru';
import { NameDialog } from './dialogs';
import { ReportTab } from './ReportTab';
import { TermsTab } from './TermsTab';

const t = ru.sublabels;

/** P37 (D-220): one sublabel: its tracks with the terms and its report by them. */
export function SublabelPage() {
  const { id = '' } = useParams();
  const list = useQuery(sublabelQueries.list());
  const sublabel = list.data?.find((s) => s.id === id);
  const [renaming, setRenaming] = useState(false);
  useBreadcrumbLabel(sublabel?.name);
  return (
    <div data-testid="sublabel-page" data-sublabel-id={id}>
      <QueryView query={list}>
        {() => (
          <>
            <PageHeader title={sublabel?.name ?? id} subtitle={t.subtitle} />
            <div className="mb-3">
              <ActionButton name="rename-sublabel" op="PATCH /sublabels/:id" variant="secondary" isDisabled={!sublabel} onPress={() => setRenaming(true)}>
                {t.rename}
              </ActionButton>
            </div>
            <CardTabs
              tabs={[
                { id: 'terms', label: t.tabs.terms, content: <TermsTab sublabelId={id} /> },
                { id: 'report', label: t.tabs.report, content: <ReportTab sublabelId={id} /> },
              ]}
            />
            {renaming && sublabel ? <NameDialog sublabel={sublabel} onClose={() => setRenaming(false)} /> : null}
          </>
        )}
      </QueryView>
    </div>
  );
}
