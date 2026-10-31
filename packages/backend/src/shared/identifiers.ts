import { randomUUID } from 'node:crypto';
import { ValidationError } from './errors';

export const newId = (): string => randomUUID();

/** ISRC normalization shared by all modules: no dashes or spaces, upper case. */
export function normalizeIsrc(raw: string | null | undefined): string {
  return (raw ?? '').replace(/[-\s]/g, '').toUpperCase();
}

/** ISRC format: CC + 3 alphanumerics + 2-digit year + 5 digits. */
export function assertIsrc(raw: string): string {
  const isrc = normalizeIsrc(raw);
  if (!/^[A-Z]{2}[A-Z0-9]{3}\d{7}$/.test(isrc)) throw new ValidationError(`Invalid ISRC "${raw}"`);
  return isrc;
}

/** UPC/EAN: digits only. */
export function normalizeUpc(raw: string | null | undefined): string {
  return (raw ?? '').replace(/\D/g, '');
}

/**
 * Name key used only for operator hints (possible duplicates) and for publishing writer aliases.
 * Never used to decide who gets master money.
 */
export function normalizeName(raw: string): string {
  return raw
    .normalize('NFKC')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim();
}
