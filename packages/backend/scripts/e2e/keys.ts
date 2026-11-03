/**
 * Naming of the e2e seed (docs/agents/19_golden_screens.md §1) as pure functions: no backend imports, so the
 * Playwright specs may import them. The ids generated at seed time are in `.seed-keys.json` (see `SeedKeys`).
 */
const pad = (n: number) => String(n).padStart(2, '0');

/** `QZTST27<nn><k>0<j>` */
export const isrc = (nn: number, k: number, j: number) => `QZTST27${pad(nn)}${k}0${j}`;
/** `27<nn><k>0000000<j>` */
export const upc = (nn: number, k: number, j: number) => `27${pad(nn)}${k}0000000${j}`;
/** `27<nn><k>0<a>` (a = 0 for the first account, 1 for a second one) */
export const account = (nn: number, k: number, a = 0) => `27${pad(nn)}${k}0${a}`;
/** Pseudonym of a letter in scenario `nn`, case `k`: `A-011`. */
export const pseudonym = (letter: string, nn: number, k: number) => `${letter}-${pad(nn)}${k}`;
/** Person owner of a letter: `Owner A-011`. */
export const ownerName = (letter: string, nn: number, k: number) => `Owner ${pseudonym(letter, nn, k)}`;
/** The one B17 statement of the whole seed (no quarter in the name: one quarter would be forced on every row). */
export const B17_FILE_NAME = '0to8_e2e_Publishing_Statement.xlsx';

/** What `seed.ts` writes to `data/test-tmp/e2e-keys.json` and `packages/frontend/e2e/.seed-keys.json`. */
export interface CaseKeys {
  /** ISRC / UPC / account lists of the case. */
  isrcs: string[];
  upcs: string[];
  accounts: string[];
  /** Letter -> pseudonym text (`A` -> `A-011`). */
  names: Record<string, string>;
  /** Letter -> owner id (a pseudonym letter maps to the owner of that pseudonym). */
  owners: Record<string, string>;
  /** Letter -> artist (pseudonym) id. */
  artists: Record<string, string>;
  /** Short name -> document id. */
  documents: Record<string, string>;
  /** ISRC -> split ids created by the seed, in creation order. */
  splits: Record<string, string[]>;
  /** Letter -> participation id. */
  participations: Record<string, string>;
  /** Label name -> label id. */
  labels: Record<string, string>;
  /** Label string -> rule id. */
  labelRules: Record<string, string>;
  /** B17 lines of the case: title -> { writer, payable, period }. */
  b17: Record<string, { writer: string; payable: string; period: string; songwriters: string; operationType: string }>;
  /** Free text facts a spec needs (the label string, the operation ids ...). */
  extra: Record<string, string>;
}

export interface SeedKeys {
  /** `S01` -> `k1` -> keys; the shared seed is `S00` / `k0`. */
  scenarios: Record<string, Record<string, CaseKeys>>;
  /** Shared entities: label ids, the owner / artist of NG, QQ and the brand 0to8. */
  shared: Record<string, string>;
  stores: { pg: string; ch: string; chStage: string };
  dataDir: string;
  b17FileName: string;
}
