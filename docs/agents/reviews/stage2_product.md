Verdict: yes

## Revision 3 (text fixes, 2026-11-02)

I re-read 10 §5 and §7, plan steps 4.4 and 4.5, and golden cases G03c, G39 and G43. Every item open at revision 2 is now fixed.

**Fixed:**
- **Blocker from revision 2.** Plan 4.5 now classifies every cash row of `0to8 Main.xlsx`:
  - Every Expense / Royalties row is a payout, including DNLXXL8's 383.67.
  - The 9,500 row ("переплата, которую заносим как аванс") is a recoupable advance.
  - Expense / Publishing (9,638.69) is a payout.
  - Expense / Advertising (2,699.39) is not loaded and is listed as a known difference (M21).
  - The other 40 Expense / Sample rows are classified one by one. The three 1,666.66 "штраф" rows are deductions for MC Denny's 5,000 fee. The 100,000 row is checked against the settlement lump and the buy-out prices before it is loaded.
  - The load log reconciles to 8,045,246.75 minus the rows it names as not loaded.
- **"вычет доли" rows (should-fix 3).** They are skipped only where step 4.3 enters a carve for that pair. Otherwise they load as deductions, and each pair is listed with its amount.
- **G03c (should-fix 2).** MALAME is now 29.761905 / 10.119048 / 10.119047, which sums to 50.000000 and leaves the label 50. That agrees with owner decision 4 and plan 4.3.
- **One balance per owner across both labels (should-fix 4).** It is labelled an assumption, and the balance shows B, recouped and paid per paying label (10 §5, plan 4.4).
- **Notes 6 and 7.** The cap on the label share and on tops above 100 is labelled an assumption with scale-down (10 §7). G39 is tagged E20 only. G43 is three separate tests, each starting from payable 80; my figures are 50, 80 and 60.

**Nothing blocks.** For stage 3, the product review will check:
- the golden numbers as tests;
- that the load log of 4.5 actually reconciles to 8,045,246.75;
- that the list of "вычет доли" pairs matches the participations of 4.3.


# Revision 2 review (kept; verdict at the time: no)

# Stage 2 review: product / money, revision 2 (2026-11-02)

## Revision 2

I re-read all of 10, 11 and 12 (revision 2) and recomputed every changed and new golden case by hand. I also checked
plan 4.5 against `0to8 Main.xlsx`, sheet INCOME  EXPENSE.

Both blockers from revision 1 are fixed. One new blocker comes from 4.5: rows of cash already paid are dropped,
which contradicts the map §6 rule that what was paid is fact. That one is a text fix.

### Recomputation of the changed and new cases (net 100; off-the-top now runs before the split)

| Case | My computation | Agree? |
|---|---|---|
| G03b | pool kind: 26 from rows 25 : 25 → 13 from each; A 12, B 12, M1 13, M2 13; B 50, ours 50 | yes |
| G03c | rows 25 + 8.5 + 8.5 = 42 → **ours 58** | the arithmetic is right, but the case contradicts owner decision 4 (label 50) and plan 4.3, which re-enters MALAME as 29.761905 / 10.119048 / 10.119047 (sum 50.000000, ours 50). Remaining 2 |
| G10a | A 23, D 7 B; L 20 C `assumption` (row document); B 30, C 20, ours 50 | yes |
| G16 | net 0: R, A, B, NG all 0, emitted | yes |
| G18 | R 15; scaled net 85; rows 21.25 / 21.25, label 42.5; pool 13 → rows 14.75 / 14.75; P 4.25 → label 38.25; NG 19.125. B = 15 + 14.75 + 14.75 + 13 = 57.5; C 4.25 + 19.125 = 23.375; ours 19.125; sum 100 | yes |
| G21 | label share 100; NG 50 C `assumption`; B 0, C 50, ours 50 | yes |
| G22 | P 10 (the whole pool), A 0, shortfall 10 as a signal; ours 90; P08 §6.7(a) cited | yes; accepted for the pool kind |
| G31 | A 100; label 0; NG 0 emitted | yes |
| G34 | 13 × 16.6 / 49.8 = 4.3333…; A, B 4.333333333333, C 4.333333333334; rows 12.266666666667 / 12.266666666667 / 12.266666666666; + 13 + 50.2 = 100 | yes |
| G35 | P1 10 % × 50 = 5, P2 15 % × 50 = 7.5 (shared base); B 62.5, ours 37.5 | yes |
| G36 | S 15 % of net = 15 from the label share; A 25, B 25; B 65, ours 35 | yes (blocker 1 fixed) |
| G37 | target 70 > label share 50: P 50, shortfall 20; B 100, ours 0 | arithmetic yes; see note 6 |
| G38 | 2026-03: A 50, NG 25, ours 25; 2026-04: A 50, ours 50 | yes |
| G39 | after the retro remixer: A 85 × 50 % = 42.5; paid 50 → payable −7.5, shown 0 | yes (the "E22" tag is wrong: E22 is the rate delta) |
| G40 | same ISRC, both units `Echo8`: A 50 + 25; Echo8 50 / 25 per account | yes |
| G41 | all-zero split: label share 100, NG 50 B, ours 50 | yes |
| G42 | A 50 B, ours 50, nothing to the brand pseudonym | yes |
| G43 | master 50 + publishing 30 = 80. Scope `publishing`: recouped 30, remaining 10, payable 50. Scope `isrcs` (another ISRC): recouped 0, payable 80. Non-recoupable payout 20: payable 60 | yes, read as three separate scenarios. Applied together they give payable 30. Say "each alone" |
| G26d | W1 alone, 100: author 50 C `publishing_terms_unconfirmed`, label 50 | yes |
| G26e | A = Σ payable; B + C + ours = A | yes |

