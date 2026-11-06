import { expect, test } from '@playwright/test';
import { account, apiPost, isrc, openAs, toastOk, upc } from '../helpers';

// The P1 onboarding checklist (D-172, S46 of 19): an own label made here from nothing («Onboard e2e»): every step but
// the label is «todo»; with its Believe account and one synthetic report (account 2746100, March 2026, the label
// string «Onboard Label 39» without an alias) the accounts and files steps are «done» and the unmapped step names the
// string; the collapse is remembered; under «Все» the organization administrator sees the organization checklist.

test.describe.configure({ mode: 'serial' });

const ACCT = account(46, 1);
const LABEL_STRING = 'Onboard Label 39';
let labelId = '';

const COLUMNS = ['Reporting month', 'Sales Month', 'Platform', 'Country / Region', 'Label Name', 'Artist Name', 'Release title', 'Track title', 'UPC', 'ISRC', 'Release Catalog nb', 'Streaming Subscription Type', 'Release type', 'Sales Type', 'Quantity', 'Client Payment Currency', 'Unit Price', 'Mechanical Fee', 'Gross Revenue', 'Client share rate', 'Net Revenue'];
const q = (v: string) => `"${v}"`;
function report(): { name: string; mimeType: string; buffer: Buffer } {
  const rec: Record<string, string> = {
    'Reporting month': '2026/03/01', 'Sales Month': '2026/03/01', Platform: 'Spotify', 'Country / Region': 'Brazil', 'Label Name': LABEL_STRING,
    'Artist Name': 'Onboard Artist', 'Release title': 'Onboard Release', 'Track title': 'Onboard Track', UPC: upc(46, 1, 1), ISRC: isrc(46, 1, 1),
    'Release Catalog nb': 'CAT039', 'Streaming Subscription Type': 'Premium', 'Release type': 'Music Release', 'Sales Type': 'Stream', Quantity: '1',
    'Client Payment Currency': 'USD', 'Unit Price': '0.004', 'Mechanical Fee': '0', 'Gross Revenue': '10', 'Client share rate': '0.85', 'Net Revenue': '10',
  };
  const text = '\ufeff' + [COLUMNS.map(q).join(';'), COLUMNS.map((c) => q(rec[c] ?? '')).join(';')].join('\r\n') + '\r\n';
  return { name: `9900046_${ACCT}_2026-03-01_2026-03-01.csv`, mimeType: 'text/csv', buffer: Buffer.from(text, 'utf8') };
}

test('S46 a new own label: the checklist under it, only the label is done', async ({ page }) => {
  const made = await apiPost(page.request, '/labels', { name: 'Onboard e2e', kind: 'own' });
  expect(made.status).toBe(201);
  labelId = (made.body as { id: string }).id;
  await openAs(page, `/?label=${labelId}`);
  const list = page.getByTestId('onboarding-checklist');
  await expect(list).toHaveAttribute('data-label-id', labelId);
  await expect(list.getByTestId('onboarding-step-label')).toHaveAttribute('data-state', 'done');
  await expect(list.getByTestId('onboarding-step-accounts')).toHaveAttribute('data-state', 'todo');
  await expect(list.getByTestId('onboarding-step-files')).toHaveAttribute('data-state', 'todo');
  await expect(list.getByTestId('onboarding-step-publishing')).toHaveAttribute('data-state', 'info');
  await expect(list.getByTestId('onboarding-step-accounts').locator('[data-col="accounts"]')).toHaveAttribute('data-value', '0');
  await expect(list.getByTestId('onboarding-link-accounts')).toHaveAttribute('href', `/labels/${labelId}`);
});

test('S46 the account and one report: accounts and files done, the label string waits for an alias', async ({ page }) => {
  expect((await apiPost(page.request, `/labels/${labelId}/accounts`, { account: ACCT })).status).toBe(201);
  await openAs(page, `/sources?label=${labelId}`);
  await page.getByTestId('field-upload-believe').setInputFiles(report());
  await page.getByTestId('action-upload-believe').click();
  await toastOk(page, 'Файл загружен');
  await openAs(page, `/?label=${labelId}`);
  const list = page.getByTestId('onboarding-checklist');
  await expect(list.getByTestId('onboarding-step-accounts')).toHaveAttribute('data-state', 'done');
  const files = list.getByTestId('onboarding-step-files');
  await expect(files).toHaveAttribute('data-state', 'done');
  await expect(files.locator('[data-col="files"]')).toHaveAttribute('data-value', '1');
  await expect(files.getByTestId(`onboarding-account-${ACCT}`)).toContainText('2026-03 – 2026-03');
  const unmapped = list.getByTestId('onboarding-step-unmapped');
  await expect(unmapped).toHaveAttribute('data-state', 'todo');
  await expect(unmapped.locator('[data-col="unmapped"]')).toHaveAttribute('data-value', '1');
  await expect(unmapped.getByTestId('onboarding-unmapped-values')).toContainText(LABEL_STRING);
  await expect(list.getByTestId('onboarding-step-splits')).toHaveAttribute('data-state', 'todo');
  await list.getByTestId('onboarding-link-unmapped').click();
  await expect(page).toHaveURL(/\/signals\/labelUnmapped/);
});

test('S46 the collapse is remembered; under «Все» the organization checklist', async ({ page }) => {
  await openAs(page, `/?label=${labelId}`);
  const list = page.getByTestId('onboarding-checklist');
  await list.getByTestId('action-onboarding-collapse').click();
  await expect(list).toHaveAttribute('data-collapsed', 'true');
  await expect(list.getByTestId('onboarding-step-label')).toHaveCount(0);
  await page.reload();
  await expect(page.getByTestId('onboarding-checklist')).toHaveAttribute('data-collapsed', 'true');
  await openAs(page, '/?label=');
  await expect(page.getByTestId('label-switch')).toHaveAttribute('data-label', '');
  const org = page.getByTestId('org-checklist');
  await expect(org).toBeVisible();
  await expect(org.getByTestId('org-step-labels')).toHaveAttribute('data-state', 'done');
  await expect(org.getByTestId('org-step-users')).toHaveAttribute('data-state', 'done');
  await expect(page.getByTestId('onboarding-checklist')).toHaveCount(0);
});
