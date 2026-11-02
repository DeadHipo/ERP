# Guides for AI agents

English, written for agents (Claude Code and others) continuing the project (D-120). They summarise and index;
they do not replace the architecture documents (`docs/01`…`09`) or the decision log (`docs/97_*.md`).

| File | Read when |
|---|---|
| [01_big_picture.md](01_big_picture.md) | Always, first: what the system does, the money pipeline, modules, state, what is next |
| [02_glossary.md](02_glossary.md) | Reading the Russian documents or grepping the code for a domain term |
| [03_decision_index.md](03_decision_index.md) | Before changing behaviour: which D-entries are in force, replaced or waiting for the owner |
| [04_recipes.md](04_recipes.md) | Making a change: endpoint, schema, source, page, money rule; guard tests |
| [05_doc_drift.md](05_doc_drift.md) | Two texts disagree, or a command from README/HANDOVER does not work |
| [09_settlement_cases.md](09_settlement_cases.md) | The settlement cases catalogue (MVP goal, stage 1): every contract mechanic with base, payer, example, current behaviour and status; open questions and the edge cases golden tests must pin |
| [10_target_model.md](10_target_model.md) | The layered calculation design of the MVP goal (stage 2): modules in three sentences, storage, layer order, settled questions |
| [11_plan.md](11_plan.md) | Steps of stages 3–7 with their D-entries, data load and verification plans |
| [12_golden_cases.md](12_golden_cases.md) | Synthetic scenarios with hand-computed answers; every one is a test |
| [13_completeness_check.md](13_completeness_check.md) | The A = B + C + ours check on the loaded data, per source, account and month (stage 5/6) |
| [14_verification.md](14_verification.md) | Stage 6 verification: what was checked against the workbooks and the old ERP, and the differences found |
| [15_mvp_report.md](15_mvp_report.md) | The MVP report for the owner: what is done, what is open (written at the end of stage 7; may not exist yet) |
| [reviews/](reviews/) | Council verdicts per stage of the MVP goal (architect, product, QA) |

Folder-specific notes are in nested `CLAUDE.md` files (Claude Code loads them when it works in that folder):
`packages/backend/src/modules/*/` (six modules), `packages/backend/src/facade/`, `packages/backend/tests/`, `packages/frontend/`.

Keeping them current: when you add a D-entry, add its line to `03_decision_index.md`; when you notice a stale
statement elsewhere, add a row to `05_doc_drift.md` instead of editing the architecture documents.
