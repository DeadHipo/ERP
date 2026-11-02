-- Participations in the splits module (D-126): a percent of a base paid to a recipient pseudonym, funded from one bucket.
-- Rows of split_shares may carry their own document. artist_id, from_artist_id and document_id refer to the owners
-- module: no foreign keys across modules (the facade checks).

ALTER TABLE splits.split_shares ADD COLUMN IF NOT EXISTS document_id text;

CREATE TABLE IF NOT EXISTS splits.participations (
    id             text PRIMARY KEY,
    isrc           text NOT NULL CHECK (isrc ~ '^[A-Z]{2}[A-Z0-9]{3}[0-9]{7}$'),
    artist_id      text NOT NULL,
    percent        numeric(9, 6) NOT NULL CHECK (percent >= 0 AND percent <= 100),
    base           text NOT NULL CHECK (base IN ('net', 'bucket')),
    funded_from    text NOT NULL CHECK (funded_from IN ('top', 'artist_pool', 'artist_share', 'label_share')),
    from_artist_id text,
    valid_from     date NOT NULL,
    valid_to       date CHECK (valid_to IS NULL OR valid_to > valid_from),
    document_id    text,
    origin         text NOT NULL CHECK (origin <> ''),
    note           text,
    created_at     timestamptz NOT NULL DEFAULT now(),

    CONSTRAINT participations_combination CHECK (
        (funded_from IN ('top', 'artist_pool') AND base = 'net')
        OR (funded_from = 'artist_share' AND base = 'bucket' AND from_artist_id IS NOT NULL AND from_artist_id <> artist_id)
        OR (funded_from = 'label_share' AND from_artist_id IS NULL)
    ),
    CONSTRAINT participations_no_overlap EXCLUDE USING gist (
        isrc WITH =,
        artist_id WITH =,
        funded_from WITH =,
        daterange(valid_from, valid_to, '[)') WITH &&
    )
);
CREATE INDEX IF NOT EXISTS participations_isrc ON splits.participations (isrc, valid_from);
