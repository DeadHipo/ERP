import { toast } from '@heroui/react';
import type { ApiError } from '../api/client';
import { errorText } from '../i18n/ru/errors';
import { fmt, ru } from '../i18n/ru';

// HeroUI's Toast does not let us set attributes on its root element, but the message is any ReactNode, so the
// hooks `data-testid="toast"` and `data-code` sit on an element inside the title (e2e: `getByTestId('toast')`).
// The toasts sit at the top right (`TOAST_PLACEMENT` in main.tsx): a refusal never covers the footer of the open dialog,
// so its submit and close stay usable at once (stage 3 QA finding 6).

/** Where the toast region is (main.tsx) and how wide a toast is: clear of a centred dialog of `max-w-xl`. */
export const TOAST_PLACEMENT = 'top end' as const;
export const TOAST_WIDTH = 380;

/** Success: what changed (values from the response), `data-code="ok"`. */
export function notifySuccess(text: string = ru.toast.done): void {
  toast.success(
    <span data-testid="toast" data-code="ok">
      {text}
    </span>,
  );
}

/** The write happened, but its audit record failed (D-150): the operator must know the trace is missing. */
export function notifyAuditFailed(): void {
  toast.warning(
    <span data-testid="toast" data-code="audit_failed">
      {ru.toast.auditFailed}
    </span>,
  );
}

/** The scalar fields of an error's `details` (`{ account, labelName, files }`) as the parameters of its sentence. */
export function detailParams(details: unknown): Record<string, string | number> {
  if (details === null || typeof details !== 'object' || Array.isArray(details)) return {};
  const params: Record<string, string | number> = {};
  for (const [key, value] of Object.entries(details)) if (typeof value === 'string' || typeof value === 'number') params[key] = value;
  return params;
}

/**
 * Failure: the Russian sentence of the code (`i18n/ru/errors.ts`), `data-code="<api code>"`; the code and the API's own
 * message follow in small print (also the tooltip), so nothing of the answer is hidden (R4). The placeholders of the
 * sentence (`{account}`, `{labelName}`, `{files}`) take the values of the error's `details` (D-169).
 */
export function notifyError(error: ApiError | Error): void {
  const code = 'code' in error && typeof error.code === 'string' ? error.code : 'error';
  const template = errorText(code);
  const params = detailParams('details' in error ? error.details : undefined);
  // a 500 names its request (D-170): `{requestId}` of the sentence «Внутренняя ошибка, код …»
  const requestId = 'requestId' in error && typeof error.requestId === 'string' ? error.requestId : '';
  params.requestId = requestId || '—';
  const russian = template === undefined ? undefined : fmt(template, params);
  const detail = `${code}: ${error.message}`;
  toast.danger(
    <span data-testid="toast" data-code={code} title={detail} className="flex flex-col gap-0.5">
      <span data-testid="toast-text">{russian ?? error.message}</span>
      {code === 'operator_required' ? null : (
        <span data-testid="toast-detail" className="text-xs opacity-70">
          {detail}
        </span>
      )}
    </span>,
    { timeout: 8000 },
  );
}