Plan 4.3, the Sleeping City Funk rows 16.666666 / 16.666667 / 16.666667 with the pool kind taking 26: the artists get
7.99999968 / 8.00000016 / 8.00000016, and the label gets exactly 50. That is sub-cent, but the plan's words "the artists
8 each" are not exact. A three-way 16.666667 / 16.666667 / 16.666666 gives the same.

### Fixed
1. **Revision-1 blocker 1 (settlement base).** `base` (`net` | `bucket`) now sits next to `funded_from`. The settlement is (`net`, `label_share`), which gives S 15, artists 50, label 35 (10 §2, §7 Q6; G36; plan 4.3). This matches the contract text: 15 % of all amounts the label receives, paid by the label.
2. **Revision-1 blocker 2 (assumption carrier).** `split_shares.document_id` is a per-row document that overrides the split's document for that row only. Q1, Q5 and M39 use it (G10a; §6 signals group allocations by assumption document). Putting the whole row in C, with the delta-only variant noted as two rows, is acceptable.
3. **Settlement lump.** The USD 100,000 is a document only, and MC Denny's 10,774.41 is a payout (§7 M33, 4.3, 4.5).
4. **Q11.** Both P and NG are `assumption` (G18 C 23.375).
5. **R1.** Labelled an assumption; G21 puts NG in C, and G41 pins the all-zero split at B.
6. **Shortfall on the pool.** It cites P08 §6.7(a).
7. **NoGhost.** The rule runs from 2026-06; 2026-02…05 sit under an assumption document (4.1, §7).
8. **Labelling.** Q12 cites owner answer 3, M52 is labelled a convention, and the M16 cover note is added.
9. **Stage-5 Annex comparison.** It uses the layer state's `labelShare` after the sublabel, by report month, excludes Echo8 by the Sch1B list, and has a 0.01 tolerance. The known differences now carry amounts.
10. **Floor titles in 4.3.** Sleeping City Funk is re-entered with the MC rows leaving the split and the duplicate DJ FANGZ row removed. The Trilalero and MALAME scaled values are named.
11. **4.5, partly fixed.** It covers nickname → pseudonym with a log, column B as period, third-party-account rows listed, "ноу рекап" with a note, and "вычет доли" handled.
12. **New golden cases.** G38–G43 and G26e close the coverage gaps I listed. I accept "one balance per owner across both labels" as a decision, but see remaining 4.

### Remaining

**Blocker 1. Plan 4.5 drops cash that Main shows as paid ("переплата" rows), and leaves 280 k of paid rows unclassified.**

Evidence from `0to8 Main.xlsx`, sheet INCOME  EXPENSE:
- The rows commented "переплата" are ordinary `Expense / Royalties` cash rows: DNLXXL8 383.67, and qaraqshy 9,500.00 ("Переплата, которую заносим как аванс").
- They are inside the Expense total of 8,045,246.75, which equals Main's "Для выплат" sheet (`recon_money.md`).
- Plan 4.5 says they are "not loaded (the overpayment already is the excess of the loaded payouts)". But these rows are themselves the payments that created the excess. Without them, paid drops by 9,883.67 and the ERP shows that amount as still payable.
- `Expense / Sample` rows without "вычет доли" are 40 rows, 280,771.38, and 4.5 does not classify them. What they contain:
  - cash to artists, mostly round sums;
  - three "штраф за Sleeping City Funk … MC Denny 13 %" rows of 1,666.66 each. These charge MC Denny's USD 5,000 settlement fee to the three artists: a deduction from their balance, not a payout to them;
  - one row of 100,000 on one nickname. It must be checked against the settlement lump (document only, M33) and the buy-out prices (document only) before it is loaded as a payout.
