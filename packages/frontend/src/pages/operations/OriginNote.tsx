import { operationOrigin } from '@erp/shared/operation-kinds';
import { ru } from '../../i18n/ru';

const t = ru.cuts.origin;

/** D-207: where an operation came from, named beside its kind (the reconciliation with the cabinet, a transfer of a cut). */
export function OriginNote(props: { externalRef: string | null | undefined }) {
  const origin = operationOrigin(props.externalRef);
  if (!origin) return null;
  return (
    <span className="text-xs text-accent" data-col="origin" data-origin={origin} title={origin === 'cabinet' ? t.cabinetHint : t.cut_transferHint}>
      {t[origin]}
    </span>
  );
}
