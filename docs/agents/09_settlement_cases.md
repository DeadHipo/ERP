# Settlement cases: the catalogue (stage 1 of the MVP goal, 2026-11-02, revision 2 after the council)

Input: `notes/settlement_landscape.md` (the map, M1…M31 and the MVP list). This file verifies the map against a sample
of contracts, the reference workbooks (Annex 14 beta of 2026-11-02, `0to8 Main.xlsx`), the live data (ClickHouse,
PostgreSQL, the old `erp.db`), report-processor and zero-erp, and the current ERP code. It is the input of stage 2
(target model, plan, golden cases). Every case states: essence, base (what the percent multiplies), payer (who owes
the recipient), an example (path or sheet, ISRC, amount), how the ERP calculates it today, and its status.
Council verdicts of revision 1 and what changed: `reviews/stage1_*.md`.

Status values: **exact** (works today), **MVP layer** (needs a calculation layer), **MVP data** (closed by entering
data into existing or planned entities, no calculation field of its own), **signal** (flag, moves no money),
**later** (outside the MVP), **out** (consciously not done).

Paths: `PD/` = `context_data/PandaDoc_documents_0 (2)/Root/`, `R/` = `context_data/Root/`, `P37/` =
`context_data/для_разработчика_37_документов_2026-11-02/` (its subfolders `3.1 IP ownership`, `3.3 Duetti carve-out`,
`3.4 Fixed term`, `3.5 Not yet documented`, `3.10 Third-party licences`, `3.11 Disputes`). Annex = `context_data/Annex
14_beta (обновлено покрытие).xlsx` (the file with the Sch* sheets; "Sch3A row N" = data row N, sheet row N + 2).
Privacy: stage names, label names, ISRC, amounts and file names; no legal names of people. Research reports behind this
file are in the session scratchpad, not in the repo.

Precedence when sources disagree (map §6): contract and owner decision of 2026-11-02 > Annex 14 > report-processor >
`0to8 Main.xlsx`; what was **paid** is taken from `0to8 Main.xlsx` as fact. Open questions are answered from the
contract → owner answers → `docs/97–99` → `contract_index` → `context`; when nothing answers, the council decides, the
D-entry says "assumption", and the money that depends on it stays in C with reason `assumption`.

## 1. Facts about the data that shape the model

Believe, 47 loaded files, 75,744,752 raw lines, net 16,338,476.40 (2023-11…2026-08), all USD. Verified by QA.

| Fact | Value | Consequence |
|---|---|---|
| Two Believe accounts | 1052428 (label 0to8, 34 files, 2023-11…2026-08, net 15,287,531.30) and 1055956 (label Echo8, 13 files, 2025-08…2026-08, net 1,050,945.10) | Echo8 is a second "our" label with its own contour of "ours" (MVP items 8, 24). A (received) stays per account and month |
| Echo8 catalogue moved between accounts | `label_name = Echo8` inside the 0to8 account 2024-12…2025-07 (net 222,129.81, plus one stray line −0.06 in 2025-12), in the Echo8 account from 2025-08; 2,436 ISRC seen in both accounts; **zero** identical lines across accounts (full fingerprint); 6,551 (ISRC, sales month) pairs reported in both accounts on different platforms (complementary, not duplicated) | Lines are never deduplicated (D-032 kept). The label of record is decided per unit by `label_name`, not by account, and is the same in both accounts |
| Imprint strings | `0to8` 90.57 % of net; `Echo8` 7.72 %; `Ahh Music` 110,128; `NoGhost Records` 56,160 + `NoGhost Records / 0to8` 31,075 + `0to8, NoGhost Records` 49 = **87.3 k**; `77 Records` 23,338 + `0to8 / 77 Records` 34,127; `R2R PRODUCTION` 3,056; Echo8 account: `qaraqshy records` 6,842, `fate music` 2,723, `CATCORE` 2,620, `SF Records` 130; unlisted: `0to8 / Enarma records` 2,094, `0to8/Echo8` 6,026, `0to8 / VBR` 160, `0to8 / PCR` 122, `0to8 / Bear catalogues` 78, `odds` 247, `no job records` 1, `Hoboshrine` 6, `0to8 x ENARMA` 0.5, `0to8/lost` 248; 17 ISRC change label name over time | A labels dictionary maps every string to our label or a sublabel with a rule (M8); a string outside the dictionary puts the unit in C `label_unmapped` |
| `sales_type` | Stream 16,506,757.86, Creation 387,911.28, Download 25,462.15, **Platform Promotion −581,621.61** (gross = net, every month since 2024-04), Abnormal Streaming Recharge −33.28 | Negative promo lines are part of the unit net and follow the unit's rates (D-035, D-094). Everything Believe reports is the "digital" channel (M18). `sales_type` stays out of the unit grain (the breakdown view has it) |
| Negative lines and units | 5,438,279 lines, −624,280.92 (3.82 % of net), 234,634 of them ordinary Stream lines; 438 unit-months below zero (−959.73); 7 units and 815 lines at exactly zero | M26 is ordinary behaviour; every layer keeps the sign and must survive a zero unit |
| No ISRC | 1,444 lines, net 2,364.33 (0.01 %), all Download lines of whole releases | Stays in C `no_isrc` (D-035 ⚠), not a priority (M41) |
| Two UPC for one ISRC | 105 ISRC, net 1,338,259.98 (e.g. DGA082458655) | Rules are keyed by ISRC and apply to every UPC of it; an advance scope may name UPC (M19) |
| gross/net | 1.1765 on Stream lines; `gross_revenue` is in the `units` projection but not read | No contract read needs a gross base (council, product finding 1): the unit keeps net only; gross is one column away if a future letter needs it |
| Coverage of net by splits (2024-01…2026-08, net 16,331,738.52) | split in force 89.60 %; ISRC known, no split 6.58 %; ISRC unknown 3.33 % (543,209.59, **all in the Echo8 account**); split with all shares 0: 0.48 %; no ISRC 0.01 %. Only 69,070.94 of the Echo8 account's 1.05 M falls under a (legacy 0to8) split | ~10 % of net is "ours by default" today (D-029); stage 4 brings the registered splits of Annex 14 and the Echo8 splits in |
| Mid-month instruments | 1,043 of 13,610 splits start on a day other than the 1st; D-025 applies them from the next report month, Annex applies them in the month of the effective date; difference 458 unit-months, 13,363.21 net (largest DGA072567654, 2026-08, 2,223.72) | Verdict in §4 (M52) |
| Reference data in PostgreSQL | 1,114 owners (all `person`, 341 confirmed), 1,107 artists, 13,610 splits / 24,754 shares (0 above 100; 447 all-zero; 87 at exactly 100), 4 B17 statements (1,054,229 lines, 2,171,639.63 payable), **0 operations** | Payout history, advances and overpayments are not loaded (MVP items 29–32 are stage 4 work) |
| Participants already stored as split rows | FRX762590589: MC ROBA CENA 20 % and MC Da 12 7 % as rows of net; DGA062593864: MC MAGRINHO 13 % and Mc Denny 13 % as rows | A participant lives either in the split or in the participation layer, never in both (M43, migration rule in stage 4) |
| B17 `operation_type` | Mechanical 1,335,151.24, Performance 537,170.71, Synchronization 292,421.36, Print 6,896.32; stored per line, dropped by `aggregatedLines()` | The accrual must keep the type (M15/M16) |