- `Expense / Publishing` (1 row, 9,638.69) and `Expense / Advertising` (7 rows, 2,699.39) are also still unnamed.

Required change to 4.5:
- Load every Main cash row exactly once.
- Load the qaraqshy 9,500 as a recoupable advance on the qaraqshy pseudonym, as its comment says.
- Load DNLXXL8 383.67 as a migration payout.
- Classify the 40 `Expense / Sample` rows one by one: payout, balance deduction (the three "штраф" rows), or document-only lump (verify the 100,000). Log each one.
- Name the treatment of the Publishing row (a payout) and the Advertising rows (M21 later, a known difference of 2,699.39).

**Should-fix 2. G03c contradicts owner decision 4 and plan 4.3.**
"Entered scaled from 50/17/17" as 25 / 8.5 / 8.5 halves the rows: the label gets 58. Owner decision 4 fixes the label at 50 ("участники уменьшаются пропорционально"), and 4.3 re-enters 29.761905 / 10.119048 / 10.119047.
Required change: use the 4.3 numbers in G03c, which gives B 50 and ours 50.

**Should-fix 3. "вычет доли" not loaded is right only where 4.3 enters a carve for that pair.**
There are 104 `Expense / Sample` "вычет доли" rows, 219,095.20 in total. For any pair without a participation in 4.3, the deduction disappears and the giving artist's payable rises.
Required change: 4.5 lists the pairs (giver, receiver, ISRC), matches each to its 4.3 participation, and puts the unmatched ones in the stage-5 known differences with their amounts.

**Should-fix 4. "One balance per owner across both labels" (§5) is an assumption, labelled as a fact.**
0to8 and Echo8 are separate legal entities. Recouping a 0to8 advance from Echo8 income, or paying one combined number, is a legal choice that no source makes. Main keeps Echo8 apart: Income 27,124.99, no Expense rows.
Required change: label it "assumption" in the D-entry. Show B, recouped and paid per paying label inside the one balance, so the choice can be reversed without new data.

### Notes
5. **Echo8 rates without a contract** are now C `split_unconfirmed` (4.4), so nothing is paid on a guess. The log should still name where each percent came from.
6. **Shortfall on (`net`, `label_share`)** (G37). P08 §6.7(a) covers third parties against the artist's share. It does not cover a label obligation such as the settlement ("the label pays 15 % of net"), where the label owes the full amount even when its share is smaller. No real settlement ISRC is expected to hit this (rows ≤ 50). The D-entry should say the cap there is an assumption, and stage 4 should report any real occurrence.
7. **Tags.** G39 should drop the "E22" tag; G43 should say its three scenarios run separately.
8. **Q6 basis.** "Annex Sch3A row 3" is data row 3 (sheet row 5), which is consistent with the 09 convention.

### What must change before I say yes
Remaining 1 (a text change to 4.5). Remaining 2–4 should go into the same revision.

---

# Revision 1 (kept for the record; verdict at the time: no)


# Stage 2 review: product / money (10_target_model.md, 11_plan.md, 12_golden_cases.md)

Reviewer: product member of the council, read-only. Sources read: `notes/goal_prompt.md`, `CLAUDE.md`, `notes/settlement_landscape.md`
(MVP list, §6), `09_settlement_cases.md`, `reviews/stage1_*.md` ("Remaining" items), the owner answers of 2026-11-02
(`ответы_разработчику_реестры_v5_2026_11_02.md`, `contract_index/решения_владельца_2026-11-02.json`), the settlement text
(`contract_index/texts_dd_pack.jsonl`, 3.11 Disputes), Annex 14_beta (обновлено покрытие): sheets Sch3A Participations, Sch3B,
Sch3C(i), Sch3C(ii), Sch3C Reference financials, Splits by ISRC, Monthly receipts / Monthly NLS by ISRC, Derivative
authorisations; `contract_index/recon_money.md`; the live `splits` schema and rows in the local PostgreSQL.
Stage names and label names only.

The layer chain is right in shape and most golden numbers are right. Two problems block acceptance, because the design
cannot produce the money that two of its own §7 decisions call for:
- The dispute settlement (Q6) is paid at half its contract rate.
- The "assumption" treatment for Q1 and Q5 has no mechanism in the storage model.

Both have the same small fix.

