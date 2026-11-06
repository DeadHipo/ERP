# links module (D-183)

The operator's decisions that join two modules, since modules never know each other. Two tables: a songwriter
of `pubv2` → an owner, a song of `pubv2` → its ISRCs (many; the whole set is replaced on a decision). Ids are opaque text. The module checks nothing: `facade/pubv2-links.ts` knows both sides and
makes the recommendation. A link is never set automatically. `calculate()` and the layers do not read it
(`tests/pubv2.test.ts`). One row per songwriter; a new decision replaces it, the `audit` module keeps the history.
