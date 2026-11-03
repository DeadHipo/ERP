import { toast } from '@heroui/react';
import type { ApiError } from '../api/client';
import { ru } from '../i18n/ru';

// HeroUI's Toast does not let us set attributes on its root element, but the message is any ReactNode, so the
// hooks `data-testid="toast"` and `data-code` sit on an element inside the title (e2e: `getByTestId('toast')`).

/** Success: what changed (values from the response), `data-code="ok"`. */
export function notifySuccess(text: string = ru.toast.done): void {
  toast.success(
    <span data-testid="toast" data-code="ok">
      {text}
    </span>,
  );
}

/** Failure: the API code and message as they are, `data-code="<api code>"`. */
export function notifyError(error: ApiError | Error): void {
  const code = 'code' in error && typeof error.code === 'string' ? error.code : 'error';
  const message = code === 'operator_required' ? ru.toast.operatorRequired : error.message;
  toast.danger(
    <span data-testid="toast" data-code={code}>
      {code}: {message}
    </span>,
    { timeout: 8000 },
  );
}
