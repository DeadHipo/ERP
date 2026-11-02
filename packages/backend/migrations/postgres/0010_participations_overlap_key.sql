-- The participation overlap key includes the source artist (D-130): two artist_share participations of one recipient
-- on one ISRC from two different source artists coexist (G12 style); the same source twice is still refused.
-- from_artist_id is NULL for every kind but artist_share, so coalesce keeps the old key for them.

ALTER TABLE splits.participations DROP CONSTRAINT IF EXISTS participations_no_overlap;
ALTER TABLE splits.participations
    ADD CONSTRAINT participations_no_overlap EXCLUDE USING gist (
        isrc WITH =,
        artist_id WITH =,
        funded_from WITH =,
        (coalesce(from_artist_id, '')) WITH =,
        daterange(valid_from, valid_to, '[)') WITH &&
    );
