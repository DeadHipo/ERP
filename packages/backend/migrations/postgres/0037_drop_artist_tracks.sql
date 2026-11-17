-- D-233: the stored artist → track links go (the owner, 2026-11-18). The money never read them; every one of the
-- 15 493 live pairs repeated a split row or a participation of the same pseudonym on the same ISRC. The pseudonyms of
-- a track are now those of its split rows and participations only. A dump of the live rows is kept outside the repo.
DROP TABLE IF EXISTS owners.artist_tracks;
