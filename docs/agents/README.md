# Guides for AI agents

English, written for agents (Claude Code and others) continuing the project (D-120). They summarise and index;
they do not replace the architecture documents (`docs/01`…`09`) or the decision log (`docs/97_*.md`).

| File | Read when |
|---|---|
| [../обзор_системы.html](../обзор_системы.html) | Для владельца: одна HTML-страница со схемами, как система работает после слоёв (данные, модули, шесть слоёв, A = B + C + наше, баланс) |
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
| [15_mvp_report.md](15_mvp_report.md) | The MVP report: what is closed, what is open for the owner, which assumptions the money depends on |
| [16_frontend_jobs.md](16_frontend_jobs.md) | The frontend goal, stage 1: the operator's jobs by cadence, where the answer comes from today, every C reason and signal with its action, what the API and pages answer, the endpoint gaps, what to take from zero-erp |
| [17_frontend_model.md](17_frontend_model.md) | The frontend goal, stage 2: the rules, the shell, every page in one sentence, drill-down, components, actions with confirmations, the new endpoints, page states, the e2e harness |
| [18_frontend_plan.md](18_frontend_plan.md) | The frontend goal, stage 2: libraries with their D-entry, the steps of stage 3 with D-entries and golden screens, stages 4–6 |
| [19_golden_screens.md](19_golden_screens.md) | The frontend goal, stage 2: what the operator sees and does on the golden-case data, with the exact numbers before and after each action (the Playwright specs) |
| [20_frontend_report.md](20_frontend_report.md) | The frontend goal report: closed, open, assumptions, the real-data table, the e2e list, performance |
| [reviews/](reviews/) | Council verdicts per stage of the MVP goal (architect, product, QA) and of the frontend goal (`frontend_stage{1,2,3}_{architect,product,qa}.md`, the stage 4 walk on the real data `frontend_stage4_walk.md`, later stages as they are written) |

Folder-specific notes are in nested `CLAUDE.md` files (Claude Code loads them when it works in that folder):
`packages/backend/src/modules/*/` (six modules), `packages/backend/src/facade/`, `packages/backend/tests/`, `packages/frontend/`.

Keeping them current: when you add a D-entry, add its line to `03_decision_index.md`; when you notice a stale
statement elsewhere, add a row to `05_doc_drift.md` instead of editing the architecture documents.