## 1. Hand recomputation of every golden case (net 100 unless stated)

I agree with every number in G01–G33 and G26a–d under the rules of 10 §3–§4. A = B + C + ours holds in every master case
where 12 gives the totals; in G09, G13, G14, G17, G27 and G28 I added the rows up myself.

| Case | My computation | Agree? |
|---|---|---|
| G01 | A 50; B 50, ours 50 | yes |
| G02 | 3 × 16.6 = 49.8; ours 50.2 | yes |
| G03a | 50 : 25 scaled to a pool of 50: 33.333333 + 16.666667 = 50.000000; ours 50 | yes (but see finding 8 on the source rows) |
| G03b | carve 1 takes 13 from 25 : 25, leaving 18.5 / 18.5; carve 2 takes 13 × 18.5 / 37 = 6.5 from each, leaving 12 / 12; M1 13, M2 13; B 50, ours 50 | yes |
| G04 | R 15; 25 × 0.85 = 21.25 each; label 42.5; B 57.5 | yes |
| G05a / G05b | label share 50 → NG 25, ours 25, B 75; label share 30 → NG 15, ours 15, B 85 | yes (equals Annex FUNK MONOCLE 0.25 and R2R QZWFT2628432 0.15) |
| G06 / G07 | RX 66.6, ours 33.4 / LL 25, ours 75 | yes |
| G08a–c | 50 / 50 (0to8); 50 / 50 (Echo8); A 50 B, 50 C `label_unmapped`, ours 0 | yes |
| G09 | 2026-02: A 50 / ours 50; 2026-03: A 25 / ours 75; 2026-05: A 0 / ours 100 | yes |
| G10a / G10b | A 23 + D 7 = 30 B, L 20 C, ours 50; after the buy-out D 7 B, L 20 C, ours 73 | yes (equals Annex 0.5 / 0.73 for FUNK DO SURPRISE). The Q1 mechanism is not pinned: finding 2 |
| G11 / G12 | P 7.5, ours 42.5 / E 5, A 45, ours 50 | yes |
| G13 / G14 | A 50 then A2 50 / P 7.5 in 2026-03, none in 2026-04 | yes |
| G15 | factor (−100 + 15) / −100 = 0.85; R −15, A −21.25, B −21.25, label −42.5 → NG −21.25, ours −21.25; B −78.75; sum −100 | yes |
| G16 | all 0 | yes |
| G17 | DU 100, ours 0 | yes |
| G18 | R 15; rows 21.25 / 21.25, label 42.5; pool carve 13 → rows 14.75 / 14.75; P 4.25 → label 38.25; NG 19.125 C; ours 19.125. B = 15 + 14.75 + 14.75 + 13 + 4.25 = 61.75; sum 100 | arithmetic yes; categorisation incomplete: finding 4 |
| G19 | A 50 C `split_unconfirmed`; P 5 B; ours 45 | yes |
| G20 | A 50 B; QQ 25 C `assumption`; ours 25 (Echo8) | yes |
| G21 | label share 100; NG 50 B; ours 50 | arithmetic yes; label wrong: finding 5 |
| G22 | pool 10 < 20: P 10, A 0, ours 90; signal of 10 | arithmetic yes; the 10 is not ours by any source: finding 6 |
| G24 | UPC1 A 50, P 5, ours 45; UPC2 A 25, P 2.5, ours 22.5; B 82.5, ours 67.5; A 150 | yes |
| G25 | stored 2026-03-01; P 7.5 | yes |
| G27 | P earns 7.5 + 7.5; recouped 7.5 + 2.5 = 10; payable 5 | yes |
| G28 | 50 − 30 = 20; 20 − 40 = −20, shown 0 | yes |
| G29 | NG 25; recouped 25 of 50; remaining 25; payable 0 | yes |
| G30–G32 | C 2 + 7, ours 0 / A 100, NG 0 / R 15, A 85, label 0 | yes |
| G33 | 1052428: A 100, B 50, ours 50 (0to8); 1055956: A 50, B 25, ours 25 (Echo8) | yes; it does not pin E13 (finding 9) |
| G26a | parts 50 / 50; W1 25 / 25; W2 (Mechanical → 90) 45 / 5 | yes |
| G26b | Synchronization: W1 25 / 25; W2 (50) 25 / 25 | yes |
| G26c | external X takes nothing (D-087): W1 100 → 50 / 50 | yes |
| G26d | "author 50" only if W1 is the only writer (part 100); on the G26a line it would be 25. State the line | wording |

## 2. Findings

