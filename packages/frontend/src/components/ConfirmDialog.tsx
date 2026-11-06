import type { ReactNode } from 'react';
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
  /**
   * The lines wait for an API answer (the money of the confirmation, e.g. `GET /documents/:id/uses`): OK stays disabled
   * and the dialog says «идёт пересчёт» until it arrives (`confirm-dialog-loading`).
   */
  isLoading?: boolean;
  /** A choice the lines depend on (the area of the payout, D-173), above the lines. */
  children?: ReactNode;
  /** The backend refuses what the lines describe (its gate): OK stays disabled and the reason is shown (`confirm-dialog-blocked`). */
  blockedReason?: string;
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
              {props.children ? <div className="mb-3 flex flex-col gap-2">{props.children}</div> : null}
              <div className="mb-1 text-sm font-medium">{ru.dialog.whatChanges}</div>
              <ul className="list-disc pl-5 text-sm">
                {props.lines.map((line, i) => (
                  <li key={i}>{line}</li>
                ))}
              </ul>
              {props.blockedReason && !props.isLoading ? (
                <div className="mt-2 text-sm text-danger" data-testid="confirm-dialog-blocked">
                  {props.blockedReason}
                </div>
              ) : null}
              {props.isLoading ? (
                <div className="mt-2 text-sm text-accent" data-testid="confirm-dialog-loading">
                  {ru.shell.recalc}
                </div>
              ) : null}
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
                isDisabled={props.isPending === true || props.isLoading === true || props.blockedReason !== undefined || !hasOperator}
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