## 2. The catalogue: M1…M31 verified

### M1 Artist share of net (RSA / Schedule C)
- Essence: the artist gets a percent of the recording's receipts. Contract wording: percent of "gross receipts actually received by the label" less taxes; what the label receives is Believe net (D-036). Owner decision 7: legal interest and economic share are different columns; the split stores the economic share.
- Base: unit net (ISRC + UPC + report month). Payer: us (0to8 or Echo8 as label of record).
- Example: `PD/RECORDING SERVICES AGREEMENT_200625DJ BOROV.pdf` (50 % ownership, 25 % royalty row); Annex "Splits by ISRC" FR10S2620775 MONTAGEM HIKARI, BellyJay 50 %, receipts 243,762.87.
- Now: exact (`calculation.ts` unit loop; `split_shares.percent` of net; approved appendix/contract on the split, approved contract on the owner).
- Status: **exact**. Data rule M37: the royalty column is read, never the ownership column.

### M2 Several artists, co-authors, MC on one ISRC
- Essence: several rows of one hundred; MC is an ordinary artist (glossary). Thirds are written 16.6 × 3 = 49.8, so the label keeps 50.2 (Annex "Splits by ISRC": 896 ISRC at 0to8 share 0.502, 1,508,754.85 receipts; ERP: 1,193 ISRC with row sum 49.8).
- Base: unit net. Payer: us.
- Example: FRX282572355 VOCE NA MIRA, DJ VGK1 25 % + Hwungii 25 %, receipts 447,364.22; `P37/3.4 Fixed term/…Schedule C #241125DJ DYLANFK` (ownership 25 % → royalty 12.5 % with three co-authors).
- Now: exact; the remainder is ours, so an added row dilutes the label (the M3 problem).
- Status: **exact**. Rounding residue of thirds stays with the label (as in Annex and Main): **MVP data**, no rule.