### 1. Blocker: the settlement 15 % (Q6, M35) is paid at half the contract rate
Evidence:
- The settlement (`texts_dd_pack.jsonl`, 3.11 Disputes) says the label pays 15 % of "regalías netas", defined as all amounts the label receives from the recordings. Base = the whole unit net; payer = the label.
- Annex Sch3A row 5 agrees ("net digital recording royalties", 15 %, third-party payment).
- 09 M35 and stage-1 product finding 5 write the result: on 50/50 the participant gets 15, the artists 50, the label 35.
- But 10 §2 defines `label_share` as "percent of the current label share". 11 step 4.3 enters "the settlement 15 `label_share`". The model therefore pays 15 % × 50 = **7.5**, not 15, and the label keeps 42.5 instead of 35.
- That underpays the participant by 7.5 % of net on 30 ISRC from 2026-02.

The model ties a participation's base to its funder. The goal asks for an explicit base and an explicit payer, and here they differ: the base is net, the payer is the label share.

Required change: add one funding kind, "percent of net, taken from the label share" (for example `net_from_label`). It works like a row of net: the participant gets net × p, the label share drops by that amount, and the artist rows are untouched. Model Q6 with it. Add golden case "rows A 25, B 25; settlement S 15 `net_from_label`": S 15, A 25, B 25, ours 35. Add the same case under a NoGhost string; under Q11 order the sublabel then gets 17.5.

### 2. Blocker: Q1 and Q5 ("an assumption document on a row") cannot be expressed; 10 and 12 contradict each other
Evidence:
- `splits.splits` has one `document_id` per split version. `split_shares` (split, artist, percent) has no document (`modules/splits/schema.ts`).
- An `assumption` document on the split therefore sends **every** row to C, confirmed artists included.
- 10 §7 Q1 says "assumption document on the licensor's row". Q5 says "the other document's rows carry an assumption document". Neither is possible.
- The G10 note in 12 says the Q1 assumption is "carried by an `assumption` document on a participation, not by the row". But the licensor is already a row on FUNK DO SURPRISE. G23 / E16 refuse the same pseudonym as both a row and a participation.
- None of the existing kinds is a "row of net": `top` dilutes everybody, `artist_pool` takes from the artists, and `label_share` has the wrong base.
- No golden case pins Q1, Q5 or E22 (ACIDO III 23 vs 25).

Required change: use the kind from finding 1. A disputed or assumed share becomes a `net_from_label` participation with its own document (kind `assumption`), on its own pseudonym of the same owner, so the double-participation check stays simple.
- Q1: the licensor gets row 14 under the licence document, plus 6 `net_from_label` under the assumption document. Only the 6 that depends on the reading sits in C, which is stage-1 product note 2.
- Q5: the conflicting claim (Lost Label on the 30 titles) gets `net_from_label` rows under assumption documents. They come out of "ours" into C, and the registered split stays B.
- E22 (ACIDO III): the licence rate 23 goes on the row, plus 2 `net_from_label` under an assumption document.
- Write each in 10 §7 and add golden cases. FUNK DO SURPRISE-like: KX 23, D 7, L 14 (approved), L′ 6 (assumption) gives B 44, C 6, ours 50. A Q5 case: registered row A 25 B; conflicting LL 25 C `assumption`; ours 50.

### 3. Should-fix: M33 / the settlement lump must not become a payout on the participant
10 §7 M33 says "a lump paid at signing is a payout operation". That is right for MC Denny: his 13 % runs retro from release, so the lump of 10,774.41 is paid against accrued B.

The settlement says the opposite of its USD 100,000. It is "la única y final contraprestación por todos los usos retrospectivos", and the 15 % runs only "a partir de la Fecha de Entrada en Vigor". Owner decision 6 agrees: before 2026-02-27 the share is settled by those payments.

Booked as a payout, the 100,000 drives the participant's payable to about −100,000, so the 15 % would never be payable. That is a recoupable advance the contract does not grant.

Required change: in 10 §7 M33 and 11 step 4.5, record the settlement lump as a document only, like buy-out prices (D-027). Keep "payout" for lumps that pay accrued royalties (Denny). Also state, as stage-1 product note 5 asked, that before 2026-02 the unit follows the split and that 15 % stays with the label of record.

### 4. Should-fix: Q11 categorises only the sublabel; the label-share participant's amount also depends on the order
On G18 the alternative order is "sublabel half first, then the A&R percent of what 0to8 keeps". It gives NG 21.25 and P 2.125, against NG 19.125 and P 4.25 under the chosen order. Ours is 19.125 either way. So P's 2.125 delta depends on the assumption as much as NG's, and the goal rule puts it in C.

