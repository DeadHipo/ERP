-- D-192: a publishing term may name an ISRC: the percent of the owner on the songs of that track (a buyout of the
-- composition, special terms). Without an ISRC it is the owner's own percent, as before. Same rules: a new term closes
-- the open one of the same owner and ISRC; a mistake is cancelled. `basis` says what it rests on (the contract, the share sold).

ALTER TABLE links.publishing_terms ADD COLUMN IF NOT EXISTS isrc text CHECK (isrc IS NULL OR isrc ~ '^[A-Z]{2}[A-Z0-9]{3}[0-9]{7}$');
ALTER TABLE links.publishing_terms ADD COLUMN IF NOT EXISTS basis text;

DROP INDEX IF EXISTS links.publishing_terms_start;
CREATE UNIQUE INDEX IF NOT EXISTS publishing_terms_start
    ON links.publishing_terms (org_id, owner_id, COALESCE(isrc, ''), valid_from) WHERE cancelled_at IS NULL;
