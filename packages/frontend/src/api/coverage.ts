/**
 * Where every operation of `packages/backend/src/api/operations.ts` is used on a screen, or why it is not.
 * Plain data, checked by `tests/coverage.test.ts`: every operation key is here (and nothing else), a `page` is `P1`..`P25`
 * (see `docs/agents/17_frontend_model.md` section 3) or `shell` (the global search and the pickers on every page), and its `route`
 * is a pattern of `src/routes/paths.ts`. A `refusal` says in words why no screen calls the operation.
 */
export const OPERATION_COVERAGE: Record<
  string,
  { page: string; route: string; note?: string } | { refusal: string }
> = {
  'GET /health': { refusal: 'not a screen: a liveness probe for deployment' },
  'GET /search': { page: 'shell', route: '/', note: 'Cmd/Ctrl+K and every EntityPicker' },

  // the login and the organizations (D-170)
  'POST /auth/login': { page: 'P23', route: '/login', note: 'field-login, field-password, action-login; invalid_credentials as a sentence (login-error); then ?next= or /' },
  'POST /auth/logout': { page: 'shell', route: '/', note: 'action-logout of UserMenu (AUTH_MODE=on)' },
  'GET /auth/me': { page: 'shell', route: '/', note: 'useMe(): once per load, before any page; UserMenu (login, organization), the operator of writes = the login, X-Org only for a system administrator' },
  'GET /orgs': { page: 'P24', route: '/system/orgs', note: 'the organizations with their counts (no money), system administrator only' },
  'POST /orgs': { page: 'P24', route: '/system/orgs', note: 'action-create-org: field-org-name, action-create-org-submit' },
  'GET /orgs/:id': { page: 'P25', route: '/system/orgs/:id', note: 'the header and counts; also the organization name of UserMenu while a system administrator works in it (erp.org)' },
  'GET /orgs/:id/users': { page: 'P25', route: '/system/orgs/:id', note: 'rows org-user-<login>' },
  'POST /orgs/:id/users': { page: 'P25', route: '/system/orgs/:id', note: 'action-create-user: field-user-login, field-user-password, action-create-user-submit' },

  'GET /owners': {
    page: 'P11',
    route: '/artists',
    note: 'owner names by id in the rows of P11, P12, P13, P14, P18, the owner filter of P2 and P21 twoRowsOneOwner (useOwnerNames); the pickers use /search and the lists use /owners/payables',
  },
  'POST /owners': { page: 'P9', route: '/owners', note: 'action-create-owner with the duplicate dialog' },
  'POST /owners/merge': { page: 'P10', route: '/owners/:id', note: 'action-merge' },
  'GET /owners/payables': { page: 'P9', route: '/owners', note: 'also the payouts view /owners?view=payouts (P4 of revision 1)' },
  'GET /owners/:id': { page: 'P10', route: '/owners/:id' },
  'GET /owners/:id/balance': { page: 'P10', route: '/owners/:id', note: 'one call shared by the tabs (under a label its book: master of its files and publishing of its statements, D-169); also the merge confirmation (the merged owner, once)' },
  'POST /owners/:id/payouts': { page: 'P10', route: '/owners/:id', note: 'action-pay on the balance tab: pays the book of the label, master and publishing (D-169)' },

  'GET /artists': { page: 'P11', route: '/artists', note: 'also the pseudonyms of the rows of P14 that carry only an artist id (useArtistNames)' },
  'GET /artists/duplicates': { page: 'P11', route: '/artists/duplicates' },
  'GET /artists/balances': { page: 'P11', route: '/artists', note: 'the money of the visible rows (ids=, D-167) or of every pseudonym (action-compute-all)' },
  'POST /artists': { page: 'P11', route: '/artists', note: 'action-create-artist' },
  'GET /artists/:id': { page: 'P12', route: '/artists/:id', note: 'the card: owner, merged ids, tracks, contracts, splits, participations, sublabel rules, documents; also the chosen pseudonym of the P22 filter' },
  'GET /artists/:id/balance': { page: 'P12', route: '/artists/:id', note: 'the one money call of the page (the reach of the pseudonym, D-165), shared by the tabs' },
  'POST /artists/:id/owner': { page: 'P11', route: '/artists', note: 'action-assign-owner; also the queue and the signals' },

  'GET /tracks': {
    page: 'P21',
    route: '/signals/:name',
    note: 'only NoteDialog «Заметка к треку» (a track chosen by ISRC) resolves the track id from it: /search returns tracks without their id and /tracks/summary is a money call; P5 uses /tracks/summary',
  },
  'POST /tracks': { page: 'P5', route: '/tracks', note: 'action-create-track; also the register-track dialog of the queue' },
  'PATCH /tracks/:id': {
    page: 'P6',
    route: '/tracks/:isrc',
    note: 'only the note is editable (action-edit-note); identifiers (ISRC, UPC, title) are not editable on any screen',
  },
  'GET /tracks/summary': { page: 'P5', route: '/tracks' },
  'GET /tracks/catalog': { page: 'P5', route: '/tracks', note: 'the first phase of P5 (D-162): the rows without money; the visible rows then ask /tracks/summary?isrcs=' },
  'GET /tracks/:isrc/money': {
    page: 'P6',
    route: '/tracks/:isrc',
    note: 'a month row shows its book (the label of its file, «Книга», month-book / data-book) and the label string → label of record → sublabel (data-label), D-169',
  },
  'GET /tracks/:isrc/breakdown/:month': { page: 'P6', route: '/tracks/:isrc', note: 'action-breakdown of a month row' },
  'GET /tracks/:isrc/explain': { refusal: 'superseded by /tracks/:isrc/money and /breakdown/:month on the screens; kept for API users' },

  'GET /releases': { page: 'P7', route: '/releases' },
  'GET /releases/:upc': { page: 'P8', route: '/releases/:upc' },

  'GET /documents': { page: 'P13', route: '/documents', note: 'label= of the switch: the documents of the label and those without one, the «Лейбл» column document-label («любой» for none, D-169); also the document titles of P21 assumptions and of the approve and recreate confirmations' },
  'POST /documents': { page: 'P13', route: '/documents', note: 'action-create-document with field-document-label (default the switch, «любой лейбл» = no labelId, D-169); also the document step of the queue actions, which sends the label of the switch (or of the operation)' },
  'PATCH /documents/:id': { page: 'P14', route: '/documents/:id', note: 'action-set-document-label: field-document-label, an own label or «любой лейбл» (null), D-169' },
  'POST /documents/:id/attach': { page: 'P13', route: '/documents', note: 'action-attach' },
  'POST /documents/:id/approve': { page: 'P13', route: '/documents', note: 'action-approve; also the queue' },
  'GET /documents/:id/uses': { page: 'P14', route: '/documents/:id', note: 'also the approve and contract confirmations (OK waits for it)' },
  'POST /contracts': { page: 'P14', route: '/documents/:id', note: 'action-create-contract; also the documents tab of P10 and the queue' },

  'GET /splits': { page: 'P15', route: '/splits' },
  'POST /splits': { page: 'P15', route: '/splits', note: 'create asks for an ISRC first; also the rules tab of P6' },
  'POST /splits/change': { page: 'P6', route: '/tracks/:isrc', note: 'rules tab' },
  'POST /splits/buyout': { page: 'P6', route: '/tracks/:isrc', note: 'rules tab; also P15' },
  'POST /splits/:id/confirm': { page: 'P14', route: '/documents/:id', note: 'action-confirm-split; also the queue and the rules tab of P6' },

  'GET /participations': { page: 'P16', route: '/participations' },
  'POST /participations': { page: 'P16', route: '/participations', note: 'also the rules tab of P6' },
  'POST /participations/:id/close': { page: 'P16', route: '/participations', note: 'also the rules tab of P6' },

  'GET /labels': { page: 'P17', route: '/labels' },
  'POST /labels': { page: 'P17', route: '/labels' },
  'POST /labels/:id/accounts': { page: 'P17', route: '/labels/:id', note: 'action-add-account (D-168); also P19: account_unregistered opens register-account-dialog (D-169)' },
  'POST /labels/:id/accounts/:account/remove': { page: 'P17', route: '/labels/:id', note: 'action-remove-account-<account> with ConfirmDialog (D-169)' },
  'POST /labels/:id/aliases': { page: 'P17', route: '/labels/:id', note: 'action-add-alias; also the queue and the signals' },
  'POST /labels/:id/rules': { page: 'P17', route: '/labels/:id', note: 'action-set-rule; also the queue and the signals' },
  'POST /labels/rules/:id/close': { page: 'P17', route: '/labels/:id', note: 'action-close-rule' },

  'GET /sources/files': { page: 'P19', route: '/sources', note: 'label= of the switch; the «Лейбл» column file-label / statement-label (D-169)' },
  'GET /sources/lines': { page: 'P19', route: '/sources/lines', note: 'label= of the switch: the files of the label only (D-169)' },
  'GET /sources/lines/facets': { page: 'P19', route: '/sources/lines', note: 'label= of the switch (D-169)' },
  'POST /sources/believe': { page: 'P19', route: '/sources', note: 'field-upload-believe under the label of the switch, closed under «Все» (upload-closed-reason); account_unregistered opens register-account-dialog and repeats (D-169)' },
  'POST /publishing/b17': { page: 'P19', route: '/sources', note: 'field-upload-b17 under the label of the switch, closed under «Все» (D-169)' },

  'GET /publishing/writers': { page: 'P18', route: '/publishing' },
  'POST /publishing/writers/:norm/map': { page: 'P18', route: '/publishing', note: 'action-map-writer; also the queue and the signals' },
  'POST /publishing/writers/resolve': { page: 'P18', route: '/publishing', note: 'action-resolve-writers' },
  'POST /publishing/terms': { page: 'P18', route: '/publishing', note: 'action-set-terms; also the queue' },

  'GET /reconciliation': { refusal: 'superseded by /overview, which returns the same rows with the queue and signal counts (one money call, P1)' },
  'GET /signals': { page: 'P21', route: '/signals/:name', note: 'one call with limit 5000 (the API cap) for the index and the lists; the grids page on the client; the label lists (filesWithoutLabel, statementsWithoutLabel, adsWithoutLabel, adOutsideBook, D-169) in pages/work/signals/label-signals.tsx' },
  'GET /overview': { page: 'P1', route: '/', note: 'also the queue summary of P2' },
  'GET /queue/:reason': { page: 'P2', route: '/queue/:reason' },

  'GET /settlements/operations': { page: 'P20', route: '/operations', note: 'also the operations tab of P10' },
  'POST /settlements/operations': { page: 'P20', route: '/operations', note: 'action-create-operation' },
  'PATCH /settlements/operations/:id': { page: 'P21', route: '/signals/:name', note: 'action-set-label of operationsWithoutLabel (D-168)' },
  'POST /settlements/operations/:id/proof': { page: 'P20', route: '/operations', note: 'action-proof; shared with P10' },
  'POST /settlements/operations/:id/deferred': { page: 'P20', route: '/operations', note: 'action-deferred; shared with P10' },
  'POST /settlements/operations/:id/deactivate': { page: 'P20', route: '/operations', note: 'action-deactivate; shared with P10' },
  'POST /settlements/operations/:id/return': { page: 'P20', route: '/operations', note: 'action-return; shared with P10' },
  'GET /ads': { page: 'P22', route: '/ads', note: 'the records grid with the URL filters (isrc, status, from, to); label= of the switch = the payer, the «Плательщик» column (D-169)' },
  'POST /ads': { page: 'P22', route: '/ads', note: 'action-create-ad (one record), action-create-ads-batch (a pasted list); every item carries the payer labelId (ad-label / ad-batch-label, default the switch), both closed under «Все» (D-169)' },
  'GET /ads/:id': { page: 'P22', route: '/ads/:id', note: 'the card of one expense: the payer (ad-label), the income book when it differs (ad-income-book), who bears it, history; read by EditAdByIdDialog of P21 (D-169)' },
  'GET /ads/summary': { page: 'P22', route: '/ads', note: 'the summary by month and payer; label= of the switch = the payer (D-169)' },
  'PATCH /ads/:id': { page: 'P22', route: '/ads', note: 'action-ad-edit: recovery percent, scope and the payer (ad-edit-label, sent when changed); also from P21 adsWithoutLabel / adOutsideBook (action-set-payer, D-169)' },
  'POST /ads/:id/deactivate': { page: 'P22', route: '/ads', note: 'action-ad-deactivate' },
  'GET /settlements/operations/:id/snapshot': { page: 'P20', route: '/operations', note: 'action-snapshot; also the balance tab of P10' },

  'GET /audit': { page: 'P6', route: '/tracks/:isrc', note: 'history tab; also the history tabs of P10, P12 and the P22 card; the «Лейбл» column (data-col="label", D-169); label= has no screen until stage 3, a card shows its whole history (D-168)' },
};

/** Pages with no operation of their own, with the reason (the guard test accepts exactly these as uncovered). */
export const PAGES_WITHOUT_OPERATIONS: Record<string, string> = {
  P3: 'the open questions are the static list OPEN_QUESTIONS of @erp/shared/open-questions',
  P4: 'revision 1 had a payouts page; it is the payouts view of P9 (/owners?view=payouts), one question and one endpoint',
};