Required change: when a unit carries both a `label_share` carve and a sublabel rule, categorise both allocations as `assumption`. Update G18: B 57.5, C 23.375, ours 19.125. Stage 4 already reports whether any NoGhost / R2R / 77 ISRC carries both. If none does, say so in the D-entry.

### 5. Should-fix: R1 is an assumption, labelled as decided
The owner's rule is phrased on "доля лейбла **по сплиту**" ("50 % → 25 / 25"). With no split, the artists' share is unknown: no paper has been entered yet. It is not zero. D-029 ("no split → ours") is a fallback, not a split.

Paying the sublabel half of 100 (G21: NG 50 B) can therefore overpay the sublabel. If a split of 50 arrives later, recalculation fixes the number, but not a payout already frozen in a snapshot.

Required change: label R1 "assumption". Make the sublabel allocation on a no-split unit C `assumption`: G21 becomes B 0, C 50, ours 50. Keep the all-zero split case (E5, an entered split) at B, and add a golden case for it, which is missing today. The money involved is small: NoGhost 139.37. The Echo8 strings are C anyway under Q12.

### 6. Should-fix: the unfunded pool shortfall goes to "ours" without a source
In G22 the participant is owed 20 by its document but gets 10. The other 10 stays with the label, and only a signal is raised. 10 §3 says "no C money is created (there is none)", but the money exists: it is the 10 counted as ours. Whether the label must fund the gap, or the participant simply gets less, is not answered by any source cited.

Required change: either move the shortfall from the label share to C with reason `unfunded`, which follows the goal rule (G22: B 10, C 10, ours 80), or cite the document that caps the participant at the pool. The P08 clause 6.7(a) wording, "shall reduce only Artist's royalty share", could serve if the D-entry quotes it.

### 7. Should-fix: the stage-5 Annex comparison compares the wrong number
11 Stage 5 compares "the ERP label share (ours + the sublabel allocation)" with Annex "Monthly NLS by ISRC". Annex NLS is already **after** the sublabel deduction. For FUNK MONOCLE FRX282688758 in 2026-08, NLS is 2,586.45 = 10,345.80 × 0.25, the share Sch3C(i) gives 0to8 after NoGhost's 25 %.

Adding the sublabel back creates a false difference on every sublabel ISRC (NoGhost alone about 87.3 k net) and hides real ones.

Required change: compare the label of record's remainder **after** the sublabel layer. Take it from the layer state before categorise, so that rows in C (unconfirmed) and `label_unmapped` units still count. Report Q11/Q12 assumption allocations as a separate column. Key both sides by report month (Annex Sch3C Reference financials: "report months"). Exclude the Echo8 perimeter by the Sch1B ISRC list, not by account, because `Echo8` units sit in the 0to8 account from 2024-12 to 2025-07.

### 8. Should-fix: stage 4 can break the floor titles while "entering differences"
Live data (`erp` database):
- Sleeping City Funk DGA062593862/863/864 is stored today as rows MAGRINHO 13, Denny 13, and DJ Raulipues / DJ FANGZ / TrongKien 8 each: label 50, already the owner's number.
- Trilalero FR2X42597261 is stored as 25 / 25.
- MALAME FR96X2565827 is stored as 16.6 × 3.

Plan 4.3 moves the SCF MCs "out of the split" into two `artist_pool` carves of 13. If the artist rows stay at 8 / 8 / 8, the pool is 24 and the result is MAGRINHO 13, Denny 11 (2 unfunded), artists 0, label 76: wrong by 26 points.

G03a's 33.33 / 16.67 also differs from the stored 25 / 25. Proportional scaling of Annex's 50 : 25 moves about 8.3 % of about 3,020 net from DYLANFK to RUSSO. The source of the rows decides this.

