import { CONTRACT_DOCUMENT_KINDS, DOCUMENT_KINDS, SPLIT_DOCUMENT_KINDS, type DocumentKind } from '@erp/shared/document-kinds';

// The document kinds each dialog offers, derived from the one list of `@erp/shared/document-kinds` (D-172): a new kind
// of the backend reaches every dialog without a copy here. `tests/document-kinds.test.ts` pins each list to the shared
// one. An `assumption` is never chosen in a dialog: it is created only by «Принять как допущение» (`AssumeDialog`) and
// is never approved, so the document step could not finish with it.

const notAssumption = (k: DocumentKind) => k !== 'assumption';

/** Every kind (P13 filter and «Создать документ»). */
export const ALL_DOCUMENT_KINDS: readonly DocumentKind[] = DOCUMENT_KINDS;
/** The kinds a split, a split row or a participation accepts (the first, `appendix`, is the default of a new one). */
export const SPLIT_STEP_KINDS: readonly DocumentKind[] = SPLIT_DOCUMENT_KINDS.filter(notAssumption);
/** A buyout: the same kinds, `buyout` first. */
export const BUYOUT_STEP_KINDS: readonly DocumentKind[] = ['buyout', ...SPLIT_STEP_KINDS.filter((k) => k !== 'buyout')];
/** The kinds a contract references (`POST /contracts`). */
export const CONTRACT_STEP_KINDS: readonly DocumentKind[] = CONTRACT_DOCUMENT_KINDS;
/** The documents of an owner (P10 «Документы»): every kind but the assumption. */
export const OWNER_DOCUMENT_KINDS: readonly DocumentKind[] = DOCUMENT_KINDS.filter(notAssumption);
