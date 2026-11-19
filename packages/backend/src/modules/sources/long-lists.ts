// Long lists as ClickHouse query parameters (D-195, D-258). The client sends a query parameter as a field of the
// URL (`param_isrcs=['A','B']`, form-encoded by `URLSearchParams`); the HTTP interface refuses a field longer than
// 131 072 bytes as it travels, encoded («Field value too long»: an ISRC is 21 bytes there, about 6 200 ISRCs). A
// list longer than `LIST_CHUNK` values is cut into chunks of distinct values in byte order, one query per chunk; the
// caller joins the answers so that the result is the one a single query would give. Pure, no storage.

/** Values of one list in one ClickHouse parameter: 1 000 ISRCs are 21 KB of a field that may hold 128 KB. */
export const LIST_CHUNK = 1_000;

/** Bytes of one list in one parameter, as the field of the URL: under the limit of 131 072 with room to spare. */
const LIST_BYTES = 100_000;

const PLAIN = /^[A-Za-z0-9]*$/;

/**
 * The bytes one value adds to the field of the URL, exactly as the client writes it (@clickhouse/client
 * `formatQueryParams` + `URLSearchParams`): the value with `\`, `'`, tab and line ends escaped, in quotes, a comma
 * after it, all of it form-encoded (a quote or a comma is 3 bytes, a Cyrillic letter 6).
 */
function sizeOf(v: string): number {
  if (PLAIN.test(v)) return v.length + 9; // %27…%27%2C
  let escaped = '';
  for (const ch of v)
    escaped += ch === '\t' ? '\\t' : ch === '\n' ? '\\n' : ch === '\r' ? '\\r' : ch === "'" ? "\\'" : ch === '\\' ? '\\\\' : ch;
  return new URLSearchParams([['', `'${escaped}',`]]).toString().length - 1;
}

const isSurrogate = (code: number) => code >= 0xd800 && code <= 0xdfff;

/**
 * The order of two texts as ClickHouse orders a `String`: by the bytes of UTF-8 (= by code points), not by a locale.
 * It differs from `<` of JavaScript (UTF-16 units) only where a character beyond U+FFFF meets one of U+E000…U+FFFF.
 */
export function byteCompare(a: string, b: string): number {
  if (a === b) return 0;
  const n = Math.min(a.length, b.length);
  for (let i = 0; i < n; i += 1) {
    const x = a.charCodeAt(i);
    const y = b.charCodeAt(i);
    if (x === y) continue;
    const sx = isSurrogate(x);
    return sx === isSurrogate(y) ? x - y : sx ? 1 : -1;
  }
  return a.length - b.length;
}

/**
 * The chunks of a list, or `undefined` when the list fits one parameter and must go as it is (the query and its
 * parameter are then exactly those of before). The chunks hold the distinct values in byte order, so the values of a
 * chunk are all below those of the next one: for a query ordered by that column first, the answers of the chunks one
 * after another are the answer of one query.
 */
export function listChunks(values: string[], size: number = LIST_CHUNK): string[][] | undefined {
  if (values.length <= size && values.reduce((n, v) => n + sizeOf(v), 0) <= LIST_BYTES) return undefined;
  const distinct = [...new Set(values)].sort(byteCompare);
  const chunks: string[][] = [];
  let chunk: string[] = [];
  let bytes = 0;
  for (const v of distinct) {
    if (chunk.length > 0 && (chunk.length >= size || bytes + sizeOf(v) > LIST_BYTES)) {
      chunks.push(chunk);
      chunk = [];
      bytes = 0;
    }
    chunk.push(v);
    bytes += sizeOf(v);
  }
  if (chunk.length > 0) chunks.push(chunk);
  return chunks;
}

/**
 * Reads by a list that may be long: one read with the list as given when it fits, else one read per chunk, one after
 * another (as `isrcsOfUpcs` of D-195), the rows joined in chunk order. `undefined` (no filter) is one read.
 */
export async function readByList<T>(
  values: string[] | undefined,
  read: (part: string[] | undefined) => Promise<T[]>,
  size: number = LIST_CHUNK,
): Promise<{ rows: T[]; chunked: boolean }> {
  const chunks = values && listChunks(values, size);
  if (!chunks) return { rows: await read(values), chunked: false };
  const rows: T[] = [];
  for (const part of chunks) for (const r of await read(part)) rows.push(r);
  return { rows, chunked: true };
}
