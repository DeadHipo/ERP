import { useState } from 'react';
import { AssignOwnerDialog } from '../../work/actions/dialogs';
import { ActionButton } from '../../../components/ActionButton';
import { ru } from '../../../i18n/ru';

/** «Привязать владельца»: the queue's dialog (pick an owner or create one) for one pseudonym. */
export function AssignOwnerAction(props: { artistId: string; pseudonym: string }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <ActionButton name="assign-owner" variant="secondary" onPress={() => setOpen(true)}>
        {ru.reference.artists.assignOwner}
      </ActionButton>
      {open ? <AssignOwnerDialog artistId={props.artistId} pseudonym={props.pseudonym} onClose={() => setOpen(false)} /> : null}
    </>
  );
}
