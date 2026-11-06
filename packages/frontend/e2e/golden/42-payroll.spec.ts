import { readFileSync } from 'node:fs';
import { expect, test, type Page } from '@playwright/test';
import { choose, labelOf, openAs, ownerName, sc, settled } from '../helpers';

// S52 (19 §4, D-173 §1.4): the payroll of the book 0to8 exported from P9 (the csv downloads, its total row of S31/3
// equals the P9 row and the json of the same call), the cut asOf on P9 and P10 (the payout of 2026-04 and the
// publishing of 2Q26 fall out at 2026-03), the area of the payroll (master 25, the whole book 55). Read only: S31/3 as
// 32-ads leaves it (earned 80, paid 20, advertising 5 of 2026-01, payable 55); nobody acts on it after.

const k = () => sc(31, 3);
const name = () => ownerName('A', 31, 3);
const filter = () => encodeURIComponent(JSON.stringify({ f: { name: { filterType: 'text', type: 'contains', filter: name() } } }));
const cell = (page: Page, ownerId: string, col: string) =>
  page.getByTestId(`owner-${ownerId}`).locator(`[data-col="${col}"]`).getByTestId('money');

/** One quoted `;` row of the csv as its fields (the payroll quotes every field, D-173). */
const fields = (line: string) => line.replace(/^\uFEFF/, '').split(';').map((f) => f.replace(/^"|"$/g, ''));

/** Exports one sheet from the open P9 and returns the csv as rows of fields, keyed by the header. */
async function exportPayroll(page: Page, area: string, sheet: string): Promise<{ name: string; rows: Record<string, string>[] }> {
  await page.getByTestId('action-payroll-export').click();
  const dialog = page.getByTestId('form-dialog');
  await expect(dialog.getByTestId('payroll-label')).toContainText('0to8');
  await choose(page, 'payroll-area', area);
  await choose(page, 'payroll-sheet', sheet);
  const download = page.waitForEvent('download');
  await dialog.getByTestId('action-payroll-download').click();
  const file = await download;
  const text = readFileSync((await file.path()) ?? '', 'utf8');
  const [head = '', ...lines] = text.split(/\r?\n/).filter((l) => l !== '');
  const cols = fields(head);
  await page.getByTestId('form-dialog-close').click();
  return { name: file.suggestedFilename(), rows: lines.map((l) => Object.fromEntries(fields(l).map((v, i) => [cols[i] ?? `${i}`, v]))) };
}

test('S52 under «Все» the export is closed («выберите лейбл»)', async ({ page }) => {
  await openAs(page, '/owners?label=');
  await expect(page.getByTestId('action-payroll-export')).toBeDisabled();
  await expect(page.getByTestId('action-payroll-export').locator('..')).toContainText('выберите лейбл');
});

test('S52 the payroll of 0to8: the csv total row of S31/3 = the P9 row (all 80 / 20 / 55) and the json; master 25', async ({ page, request }) => {
  const ownerId = k().owners.A ?? '';
  await openAs(page, `/owners?label=${labelOf('0to8')}&grid=${filter()}`);
  await settled(page);
  await expect(cell(page, ownerId, 'earned')).toHaveAttribute('title', '80');
  await expect(cell(page, ownerId, 'paid')).toHaveAttribute('title', '20');
  await expect(cell(page, ownerId, 'payable')).toHaveAttribute('title', '55');
  const all = await exportPayroll(page, 'мастер и паблишинг', 'ведомость');
  expect(all.name).toBe('payroll_0to8_all_all_payroll.csv');
  const total = all.rows.find((r) => r.ownerId === ownerId && r.rowKind === 'total');
  expect([total?.earned, total?.paid, total?.adsCharged, total?.payable]).toEqual(['80', '20', '5', '55']);
  const pseudonymRow = all.rows.find((r) => r.ownerId === ownerId && r.rowKind === 'pseudonym');
  expect(pseudonymRow?.earned).toBe('50');
  // the json of the same read says the same
  const json = (await (await request.get(`/api/v1/owners/payroll?label=${labelOf('0to8')}&area=all`)).json()) as {
    rows: { ownerId: string; rowKind: string; earned: string; paid: string; payable: string | null }[];
    totals: { bookBMatches: boolean };
  };
  const jsonTotal = json.rows.find((r) => r.ownerId === ownerId && r.rowKind === 'total');
  expect([jsonTotal?.earned, jsonTotal?.paid, jsonTotal?.payable]).toEqual(['80', '20', '55']);
  expect(json.totals.bookBMatches).toBe(true);
  // the master area (the default of the payroll and of the button): earned 50, payable 50 − 20 − 5 = 25
  const master = await exportPayroll(page, 'мастер', 'ведомость');
  expect(master.name).toBe('payroll_0to8_all_master_payroll.csv');
  const masterTotal = master.rows.find((r) => r.ownerId === ownerId && r.rowKind === 'total');
  expect([masterTotal?.earned, masterTotal?.payable]).toEqual(['50', '25']);
  // the control sheet: A = B + C + ours by account and month, no discrepancy
  const control = await exportPayroll(page, 'мастер и паблишинг', 'контроль A = B + C + наше');
  expect(control.rows.length).toBeGreaterThan(0);
  expect(control.rows.every((r) => r.discrepancy === '0')).toBe(true);
});

test('S52 asOf 2026-03 on P9, the export and P10: earned 50, paid 0, payable 45 (the advertising of 2026-01 stays); the payout is closed under a cut', async ({ page }) => {
  const ownerId = k().owners.A ?? '';
  await openAs(page, `/owners?label=${labelOf('0to8')}&grid=${filter()}`);
  await settled(page);
  await page.getByTestId('field-as-of').fill('2026-03');
  await expect(page).toHaveURL(/asOf=2026-03/);
  await settled(page);
  await expect(cell(page, ownerId, 'earned')).toHaveAttribute('title', '50');
  await expect(cell(page, ownerId, 'paid')).toHaveAttribute('title', '0');
  await expect(cell(page, ownerId, 'payable')).toHaveAttribute('title', '45');
  const cut = await exportPayroll(page, 'мастер и паблишинг', 'ведомость');
  expect(cut.name).toBe('payroll_0to8_2026-03_all_payroll.csv');
  const total = cut.rows.find((r) => r.ownerId === ownerId && r.rowKind === 'total');
  expect([total?.earned, total?.paid, total?.payable]).toEqual(['50', '0', '45']);
  // P10 under the same cut
  await openAs(page, `/owners/${ownerId}?tab=balance&label=${labelOf('0to8')}&asOf=2026-03`);
  await settled(page);
  await expect(page.getByTestId('field-as-of')).toHaveValue('2026-03');
  await expect(page.getByTestId('balance-earned').getByTestId('money')).toHaveAttribute('title', '50');
  await expect(page.getByTestId('balance-paid').getByTestId('money')).toHaveAttribute('title', '0');
  await expect(page.getByTestId('balance-payable').getByTestId('money')).toHaveAttribute('title', '45');
  await expect(page.getByTestId('action-pay')).toBeDisabled();
  await expect(page.getByTestId('action-pay').locator('..')).toContainText('уберите срез');
});
