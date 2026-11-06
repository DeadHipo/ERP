import type { z } from 'zod';
import type { splitImportSchema } from '@erp/shared/api-responses';

/** The answer of `POST /splits/import` (preview or apply). */
export type SplitImport = z.output<typeof splitImportSchema>;
export type ImportRow = SplitImport['rows'][number];
export type ImportGroup = SplitImport['groups'][number];
