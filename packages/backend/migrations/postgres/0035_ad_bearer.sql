-- D-231: who bears the unrecovered part of an advertising expense is set by hand (the owner, 2026-11-18): the payer
-- label (null, the default) or a sublabel of the register. Since D-229 the money reads no sublabel rule, so the
-- calculation never decides it from a Believe string; the money itself is unchanged (a sublabel has no recipient: the
-- unrecovered part stays the label's), the sublabel's report shows it.
ALTER TABLE ads.expenses ADD COLUMN IF NOT EXISTS bearer_sublabel_id text;
