import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';
import type { Readable } from 'node:stream';
import yauzl from 'yauzl';
import { ValidationError } from './errors';

/** sha256 of a file, computed while streaming (files may be ~1 GB). */
export function sha256File(path: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const h = createHash('sha256');
    createReadStream(path)
      .on('data', (c) => h.update(c))
      .on('error', reject)
      .on('end', () => resolve(h.digest('hex')));
  });
}

/** Largest unpacked report accepted from a zip (a real monthly Believe report unpacks to about 1-2 GB). */
export const MAX_UNZIPPED_BYTES = 16 * 1024 ** 3;

/**
 * Opens the single entry of a zip archive as a stream. More than one entry, an entry that is not a CSV, or an entry
 * larger than MAX_UNZIPPED_BYTES is an error (yauzl checks the declared size against the bytes it inflates).
 */
export function openSingleZipEntry(
  path: string,
): Promise<{ name: string; stream: Readable; modifiedAt: string }> {
  return new Promise((resolve, reject) => {
    // autoClose is off: after listing the entries the archive must stay open to stream the single entry.
    yauzl.open(path, { lazyEntries: true, autoClose: false }, (err, zip) => {
      if (err || !zip)
        return reject(new ValidationError(`Cannot open zip: ${err?.message ?? 'unknown error'}`));
      // The archive is released exactly once, however the entry stream ends (end, error, or destroyed early).
      let closed = false;
      const close = () => {
        if (!closed) {
          closed = true;
          zip.close();
        }
      };
      const entries: yauzl.Entry[] = [];
      zip.on('entry', (e: yauzl.Entry) => {
        if (!e.fileName.endsWith('/') && !e.fileName.startsWith('__MACOSX')) entries.push(e);
        zip.readEntry();
      });
      zip.on('error', (e: Error) => {
        close();
        reject(e);
      });
      zip.on('end', () => {
        if (entries.length !== 1) {
          close();
          return reject(new ValidationError(`Zip must contain exactly one file, found ${entries.length}`));
        }
        const entry = entries[0] as yauzl.Entry;
        if (!/\.csv$/i.test(entry.fileName)) {
          close();
          return reject(
            new ValidationError(`The file inside the zip must be a .csv report, found ${entry.fileName}`),
          );
        }
        if (entry.uncompressedSize > MAX_UNZIPPED_BYTES) {
          close();
          return reject(
            new ValidationError(`The report inside the zip is too large (${entry.uncompressedSize} bytes)`),
          );
        }
        zip.openReadStream(entry, (e2, stream) => {
          if (e2 || !stream) {
            close();
            return reject(e2 ?? new Error('Cannot read zip entry'));
          }
          stream.on('end', close);
          stream.on('error', close);
          stream.on('close', close);
          resolve({ name: entry.fileName, stream, modifiedAt: entry.getLastModDate().toISOString() });
        });
      });
      zip.readEntry();
    });
  });
}

/**
 * Opens a report file as a stream; `.zip` archives are unpacked on the fly. For a zip, the entry's modification
 * time is returned as the best available generation date.
 */
export async function openReportStream(
  path: string,
  fileName: string,
): Promise<{ stream: Readable; modifiedAt: string | null }> {
  if (/\.zip$/i.test(fileName)) {
    const e = await openSingleZipEntry(path);
    return { stream: e.stream, modifiedAt: e.modifiedAt };
  }
  return { stream: createReadStream(path), modifiedAt: null };
}
