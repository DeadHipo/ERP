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

Folder-specific notes are in nested `CLAUDE.md` files (Claude Code loads them when it works in that folder):
`packages/backend/src/modules/sources/`, `packages/backend/src/facade/`, `packages/backend/tests/`, `packages/frontend/`.

Keeping them current: when you add a D-entry, add its line to `03_decision_index.md`; when you notice a stale
statement elsewhere, add a row to `05_doc_drift.md` instead of editing the architecture documents.
