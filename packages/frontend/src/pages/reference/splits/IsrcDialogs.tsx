import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { splitQueries } from '../../../api/queries/splits';
import { ActionButton } from '../../../components/ActionButton';
import { FormDialog } from '../../../components/FormDialog';
import { EntityPicker } from '../../../components/fields/EntityPicker';
import { ru } from '../../../i18n/ru';
import { CreateParticipationDialog } from '../../catalog/track/ParticipationDialogs';
import { BuyoutDialog, SplitDialog } from '../../catalog/track/SplitDialogs';

const t = ru.reference.splits;

/** Loads every split of the ISRC (the catalog dialogs work on them) and renders the dialog once they are here. */
export function WithSplits(props: { isrc: string; children: (splits: NonNullable<ReturnType<typeof useSplits>['data']>['items']) => React.ReactNode }) {
  const q = useSplits(props.isrc);
  if (!q.data) return null;
  const sorted = [...q.data.items].sort((a, b) => (a.validFrom < b.validFrom ? -1 : a.validFrom > b.validFrom ? 1 : 0));
  return <>{props.children(sorted)}</>;
}
function useSplits(isrc: string) {
  return useQuery(splitQueries.page({ isrc, limit: 500 }));
}

export type IsrcAction = { kind: 'change' | 'buyout'; isrc: string };

/** «Изменить с даты» / «Выкуп» for one ISRC, with the catalog dialogs. */
export function IsrcActionDialog({ action, onClose }: { action: IsrcAction; onClose: () => void }) {
  return (
    <WithSplits isrc={action.isrc}>
      {(splits) =>
        action.kind === 'change' ? (
          <SplitDialog mode="change" isrc={action.isrc} splits={splits} onClose={onClose} />
        ) : (
          <BuyoutDialog isrc={action.isrc} splits={splits} onClose={onClose} />
        )
      }
    </WithSplits>
  );
}

/** «Создать сплит» / «Создать участие» from a list page: first pick the ISRC, then the catalog dialog. */
export function CreateForIsrc({ what, onClose }: { what: 'split' | 'participation'; onClose: () => void }) {
  const [isrc, setIsrc] = useState<string | null>(null);
  const [go, setGo] = useState(false);
  if (go && isrc) {
    return (
      <WithSplits isrc={isrc}>
        {(splits) =>
          what === 'split' ? (
            <SplitDialog mode="create" isrc={isrc} splits={splits} onClose={onClose} />
          ) : (
            <CreateParticipationDialog isrc={isrc} splits={splits} onClose={onClose} />
          )
        }
      </WithSplits>
    );
  }
  return (
    <FormDialog
      isOpen
      onOpenChange={(o) => (o ? null : onClose())}
      title={t.createPick}
      subtitle={t.createPickSubtitle}
      footer={
        <ActionButton name="create-pick-next" write={false} isDisabled={!isrc} onPress={() => setGo(true)}>
          {t.next2}
        </ActionButton>
      }
    >
      <EntityPicker name="create-isrc" label={t.isrc} kind="tracks" value={isrc} onChange={(id) => setIsrc(id)} />
    </FormDialog>
  );
}
