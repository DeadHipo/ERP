import type { Readable } from 'node:stream';
import { ValidationError } from '../../shared/errors';

/** A field longer than this is a broken file (e.g. an unclosed quote), not data. */
const MAX_FIELD = 64 * 1024;

/**
 * Streaming RFC 4180 parser: quoted fields, "" escapes, delimiters and newlines inside quotes, CRLF or LF.
 * Yields one string[] per record; holds one chunk plus the current record in memory. Invalid UTF-8 is an error.
 */
export async function* parseCsv(input: Readable, delimiter = ';'): AsyncGenerator<string[]> {
  const utf8 = new TextDecoder('utf-8', { fatal: true });
  const decoder = {
    write: (b: Buffer) => {
      try {
        return utf8.decode(b, { stream: true });
      } catch {
        throw new ValidationError('The report is not valid UTF-8');
      }
    },
    end: () => {
      try {
        return utf8.decode();
      } catch {
        throw new ValidationError('The report is not valid UTF-8');
      }
    },
  };
  let field = '';
  let record: string[] = [];
  let inQuotes = false;
  let quotePending = false; // saw a quote inside a quoted field: either an escape or the closing quote
  let first = true;
  let fieldStarted = false;

  const D = delimiter;
  function* feed(text: string): Generator<string[]> {
    for (let i = 0; i < text.length; i++) {
      const ch = text[i] as string;
      if (inQuotes) {
        if (quotePending) {
          quotePending = false;
          if (ch === '"') {
            field += '"';
            continue;
          }
          inQuotes = false; // closing quote, fall through to normal handling of ch
        } else if (ch === '"') {
          quotePending = true;
          continue;
        } else {
          field += ch;
          if (field.length > MAX_FIELD)
            throw new ValidationError('A quoted field is too long: unclosed quote in the report?');
          continue;
        }
      }
      if (ch === '"' && !fieldStarted) {
        inQuotes = true;
        fieldStarted = true;
      } else if (ch === D) {
        record.push(field);
        field = '';
        fieldStarted = false;
      } else if (ch === '\n') {
        record.push(field);
        field = '';
        fieldStarted = false;
        const out = record;
        record = [];
        if (!(out.length === 1 && out[0] === '')) yield out;
      } else if (ch === '\r') {
        // CR is ignored outside quotes (CRLF line ends)
      } else {
        field += ch;
        fieldStarted = true;
        if (field.length > MAX_FIELD)
          throw new ValidationError('A field is too long: the file is not a ";"-separated report');
      }
    }
  }

  for await (const chunk of input) {
    let text = decoder.write(chunk as Buffer);
    if (first) {
      if (text.charCodeAt(0) === 0xfeff) text = text.slice(1);
      first = false;
    }
    yield* feed(text);
  }
  yield* feed(decoder.end());
  if (quotePending) {
    inQuotes = false;
    quotePending = false;
  }
  if (inQuotes) throw new ValidationError('CSV ends inside a quoted field');
  if (field !== '' || record.length > 0 || fieldStarted) {
    record.push(field);
    yield record;
  }
}
