import { expect, test } from '@playwright/test';
import { apiPost, isrc, labelOf, openAs, pick, toastOk } from '../helpers';

// S58 (D-217…D-220): the sublabels P36 / P37. A sublabel of its own is created on P36, a term of 25 % on the S01 k2
// track (net 100 in 2026-03, row A 50: the label share 50) is checked (a wrong ISRC is an error row, nothing saved)
// and saved without a document; the report of P37 shows the part waiting for the document and equals the API; a
// document attached on P36 confirms it; the csv is saved; the history dialog cancels the term. The terms are not read
// by the money: nothing seeded changes.

test.describe.configure({ mode: 'serial' });

const NAME = 'S58 Sublabel e2e';
const I = isrc(1, 2, 1);
let sublabelId = '';

test('S58 the register: a sublabel created on P36', async ({ page }) => {
  await openAs(page, '/');
  await page.getByTestId('nav-sublabels').click();
  await expect(page.getByTestId('sublabels-page')).toBeVisible();
  await page.getByTestId('action-create-sublabel').click();
  await page.getByTestId('field-sublabel-name').fill(NAME);
  const created = page.waitForResponse((r) => r.url().endsWith('/api/v1/sublabels') && r.request().method() === 'POST');
  await page.getByTestId('action-sublabel-name-submit').click();
  const res = await created;
  expect(res.status()).toBe(201);
  sublabelId = ((await res.json()) as { id: string }).id;
  await toastOk(page, `Саблейбл «${NAME}» заведён`);
  await expect(page.getByTestId(`sublabel-${sublabelId}`)).toHaveAttribute('data-tracks-now', '0');
  // the same name without case is refused by the API
  expect((await apiPost(page.request, '/sublabels', { name: NAME.toLowerCase() })).code).toBe('sublabel_name_taken');
});

test('S58 a term: the preview, an error row, the save without a document', async ({ page }) => {
  await openAs(page, `/sublabels/${sublabelId}`);
  await expect(page.getByTestId('sublabel-page')).toHaveAttribute('data-sublabel-id', sublabelId);
  await page.getByTestId('action-add-sublabel-terms').click();
  await page.getByTestId('field-sublabel-terms-isrcs').fill(`${I}\nWRONG`);
  await page.getByTestId('field-sublabel-terms-percent').fill('25');
  await page.getByTestId('field-sublabel-terms-from').fill('2026-01');
  await page.getByTestId('action-sublabel-terms-preview').click();
  await expect(page.getByTestId('terms-preview-totals')).toHaveAttribute('data-errors', '1');
  await expect(page.getByTestId('terms-preview-row-2')).toHaveAttribute('data-kind', 'error');
  await expect(page.getByTestId('action-sublabel-terms-submit')).toBeDisabled();

  await page.getByTestId('field-sublabel-terms-isrcs').fill(I);
  // a changed batch needs a new preview
  await expect(page.getByTestId('action-sublabel-terms-submit')).toBeDisabled();
  await page.getByTestId('action-sublabel-terms-preview').click();
  await expect(page.getByTestId('terms-preview-totals')).toHaveAttribute('data-new', '1');
  await expect(page.getByTestId('terms-preview-row-1')).toHaveAttribute('data-kind', 'new');
  await page.getByTestId('action-sublabel-terms-submit').click();
  await toastOk(page, 'Сохранено условий: 1');
  const row = page.locator(`[data-testid^="sublabel-term-"][data-isrc="${I}"]`);
  await expect(row).toHaveAttribute('data-state', 'open');
  await expect(row.locator('[col-id="document"]')).toContainText('нет — деньги ждут');
});

