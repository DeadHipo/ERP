import ExcelJS from 'exceljs';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { BELIEVE_COLUMNS } from '../../src/modules/sources';
import type { DocumentKind } from '../../src/modules/owners';
import { openFacade } from '../../src/facade';
import type { PaymentService } from '../../src/facade/payment-service';
import { testSources, testStack } from './test-sources';
import { TMP } from './tmp-root';

// Synthetic test data only: invented ISRCs, UPCs, names and amounts.

export { TMP };

export function tmpPath(name: string): string {
  const dir = join(TMP, randomUUID());
  mkdirSync(dir, { recursive: true });
  return join(dir, name);
}

export interface BelieveRowSpec {
  reportingMonth?: string; // YYYY-MM
  salesMonth?: string;
  platform?: string;
  country?: string;
  isrc: string;
  upc: string;
  net: string;
  gross?: string;
  quantity?: number;
  artistName?: string;
  trackTitle?: string;
  currency?: string;
  subscription?: string;
  salesType?: string;
  releaseType?: string;
  /** `Label Name` column; default 'Test Label' */
  labelName?: string;
}

const q = (v: string) => `"${v.replace(/"/g, '""')}"`;

export function believeCsv(month: string, rows: BelieveRowSpec[]): string {
  const lines = [BELIEVE_COLUMNS.map(q).join(';')];
  for (const r of rows) {
    const rm = (r.reportingMonth ?? month).replace('-', '/') + '/01';
    const sm = (r.salesMonth ?? r.reportingMonth ?? month).replace('-', '/') + '/01';
    const rec: Record<string, string> = {
      'Reporting month': rm,
      'Sales Month': sm,
      Platform: r.platform ?? 'Spotify',
      'Country / Region': r.country ?? 'Brazil',
      'Label Name': r.labelName ?? 'Test Label',
      'Artist Name': r.artistName ?? 'Synthetic Artist',
      'Release title': 'Synthetic Release',
      'Track title': r.trackTitle ?? 'Synthetic Track',
      UPC: r.upc,
      ISRC: r.isrc,
      'Release Catalog nb': 'CAT001',
      'Streaming Subscription Type': r.subscription ?? 'Premium',
      'Release type': r.releaseType ?? 'Music Release',
      'Sales Type': r.salesType ?? 'Stream',
      Quantity: String(r.quantity ?? 1),
      'Client Payment Currency': r.currency ?? 'USD',
      'Unit Price': '0.004',
      'Mechanical Fee': '0',
      'Gross Revenue': r.gross ?? r.net,
      'Client share rate': '0.85',
      'Net Revenue': r.net,
    };
    lines.push(BELIEVE_COLUMNS.map((c) => q(rec[c] ?? '')).join(';'));
  }
  return '﻿' + lines.join('\r\n') + '\r\n';
}

let reportSeq = 0;
/** Without `reportId` every call gets its own report id, so two files of one test never share one. */
export function believeFileName(month: string, account = '1052428', reportId?: string): string {
  reportId ??= String(9_500_000 + ++reportSeq);
  return `${reportId}_${account}_${month}-01_${month}-01.csv`;
}

export function writeBelieve(
  month: string,
  rows: BelieveRowSpec[],
  opts: { account?: string; reportId?: string } = {},
) {
  const fileName = believeFileName(month, opts.account, opts.reportId);
  const path = tmpPath(fileName);
  writeFileSync(path, believeCsv(month, rows));
  return { path, fileName };
}

export interface B17RowSpec {
  writer: string;
  title: string;
  payable: string | number;
  period?: string;
  /** comma-separated writers of the work (B17 "songwriters"); empty by default */
  songwriters?: string;
  /** B17 "operation type" column; 'Performance' by default */
  operationType?: string;
}

export async function writeB17(
  quarterLabel: string,
  rows: B17RowSpec[],
  fileName = `0to8_${quarterLabel}_Publishing_Statement.xlsx`,
) {
  const wb = new ExcelJS.Workbook();
  wb.addWorksheet('Cover').addRow(['Statement', 'Synthetic']);
  const ws = wb.addWorksheet('Detail');
  ws.addRow([
    'Period',
    'asset title',
    'rights-holder name',
    'work identifier',
    'songwriters',
    'operation type',
    'retailer / service',
    'country',
    'net amount',
    'Withholding',
    'Total Payable',
  ]);
  for (const r of rows) {
    const payable = typeof r.payable === 'number' ? r.payable : Number(r.payable);
    ws.addRow([
      r.period ?? '2Q26',
      r.title,
      r.writer,
      'W-' + r.title.length,
      r.songwriters ?? '',
      r.operationType ?? 'Performance',
      'Spotify',
      'US',
      payable,
      0,
      typeof r.payable === 'string' ? r.payable : payable,
    ]);
  }
  const path = tmpPath(fileName);
  await wb.xlsx.writeFile(path);
  return { path, fileName };
}

