import type { ReactNode } from 'react';
import { Button, Modal } from '@heroui/react';
import { HiddenRacDialogAnchor } from './HiddenRacDialogAnchor';
import { ru } from '../i18n/ru';

/**
 * The one form dialog of an action (a queue or signal action, a wizard): a title, the fields, and the action buttons
 * in the footer (each an `ActionButton`; irreversible steps open a `ConfirmDialog` on top). `data-testid="form-dialog"`.
 */
export function FormDialog(props: {
  isOpen: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  /** One sentence under the title: what the action does. */
  subtitle?: string;
  children: ReactNode;
  footer?: ReactNode;
}) {
  return (
    <Modal isOpen={props.isOpen} onOpenChange={props.onOpenChange}>
      <HiddenRacDialogAnchor />
      <Modal.Backdrop>
        <Modal.Container placement="center" scroll="inside">
          <Modal.Dialog data-testid="form-dialog" className="max-w-xl">
            <Modal.Header>
              <Modal.Heading>{props.title}</Modal.Heading>
            </Modal.Header>
            <Modal.Body>
              {props.subtitle ? <p className="mb-3 text-sm text-muted">{props.subtitle}</p> : null}
              <div className="flex flex-col gap-3">{props.children}</div>
            </Modal.Body>
            <Modal.Footer>
              <Button variant="secondary" data-testid="form-dialog-close" onPress={() => props.onOpenChange(false)}>
                {ru.common.close}
              </Button>
              {props.footer}
            </Modal.Footer>
          </Modal.Dialog>
        </Modal.Container>
      </Modal.Backdrop>
    </Modal>
  );
}
