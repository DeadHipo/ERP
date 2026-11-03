import type { Page, Route } from '@playwright/test';

/** U+00A0 / U+202F (grouping) and U+2212 (minus) as plain characters, so money text compares with ordinary strings. */
export const norm = (s: string | null): string =>
  (s ?? '').replace(/[\u00a0\u202f]/g, ' ').replace(/\u2212/g, '-').trim();

export async function setOperator(page: Page, name: string): Promise<void> {
  await page.getByTestId('operator-field').fill(name);
}

export const json = (route: Route, status: number, body: unknown) =>
  route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) });

export const apiError = (code: string, message: string, statusCode: number) => ({
  error: { code, message, statusCode },
});

/** Collects console errors and uncaught page errors of a page (the smoke spec asserts there are none). */
export function trackErrors(page: Page): string[] {
  const errors: string[] = [];
  page.on('console', (m) => {
    if (m.type() === 'error') errors.push(`console: ${m.text()}`);
  });
  page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));
  return errors;
}