/**
 * A facade on the private PostgreSQL database of this test file (D-121): the module tables and the sources are emptied
 * first, so every facade starts from nothing. Two facades of one test that must see the same data share one facade.
 */
export async function newFacade(threshold = 0, opts: { paymentService?: PaymentService } = {}) {
  const stack = await testStack();
  await stack.resetModules();
  const dataDir = join(TMP, `facade-${randomUUID()}`);
  mkdirSync(dataDir, { recursive: true });
  const facade = openFacade({
    db: stack.db,
    dataDir,
    payoutThresholdCents: threshold,
    sources: testSources(),
    ...opts,
  });
  // The own labels every test starts with: the imprint of the synthetic Believe files is "Test Label".
  const labels = facade.modules.labels;
  const zero = await labels.createLabel({ name: '0to8', kind: 'own' });
  await labels.addAlias(zero.id, 'Test Label');
  await labels.addAlias(zero.id, '0to8');
  const echo = await labels.createLabel({ name: 'Echo8', kind: 'own' });
  await labels.addAlias(echo.id, 'Echo8');
  // the Believe accounts of the synthetic files (D-169): a file is loaded under the label its account is registered to
  await labels.addAccount(zero.id, '1052428');
  await labels.addAccount(echo.id, '1055956');
  // every operation and payout is made under a label (D-168): the tests use the seeded 0to8 unless they say otherwise
  return Object.assign(facade, { testLabels: { '0to8': zero.id, Echo8: echo.id } });
}

export type TestFacade = Awaited<ReturnType<typeof newFacade>>;

/** Owner with an approved contract listing its artists. */
export async function confirmedOwner(f: TestFacade, name: string, pseudonyms: string[]) {
  const o = f.modules.owners;
  const owner = await o.createOwner({ name, kind: 'person' });
  const artists = [];
  for (const p of pseudonyms) artists.push(await o.createArtist({ pseudonym: p, ownerId: owner.id }));
  const doc = await o.createDocument({
    kind: 'contract',
    title: `Dummy contract ${name}`,
    fileRef: `dummy://${name}.pdf`,
    ownerId: owner.id,
    requiresApproval: true,
  });
  await o.approveDocument(doc.id, 'manager');
  await o.createContract({ ownerId: owner.id, documentId: doc.id, artistIds: artists.map((a) => a.id) });
  return { owner, artists, contractDocId: doc.id };
}

/** Approved appendix document confirming splits. */
export async function approvedAppendix(f: TestFacade, ownerId: string | null = null) {
  const o = f.modules.owners;
  const d = await o.createDocument({
    kind: 'appendix',
    title: 'Dummy appendix (Schedule C)',
    fileRef: 'dummy://appendix.pdf',
    ownerId,
    requiresApproval: true,
  });
  return o.approveDocument(d.id, 'manager');
}

export async function approvedDoc(
  f: TestFacade,
  kind: Exclude<DocumentKind, 'assumption'>,
  ownerId: string | null = null,
) {
  const o = f.modules.owners;
  const d = await o.createDocument({
    kind,
    title: `Dummy ${kind}`,
    fileRef: `dummy://${kind}.pdf`,
    ownerId,
    requiresApproval: false,
  });
  return d;
}

/** Owner of kind label with one pseudonym named like the owner (a company, sublabel or buyer). */
export async function labelOwner(f: TestFacade, name: string) {
  const o = f.modules.owners;
  const owner = await o.createOwner({ name, kind: 'label' });
  const artist = await o.createArtist({ pseudonym: name, ownerId: owner.id });
  return { owner, artist };
}

/** Owner with pseudonyms and no contract: nothing of it is confirmed. */
export async function unconfirmedOwner(f: TestFacade, name: string, pseudonyms: string[]) {
  const o = f.modules.owners;
  const owner = await o.createOwner({ name, kind: 'person' });
  const artists = [];
  for (const p of pseudonyms) artists.push(await o.createArtist({ pseudonym: p, ownerId: owner.id }));
  return { owner, artists };
}

/** A council decision recorded as a document: the file is attached, it is never approved (status not_approved). */
export async function assumptionDoc(f: TestFacade, ownerId: string | null, title: string) {
  return f.modules.owners.createDocument({
    kind: 'assumption',
    title,
    fileRef: 'dummy://assumption.pdf',
    ownerId,
    requiresApproval: true,
  });
}
