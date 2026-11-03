/**
 * Where every operation of `packages/backend/src/api/operations.ts` is used on a screen, or why it is not.
 * Plain data, checked by `tests/coverage.test.ts`: every operation key is here (and nothing else), a `page` is `P1`..`P22`
 * (see `docs/agents/17_frontend_model.md` section 3) or `shell` (the global search and the pickers on every page), and its `route`
 * is a pattern of `src/routes/paths.ts`. A `refusal` says in words why no screen calls the operation.
 */
export const OPERATION_COVERAGE: Record<
  string,
  { page: string; route: string; note?: string } | { refusal: string }
> = {
  'GET /health': { refusal: 'not a screen: a liveness probe for deployment' },
  'GET /search': { page: 'shell', route: '/', note: 'Cmd/Ctrl+K and every EntityPicker' },

  'GET /owners': {
    page: 'P11',
    route: '/artists',
    note: 'owner names by id in the rows of P11, P12, P13, P14, P18, the owner filter of P2 and P21 twoRowsOneOwner (useOwnerNames); the pickers use /search and the lists use /owners/payables',
  },
  'POST /owners': { page: 'P9', route: '/owners', note: 'action-create-owner with the duplicate dialog' },
  'POST /owners/merge': { page: 'P10', route: '/owners/:id', note: 'action-merge' },
  'GET /owners/payables': { page: 'P9', route: '/owners', note: 'also the payouts view /owners?view=payouts (P4 of revision 1)' },
  'GET /owners/:id': { page: 'P10', route: '/owners/:id' },
  'GET /owners/:id/balance': { page: 'P10', route: '/owners/:id', note: 'one call shared by the tabs; also the merge confirmation (the merged owner, once)' },
  'POST /owners/:id/payouts': { page: 'P10', route: '/owners/:id', note: 'action-pay on the balance tab' },

  'GET /artists': { page: 'P11', route: '/artists', note: 'also the pseudonyms of the rows of P14 that carry only an artist id (useArtistNames)' },
  'GET /artists/duplicates': { page: 'P11', route: '/artists/duplicates' },
  'POST /artists': { page: 'P11', route: '/artists', note: 'action-create-artist' },
  'GET /artists/:id': { page: 'P12', route: '/artists/:id' },
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
  'GET /tracks/:isrc/money': { page: 'P6', route: '/tracks/:isrc' },
  'GET /tracks/:isrc/breakdown/:month': { page: 'P6', route: '/tracks/:isrc', note: 'action-breakdown of a month row' },
  'GET /tracks/:isrc/explain': { refusal: 'superseded by /tracks/:isrc/money and /breakdown/:month on the screens; kept for API users' },

  'GET /releases': { page: 'P7', route: '/releases' },
  'GET /releases/:upc': { page: 'P8', route: '/releases/:upc' },

  'GET /documents': { page: 'P13', route: '/documents', note: 'also the document titles of P21 assumptions and of the approve and recreate confirmations' },
  'POST /documents': { page: 'P13', route: '/documents', note: 'action-create-document; also the document step of the queue actions' },
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
  'POST /labels/:id/aliases': { page: 'P17', route: '/labels/:id', note: 'action-add-alias; also the queue and the signals' },
  'POST /labels/:id/rules': { page: 'P17', route: '/labels/:id', note: 'action-set-rule; also the queue and the signals' },
  'POST /labels/rules/:id/close': { page: 'P17', route: '/labels/:id', note: 'action-close-rule' },

  'GET /sources/files': { page: 'P19', route: '/sources' },
  'GET /sources/lines': { page: 'P19', route: '/sources/lines' },
  'GET /sources/lines/facets': { page: 'P19', route: '/sources/lines' },
  'POST /sources/believe': { page: 'P19', route: '/sources', note: 'field-upload-believe' },
  'POST /publishing/b17': { page: 'P19', route: '/sources', note: 'field-upload-b17' },

  'GET /publishing/writers': { page: 'P18', route: '/publishing' },
  'POST /publishing/writers/:norm/map': { page: 'P18', route: '/publishing', note: 'action-map-writer; also the queue and the signals' },
  'POST /publishing/writers/resolve': { page: 'P18', route: '/publishing', note: 'action-resolve-writers' },
  'POST /publishing/terms': { page: 'P18', route: '/publishing', note: 'action-set-terms; also the queue' },

  'GET /reconciliation': { refusal: 'superseded by /overview, which returns the same rows with the queue and signal counts (one money call, P1)' },
  'GET /signals': { page: 'P21', route: '/signals/:name', note: 'one call with limit 5000 (the API cap) for the index and the lists; the grids page on the client' },
  'GET /overview': { page: 'P1', route: '/', note: 'also the queue summary of P2' },
  'GET /queue/:reason': { page: 'P2', route: '/queue/:reason' },

  'GET /settlements/operations': { page: 'P20', route: '/operations', note: 'also the operations tab of P10' },
  'POST /settlements/operations': { page: 'P20', route: '/operations', note: 'action-create-operation' },
  'POST /settlements/operations/:id/proof': { page: 'P20', route: '/operations', note: 'action-proof; shared with P10' },
  'POST /settlements/operations/:id/deferred': { page: 'P20', route: '/operations', note: 'action-deferred; shared with P10' },
  'POST /settlements/operations/:id/deactivate': { page: 'P20', route: '/operations', note: 'action-deactivate; shared with P10' },
  'POST /settlements/operations/:id/return': { page: 'P20', route: '/operations', note: 'action-return; shared with P10' },
  'GET /ads': { page: 'P22', route: '/ads', note: 'the records grid with the URL filters (isrc, status, from, to)' },
  'POST /ads': { page: 'P22', route: '/ads', note: 'action-create-ad: one record per dialog (the API takes a batch)' },
  'GET /ads/summary': { page: 'P22', route: '/ads', note: 'the summary by month and label of record' },
  'PATCH /ads/:id': { page: 'P22', route: '/ads', note: 'action-ad-edit: recovery percent and scope' },
  'POST /ads/:id/deactivate': { page: 'P22', route: '/ads', note: 'action-ad-deactivate' },
  'GET /settlements/operations/:id/snapshot': { page: 'P20', route: '/operations', note: 'action-snapshot; also the balance tab of P10' },

  'GET /audit': { page: 'P6', route: '/tracks/:isrc', note: 'history tab; also the history tab of P10' },
};

/** Pages with no operation of their own, with the reason (the guard test accepts exactly these as uncovered). */
export const PAGES_WITHOUT_OPERATIONS: Record<string, string> = {
  P3: 'the open questions are the static list OPEN_QUESTIONS of @erp/shared/open-questions',
  P4: 'revision 1 had a payouts page; it is the payouts view of P9 (/owners?view=payouts), one question and one endpoint',
};
