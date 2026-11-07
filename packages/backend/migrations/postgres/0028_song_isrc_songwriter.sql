-- D-191: the songwriter of the song beside each link, so the database itself keeps one ISRC under one song per
-- songwriter (D-190). A song never changes its songwriter; two songwriters on one ISRC (co-authorship) stay allowed.

ALTER TABLE links.song_isrc ADD COLUMN IF NOT EXISTS songwriter_id text;

UPDATE links.song_isrc l SET songwriter_id = s.songwriter_id
  FROM pubv2.songs s
 WHERE s.org_id = l.org_id AND s.id = l.song_id AND l.songwriter_id IS NULL;

ALTER TABLE links.song_isrc ALTER COLUMN songwriter_id SET NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS song_isrc_one_per_songwriter ON links.song_isrc (org_id, songwriter_id, isrc);
