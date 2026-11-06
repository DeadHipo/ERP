// The limits of the Believe release export import (D-172, `POST /releases/import`): one source for the backend reader,
// the route and the frontend. The real export of a label is about 8 000 rows, 1 MB.

/** At most this many releases in the file (413 `import_too_large`). */
export const RELEASE_IMPORT_MAX_ROWS = 20_000;
/** At most this many bytes of the uploaded file (413 `import_too_large`). */
export const RELEASE_IMPORT_MAX_BYTES = 10 * 1024 * 1024;
