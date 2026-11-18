-- D-238: the metadata of a recording by ISRC (the owner, 2026-11-18: per organization, no history, no loader yet; edited
-- from the UI and the API). Navigation, not money: the calculation never reads these tables.
--   track_meta      one row per ISRC: what the screens show (the title with its version, artists, duration, cover…);
--   track_platforms what was found on each platform (1 : N), one row per platform entry (a platform may hold several).
CREATE TABLE IF NOT EXISTS owners.track_meta (
    org_id            text        NOT NULL,
    isrc              text        NOT NULL CHECK (isrc ~ '^[A-Z]{2}[A-Z0-9]{3}[0-9]{7}$'),
    title             text,
    version           text,
    artists           text,
    duration_ms       integer     CHECK (duration_ms > 0),
    explicit          boolean,
    release_date      date,
    cover_url         text,
    primary_platform  text,
    updated_at        timestamptz NOT NULL,
    updated_by        text        NOT NULL,
    PRIMARY KEY (org_id, isrc)
);

CREATE TABLE IF NOT EXISTS owners.track_platforms (
    org_id        text        NOT NULL,
    id            text        PRIMARY KEY,
    isrc          text        NOT NULL CHECK (isrc ~ '^[A-Z]{2}[A-Z0-9]{3}[0-9]{7}$'),
    platform      text        NOT NULL,
    platform_id   text,
    url           text,
    album_id      text,
    album_url     text,
    upc           text,
    title         text,
    artists       text,
    duration_ms   integer     CHECK (duration_ms > 0),
    explicit      boolean,
    release_date  date,
    cover_url     text,
    status        text        NOT NULL DEFAULT 'found' CHECK (status IN ('found', 'not_found', 'error')),
    source        text        NOT NULL DEFAULT 'manual',
    raw           jsonb,
    fetched_at    timestamptz,
    updated_at    timestamptz NOT NULL,
    updated_by    text        NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS track_platforms_entry
    ON owners.track_platforms (org_id, isrc, platform, coalesce(platform_id, ''));
CREATE INDEX IF NOT EXISTS track_platforms_isrc ON owners.track_platforms (org_id, isrc);