Required change:
- In 4.2/4.3, either keep the SCF rows as they are (already correct) or rescale the three artists to 16.666667 / 16.666667 / 16.666666 before adding the carves.
- Name the source of the rows that are scaled (Annex registered rows vs ERP rows vs the artist schedule's royalty column, M37), and log the scaling.
- Remove the duplicate DJ FANGZ 16.6 row, the cause of Annex's 45.8, explicitly.
- Add the missing golden case for MALAME (3 rows 50 : 17 : 17 → 29.761905 / 10.119048 / 10.119047, sum exactly 50). Stage-1 asked for one case per title, and 6-decimal scaling of thirds needs a residue rule.

### 9. Should-fix: golden coverage gaps (MVP ✅ items and catalogue cases without a pinning case)
Each of these needs a golden case, or the name of an existing test in 12:
- **M19 / item 30**: advance scope `publishing`; scope by an ISRC/UPC list, including E9 "an advance scope by UPC on one of two UPC"; scope `none`. 12 names no existing recoup test.
- **M20 / item 31**: a non-recoupable one-off payout lowers payable and recoups nothing.
- **M29 / item 19 and M39 / E22 signals**: 10 §6 lists track notes but **drops the M39 signal** (conflicting claims, rate delta), which 09 §6 requires. Add it to §6 and pin both signals.
- **E20 / M33**: a rule entered retroactively after a payout (Kenke, executed 2026-10-31, covering receipts from 2026-06). Payable drops, can go negative, and the snapshot stays unchanged.
- **E13**: G33 uses two ISRC. Pin the same ISRC and sales month in both accounts, with the same label of record and A kept per account.
- **E14**: a `label_name` change between months on one ISRC.
- **E5**: an all-zero split under a sublabel string (half of 100, B).
- **Brand artist (item 16)**: a pseudonym of our label's owner with no row; nothing is paid.
- **M3a MALAME**: see finding 8.
- **Publishing**: the "no writer of ours → holder / `writer_unmapped`" case, and A = B + C + ours on a B17 statement. The publishing cases assert no reconciliation.

### 10. Should-fix: the stage-4 payment-history load (4.5) is underspecified where Main and the ERP keys differ
Facts from `recon_money.md`: Main has 1,230 nicknames, matched case- and space-insensitively. Expense by category: Royalties 6,637,956.89, Advance 585,333.60, **Sample 499,866.57**, Other 309,751.60, **Publishing 9,638.69**, **Advertising 2,699.39**. Main's month columns follow column C (posting date), not column B ("Reports date for artists").

Required changes to 4.5:
- **Nickname → owner.** A nickname is a name, not a key. Resolve it to an ERP pseudonym by its normalised spelling, and take the owner of that pseudonym. Log ambiguous and unmatched nicknames with their amounts, and hold them out of the load, never drop them silently.
- **Payee route rows (M50).** NoGhost's 25,000 went through an artist's Tipalti account under that artist's nickname. List these re-routed rows explicitly, or the generic rule books NoGhost's payout on the artist.
- **Expense / Sample "вычет доли"** (144 rows). These move money between balances (M13). Once `artist_share` carves exist, loading them as payouts double-counts the carve. Decide per row: either the carve or the operation, never both. 4.5 is silent on them.
- **Expense / Publishing and Advertising.** State their treatment: publishing payouts are payouts; advertising is M21, later, so list the 2,699.39 as a known difference.
- **"Overpayments entered as advances".** Load only Main's cash rows, each once. An overpayment then appears by itself as negative payable (Lost Label −4,104.93). Never enter it as an extra operation.
- **Period.** Use column B (report date) as `period` and column C as the operation date.
- **"ноу рекап" rows (15).** Load the advance as is, with a note naming the holiday. compare-main must attribute those owners' differences to M44 by name, not absorb them.

### 11. Should-fix: Echo8 is a separate legal entity, but the balance is one per owner
10 §5 keeps `ownerBalance` per owner. An owner with paper at both entities (SXLLX), or an Echo8 sublabel with an advance (qaraqshy 20,000, Sch3B), would then recoup across entities and be paid one combined number. Main keeps Echo8 apart: Income 27,124.99, no Expense rows.

Required change: decide in 10 whether payable and recoup run per owner or per owner and our label (the payer). If the decision is per owner, label it an assumption. Then:
- 4.5 must tag each payout and advance with its paying label.
- compare-main must compare the Echo8 sheet separately.
- List the large expected difference: Echo8 earnings over about 1.05 M net against 27 k in Main.

### 12. Should-fix: 4.4 "a split without a document" for Echo8 invents a rate
If an Echo8 artist has no RSA, there is no source for the percent. Then D-029 applies (no split → Echo8's share). If a rate is entered from a non-contract source (Backstage export, report-processor's 50 % pool), it must carry an `assumption` document, not "no document".

Required change: name the source of each Echo8 percent, and use `assumption` where it is not a contract.

### 13. Should-fix: sublabel rule start dates are not in 4.1
NoGhost's agreement is dated 2026-06-19 (Annex Sch3A: "from 19 June 2026"), while NoGhost units start at 2026-02. The owner's rule gives no start date. 4.1 must state each rule's `valid_from`. If NoGhost's half applies before the agreement, those months are an assumption (C).

### 14. Note: Q12 and owner answer 3
For the 0to8-side strings (Enarma, VBR, PCR, Bear, odds, no job records, Hoboshrine), owner answer 3 says no external labels are expected among the other imprints ("Внешних лейблов среди них мы не ждём"). That leans towards alias, no deduction. Putting the sublabel half in C `assumption` is still acceptable, because nothing is paid out on a guess. The D-entry should cite answer 3, and the money in C is effectively ours-pending. For the Echo8 strings Q12 stands. Expected stage-5 difference: qaraqshy's advance shows 20,000 outstanding against Annex 15,898.11.

### 15. Note: M52 is a granularity convention; label it so
The assignments give the assignee income "arising on or after" the effective date, which reads as the sales month. D-025 and the floor both key on the report month, so neither applies the contract exactly. The floor agrees with Annex, which is keyed by report month. The D-entry should say this, name the gainer of the part-month (the new holder, us on buy-outs, 13,363.21 net in total, as stage-1 note 4 asked), and not call it "decided by the contract".

### 16. Note: M16 "cover"
The administration agreement gives 50 % on "cover and synch". B17 has no cover type, so cover income is paid at 90. Say so in the D-128 entry, as an assumption whose money is not separable.

### 17. Note: decisions I accept as consistent
- **Q3**: decided on the payment fact; wording fixed as stage-1 asked.
- **E15**: rows paid, ours in C. It is moot once 4.1 maps every string.
- **M29**: a note, no money.
- **Q12 C treatment**.
- **Q6 "label pays" reading**. Only its base is wrong (finding 1).

## 3. Three stacked real recordings on 100 net (model as designed vs Annex)

| Recording | Model on 100 (data as planned in 11) | Annex 14_beta | Difference and cause |
|---|---|---|---|
| Sleeping City Funk DGA062593864 (M3, owner decision 4) | Stored rows today: DJ Raulipues 8, DJ FANGZ 8, TrongKien 8, MAGRINHO 13, Denny 13 → B/C 50 (today all C `split_unconfirmed`: the split has no document), ours 50. If 4.3 migrates the MCs to pool carves without rescaling: artists 0, MAGRINHO 13, Denny 11 (2 unfunded), ours 76 | rows incl. the duplicate DJ FANGZ 16.6 → 0to8 0.458 (NLS 13,213.61 on 28,850.68) | Correct model: +4.2 to the label, as the owner decided (≈ 1.2 k on 864, ≈ 0.6 k on 863). The migration trap: +26 points (finding 8). On DGA062593862 Annex has 0.501 (Denny absent): −0.1 |
| FUNK DO SURPRISE FRX762590589 (M11 row + M9 partial buy-out + M52) | 2025-07…2026-04: KXZINVK 23, licensor 20 (C `owner_unconfirmed`, moved from the artist pseudonym to the licensor's, Sch3A row 9), MC Da 12 7, ours 50. From 2026-05 (buy-out 2026-05-26 floored): KXZINVK 0, ours 73 | 0.50 then 0.73 from 2026-05 (NLS 2026-05 722.11 = 989.19 × 0.73) | Agrees once M52 is applied. Today's stored `valid_from` 2026-05-26 gives 2026-05 at 50 (−227.51 for the label). Q1: 6 of the 20 (1,900.93 over the period) depends on the assumption, and the model cannot separate it (finding 2) |
| Heavenly jumpstyle FRX282644590 (M4 remixer, retro) | rows 16.67 / 16.67 / 16.66 (approved); Kenke 15 top; rows × 0.85 = 14.1695 / 14.1695 / 14.161; ours 42.5; B 57.5 | 0.50 ("no split line on this code", Catalog Shares) | −7.5 to the label as the owner decided (Annex not updated): 1,148.47 on 15,312.89; Eiden XII FRX282644591: 2,164.22 on 28,856.32. Receipts 2026-06…08 predate execution (2026-10-31): E20 |
| FUNK MONOCLE FRX282688758 (sublabel; the only real multi-layer type) | Raiden 50; label share 50 → NG 25; ours 25 | 0.25 (2026-08 NLS 2,586.45 = 10,345.80 × 0.25) | 0. Note that NLS is after the sublabel (finding 7) |

## 4. What must change before I say yes
1. Add the `net_from_label` funding kind, which gives the explicit base "net, from the label share"; model Q6 with it; add the golden case (finding 1).
2. Use the same kind, on a separate pseudonym, for the assumption cases Q1, Q5 and E22; fix 10 §7 and the G10 note; add golden cases (finding 2).

Findings 3–13 should be fixed in the same revision of 10/11/12; they are text changes and golden cases, not design changes.
