-- D-233: the MC mark on every split row of an MC, in every version of the split (history included), so that the
-- advertising, which reads the mark of the split in force at the month of the expense, keeps exempting the MCs it
-- exempted by their name before. The initial set is exactly the old name rule of the advertising (a pseudonym
-- «MC …», «MC_…», «MC-…», any case); the owner then corrects the exceptions. Marking a row also stops it bearing the
-- pool carves of other MCs (D-216, the owner's rule of 2026-11-18: «MC не несёт вырезы других»).
-- A data-only bypass of the facade (an in-place update of the versions, like the date normalisation of D-131): run
-- through psql on a database with a fresh dump. Prints the counts; idempotent.
BEGIN;
UPDATE splits.split_shares sh
   SET is_mc = true
  FROM owners.artists a
 WHERE a.id = sh.artist_id
   AND a.org_id = sh.org_id
   AND a.pseudonym ~* '^\s*mc[[:space:]_-]'
   AND sh.is_mc = false;
SELECT count(*) AS mc_rows, count(DISTINCT sh.artist_id) AS mc_pseudonyms
  FROM splits.split_shares sh WHERE sh.is_mc;
COMMIT;
