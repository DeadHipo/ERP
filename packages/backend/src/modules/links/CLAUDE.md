# links module (D-183)

The operator's decisions that join two modules, since modules never know each other. Two tables: a songwriter
of `pubv2` → an owner, a song of `pubv2` → its ISRCs (many; the whole set is replaced on a decision). Ids are opaque text. The module checks nothing: `facade/pubv2-links.ts` knows both sides and
makes the recommendation. A link is never set automatically. `calculate()` and the layers do not read it
(`tests/pubv2.test.ts`). One row per songwriter; a new decision replaces it, the `audit` module keeps the history.

`publishing_terms` (D-185): the author percent of an owner, moved one to one from `publishing.pub_terms` (the old module is gone, D-234). A term is never edited: a new one closes the open one. The calculation reads it through `facade/publishing-source.ts`.

D-188: no operation type in `publishing_terms`; a mistaken term is cancelled (`cancelled_at`, `cancelled_by`, `cancel_reason`), never deleted or edited: only the latest of its owner, the term it closed opens again. Reads skip cancelled rows.

D-190, D-191: `song_isrc` carries the `songwriter_id` of the song (a song never changes its songwriter); the unique index `(org_id, songwriter_id, isrc)` keeps one ISRC under one song per songwriter. Two songwriters on one ISRC is co-authorship and allowed. A future merge of songwriters must update this column in the same transaction (and meets the index when both had the ISRC).

D-192: `publishing_terms.isrc` (null = the owner's own percent) and `basis`. A term of an ISRC has the same rules within its (owner, ISRC): a new one closes the open one, a cancel reopens the previous one; the unique start index is on `(org, owner, COALESCE(isrc, ''), valid_from)`. `ownerTerms()` / `isrcTerms()` split them; `publishingTerms()` gives both. The facade applies them in `publishing-source.ts` through `pubv2-isrc-terms.ts`.

D-194: `reassignOwner(from, into)` moves the `songwriter_owner` rows of a merged owner (called by the merge through `facade/publishing-source.ts`); terms stay with their record and the facade prefers the survivor's own.

D-217: `sublabel_terms` — the term of a sublabel (`labels.sublabels`) on an ISRC: `percent` of the label share after the artists and the participations, `valid_from` / `valid_to` (month starts; the facade floors), `document_id` (null = the money waits). The rules of `publishing_terms`: one live term per ISRC at a month, a new one closes the open one (`term_overlap` for a start on or before a live start or inside a closed term), `closeSublabelTerm` once, `cancelSublabelTerm` only the latest of the ISRC (the closed one opens again), `attachSublabelTermDocument` once where there is none. The money does not read the table yet: the calculation still takes the sublabel rules of `labels`.
