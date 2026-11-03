import { AlertDialog, Button } from '@heroui/react';
import { HiddenRacDialogAnchor } from './HiddenRacDialogAnchor';
import { useOperator } from '../lib/operator';
import { ru } from '../i18n/ru';

/**
 * The one confirmation of every irreversible action (17 §6, R5): says what changes, shows the operator, and keeps
 * the confirm button disabled while the request is in flight (and while no operator is set).
 */
export function ConfirmDialog(props: {
  isOpen: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  /** What changes, one line each (amounts come from the API). */
  lines: string[];
  onConfirm: () => void;
  isPending?: boolean;
  confirmLabel?: string;
}) {
  const { operator, hasOperator } = useOperator();
  return (
    <AlertDialog isOpen={props.isOpen} onOpenChange={props.onOpenChange}>
      <HiddenRacDialogAnchor />
      <AlertDialog.Backdrop>
        <AlertDialog.Container placement="center">
          <AlertDialog.Dialog data-testid="confirm-dialog" className="max-w-lg">
            <AlertDialog.Header>
              <AlertDialog.Icon status="warning" />
              <AlertDialog.Heading>{props.title}</AlertDialog.Heading>
            </AlertDialog.Header>
            <AlertDialog.Body>
              <div className="mb-1 text-sm font-medium">{ru.dialog.whatChanges}</div>
              <ul className="list-disc pl-5 text-sm">
                {props.lines.map((line, i) => (
                  <li key={i}>{line}</li>
                ))}
              </ul>
              <div className="mt-3 text-sm text-muted">
                {ru.dialog.operator}:{' '}
                <span data-testid="confirm-dialog-operator">{hasOperator ? operator : ru.shell.operator.hint}</span>
              </div>
            </AlertDialog.Body>
            <AlertDialog.Footer>
              <Button
                variant="secondary"
                data-testid="confirm-dialog-cancel"
                isDisabled={props.isPending}
                onPress={() => props.onOpenChange(false)}
              >
                {ru.dialog.cancel}
              </Button>
              <Button
                data-testid="confirm-dialog-ok"
                isDisabled={props.isPending === true || !hasOperator}
                isPending={props.isPending}
                onPress={props.onConfirm}
              >
                {props.confirmLabel ?? ru.dialog.confirm}
              </Button>
            </AlertDialog.Footer>
          </AlertDialog.Dialog>
        </AlertDialog.Container>
      </AlertDialog.Backdrop>
    </AlertDialog>
  );
}
