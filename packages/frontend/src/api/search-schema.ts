import { z } from 'zod';

// TEMPORARY: `GET /search` is built in step 3.3b. Until its response schema lands in `@erp/shared/api-responses`
// (17 N10), the shell parses the response with this schema; step 3.3b replaces it with the shared one.
export const searchKinds = ['owners', 'artists', 'tracks', 'documents', 'labels'] as const;

export const searchResponseSchema = z.object({
  owners: z.array(z.object({ id: z.string(), name: z.string(), status: z.string() })).default([]),
  artists: z.array(z.object({ id: z.string(), pseudonym: z.string(), ownerId: z.string().nullable() })).default([]),
  tracks: z.array(z.object({ isrc: z.string().nullable(), upc: z.string().nullable(), title: z.string() })).default([]),
  documents: z.array(z.object({ id: z.string(), title: z.string(), kind: z.string(), status: z.string() })).default([]),
  labels: z.array(z.object({ id: z.string(), name: z.string(), kind: z.string() })).default([]),
});
