-- D-195: the release registry without the file. A row is (org, label, UPC); a new export updates it (preview → apply),
-- the provenance is the audit. The release time is kept as the export gives it (no time zone in the value).
-- The table was empty in every store when this ran (the D-172 import had not been used on real data).
DROP TABLE IF EXISTS owners.releases;
CREATE TABLE owners.releases (
    org_id          text NOT NULL,
    label_id        text NOT NULL,
    upc             text NOT NULL CHECK (upc ~ '^[0-9]+$'),
    release_title   text NOT NULL,
    version         text,
    artist_string   text,
    label_string    text,
    released_at     timestamp without time zone,
    track_count     integer CHECK (track_count >= 0),
    catalog_number  text,
    territories     integer,
    stores          integer,
    created_at      timestamptz NOT NULL,
    updated_at      timestamptz NOT NULL,
    PRIMARY KEY (org_id, label_id, upc)
);
CREATE INDEX IF NOT EXISTS releases_org_upc ON owners.releases (org_id, upc);
