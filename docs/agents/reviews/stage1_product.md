Verdict: yes

# Stage 1 review: product / money (2026-11-02)

## Revision 2

Re-read `docs/agents/09_settlement_cases.md` (revision 2, 389 lines) against the same sources. I re-checked the
revision 1 hand numbers against the new text and §6 order (layer 3 split → 4 off the top → 5 carves → sublabel half
→ 6 categorise). All of them now agree.

| Case on 100 net | Expected | Revision 2 |
|---|---|---|
| (a) Sleeping City Funk | MAGRINHO 13, Denny 13, artists 8 / 8 / 8, label 50; B 50, ours 50 | M3 (a) and §4 give the same; the MCs are participations, not rows (§1 row "Participants already stored as split rows", M43) |
| (a') Trilalero FR2X42597261 | rows 50 + 25 scaled to 33.33 + 16.67, label 50 | M3 (a), MVP data, one golden case per title |
| (b) Remixer on 50 / 25 / 25 | 15 / 21.25 / 21.25, label 42.5 | M4 (Kenke and Eiden XII only), layer 4 |
| (c) Sublabel, artist 50 % / 70 % | B 75, ours 25 / B 85, ours 15 | M5, NoGhost, R2R, 77 only |
| (d) FUNK DO SURPRISE before / after 2026-05 | rows of net KXZINVK 23, licensor 20, Da 12 7, label 50 → 73 after the buy-out; the licensor's 20 in C (Q1 assumption, and the envelope is not closed), B 30 / 7, ours 50 / 73 | M11, Q1: base net, the row stays a row, no double count |

### Fixed
- **Blocker 1** (gross base): fixed. Net everywhere (M1, M11, M34, §4 "M11 base"); the unit keeps net only (§1 gross/net row); Q1 is now the "less other participants" clause.
- **Blocker 2** (owner decision 4): fixed. Three titles and all their versions; Trilalero and MALAME scaled (M3a, data); pool-funded fixed-rate participants only where a document or the owner says so (Sleeping City Funk, P08 §6.7: M3b); Q2 re-worded; golden case per title.
- **Blocker 3** (sublabel scope): fixed. The half rule only for NoGhost, R2R, 77 (§4); Q12 covers every other sublabel string, with the sublabel allocation in C `assumption` and the qaraqshy advance waiting for it.
- Should-fix items:
  - 4: `0to8/Echo8` → 0to8 (owner answer 1).
  - 5: Q6/M35 is a participation from the label share, by the contract text; pre-start money per owner decision 6.
  - 6: FUNK DO SURPRISE row, payee and buy-out.
  - 7: M4 limited to two documents.
  - 8: Q11 order assumption with C.
  - 9: Q5 conflicts → C plus a signal.
  - 10: the MC Denny 10,774.41 is a payout against accruals; the USD 5,000 fee is the one-off.
  - 11: brand artist = a label-owned pseudonym with no share.
- Notes 12–14 are in: RioX base decided from the contract (Q4); M44 is a known stage-5 difference; publishing interest 12.5–50 %; NoGhost compositions noted; consulting and indemnification out; the beat-lease cap is a later signal.

### Remaining (none blocks acceptance; carry into stage 2)
1. **Should-fix, wording: Q3 is called an "assumption" while its money stays in B.** That contradicts the goal rule as written. The basis given is the payment fact in Main (the §6 exception). Call it "decided on the payment fact (map §6 exception)" in the D-entry rather than "assumption". Otherwise the money belongs in C.
2. **Note: Q1 sends the licensor's whole allocation to C** (20 on the example), although 14 is due under either reading and only 6 depends on the assumption. This is conservative and harmless while the envelope is open. When the clean PDF arrives, only the delta should stay in C.
3. **Note: M3a stores the scaled rows as data.** A later row change on a floor title has to be rescaled by hand. The three golden cases must pin the scaled numbers, and stage 4 should log the scaling.
4. **Note: M52** (`valid_from` = the first day of the month containing the effective date) gives the whole month to the new holder. That matches Annex and keeps D-025, but the D-entry should say who gains the part-month (13,363.21 net in total).
5. **Note: M33's "belong neither to the participant nor to the label as a rule"** must say explicitly in the stage-2 D-entry where the pre-2026-02-27 15 % sits in the calculation. My reading: no participation before the start; the unit follows the split, and the lump is a payout operation.


## Revision 1 review (verdict at the time: no; kept for the record)

Reviewed: `docs/agents/09_settlement_cases.md` against `notes/goal_prompt.md`, `notes/settlement_landscape.md` (MVP list, §6),
the owner answers of 2026-11-02 (`context_data/ответы_разработчику_реестры_v5_2026_11_02.md`,
`context_data/contract_index/решения_владельца_2026-11-02.json`), contract texts (`contract_index/texts.jsonl`,
`texts_dd_pack.jsonl`), Annex 14 (final, 02.11) and Annex 14_beta (обновлено покрытие) sheets "Splits by ISRC",
"Coverage by recording", "Sch3A Participations", "Sch3A Payment costs", "Sch4A Known claims".
Stage names and label names only.

The catalogue is thorough and most cases, bases and payers are right. Three points get the money wrong or contradict
the owner, and these must be fixed before stage 2 writes golden answers from it.

## Hand recomputation on 100 USD of unit net

| Case | Source | Expected (my computation) | §6 order as written | Annex 14 |
|---|---|---|---|---|
| (a) Sleeping City Funk, DGA062593862 | owner decision 4; Sch3A row "MC Denny and MC MAGRINHO, 13 % each, out of the artists' share; label share stays at 50 %"; the Denny letter "13 % of Net Receipts actually received", retroactive from release; JET licence "Masters Royalty 13 %" | label 50; MAGRINHO 13; Denny 13; the three artists share 24 in their registered proportion (12.3 : 12.3 : 12.3), so 8 / 8 / 8. **B 50, C 0, ours 50** | Right only if MAGRINHO and Denny are layer-4 participations and the artist rows are the artists only. If MAGRINHO stays an ordinary split row (M2: "MC is an ordinary artist"), Denny's 13 is funded pro rata from 49.9 of rows, MAGRINHO drops to 9.61 and the artists to 9.10. That is wrong against his licence | MAGRINHO 13 + 3 × 12.3 = 49.9, label 50.1, Denny absent. On DGA062593864/863 the duplicate DJ FANGZ 16.6 row gives label 45.8, the error the owner names |
| (b) Remixer 15 % on 50 / 25 / 25 | owner decision 5; Sch3A rows for Kenke and Eiden XII ("off the top; remaining 85 % divided in the previous proportion") | remixer 15; artists 21.25 + 21.25; label 42.5. **B 57.5, C 0, ours 42.5** (with a sublabel on top: sublabel 21.25, ours 21.25) | Same (layer 2, then layer 3) | FRX282644590 / 591 show label 0.5: Annex not updated (owner 5) |
| (c1) Sublabel, artist split 50 % | owner decision 2 | artist 50; sublabel 25; label 25. **B 75, ours 25** | Same (layer 6) | FRX282688758 FUNK MONOCLE: Raiden 50 %, sublabel 25 %, 0to8 0.25. Matches |
| (c2) Sublabel, artist split 70 % | owner decision 2 | artist 70; sublabel 15; label 15. **B 85, ours 15** | Same | QZWFT2628432 (R2R): artist 70 %, sublabel 15 %, 0to8 0.15. Matches |
| (d) Sample licence 20 % on FUNK DO SURPRISE FRX762590589, gross/net 1.1765, period 2025-07…2026-04 | licence letter: "20 % of gross receipts actually received by" the label; "Gross receipts" = monies "actually received by or credited to" the label, less transaction fees and **less payments for other shareholders / owners / participants** of the new recording. The rows: KXZINVK 23, MC Da 12 7 | What the label "actually receives" is Believe **net** (same wording as the RSA, read as net in M1 / D-036). Registry and payment practice: licensor 20, KXZINVK 23, Da 12 7, label 50. **B 50, ours 50**, with the licensor's 20 payable to the licensor entity, not to the artist pseudonym. Open point: the "less other participants" clause, which would make the base 70 and the licensor's share 14. So 6 of the 20 depend on an assumption | Q1 + layer 4: 20 % × 117.65 = **23.53**, funded from the pool. KXZINVK falls to 20.29 and Da 12 to 6.18; the 23.53 goes to C. If the registered 20 % row is not removed, it is counted twice (B 73.53). From 2026-05 KXZINVK is bought out (label 73, rows left 27), and pool funding of 23.53 would wipe out Da 12 | MC ROBA CENA 20 % inside the registered split, label 0.5 (0.73 from 2026-05 after the KXZINVK buy-out). Sch3A: "registered to the artist instead of the licensor; payable to the licensor" |

## Findings

### 1. Blocker: the "gross" base of sample letters is misread (M11, M34, Q1, §6 unit "with net, gross")
Evidence:
- The FUNK DO SURPRISE letter, and the MC Denny letters for JOGA / ACIDO III, say "gross receipts **actually received by**" the label. The FUNK DO SURPRISE letter defines them as monies "actually received by or credited to" the label.
- The label receives Believe net. The catalogue reads the identical RSA phrase ("percent of gross receipts actually received", also P08 §6.2) as Believe net (M1, D-036), but reads it as Believe `gross_revenue` in Q1.
- The RioX contract defines its base the same way: gross "after deduction of any distribution fees" is net.
- The searched column of Q1 ("gross defined as receipts less VAT") leaves out "actually received by or credited to". It also leaves out the "less payments for other participants" clause, which is the real open point.

Required change: base = unit net for every "received by / credited to the label" wording. Keep a gross base only for a letter that defines receipts before the distributor fee; I found none among the letters I read. Re-state Q1 as the "less other participants" question, with the assumption amount only (20 vs 14 on the example), in C. Drop "gross" from the MVP layer parameters unless one letter needs it. The map's "% от gross" (item 10) is a draft; the contract outranks it (§6).

### 2. Blocker: owner decision 4 is narrower in titles and different in mechanism than M3 / Q2 describe
Evidence:
- `решения_владельца_2026-11-02.json` → `label_floor`: rate 50 for **three** titles, Sleeping City Funk, Trilalero Tramalima Funk and FUNK DO MALAME AMARELO. Its text: "доля лейбла не размывается, **участники уменьшаются пропорционально**".
- The catalogue covers only Sleeping City Funk. It models the decision as "a participant at full rate funded by the artists pro rata". Q2 then generalises it to every sample licensor ("decided").
- The other two titles have no licensed MC. Their rows simply exceed the artist pool:
  - FR2X42597261/262 Trilalero: DJ RUSSO ORIGINAL 50 + DJ DYLANFK 25 = 75, while Annex shows 0to8 0.5.
  - FR96X2565827…830 MALAME: DJ XFOCOS 50 + 17 + 17 = 84, while Annex shows 0.502.
- So the floor is "scale all rows proportionally so that the label keeps 50". On 100 net that gives RUSSO 33.33 + DYLANFK 16.67. The M3 layer cannot express this: it gives RUSSO 25 + DYLANFK 25, or needs someone to pick which row is the "participant".

Required change:
- Add the two titles and all their versions to the case.
- Model owner 4 as a label-floor step (rows × (100 − floor) / Σ rows) on the listed titles.
- Keep layer-4 pool funding for named licensed participants (Sleeping City Funk MCs; the P08 contracts, whose §6.7(a) says a third-party participation "shall reduce only Artist's royalty share").
- Re-word Q2. Pool funding is decided for the P08 contracts (contract) and for the three titles (owner). For any other sample letter it is an assumption, and the money that depends on it goes to C, or the source is cited per licence (the Annex Sch3A "Treatment" column).
- Golden cases: one per title.

### 3. Blocker: the sublabel verdict in §4 goes further than the owner's decision
Evidence:
- Owner answer 2 says: "относится ко всем трём саблейблам: NoGhost, R2R и 77 Records". The JSON `sublabel_without_document` lists only 77 Records and R2R PRODUCTION.
- §4 and M5 declare report-processor's 25/25 for Bear / VBR / ENARMA and its 30/70 for qaraqshy "superseded by the owner rule". M8 lists qaraqshy, fate music, CATCORE and SF Records as Echo8 sublabels, but no rule for them is decided anywhere.
- qaraqshy is an economic party: it holds a 20,000 advance in Sch3B, so it needs a share to recoup from.
- `contract_index/DECISIONS.md` item 7: these labels have no contract, and "the rate was not invented".

Required change:
- Limit the §4 verdict to the three named sublabels.
- Add an open question for the Echo8 sublabels and for the other report-processor sublabels.
- Treat their money as an assumption (the D-067 ⚠ treatment, with a C reason). Do not apply the half rule to them silently.

### 4. Should-fix: "0to8/Echo8 = Echo8" contradicts the owner's answer
The answers say the final Annex 14 has "+12 релизов **0to8** под импринтом «0to8/Echo8»". That Annex is the 0to8 perimeter, and it excludes the Echo8 repertoire. The catalogue's rule (M8, §4 Echo8 row) puts them under Echo8, based on report-processor's "0to8 / X = X", which ranks lower. Required change: `0to8/Echo8` → label of record 0to8 (owner), or an explicit exception in the labels dictionary.

### 5. Should-fix: Q6, the settlement 15 %: the "contract silent" claim is not accurate
The settlement (3.11 Disputes, Spanish text) says the label agrees to pay 15 % of net digital recording royalties, defined as all amounts received by the label from the recordings. So the base is defined (whole unit net), and the payer is the label. The literal reading is "from the label share", not "off the top" (on 50/50: participant 15, artists 50, label 35; off the top would be 15 / 42.5 / 42.5).

M33 also says money before 2026-02-27 "stays where the split puts it". The owner JSON (`participant_from`) says that before that date the share is settled by payments under the agreement and "не относится ни к участнику по сплиту, ни к лейблу".

Required change: correct the searched column, quote both texts in the D-entry, and either decide "label share" by the contract or keep the assumption → C, with the alternative stated.

### 6. Should-fix: FUNK DO SURPRISE: double count, payee and buy-out interaction
Sch3A says the licensor's 20 % is already in the registered split, under the artist pseudonym, and is payable to the licensor (an entity representing the artist; M10 recipient change). The advance of 5,000 is recouped (Q4 2025).

The catalogue does not say:
- that the layer-4 participation **replaces** that row;
- that the buy-out of KXZINVK from 2026-05 (label 0.73) leaves no artist pool to fund it;
- that MC Da 12 holds its own fixed 7 % licence (with a separate label), so there is nothing to scale.

Required change: a golden case for both periods. A licensor with a fixed rate is not a pool row.

### 7. Should-fix: M4 "off the top, everybody diluted" is a two-document rule, not a default
Owner 5 calls it "отдельное правило" for Kenke and Eiden XII. On a P08 contract (19 contracts, e.g. Raiden, UMBRELLA), §6.7(a) says producer / featured / clearance participations reduce only the artist share. Required change: off the top only where the document says so (Kenke, Eiden XII, possibly the settlement); otherwise the participation is funded from the pool.

### 8. Should-fix: layer order 5 → 6 is an unflagged assumption
The owner says the sublabel gets half of the label share "после артистов, MC и ремиксеров". Label-share participations (A&R, collaborator: M12) are not mentioned. Putting layer 5 before 6 makes the sublabel bear half of them. Required change: add the question to §5 and check whether any NoGhost / R2R / 77 ISRC carries an M12 participation. If one does, the delta is an assumption → C; if none does, say so.

### 9. Should-fix: Q3 and Q5 are settled by Annex / Main, which are not answer sources in map §6
The §6 search order is contract → owner answers → docs/97–99 → contract_index → context. Annex 14 and Main rank in precedence only when sources conflict; they are not where answers to open questions come from.
- Q5: Lost Label vs the direct schedules on 30 titles, and SXLLX under both entities. The contracts conflict and there is no owner answer, so under the goal rule the disputed amount goes to C "assumption" with the signal.
- Q3: the late schedule. Paid history in Main is fact (§6 exception) and can support the D-entry, but cite it as the payment fact and state the size of the money it decides.

### 10. Should-fix: the MC Denny lump on Sleeping City Funk is accrued royalty, not a one-off
The letter pays USD 10,774.41 on execution as "retroactive royalties accrued" through July 2026, and separately a non-recoupable settlement fee. M20 and M33 file "the lump" as a one-off operation. Required change:
- the import records the 10,774.41 as a payout against Denny's accruals, which reduces his payable;
- the fee is a non-recoupable operation;
- otherwise payable is overstated by that amount.

### 11. Should-fix: brand artist (MVP item 16) dismissed
M28 says "no 'brand artist' category exists in the data". M21 itself allocates ads "without MC and brands". Annex has recordings with the artist "0to8" and share "not established" (e.g. FRX992554619). Required change: define the brand artist as a label-owned pseudonym with no share (MVP data), so that item 16 is covered.

### 12. Note: the RioX base (Q4) is answerable from the contract
The label share is 33.3 % of "gross revenues … after deduction of any distribution fees, and transaction costs", which is Believe net; §1.2.4 (advances) is a recoup, not a base. The assumption → C is safe (~0.7 k) but not needed.

### 13. Note: M44 and "until the owner confirms"
The goal forbids asking the owner. Phrase every pending item as "D-entry assumption, money in C". M44 (recoup holidays, 50 % "ноу рекап") touches MVP item 30: Main's 15 holiday rows will show up as reconciliation differences in stage 5 unless the history import reproduces them. List this as a known stage-5 difference.

### 14. Note: smaller facts
- The licensors' publishing interest is 12.5–50 %, not 12.5–25 %: FUNK DO SURPRISE 30 %, ACIDO III 50 %.
- The NoGhost Share in the contract covers Covered Compositions too, which is the B17 side. The owner rule speaks of the recording, so the publishing side is later; say so.
- The FUNK DO SURPRISE letter is signed but the PandaDoc envelope is not closed. Until a clean PDF exists, the ERP treats that money as an unconfirmed document (C).

## MVP coverage (item 4 of the brief)

Every ✅ item maps to a case with status exact, MVP layer or MVP data:
- 1 → M1; 2 → M2; 3 → M3; 4 → M4; 5 → M5; 6 → M6; 7 → M7; 8 → M8; 9 → M9;
- 10 → M11/M34; 11 → M12; 12 → M13; 13 → M10; 14 → M25; 15 → M26; 16 → M28;
- 17 → M18; 18 → M14; 19 → M29; 20 → M17; 21 → M15; 22 → M16;
- 24 → M8 + §1; 25 → M17;
- 29 → M47 / §6 Settlements; 30 → M19; 31 → M20; 32 → M27.

None is pushed to later or out wholesale. Partial gaps:
- item 3: two of the three owner titles are missing (finding 2);
- item 8: the Echo8 sublabels have no rule (finding 3);
- item 16: brand artist (finding 11);
- item 30: the release and contract scopes are meant to be ISRC lists; state it. The 100 %-of-gross recoup and the holidays moved to later have no owner basis (finding 13).

## Missing-case sample (item 5 of the brief, 7 random documents, seed 20261102)

| Document (kind) | Money mechanic | Catalogue case |
|---|---|---|
| Work-for-hire agreement (work_for_hire), USD 100–200 fee, no royalties | fixed fee; the label owns 100 % | M20 + owner answer 7 (legal interest 100) ✓ |
| A&R consulting agreement (consulting), USD 1,000 per month, no royalty | operating cost, not an owner balance | not listed. Note: list consulting and services fees as out (not royalty) |
| Copyright assignment, individual purchaser (caa), 100 % master + composition, pre-assignment earnings included | full buy-out, retro, publishing side | M9 + M33; publishing side ◻23 (D-045) ✓ |
| Believe indemnification letter (indemnification) | no money | not listed. Note: list as out |
| Non-exclusive beat lease (beat_lease), USD 60, **capped at 500,000 streams** | fee + usage cap | fee M20 ✓; the stream cap is **not covered**: proposed a new signal case ("licence usage limit exceeded"), like M29, moves no money |
| Additional agreement, advance (advance) | recoupable advance, tranches | M19 ✓ |
| Derivative clearance with YATOMI HOUSE RECORDS (remix), 25 % of gross master receipts to 0to8 from the first dollar | incoming share from another label | M46, later (◻27) ✓ |

## What must change for "yes"
Findings 1, 2 and 3 in the catalogue (the Q1 base, the owner-4 floor with its three titles, the sublabel scope). Findings 4–11 can be fixed in the same pass or carried as explicit stage-2 items with golden cases.
