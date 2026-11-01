# Glossary: Russian documents ↔ English code

Written 2026-11-01 (D-120). The architecture documents are in Russian, the code and the decision log are in English.
Use this table to grep both sides. "Doc" is the file where the term is defined.

## People, catalogue, documents (module `owners`, doc 02)

| Russian (docs) | English (code / log) | Where in code | Notes |
|---|---|---|---|
| владелец | owner (`kind: 'person' \| 'label'`) | `modules/owners` | Contract party and payee. Payouts go to owners only |
| артист, псевдоним | artist, pseudonym | `modules/owners` | Exactly one owner per artist (`no_owner` / `unconfirmed` / `confirmed`, D-017) |
| MC | MC = an artist | — | No separate model (01, principle 5) |
| трек, запись трека | track; record = ISRC + UPC pair | `modules/owners` (`knownPairs`) | Splits and money are per ISRC |
| релиз | release (UPC) | — | Optional, metadata |
| договор, основа, приложение | contract, base, appendix | `modules/owners` documents/contracts | Appendix confirms a split |
| документ, требует проверки менеджером | document, `requiresApproval` | `modules/owners` | Status `not_attached` / `not_approved` / `approved` (D-016) |
| «незакрыто», «ждёт документов» | unconfirmed, waiting for documents | — | Marks only; payout gate is the owner's approved contract (D-017) |
| срок на загрузку (`expiredTime`) | upload deadline (`upload_deadline`) | `modules/owners` | Displayed only, nothing happens on expiry (D-024); M11 open |
| пустышка | placeholder (artist/owner without documents) | — | Unknown B17 writers get an owner "waiting for documents"; a split artist without owner is C `artist_without_owner` (D-059) |
| слияние (merge) | merge | `facade/owner-view.ts` `mergeOwners` | Unconfirmed merges into confirmed (D-020, D-046, D-095) |
| реквизиты | payment details | — | Not built (98, M3) |

## Splits (module `splits`, doc 04)

| Russian | English | Where | Notes |
|---|---|---|---|
| сплит, доля | split, share (`percent`) | `modules/splits` | Artist and MC shares only, one level, per ISRC |
| наша доля | our share | `facade/calculation.ts` | Remainder: 100 − Σ shares, never stored |
| период действия, дата отчёта | validity period, report date | `splitIndex.at(isrc, monthStart(reportingMonth))` | `valid_to` exclusive (D-025) |
| выкуп | buyout | `facade/splits.ts` `buyout` | A split change to 0 for the seller; the payment is not in the balance (D-027) |
| базовый сплит | base split template | — | Not implemented (D-030) |

## Sources (module `sources`, docs 03, 06)

| Russian | English | Where | Notes |
|---|---|---|---|
| источник, отчёт | source, report file | `modules/sources/registry.ts` | Registry in PostgreSQL `source_files`, status `loading/loaded/failed/superseded` |
| аккаунт Believe | account | registry | Two accounts: main and the sub-label (echo8) |
| отчётный месяц / месяц продаж | reporting month / sales month | `reportingMonth`, `salesMonth` | Default period basis: report date |
| ключ строки | line key | `columnar.ts` views | 11 fields, README §5; equal keys summed by views, not at load |
| единица расчёта | unit (ISRC+UPC+report month+sales month, net) | `sources.snapshot()` | D-036 |
| нераспределённое | unallocated (`unknown_pair`, `no_isrc`) | `calculation.ts` | Counted in C |
| дубль периода / файла | `duplicate_period` / `duplicate_file` (409) | `loader.ts` | Same account+month, or same sha256 |
| саб-лейбл | sub-label | — | Rule for NoGhost: D-067 (owner review) |

## Publishing (module `publishing`, doc 08)

| Russian | English | Where | Notes |
|---|---|---|---|
| паблишинг, авторские | publishing | `modules/publishing` | B17 now, ASCAP in iteration 2 |
| выписка B17 | B17 statement | `b17-format.ts` | Amount column `Total Payable` (README §5) |
| автор | writer / songwriter | `songwriters` column | Our listed writers share a line equally (D-087) |
| правообладатель | rights-holder (payee) | `rights-holder name` | Gets the line when no listed writer is ours |
| условия паблишинга, процент автора | publishing terms, author percent | `setPublishingTerms` | Default 50 % → category C until confirmed (D-043) |
| сопоставление автора | writer resolution / mapping | `resolveWriters`, `mapWriter` | By name to owner aliases (D-042, D-086) |

## Settlements and payouts (module `settlements`, doc 07)

| Russian | English | Where | Notes |
|---|---|---|---|
| взаиморасчёты | settlements | `modules/settlements` | Operations only, no types |
| операция in / out | operation, `direction: 'in' \| 'out'` | `OperationView` | Integer cents, signed |
| аванс, бонус (возвратный) | advance, recoupable payout | operation with `scope` | `out` with scope |
| охват погашения | scope (`any`, `master`, `publishing`, `master_publishing`, `isrcs`, `excludeIsrcs`) | `recoup.ts` | Mandatory for recoupable payouts |
| погашение, рекуп | recoupment, recoup | `recoup.ts` | Only from income in scope, after its date, largest first, capped (D-049, D-072, D-094) |
| корректировка: списание / пополнение | adjustment: deduction / credit | `createOperation` | Need an approved document (D-048) |
| списание безнадёжного долга | bad-debt write-off | — | Not implemented; enter as a credit with a document (D-055) |
| платёжка, подтверждение оплаты | payment proof (`paymentProofId`) | `attachPaymentProof` | A payout counts only with it |
| возврат | return (`in`, linked by `operationRef`) | `returnPayout` | D-052 |
| отложенная выплата | deferred payout | `deferred` | Blocks new payouts of that owner |
| кнопка «Выплата» | payout button | `facade/payouts.ts` `createPayout` | The only way to make a plain payout (D-051) |
| снимок выплаты | payout snapshot | `createPayout` | Per artist breakdown + file hashes (D-053) |
| порог выплаты | payout threshold | `PAYOUT_THRESHOLD_CENTS` (default 10000) | D-013 |
| перенос данных (migration) | `migration` flag | operations | Counts without documents, never blocks (D-048) |

## Facade (doc 09)

| Russian | English | Where | Notes |
|---|---|---|---|
| фасад | facade | `src/facade/` | Only composer of modules |
| сверка полноты А / Б / В | completeness check A / B / C (`reconcile`) | `calculation.ts` | A received, B not ours, C waiting; our share = A − B − C |
| заработано / выплачено / к выплате | earned / paid / payable (`payableShown` ≥ 0) | `balance.ts` | D-050, D-058 |
| сигналы | signals | `facade/reports.ts` | Alarms: discrepancies, unknown pairs, etc. |
| объяснение «за что» | track explanation | `explainTrack` | Platform/country breakdown from ClickHouse |
| старая ERP | old ERP, `erp.db` | `scripts/reconcile-erp.ts` | Reference only, differences are expected |
