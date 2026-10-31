import ExcelJS from 'exceljs';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { BELIEVE_COLUMNS } from '../../src/modules/sources';
import { openFacade } from '../../src/facade';
import { testSources } from './test-sources';
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
      'Label Name': 'Test Label',
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

export function believeFileName(month: string, account = '1052428', reportId = '9000001'): string {
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
      'Performance',
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

export function newFacade(threshold = 0) {
  return openFacade({ dataDir: ':memory:', payoutThresholdCents: threshold, sources: testSources() });
}

export type TestFacade = ReturnType<typeof newFacade>;

/** Owner with an approved contract listing its artists. */
export function confirmedOwner(f: TestFacade, name: string, pseudonyms: string[]) {
  const o = f.modules.owners;
  const owner = o.createOwner({ name, kind: 'person' });
  const artists = pseudonyms.map((p) => o.createArtist({ pseudonym: p, ownerId: owner.id }));
  const doc = o.createDocument({
    kind: 'contract',
    title: `Dummy contract ${name}`,
    fileRef: `dummy://${name}.pdf`,
    ownerId: owner.id,
    requiresApproval: true,
  });
  o.approveDocument(doc.id, 'manager');
  o.createContract({ ownerId: owner.id, documentId: doc.id, artistIds: artists.map((a) => a.id) });
  return { owner, artists, contractDocId: doc.id };
}

/** Approved appendix document confirming splits. */
export function approvedAppendix(f: TestFacade, ownerId: string | null = null) {
  const o = f.modules.owners;
  const d = o.createDocument({
    kind: 'appendix',
    title: 'Dummy appendix (Schedule C)',
    fileRef: 'dummy://appendix.pdf',
    ownerId,
    requiresApproval: true,
  });
  return o.approveDocument(d.id, 'manager');
}

export function approvedDoc(
  f: TestFacade,
  kind: 'buyout' | 'advance_basis' | 'adjustment_basis' | 'contract' | 'appendix',
  ownerId: string | null = null,
) {
  const o = f.modules.owners;
  const d = o.createDocument({
    kind,
    title: `Dummy ${kind}`,
    fileRef: `dummy://${kind}.pdf`,
    ownerId,
    requiresApproval: false,
  });
  return d;
}
