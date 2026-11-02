# frontend: notes for agents

- Minimal React + Vite + TypeScript SPA (D-007, D-062): React Router, plain CSS (`src/styles.css`), no UI kit.
  One folder per domain (`owners`, `documents`, `splits`, `labels`, `sources`, `settlements`), one component per page; pages added by the layered model (D-129): `labels/LabelsPage.tsx` (labels, aliases, sublabel rules), `splits/ParticipationsPage.tsx` (list by ISRC, create, close); the terms form has an operation type select, the signals show `unfunded`, `labelUnmapped` and assumption documents;
  routes in `src/App.tsx`; shared table/form bits in `src/components/ui.tsx`.
- All data through `src/api/client.ts` (`/api/v1`, errors as `ApiError` with `code`). Request/response types come
  from `@erp/shared/api-schemas` and `@erp/shared/api-responses`; never redefine them here.
- Category C reasons are one enum with labels: `REASON_LABELS` in `packages/shared/src/reasons.ts`, shown through `reasonLabel` in `components/ui.tsx` (`SourcesPage.tsx`, `OwnerBalancePage.tsx`). A new reason needs a label there (the compiler and `tests/api-reasons.test.ts` enforce it); never hard-code reason texts in a page. Reconciliation rows are per account and show `ourShareByLabel`.
- Money arrives as decimal strings. Display them; do not do arithmetic with `Number`/`parseFloat`.
- The UI shows; the backend decides. Rules (payout gate, blocking, categories) are enforced by the facade; the UI
  may disable a button (D-076) but must not be the only check.
- No frontend tests exist. Check with `npm run build:client` and by opening the page on a running server
  (`npm run dev:client` proxies to the API, or the API serves `packages/frontend/dist`).