test('S58 the report of P37 equals the API; the document confirms it; the csv', async ({ page }) => {
  const api = async () => (await (await page.request.get(`/api/v1/sublabels/${sublabelId}/report`)).json()) as {
    rows: { month: string; isrc: string; status: string; amount: string; labelShare: string }[];
    artists: { key: string }[];
    total: Record<string, string>;
  };
  const before = await api();
  expect(before.rows.map((r) => [r.month, r.isrc, r.status])).toEqual([['2026-03', I, 'waiting']]);
  expect(before.total.labelShare).toMatch(/^50(\.0*)?$/);
  expect(before.total.amount).toMatch(/^12\.50*$/);

  await openAs(page, `/sublabels/${sublabelId}?tab=report`);
  const total = page.getByTestId('sublabel-report-total');
  for (const k of ['labelShare', 'amount', 'confirmed', 'waiting'])
    await expect(total.locator(`[data-col="${k}"]`)).toHaveAttribute('data-value', before.total[k] ?? '');
  // by month (the default): one row per month, its tracks open below it
  await expect(page.getByTestId('sublabel-report')).toHaveAttribute('data-view', 'months');
  await expect(page.getByTestId(`report-row-2026-03-${I}`)).toHaveCount(0);
  await page.getByTestId('report-month-2026-03').getByTestId('action-report-expand').click();
  await expect(page.getByTestId(`report-row-2026-03-${I}`)).toHaveAttribute('data-reason', 'no_document');
  // by track and by artist: the API's groups, each opening its details
  await page.getByTestId('action-report-view-tracks').click();
  await expect(page.getByTestId(`report-track-${I}`).locator('[data-col="amount"] [data-testid="money"]')).toHaveAttribute('title', before.total.amount ?? '');
  await page.getByTestId('action-report-view-artists').click();
  await expect(page.getByTestId('sublabel-report')).toHaveAttribute('data-view', 'artists');
  await expect(page.getByTestId('sublabel-report-artists').locator('tbody > tr[data-testid^="report-artist-"]')).toHaveCount(before.artists.length);
  const group = before.artists[0];
  await page.getByTestId(`report-artist-${group?.key || 'none'}`).getByTestId('action-report-expand').click();
  await expect(page.getByTestId(`report-track-${I}`)).toBeVisible();

  const download = page.waitForEvent('download');
  await page.getByTestId('action-sublabel-report-csv').click();
  expect((await download).suggestedFilename()).toMatch(/^sublabel_.*\.csv$/);

  const doc = await apiPost(page.request, '/documents', {
    kind: 'appendix',
    title: 'S58 sublabel appendix',
    fileRef: 'dummy://s58.pdf',
    requiresApproval: false,
    labelId: labelOf('0to8'),
  });
  expect(doc.status).toBe(201);
  await openAs(page, '/sublabels?tab=terms');
  await page.getByTestId('field-terms-no-document').check();
  await page.getByTestId('action-attach-sublabel-terms').click();
  await pick(page, 'attach-document', 'S58 sublabel appendix');
  await page.getByTestId('action-attach-sublabel-document').click();
  await toastOk(page, /Документ приложен к \d+ условиям/);

  const after = await api();
  expect(after.rows.map((r) => r.amount)).toEqual(before.rows.map((r) => r.amount));
  await openAs(page, `/sublabels/${sublabelId}?tab=report&view=tracks`);
  const row = after.rows[0];
  await page.getByTestId(`report-track-${I}`).getByTestId('action-report-expand').click();
  await expect(page.getByTestId(`report-row-2026-03-${I}`)).toHaveAttribute('data-status', row?.status ?? '');
});

test('S58 advertising borne by the sublabel by hand: on the card and in the report', async ({ page }) => {
  const made = await apiPost(page.request, '/ads', {
    items: [{ isrc: I, month: '2026-03', amount: '10.00', recoveryPercent: '50', labelId: labelOf('0to8'), bearerSublabelId: sublabelId }],
  });
  expect(made.status).toBe(201);
  const adId = (made.body as unknown as { created: { id: string }[] }).created[0]?.id ?? '';
  await openAs(page, `/ads/${adId}`);
  await expect(page.getByTestId('ad-bearer')).toContainText(NAME);
  const report = (await (await page.request.get(`/api/v1/sublabels/${sublabelId}/report`)).json()) as { adsTotal: string; amountAfterAds: string };
  expect(report.adsTotal).toMatch(/^5(\.0*)?$/);
  await openAs(page, `/sublabels/${sublabelId}?tab=report`);
  await expect(page.getByTestId(`report-ad-${adId}`)).toBeVisible();
  await expect(page.getByTestId('sublabel-report-total').locator('[data-col="amountAfterAds"]')).toHaveAttribute('data-value', report.amountAfterAds);
});

test('S58 the history: the cancel of the latest term', async ({ page }) => {
  await openAs(page, `/sublabels/${sublabelId}`);
  await page.locator(`[data-testid^="sublabel-term-"][data-isrc="${I}"]`).getByTestId('action-sublabel-term-history').click();
  await expect(page.getByTestId('sublabel-term-history')).toBeVisible();
  await page.getByTestId('field-term-cancel-reason').fill('S58 mistake');
  await page.getByTestId('action-cancel-sublabel-term').click();
  await toastOk(page, 'Условие отменено');
  await expect(page.locator(`[data-testid^="sublabel-term-"][data-isrc="${I}"]`)).toHaveCount(0);
  const report = (await (await page.request.get(`/api/v1/sublabels/${sublabelId}/report`)).json()) as { rows: unknown[] };
  expect(report.rows).toEqual([]);
});