### M3 Label share fixed: participants reduced, the label is not diluted
- Essence: two mechanisms. (a) **Owner decision 4** (`label_floor` in the owner's JSON): on three titles and all their versions, Sleeping City Funk, Trilalero Tramalima Funk and FUNK DO MALAME AMARELO, the label keeps 50 % and "participants are reduced proportionally". Trilalero rows 50 + 25 = 75 and MALAME rows 50 + 17 + 17 = 84 while Annex shows the label at 0.5 / 0.502: the rows are scaled to the pool (RUSSO 33.33 + DYLANFK 16.67 on 100). On Sleeping City Funk the two licensed MCs keep their 13 % each and the three artists share the remaining 24 (8 each) (Annex Sch3A row 9). (b) The newest RSA template (`P37/3.4 Fixed term/…RDAA #091026 ilysam-Burnedsam`, §6.1/6.7; 19 contracts since 2024-12 flagged in `documents.json`) fixes the label's "Retained Share": a third-party participation reduces only the artist share.
- Base: artist pool = 100 − label share. Payer: us.
- Example: DGA062593864 / DGA062593863 (Sleeping City Funk versions: label 45.8 % in Annex from a duplicated DJ FANGZ row, decided 50 %, difference 4.2 pp × 43,306.84 = 1,819); FR2X42597261/262 (Trilalero); FR96X2565827…830 (MALAME).
- Now: only by hand-computed absolute percents; the label is diluted by every new row.
- Status: (a) **MVP data**: the registry enters the scaled rows (Trilalero, MALAME) and, where a licensed participant has a fixed rate, that participant as a participation funded from the pool (Sleeping City Funk MCs); (b) **MVP layer**: participation funded from the artist pool, used only where the document says so (P08 contracts, Sch3A row 9). Golden cases: one per title.

### M4 Remixer off the top of the whole net, everybody diluted
- Essence: remixer 15 % of net proceeds; the remaining 85 % is split in the former proportion, so the label goes 50 → 42.5 (owner decision 5: "a separate rule", for Kenke and Eiden XII). Kenke's share includes receipts before the agreement date (M33). This is a two-document rule, not a default: on a P08 contract a third party reduces only the artist share (M3).
- Base: unit net, off the top. Payer: us.
- Example: `PD/0to8 Derivative Remix Agreement Kenke.pdf`, FRX282644590 Heavenly jumpstyle (receipts 15,312.89); Eiden XII FRX282644591 (28,856.32; the agreement is not in the folders, owner answer 5 only). Annex "Splits by ISRC" still shows label 0.50 for both.
- Now: not representable (no overlay ordering).
- Status: **MVP layer** (participation off the top; scales everything below).

### M5 Sublabel: half of the label share after artists, MC and remixers
- Essence: owner decision 2 for **NoGhost, R2R PRODUCTION and 77 Records only**: label share by split 50 → label 25 + sublabel 25; computed per month from that month's label share. The NoGhost contract says 25 % of the whole Net Receipts (of Covered Recordings and Covered Compositions) and a USD 50,000 advance recoupable only from the NoGhost share; the owner will re-sign it under the half rule; the composition side is later. R2R and 77 have no written contract (basis: owner decision). "Excluded Projects" (solo TRXSHBXY / WARMANE) are excluded from exclusivity only: released through 0to8 they carry the NoGhost share by the contract's own words. The artist contract never mentions the sublabel (`PD/…RSA #090125TRXSHBXY`), so the layer comes from the imprint of the unit, not from the artist's paper. Other sublabel strings (Echo8's qaraqshy, fate, CATCORE, SF; 0to8's Enarma, VBR, PCR, Bear, odds, no job records, Hoboshrine) have **no decided rule**: Q12.
- Base: label share of the unit after the layers above. Payer: us; the sublabel is an owner of kind `label` whose pseudonym receives the allocation and a payout.
- Example: `PD/0to8 X NoGhost Exclusive Sublabel Agreement.pdf`; Annex Sch3C(i): FRX282688758 FUNK MONOCLE (Raiden 50 %), receipts 11,349.90, NoGhost 25 %; QZWFT2628432 (R2R, artist 70 %), 605.70, label 15 after sublabel 15. Units: NoGhost ≈ 87.3 k net 2026-02…08, 77 Records 57 k, R2R 3 k. report-processor's "half" model computes exactly this for NoGhost and 77.
- Now: none; D-067 ⚠ keeps the money in our share.
- Status: **MVP layer** (a label rule attached to the imprint; the NoGhost advance recoups from that owner's income, scope `any`, since that owner earns nothing else: Q10).

### M6 Pass-through sublabel: we pay the sublabel, the sublabel pays the artists
- Essence: RioX keeps 66.6 % (33.3 own fee + 33.3 artist payment share); 0to8 keeps 33.3 %; payment to RioX discharges 0to8 toward contributors; no artist rows. The base is "gross revenues after deduction of any distribution fees and transaction costs", which is Believe net (the contract answers Q4); 33.3 + 66.6 = 99.9, the residue stays with the label.
- Base: unit net. Payer: us → RioX (owner of kind `label`, its own pseudonym).
- Example: `PD/Sublabel Pass-Through SONG_ROYALTY_SHARE_AGREEMENT_#150426RioX Records.pdf`: MONTAGEM CHANG GE and MONTAGEM ZIZAI with versions, no ISRC; Main: RioX Records income 655.69, no payout; no `label_name` RioX in Believe.
- Now: approximable today.
- Status: **MVP data** (layer "split": one row of 66.6 % to the RioX pseudonym on the listed ISRCs, no artist rows, document = the contract).

### M7 Label representative: we pay the label, the label pays its artists; schedules replace each other
- Essence: Lost Label schedules give per row a royalty equal to half the ownership (50/25, 66.6/33.3, 49.6/24.8…); the 2026-10-12 schedule revokes the 2025-08-11, 2026-02-01 and 2026-10-09 schedules; payment to Lost Label discharges 0to8 toward the represented artists; 0to8 may cut the percentages without notice when a third party claims a share; only 50 % of approved marketing is recoupable. 30 of the 39 titles are also in two direct artist schedules at 50/25 each (M39).
- Base: unit net. Payer: us → Lost Label (owner of kind `label`, its own pseudonym).
- Example: `R/SCHEDULE C (RECORDING SERVICES AGREEMENT #110825Lost Label LLC).pdf`; Main: Lost Label LLC income 82,382.31, expense 86,487.24 (overpaid 4,104.93, M27); Believe `0to8/lost` 248 net.
- Now: date-replaced split periods exist (D-025/D-026); the recipient can only be an artist with an owner, which is exactly the convention of §6.
- Status: **MVP data** (split rows to the representative's pseudonym; no direct artist rows on those ISRCs) plus the M39 signal.

### M8 Imprint aliases and Echo8 as a second own label
- Essence: owner decision 3: Ahh Music = 0to8, no deduction (Annex deducts 25 % on 383 recordings by mistake; Sch3C(i) shows it). Owner answer 1: the 12 releases under the imprint `0to8/Echo8` are **0to8** releases, so `0to8/Echo8` → 0to8 (not the generic `0to8 / X = X` of report-processor, which ranks lower). Echo8 is a separate legal entity with its own artist agreements and its own sublabels; one artist can hold identical paper with both entities (SXLLX, 15 titles). Annex 14 excludes the Echo8 repertoire (4,104 ISRC) from its perimeter; Main keeps Echo8 income on a separate sheet (27,124.99). A brand artist (the label's own name as performer, e.g. artist "0to8" on FRX992554619) is a pseudonym owned by our label's owner with no share (MVP item 16).
- Base: the label of record of a unit decides whose "ours" it is and which sublabel rule applies. Payer: n/a.
- Example: units with `label_name` Ahh Music 110 k net, `0to8/Echo8` 6 k, `Echo8` in the 0to8 account 222 k; `PD/Echo8_RECORDING SERVICES AGREEMENT_#100325SXLLX.pdf` and `PD/RECORDING SERVICES AGREEMENT_100325SXLLX.pdf`.
- Now: `label_name` is stored per row but not in the unit; `account` is carried and ignored; no dictionary; all owners are `person`.
- Status: **MVP layer** (labels module: dictionary of normalised label strings → our label | sublabel + rule; the unit carries `label_name`; "ours" reported per our label; unmapped string → C `label_unmapped`). Brand artist: **MVP data**.

### M9 Buyout, full and partial, by ISRC, from a date, derivatives included
- Essence: the seller's slice moves to the label from the effective date. Annex Sch3C(ii), 1,345 ISRC: buy-out from a contributor 578 = partial in percentage points 294 (25, 16.6, 50, 20, 12.5, 16, 12, 23, 8.3, 10, 17 pp) + whole interest of the seller 88 + **196 "interest not stated per recording; see the instrument"** (M51); transfers between the seller's own entities 767 (M10, no money moves). Derivatives count even when unlisted. ISRC are printed with hyphens or spaces (M40). The price is not part of the balance (D-027); Main nets the seller's accrued balance against the price (M47). The effective date falls mid-month (M52).
- Base: the seller's share. Payer: n/a.
- Example: `PD/Copyright Asset Purchase Agreement #080526DJ TUUV.pdf` (12.5 / 16.6 / 50 per row, USD 6,000); DGA082458655 Cuando Se Te Moja La Tarea 2 (two UPC; DJ Ikeraus whole 17.5 % from 2025-12-16, label 0.5 → 0.675, receipts 90,984.39); DGA072567654 Sinos De Natal, 25 pp from 2026-08-13 (40,442.38). Acquired receipts 1,710,081.00.
- Now: full buyout exact (`splits.buyout`, seller → 0 from the date, also in later periods); partial = a manual `changeSplit` with the reduced percent.
- Status: **exact** for full (with the M52 date rule); partial = **MVP data** (change of split with the seller at the remaining percent, document kind buyout); publishing buyout by work list stays ◻ (D-045 ⚠).

### M10 Chain of assignments: recipient changes, rate does not
- Essence: nine assignments in the pack are signed on one date and "take effect as of" an earlier one (e.g. signed 2026-10-12, effective 2024-07-02; the CAPA bundle effective 2026-08-31); the assignee gets income arising on or after the effective date; chain person → Inc. → FZ. Payment redirections (the licensor paid instead of the artist for the MC ROBA CENA licence) are the same mechanic.
- Base: n/a (recipient with a date). Payer: n/a.
- Example: `P37/3.1 IP ownership/*` (P15–P23); Annex Sch4D legacy instruments (290 + 56 + 24 ISRC vested in FZ on 2026-09-21 / 2026-10-12).
- Now: an artist's owner is fixed (D-019); a merge moves all history.
- Status: **MVP data**: a split change at the effective month (M52) to the new recipient's pseudonym (same percent), document = the assignment. For transfers inside our own entities nothing changes in money. No new field.

### M11 Sample or acapella licence: a fixed percent of the new recording's receipts
- Essence: the letters say "N % of gross receipts actually received by / credited to the label", which is Believe **net** (same wording as the RSA, M1); rates 7, 10, 12, 12.5 (6.25 + 6.25), 13, 15, 20, 30. Some letters deduct "payments to other participants" from that base (FUNK DO SURPRISE, Mc Luizinho): Q1. Licensors often keep a publishing interest in the new composition (12.5–50 %; B17 side, M34); some start from the release date with a lump at signing (M33); fees are flat, advance or settlement fee (M20). Where the registry already carries the licensor's rate as a row (FUNK DO SURPRISE: MC ROBA CENA 20 %, Da 12 7 %, label remainder 50 → 73 after the KXZINVK buy-out), it stays a split row payable to the licensor's pseudonym (M10). Pool funding applies only where the artist's paper says so (P08) or the owner decided (Sleeping City Funk).
- Base: unit net. Payer: us.
- Example: FRX762590589 FUNK DO SURPRISE, receipts 31,682.16 (the letter is signed but its PandaDoc envelope is not closed: C until a clean PDF); `PD/JET MUSIC GROUP_Sample_License_OT08_Sleeping City Funk _MC_MAGRINHO_.pdf` (13 % masters + 15 % composition); Annex Sch3A rows 4, 7, 8; the two Mc Gw licences (~387 k of recordings) are not in the folders.
- Now: as split rows of net where the registry has them (M11 "none" in revision 1 was wrong).
- Status: **MVP data** (split row to the licensor's pseudonym) by default; **MVP layer** (participation from the pool) only where a document fixes the label share. The "less other participants" clause: Q1, assumption → C.

### M12 Collaborator / A&R participation out of the label share
- Essence: 10–15 % of the label's net master royalties on listed recordings for a window: 3 years from each recording's release date (Maximum Madness) or 5 years from the agreement (Matra, XENO XID); advance recoupable from the participation only; Matra also gets USD 300 per release (an operation).
- Base: label share of the unit. Payer: us.
- Example: `PD/A&R Royalty Participation Agreement_#200625Maximum Madness.pdf` (QZPLR2584788, a valid ISRC, net 135.11); `PD/_Social Media Royalty Participation Agreement_Matra (4).pdf` (rows 10 % and 12.5 %; USD 5,000 advance); MC Hub task_128: Maximum Madness 5 % of label profit = 2.5 % of net.
- Now: none.
- Status: **MVP layer** (participation from the label share, period per ISRC; its recipient is the participant's own pseudonym, so the advance scope is `any` on that owner or the ISRC list).

### M13 Share of an artist's share
- Essence: a producer's only consideration is 10 % of the artist's share of one release (reserve up to 15 %); Main settles such shares by moving amounts between balances ("вычет доли", 144 rows, 499,866.57).
- Base: one named artist's amount on the ISRC. Payer: us, out of that artist's amount.
- Example: `PD/Exclusive Master Purchase Agreement #021026era.pdf` ("Оружие", title + SoundCloud link, no ISRC); Main Expense/Sample rows "вычет доли … 16.66 % (8.33 % / 8.33 %) MC CODE & MC TIGRAO".
- Now: none.
- Status: **MVP layer** (participation funded from a named artist's amount).

### M14 Co-ownership between creators
- Essence: two rightsholders split net 50/50 or 90/10; #1 collects and pays #2. On the master side this is a share of #1's amount to #2 (same layer as M13); on the B17 side it would be unequal writer parts (D-087 ⚠).
- Base: artist #1's amount. Payer: rightsholder #1 when #1 collects; when 0to8 pays both directly it is a plain two-row split.
- Example: `PD/Co-ownership agreement_DRXG ADXICTION, RAGEIX.pdf` (90/10); `PD/Co-ownership agreement_ILLXSION.pdf`, `PD/Co-ownership agreement_LEXFEED.pdf` (50/50).
- Status: **MVP data** when both are our artists (two split rows); **MVP layer** (M13) when the contract routes #2 through #1; publishing side later (D-087).

### M15 Co-publishing 50 %
- Essence: 26 identical contracts: owner gets 50 % of mechanical, sync and other publishing income of the publisher's net income; the writer's performance share is collected directly; reversion by notice years later.
- Base: B17 line payable, by `operation_type`. Payer: us.
- Example: `PD/Zero To Infity Co-Pub Agreement_DJ ZENITE.pdf`; pub_terms today: 92 owners at 50 %, 6 at 0 %.
- Now: one percent per owner and period (`pub_terms`), chosen by quarter end; default 50 % is C `publishing_terms_unconfirmed`; the author share is computed inside the publishing module.
- Status: **MVP data** for the 50-on-everything case; the author share becomes a facade layer (§6), with the rate-by-type key shared with M16.

### M16 Publishing administration 90 % / 50 % cover and sync
- Essence: one related-party exclusive publishing administration agreement (PandaDoc Root): 90 % generally, 50 % on cover and synch.
- Base: B17 line payable by `operation_type` (Mechanical/Performance/Print → 90, Synchronization → 50). Payer: us.
- Now: `operation_type` is dropped by `aggregatedLines()`; impossible.
- Status: **MVP layer** (pub_terms with an optional operation type; the accrual keeps the type).

### M17 B17: equal parts of our writers in `songwriters`
- Essence: D-087 ⚠; report-processor v3 does 50 % label + writers' pool by composition ownership instead (owner-side practice, not a contract). Sample licensors with a publishing interest become songwriters of the work (M34).
- Base: Total Payable. Payer: us.
- Example: 4 statements, 2,171,639.63 payable; 32 holders mapped, 14 external songwriters.
- Now: exact per D-087, computed inside the publishing module.
- Status: **exact** in result; the equal-parts step moves to a facade layer (§6). Unequal parts remain ⚠ (D-087).

### M18 Different rates by channel
- Essence: Schedule C has four columns (digital, direct ads, collection societies, synch). Unequal rows are rare: GRIXOR 30/30/45/45, lirvie 12.5/12.5/25/12.5, DIPIENS societies 0. Societies and synch money never arrive through Believe; everything Believe reports is the digital channel.
- Example: `R/0to8_RECORDING_SERVICES_AGREEMENT_190526GRIXOR.pdf`.
- Status: **MVP data** with one rule: Believe = channel "digital", the digital column is the split percent; the other columns are a document note (D-entry).

### M19 Recoupable advance
- Essence: scopes seen: any income of the artist (144 of 160 old advances), publishing only (14, outstanding 56,831.78), none (2, non-recoupable), a participation only (Matra, XENO; the licensor of the MC ROBA CENA vocal, closed), a list of UPC (Matra: 4 releases of 7; "release" and "contract" scopes of the map are ISRC/UPC lists), 100 % of gross before the artist share starts (UMBRELLA, EUR 40,000, paid to a designated payee, M44). Several tranches. NoGhost: from the NoGhost share only. Main carries "ноу рекап" markers (recoup holiday, 50 %) on 15 rows (M44; a known stage-5 difference).
- Base: earned income in scope. Payer: n/a.
- Example: Annex Sch3B: 84 advances, 257,050.00 issued, 223,965.44 outstanding (64 open, 20 partial; qaraqshy 20,000, DJ Raulipues 15,000, ASTXR 15,000, XENO XID 12,500); `PD/ADDITIONAL AGREEMENT_ADVANCE_DJ KAI01.pdf` (1,000 + 500).
- Now: `out` + scope (any / master / publishing / master_publishing / isrcs with exclusions), basis and proof documents, largest-first recoup (D-049…D-101), computed in `modules/settlements/recoup.ts`.
- Status: **exact** for any / publishing / ISRC list; participation-only = **MVP data** because every participation has its own pseudonym (§6); the recoup function moves to the facade (§6). Holidays and 100 %-of-gross recoup: **later**.

### M20 One-off payments: non-recoupable advance, fixed fee, work for hire, beat lease, buyout price, permission fee, bonus
- Essence: paid once, do not change shares, not recouped. Main: Expense/Other 89 rows 309,751.60 (buyout prices), Expense/Sample 144 rows. The MC Denny lump of 10,774.41 on Sleeping City Funk is **accrued royalty paid at signing** (a payout against his retro participation), not a one-off; only his USD 5,000 settlement fee is one.
- Example: `P37/3.5 Not yet documented…/*Maroi*` USD 10,000 flat; CBMG USD 10,000 with proof (P35); `PD/EXCLUSIVE BEAT PURCHASE AGREEMENT.pdf` USD 240.
- Now: a non-recoupable payment outside the button is an `out` operation with `migration: true`; otherwise only documents.
- Status: **MVP data** (operations with a document; the history import records non-recoupable payments as payouts without scope). Consulting, services and indemnification letters move no royalty money: **out**. A beat-lease stream cap (500,000 streams): **signal**, later.

### M21 Advertising costs
- Essence: ad posts per track (PROMO sheet, 1,090,737.65 posted), allocated to artists by split without MC and brands, with per-artist exceptions and a recoup / no-recoup flag; Echo8 promo is a separate balance.
- Status: **later** (MVP ◻33); the manual deduction operation exists today.

### M22 Payment fees (EasyStaff 6 %, Tipalti 0.5 %)
- Essence: Annex Sch3A Payment costs: the fees are funded by the payer **on top** of the recipient amount; the Main ledger has no fee rows. The map's "от выплаты" is contradicted.
- Status: **later** (MVP ◻34).

### M23 Threshold USD 100, carry-over, quarterly + 90 days
- Status: **later** (payout side); the global threshold exists (D-013).

### M24 Currency
- Essence: EUR advance (Remixed Records), RMB (NetEase, incoming), RUB (Russian licence via EasyStaff), CNY and RUB purchase prices. Believe net and the Main ledger are USD only.
- Status: **later**; operations stay USD cents.

### M25 Term of a rule, option, "until recouped", schemes replacing each other
- Essence: every rule has a validity by report month (D-025); contract terms are 7 years or until recouped, 3-year rollovers; participations 3–5 years; schedules replace each other on their signing date; Annex marks months with no share established as "not established" (not 0, not 100). The owner's registry applies the registered split to all months of the ISRC unless an instrument carries a date (M38).
- Status: **exact** for splits and terms; participations and label rules get the same `valid_from` / `valid_to`.

### M26 Negative lines, returns, corrections
- Essence: 3.8 % of net is negative (promo and refunds); recalculation from scratch absorbs corrections; after a payout a later negative lowers payable, possibly below zero (M27).
- Status: **exact** (D-035, D-094). Every layer keeps the sign (edge cases E1, E2).

### M27 Overpayment becomes a debt
- Essence: payable can go negative and stays so; Main records overpayments as advances (9,500; 383.67) and the Sleeping City Funk overpayment "already paid".
- Status: **exact** (negative payable kept, shown as 0); stage 4 loads the facts.

### M28 Perimeter exclusions
- Essence: Annex Sch1B: Echo8 repertoire 4,104 (an own-label contour, M8), Duetti sale 243 ISRC, withdrawn recordings 10, other 2; brand artist: M8. Duetti is a dated sale (effective 2026-05-08 and 2026-06-01), derivatives included whether listed or not (18 derivative ISRC removed from Annex on 2026-11-02), with a per-ISRC income participation back to the seller (0 % on 95 rows, 35 % on one, 50 % on two) paid by the buyer; Believe lines for those ISRC continue until the delivery agreement ends (~2026-11-02).
- Base: unit net after the sale month. Payer: us → the buyer (owner of kind label, its own pseudonym); the participation back is a new income source (later).
- Example: `P37/3.3 Duetti carve-out/*` (P03, P04); Annex Sch1B rows "Duetti Agreements".
- Now: none (money cannot leave "ours").
- Status: **MVP data** (from the effective month the split of each sold ISRC becomes 100 % to the buyer's pseudonym, document = the sale; withdrawn recordings keep their last split). Participation back to us: **later**.

### M29 Derivative version outside the authorisation
- Essence: 11 nightcore versions (receipts 7,513.16; one of them, FRX992667050, on another UPC) outside the remixers' authorisation (clause 5.1); other contracts restrict derivatives similarly.
- Status: **signal** (a registry of authorised ISRC per derivative agreement is data; the ERP flags units of the listed outside ISRC). Money follows the ordinary split.

### M30 Claims and disputes
- Essence: contradicted: the known disputes are settlements that create money rules (M35), not holds. Holds on a payee exist in Main practice.
- Status: holds **later**; settlements → M35.

### M31 Minors, representatives, W-8BEN
- Status: **later** (payout side, D-018 ⚠).

## 3. New cases found in stage 1

### M32 Dated master sale with unlisted derivatives (Duetti) — see M28. **MVP data**.

### M33 Retroactive effective dates
- Essence: assignments effective before signing (M10); Kenke's 15 % includes receipts before 2026-07-27; sample letters apply from each release date with the accrued amount paid at signing (MC Denny 10,774.41 = a payout against the retro participation); NetEase retro to 2026-06-26. The settlement participation (M35) starts 2026-02-27 by owner decision 6: earlier amounts were settled by the lump and belong neither to the participant nor to the label as a rule.
- Status: **MVP data**: a rule's `valid_from` may precede its document date; the lump is a payout operation of the history import. No field.

### M34 Sample licence variants — refines M11
- Essence: base net (letters), "less other participants" clause (Q1), publishing interest kept by the licensor (12.5–50 %: B17 side, they become songwriters of the work for M17), retro start (M33), fee kinds (M20). The CBMG letter: 0 % royalty but 50 % of the new composition collected directly.
- Status: master side **MVP data / layer** as M11; publishing interest **later** (writer shares, D-087).

### M35 Dispute settlement as a dated participation
- Essence: `P37/3.11 Disputes/*`: USD 100,000 lump plus 15 % of "net digital recording royalties", defined as all amounts the label receives from the recordings, on two title families and their versions; the label pays. The literal reading is a participation **from the label share** (on 50/50: participant 15, artists 50, label 35); the registry v7 treats it as "outside the split". Owner decision 6 fixes the start at 2026-02-27. Kenke is also a settlement (M4).
- Base: unit net. Payer: us, from the label share. Example: Annex Sch3A row 3 (30 ISRC in registry v7).
- Status: **MVP layer** (participation from the label share, document = the settlement); the alternative reading (off the top) is stated in the D-entry; no assumption flag because the contract defines base and payer.

### M36 Participation window anchored to the release date; per-release bonus — see M12. **MVP data** (period per ISRC computed at entry from the release date); bonus = operation.

### M37 Royalty derived from ownership; rounding residue
- Essence: Schedule C royalty = ownership / 2; co-author rates are not on the row; 16.6 × 3 leaves 50.2 to the label; RioX sums to 99.9; registry rows computed as "100 − rate" overstate the label when ownership < 100 (13 + 3 rows in `recon_tracks.md`).
- Status: **MVP data** (entry rule: read the royalty column). Residues stay with the label of record.

### M38 Schedules added over time; which month a late schedule applies from
- Essence: schedules C…H are signed months apart; no contract states whether a schedule signed after release applies to earlier months. Fact of payment (map §6 exception): Main pays the registered rate for every reported month, including months before the schedule's signing date.
- Status: **MVP data** with a D-entry marked assumption, supported by the payment fact: the registered split applies from the first report month of the ISRC unless the instrument carries its own date. The money it decides is the months before each schedule's signing date; the ERP does not hold signing dates, so it is not quantified. The money stays B (paid practice), the D-entry names the risk.

### M39 Conflicting claims on one recording
- Essence: Lost Label's 2026-10-12 list overlaps 30 titles with the DJ DYLANFK (`P37/3.4 Fixed term/…#241125DJ DYLANFK`) and DJ Raulipues (#010425) schedules, each 50/25 (150 % ownership claimed); SXLLX has identical paper with 0to8 and Echo8; NoGhost "Excluded Projects" released through 0to8 still carry the NoGhost share; ACIDO III: licence 23 % vs 25 % registered and paid (Sch3A row 8).
- Status: **signal** plus the goal rule: the registered split (Annex "Splits by ISRC", the owner's arbitration) stands as B; rows of the conflicting document are entered under an assumption document, so their money is C `assumption` (Q5). A rate conflict (23 vs 25) is entered at the registered rate with the delta flagged.

### M40 Recording identification outside ISRC
- Essence: hyphenated and spaced ISRC, title families "and all versions", Spotify album URLs, SoundCloud links, titles only.
- Status: **MVP data**: ISRC normalisation at entry (`assertIsrc`); title → ISRC resolution is a data-entry step (stage 4 scripts), never a calculation key.

### M41 Lines without ISRC folded onto the release's main ISRC (report-processor, zero-erp `upc_main_track`)
Status: **out** for the MVP: D-035 ⚠ keeps them in C `no_isrc` (2,364 net).

### M42 No-split fallback pools (Echo8 50 % equal among row artists; R2R family 75/25 without a split)
Status: **out**: no split = the label of record's share (D-029), reported as `ourShareNoSplit` per label; Echo8 artists have Echo8 contracts and get splits in stage 4 (today 543 k of Echo8 net has no track and 69 k a legacy split).

### M43 Funding scheme of a participation
- Essence: the MC Hub and zero-erp show five ways to fund a participant's percent: from the label share (M12), from the artist pool pro rata (M3b), equally from named artists, entirely from one named artist (M13), off the top diluting everybody (M4). "Equal points" (task_194) and "equally from named artists" are entered as explicit rows or per-artist carves. A participant lives either in the split or in the layer, never in both (stage 4 migrates the existing rows of FRX762590589 and DGA062593864 if they become layer participations; otherwise they stay rows).
- Status: **MVP layer** parameter set: `off_the_top` | `artist_pool` | `label_share` | `artist_share(of pseudonym)`.

### M44 Recoup variants: 100 % of gross before the artist share (UMBRELLA), recoup holiday / 50 % ("ноу рекап"), Lost Label 50 %-recoupable marketing
Status: **later**; the default scopes cover the 84 open advances; Main's 15 holiday rows are a known stage-5 difference.

### M45 Inbound third-party licence with a revenue-split flip (Remixed Records, EUR 40,000, 70/30 until 2029-12-31, then 30/70)
Status: **later** (CARAMEL JESTER family; Echo8 repertoire).

### M46 Incoming money from other labels and platforms (YATOMI / SUNDAY / ARCADIA 25 %, Kurate, NetEase RMB, Clear Music sync)
Status: **later** (MVP ◻27).

### M47 Buyout price netted against the seller's accrued balance; "IGNORE Reports" rows
- Essence: Main closes a seller's pre-buyout unpaid balance by the price ("Долг лейбла до выкупа … Ignore Reports", 11 rows) and keeps the seller's post-buyout accruals.
- Status: **MVP data** for stage 4: the history import records such rows as paid (operation) or as not earned (the split change), never both.

### M48 Taxes (9 % on the label remainder in report-processor; 30 % on US SoundOn). **Out**.

### M49 Locked periods / frozen quarters. **Out**: the ERP recalculates from scratch; only the payout snapshot is frozen (D-053).

### M50 Payment through a third-party payee (NoGhost 25,000 via an artist's Tipalti account; "Send to fl"; UMBRELLA designated payee)
Status: **later** (payout side); the history import records the payout on the owner who earned it, with the route in the comment.

### M51 Buy-out with the interest not stated per recording (196 ISRC of Sch3C(ii))
- Essence: the instrument names the project, not the per-recording percent.
- Status: **MVP data** for stage 4: read the instrument (`contract_index/documents.json` holds the per-row seller percent for the CAPA family); until read, the share stays where the split puts it and the ISRC is listed as an assumption in the stage-4 log.

### M52 Instrument effective mid-month
- Essence: buyouts, assignments, sales and settlements carry a day; D-025 selects the split by the first day of the report month, so a split starting 2025-12-16 applies from 2026-01; Annex applies the new share in the month that contains the effective date (2025-12). Difference 458 unit-months, 13,363.21 net.
- Status: **MVP data**, verdict in §4: D-025 stays; the entry rule sets `valid_from` = the first day of the month containing the effective date (so the ERP and Annex agree); stage 4 normalises the 1,043 legacy mid-month dates the same way and logs them.

### M53 Non-economic documents (NDA, powers of attorney, DMCA, employment and reference letters, Grammy, indemnity, consulting)
Status: **out**. They move no money; they are filed as documents of their kind (or not loaded) and create no split, participation or rule.

### M54 Known ISRC under a second, unregistered UPC
- Essence: Believe reports a known ISRC under a UPC that module 1 does not list, so the line is `unknown_pair` (C) although the ISRC has a split.
- Status: **MVP data**, D-135: register every Believe pair of a known ISRC; a split by ISRC then applies to every UPC.

### M55 Echo8 artist agreements as split documents
- Essence: only four Echo8 RSAs exist in the folders; the Echo8 splits taken from the Backstage export have no document of their own.
- Status: **data gap**. Those splits stay in C `split_unconfirmed` until their documents arrive.

### M56 SoundOn-format statements and fixed revenue shares among people named on a line
Status: **later** (MVP list item ◻26): a new source format and a fixed-share rule; nothing is calculated today.

### M57 Accrual-basis royalty (Russian licence "received or accrued")
Status: **later**. The ERP counts royalty on the report month of the received line; an accrual view needs an owner decision.

### M58 Sublabel per-artist exceptions (an artist's lines excluded from a sublabel's imprint)
Status: **open**, not expressible: the sublabel rule applies to the whole imprint's label share and has no per-ISRC or per-artist exclusion. The signals `sublabelWithoutRule` and `ruleRecipientIsRow` (D-136) show where such an exception would matter.

## 4. Contradictions and the verdicts (by precedence)

| Topic | Sources disagree | Verdict | Basis |
|---|---|---|---|
| Sublabel rate | contract NoGhost 25 % of net; report-processor 25/25 for R2R/Bear/VBR/ENARMA and 30/70 qaraqshy; Annex 25 % / 15 % fixed | half of the label share after artists, MC, remixers, per month, for **NoGhost, R2R, 77 Records**; every other sublabel string: Q12 (assumption, C) | owner decision 2 (2026-11-02); NoGhost to be re-signed |
| Ahh Music | Annex deducts 25 % | no deduction, it is 0to8 | owner decision 3 |
| `0to8/Echo8` | report-processor `0to8 / X = X` | 0to8 | owner answer 1 (12 releases of 0to8 under that imprint) |
| MC on the three floor titles | Annex label 45.8 % (Sleeping City Funk) | label 50 %, rows scaled; licensed MCs at their rate from the pool | owner decision 4 |
| Remixer | Annex label 50 % | 15 % off the top, label 42.5 %, for Kenke and Eiden XII only | owner decision 5 |
| Echo8 | map: "not a sublabel" | a second own label (legal entity) with its own contour, its own sublabels | contracts (4 Echo8 RSAs), accounts in Believe |
| M30 disputes | map: hold | settlement = dated participation from the label share; holds later | contract P14 |
| M11 base | map: gross | net ("gross receipts actually received by the label") | contracts P24…P34, same wording as the RSA |
| M22 fee direction | map: from the payout | on top, label cost | Annex Sch3A Payment costs |
| M28 Duetti | map: ISRC-list filter | dated sale, unlisted derivatives included, participation back | contracts P03, P04 |
| NoGhost excluded projects | DECISIONS.md: excluded | excluded from exclusivity only; the royalty clause applies when released through 0to8 | contract §2.1 |
| Sch3C(ii) 963 "transfers" (revision 1) | | 767 transfers between own entities + 196 contributor buy-outs with the interest in the instrument (M51) | Annex Sch3C(ii) columns Basis × Interest |
| Mid-month instruments | D-025 (next report month) vs Annex (month of the date) | D-025 stays; entry rule `valid_from` = month start of the effective date (M52) | D-025 in force; the entry rule removes the 13,363.21 difference without a code change |
| Cross-account duplicates | report-processor dedups by fingerprint | no duplicate lines exist; never dedup (D-032); the accounts are complementary per platform | ClickHouse check (QA re-verified) |
| Splits of old months | report-processor uses the latest snapshot | by report date (D-025) with `valid_from` as the registry gives (M38) | D-025 in force |
| B17 split | report-processor v3: 50 % label + writers' pool by ownership | equal parts of our writers (D-087 ⚠), label keeps the rest | D-087 in force, ⚠ |
| +2 months payout lag of the Believe royalties files | Believe pays two months after the sales month; Main lists payments by payment month | the ERP keys on the line's report month; the lag matters only when matching Main payments (period = report month) | D-025, D-110 |

## 5. Open questions and the proposed answers (for the council and the D-entries of stage 2)

| # | Question | Searched | Proposed answer | Money treatment |
|---|---|---|---|---|
| Q1 | Sample letters with "gross receipts … less payments to other participants of the new recording" (FUNK DO SURPRISE, Mc Luizinho): base net, or net minus the other rows (20 vs 14 on 100 with rows 23 + 7)? | contract: clause present; owner answers: silent | base net (the registry and payments use 20) | assumption document → the licensor's allocation in C `assumption` (on FUNK DO SURPRISE it is C anyway: envelope not closed) |
| Q2 | Sample licensor funded from the artist pool or a row of net | owner decision 4 (three titles); P08 §6.7 | pool only where the document or the owner says so; otherwise a row of net, label = remainder | decided per document |
| Q3 | Schedule signed after release: from which month | contracts silent; Main pays the registered rate for earlier months | from the first report month of the ISRC unless the instrument has a date (M38) | D-entry "assumption", money stays B on the payment fact |
| Q4 | RioX base | contract: "gross after distribution fees and transaction costs" | net | decided (no assumption) |
| Q5 | Lost Label vs direct artist contracts on 30 titles; SXLLX under both entities | contracts conflict; no owner answer | the registered split stands; the conflicting rows carry an assumption document | C `assumption` for the conflicting rows + signal (M39) |
| Q6 | Settlement 15 %: from the label share or off the top | contract: base = all amounts received, the label pays | from the label share (M35) | decided; the alternative noted in the D-entry |
| Q7 | Platform Promotion negatives | report-processor, Annex: inside net | inside the unit net, same rates | D-035/D-094 in force |
| Q8 | Echo8 without a split | report-processor: 50 % pool | Echo8's share (D-029 per label) | in force |
| Q9 | Channel rates | contracts (3 unequal rows) | Believe = digital column | D-entry, note on the document |
| Q10 | NoGhost advance USD 50,000 recoup | contract: from the NoGhost share only | scope `any` on the NoGhost owner (it earns only that share) | MVP data |
| Q11 | Order of a label-share participation (M12, M35) and the sublabel half | owner decision 2 lists artists, MC, remixers before the sublabel; silent on A&R | label-share participations first, then the sublabel halves the remainder | assumption: when one ISRC carries both, the sublabel allocation goes to C `assumption`; stage 4 reports whether any NoGhost / R2R / 77 ISRC carries one |
| Q12 | Rule for sublabel strings outside owner decision 2 (qaraqshy, fate music, CATCORE, SF Records; Enarma, VBR, PCR, Bear, odds, no job records, Hoboshrine) | contracts: none (DECISIONS.md 7); Annex Sch3C(i): Enarma/VBR/Bear 25 %; report-processor: 25/25 and 30/70 | half of the label share, as for the three named ones | assumption document on each such label rule → the sublabel allocation in C `assumption`; our half stays ours. The qaraqshy advance (20,000) recoups only once that income is confirmed |

## 6. Final MVP scope for stage 2 (what the target model must compute)

Conventions that the layers rely on:
- **Every recipient of any allocation is a pseudonym (artist id) with an owner.** A company, sublabel, representative, buyer or participant gets its own pseudonym owned by an owner of kind `label` or `person`; a participation carries its own recipient pseudonym, so its income is a separate income item from any split row of the same person. Allocations also carry the layer and rule id for `explainTrack`.
- **Documents decide confirmation; a document of kind `assumption` is never approved** and maps to C reason `assumption`. Splits, participations and label rules reference a document; no `basis` field.
- **Modules compute no money.** The publishing module returns aggregated lines (with `operation_type`), writers and terms; the settlements module returns operations; the recoup function (`modules/settlements/recoup.ts`) moves to the facade as a layer.
- A (received) is per source, account and month; "ours" is reported per our label (0to8, Echo8); A = B + C + ours holds per source, account and month.

Layers on one master unit (ISRC + UPC + report month + sales month, net, account, `label_name`), order fixed in one place:
1. **Label of record** (M8): dictionary → our label | sublabel (with rule); unmapped string → C `label_unmapped`.
2. **Perimeter** (as today): `no_isrc`, `unknown_pair` → C.
3. **Split** (M1, M2, M3a, M6, M7, M9, M10, M11 rows, M28): artist rows as percent of net; label share = 100 − Σ.
4. **Off the top** (M4; M35 if ever decided so): percent of net to a recipient; rows and label share scaled by (net − Σ top) / net.
5. **Carve** (one function, ordered list): take p % of a bucket and give it to a recipient; buckets `artist_pool` (base net, funded by the rows pro rata; M3b, M11 pool cases), `artist_share` (base = one row's amount; M13, M14), `label_share` (base = the label share; M12, M35), then the **sublabel** half (M5: bucket `label_share`, p = 50, recipient = the sublabel pseudonym; Q11 order, Q12 assumptions). A carve that exceeds its bucket takes what is there and reports the shortfall as a signal (`unfunded`).
6. **Categorise**: every allocation is B or C with a reason (`split_unconfirmed`, `artist_without_owner`, `owner_unconfirmed`, `assumption`, `label_unmapped`, `unknown_pair`, `no_isrc`); "ours" is the remainder of the label of record; no split → ours (D-029).

Publishing layers (facade): **writer parts** (M17 equal parts of our writers), **author share** (terms percent by owner, period and `operation_type`: M15, M16), **categorise** (`writer_unmapped`, `owner_unconfirmed`, `publishing_terms_unconfirmed`).
Settlements layers (facade): **recoup** (M19, moved as is), **balance** (payable = B − recouped − paid + returns + credits; M27).
Signals: M29, M39, `unfunded`. Later: M21, M22, M23, M24, M31, M44, M45, M46, M50. Out: M41, M42, M48, M49.

Cases closed by data alone (no calculation field): M3a, M6, M7, M9 partial, M10, M11 rows, M14 (two of ours), M18, M20, M28, M33, M36, M37, M38, M40, M47, M51, M52, brand artist.

## 7. Edge cases the golden tests must pin (per layer)

| # | Edge case | Layer | Evidence | Expected treatment |
|---|---|---|---|---|
| E1 | Negative unit net | all | 438 unit-months, −959.73; promo lines | every layer keeps the sign; a sublabel half of a negative label share is negative |
| E2 | Zero net | all | 7 units, 815 lines | no division, allocations of 0, A = B + C + ours = 0 |
| E3 | Carves above their bucket (pool participants above the pool; top + rows above 100) | 4, 5 | Sleeping City Funk rows above 50 | take what is there, `unfunded` signal; rows never go negative on a positive unit |
| E4 | Label share 0 (rows sum to 100) | 5 | 87 splits | label-share carve and sublabel half give 0 |
| E5 | Label share 100 (all-zero split or no split) | 3, 5 | 447 all-zero splits; Ahh Music 19,694.98 under all-zero | no split → ours, no sublabel half (D-029); all-zero split → sublabel half of 100 applies |
| E6 | Sublabel imprint on an ISRC with no split | 1, 5 | qaraqshy 6,841.85, NoGhost 139.37 | no split → ours of the label of record; no carve |
| E7 | Rule starting mid-history, retro start, window end | 4, 5 | M33, M35, M36 | per report month; months outside the window unaffected |
| E8 | Instrument effective mid-month | 3 | 1,043 splits; 13,363.21 | M52: month start of the effective date |
| E9 | Two UPC for one ISRC | 3, recoup | 105 ISRC, 1.34 M | rule by ISRC on both units; an advance scope by UPC on one |
| E10 | Echo8 unit with a 0to8-paper artist; identical paper with both entities | 1, 3 | SXLLX; 69 k | the label of record is Echo8; the split applies; signal M39 |
| E11 | Unknown pair / unknown ISRC | 2 | 543 k, all Echo8 account | C per account and month, ours 0 |
| E12 | Split unconfirmed, participation on top confirmed | 3, 5, 6 | 773 owners without a contract | the rows are C `split_unconfirmed`, the carve amount is categorised by its own document and owner |
| E13 | Same ISRC and sales month in two accounts | 1 | 6,551 pairs | both units get the same label of record; A stays per account |
| E14 | `label_name` changes over time | 1 | 17 ISRC | per unit-month |
| E15 | Imprint string not in the dictionary | 1 | Enarma, VBR, PCR, … | C `label_unmapped`, ours 0, signal |
| E16 | Participant present both as a split row and as a carve | 3, 5 | FRX762590589, DGA062593864 | refused at entry (signal `double_participation`); stage 4 migrates |
| E17 | Rounding across a chain of layers | 6 | thirds, RioX 99.9 | exact decimals; A = B + C + ours exactly; residues to the label |
| E18 | All layers combined on one ISRC | 1–6 | none real; the goal requires it | top 15 + rows 50/25/25 + pool carve 13 + label carve 10 + sublabel half: hand answer in 12_golden_cases.md |
| E19 | Buy-out with the interest not stated per recording | 3 | 196 ISRC | M51: unchanged until read, listed |
| E20 | Rule entered retroactively after a payout | payout | Kenke retro; M27 | recalculation changes payable; the snapshot stays; payable may go negative |
| E21 | Advance recouped only from a participation or a sublabel share; that share zero or negative in a month | recoup | Matra, XENO, NoGhost | own pseudonym → own income item; zero capacity recoups nothing |
| E22 | Licence rate differs from the registered rate | 5 | ACIDO III 23 vs 25 | registered rate, delta flagged (M39) |
| E23 | Participation window ending mid-history | 5 | Maximum Madness | months after the end unaffected |
| E24 | Off-the-top on a unit whose rows already sum to 100 | 4 | — | rows scaled to 85, label share 0 |
| E25 | Unit of a sold recording after the sale month (Duetti) | 3 | 243 ISRC | 100 % to the buyer's pseudonym, nothing to our artists; before the month: old split |
