/**
 * The source of the money of publishing (D-185, D-189): `v2` = the report summaries and the links, `v1` = the old module.
 * One switch for the facade and for `GET /auth/me` (D-194: the UI opens the dialogs of the source that takes writes).
 */
export type PublishingSource = 'v1' | 'v2';
export const publishingSourceOf = (env: NodeJS.ProcessEnv = process.env): PublishingSource =>
  env.PUBLISHING_SOURCE === 'v2' ? 'v2' : 'v1';
