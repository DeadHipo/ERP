import { createWriteStream } from 'node:fs';
import { mkdir, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { pipeline } from 'node:stream/promises';
import busboy from 'busboy';
import type { Request } from 'express';
import * as S from '@erp/shared/api-schemas';
import type { Facade } from '../facade';
import { parse } from './http';
import { ValidationError } from '../shared/errors';
import { newId } from '../shared/identifiers';

export interface UploadedFile {
  path: string;
  fileName: string;
  fields: Record<string, string>;
  cleanup(): Promise<void>;
}

const MAX_UPLOAD = 2 * 1024 ** 3;

/**
 * Streams a multipart upload (field "file") to a temporary file; the request body is never buffered in memory.
 * An upload cut by the size limit is an error, and the temporary file is removed on every failure.
 */
export async function receiveUpload(req: Request, tmpDir: string): Promise<UploadedFile> {
  await mkdir(tmpDir, { recursive: true });
  const path = join(tmpDir, `${newId()}.upload`);
  const cleanup = () => rm(path, { force: true });
  // Kept outside the promise: on a failure the write must settle before the file is removed (D-101).
  let fileStream: (NodeJS.ReadableStream & { destroy(): void }) | undefined;
  let written: Promise<string> | undefined;
  try {
    return await new Promise<UploadedFile>((resolve, reject) => {
      let bb: busboy.Busboy;
      try {
        bb = busboy({
          headers: req.headers,
          defParamCharset: 'utf8',
          limits: { files: 1, fileSize: MAX_UPLOAD },
        });
      } catch {
        reject(new ValidationError('Expected multipart/form-data with a "file" field'));
        return;
      }
      const fields: Record<string, string> = {};
      let truncated = false;
      bb.on('field', (name, value) => (fields[name] = value));
      bb.on('file', (name, stream, info) => {
        if (name !== 'file' || written) {
          stream.resume();
          return;
        }
        fileStream = stream;
        stream.on('limit', () => (truncated = true));
        written = pipeline(stream, createWriteStream(path)).then(() => info.filename || 'upload');
      });
      bb.on('error', reject);
      req.on('aborted', () => reject(new ValidationError('The upload was aborted')));
      bb.on('close', () => {
        if (!written) return reject(new ValidationError('No file in the upload (field "file")'));
        written
          .then((fileName) => {
            if (truncated) return reject(new ValidationError('The file is larger than the upload limit'));
            resolve({ path, fileName: fields['fileName'] || fileName, fields, cleanup });
          })
          .catch(reject);
      });
      req.pipe(bb);
    });
  } catch (e) {
    fileStream?.destroy();
    await written?.catch(() => undefined);
    await cleanup().catch(() => undefined); // never hide the original error
    throw e;
  }
}

/**
 * The label of an upload (`?label=`, D-169), checked before the multipart body is received: a refusal drains the
 * body unread (`req.resume()`) and answers at once.
 */
export async function uploadLabel(facade: Facade, req: Request): Promise<string> {
  try {
    const { label } = parse(S.uploadLabelQuery, req.query);
    return (await facade.assertUploadLabel(label)).id;
  } catch (e) {
    await drain(req);
    throw e;
  }
}

/**
 * Reads the request body to its end without keeping any of it, so that the client finishes writing before the
 * refusal is sent (a response that closes the socket while the client still writes gives it EPIPE).
 */
function drain(req: Request): Promise<void> {
  return new Promise((resolve) => {
    if (req.readableEnded || req.complete) return resolve();
    const done = () => resolve();
    req.once('end', done);
    req.once('error', done);
    req.once('close', done);
    req.resume();
  });
}
