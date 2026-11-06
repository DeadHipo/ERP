import { useState } from 'react';
import type { OperationKey } from '../../api/coverage';
import { ActionButton } from '../ActionButton';
import { ru } from '../../i18n/ru';

/**
 * The one file form of the app (P19 reports, P28 split import, P7 release registry; D-172 FIX-10): a hidden native file
 * input behind a Russian label with the chosen name, and the button that sends it. The form only chooses and hands
 * the file over: `onSubmit(file, reset)` runs the request of the page (`useAction` or a preview mutation), and `reset`
 * clears the choice when the page is done with the file (P28 keeps it until the apply).
 *
 * Hooks: the wrapper `<testId>`, the input `field-<field>`, the chosen name `<testId>-chosen`, the button `action-<action>`.
 */
export function UploadForm(props: {
  testId: string;
  field: string;
  action: string;
  /** The operation the button triggers (D-171: closed without it in `me.abilities`). */
  op: OperationKey;
  label: string;
  accept: string;
  /** The button text; default «Загрузить». */
  submitText?: string;
  isPending?: boolean;
  /** Closed by the page (under «Все», `useWriteLabel`); the reason is shown beside the button. */
  closed?: boolean;
  closedReason?: string;
  onSubmit: (file: File, reset: () => void) => void;
}) {
  const t = ru.reference.sources;
  const [file, setFile] = useState<File | null>(null);
  const [key, setKey] = useState(0);
  const reset = () => {
    setFile(null);
    setKey((k) => k + 1);
  };
  const closed = props.closed === true;
  return (
    <div className="flex flex-wrap items-center gap-3" data-testid={props.testId}>
      {/* The native input is hidden (its browser text is English); the label is the Russian button and the chosen name. */}
      <label className="flex cursor-pointer flex-wrap items-center gap-2 text-sm">
        <span>{props.label}</span>
        <span className="rounded-lg border border-border bg-default/40 px-3 py-1">{t.chooseFile}</span>
        <span className="text-muted" data-testid={`${props.testId}-chosen`}>
          {file ? file.name : t.noFileChosen}
        </span>
        <input
          key={key}
          type="file"
          accept={props.accept}
          className="sr-only"
          data-testid={`field-${props.field}`}
          onChange={(e) => setFile(e.target.files?.[0] ?? null)}
        />
      </label>
      <ActionButton
        name={props.action}
        op={props.op}
        isPending={props.isPending}
        isDisabled={file === null || closed}
        reason={closed ? props.closedReason : ru.actions.hints.fillFields}
        onPress={() => file && props.onSubmit(file, reset)}
      >
        {props.submitText ?? t.upload}
      </ActionButton>
    </div>
  );
}
