# frontend: notes for agents

- Minimal React + Vite + TypeScript SPA (D-007, D-062): React Router, plain CSS (`src/styles.css`), no UI kit.
  One folder per domain (`owners`, `documents`, `splits`, `sources`, `settlements`), one component per page;
  routes in `src/App.tsx`; shared table/form bits in `src/components/ui.tsx`.
- All data through `src/api/client.ts` (`/api/v1`, errors as `ApiError` with `code`). Request/response types come
  from `@erp/shared/api-schemas` and `@erp/shared/api-responses`; never redefine them here.
- Money arrives as decimal strings. Display them; do not do arithmetic with `Number`/`parseFloat`.
- The UI shows; the backend decides. Rules (payout gate, blocking, categories) are enforced by the facade; the UI
  may disable a button (D-076) but must not be the only check.
- No frontend tests exist. Check with `npm run build:client` and by opening the page on a running server
  (`npm run dev:client` proxies to the API, or the API serves `packages/frontend/dist`).
