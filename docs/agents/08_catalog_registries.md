# Catalog registries workbook (specification of 2026-11-01)

One script builds one workbook with the registers the specification asks for: recordings, contracts, royalties,
consents and restrictions, assets, monthly receipts, monthly label share, and the summary with the gap lists.
It does not change the ERP and writes nothing to the databases. It is not part of `npm test`.

```
python3 packages/backend/scripts/build-catalog-registries-v11.py
```

It needs the stack up (ClickHouse and PostgreSQL from `.env`), Python with `openpyxl` and `python-docx`, and the git-ignored
`context_data/` folder. The workbook and the log go to `context_data/contract_index/` and are never committed:
they hold party names. Two runs on the same inputs give the same bytes.

v5 (2026-11-02) is the current build; v4 is kept so its file can be rebuilt. v5 adds: the perimeter is the list
of Annex 14 (owner decision of 2026-11-02); Duetti is excluded by the ISRCs of Schedule 1 of the two sale
agreements; the due-diligence pack folder is a third PDF source (tesseract reads pages without a text layer, the
text is cached by sha256 in `contract_index/texts_dd_pack.jsonl`); owner decisions are read from
`contract_index/решения_владельца_2026-11-02.json`, so no name is written in the script.

## Sources

- Recordings and money: ClickHouse `believe.rows`, only files the registry marks `loaded`, both Believe accounts.
  Every raw file in `believe/raw` and `believe_echo8` is hashed against the registry; a file that is neither
  loaded nor a duplicate of a loaded month stops the build.
- Rates: the final split workbook `0to8_Splits_20260814.xlsx`, and the buyout register of `erp.db` from the
  buyout's effective month. `erp.db` is copied to a temporary folder and opened read-only.
- Documents: `contract_index/documents.json` and `texts.jsonl`. The sha256 of every PDF on disk is checked against
  the index. The register of `erp.db` adds the documents of the 22.09.2026 due-diligence pack that are not in the
  two folders; they are marked "файла нет" and never count as naming a recording.
- Release date: Zero catalog, then `erp.db`, then the Zero shipments by UPC, then the first Believe sales month.
  The column next to it says which.
- Annex 14: in v5 the perimeter list, the Catalog Shares rate of a recording without a split line (only inside
  the period Annex gives), the remixer authorisations and the buyout effective dates. Its label amounts are
  only compared against. `0to8 Main.xlsx` is only compared against.

## Rules a reader may not expect

- Perimeter (v4): lines in account 1052428, except a recording whose every line there is under the imprint
  `Echo8`. In v5 it is the Annex 14 list; the book only states why a recording is outside.
- A participation outside the registered split (sub-label, remixer, a settled share) is its own row on «Роялти»
  with «Отражено в сплите: нет». A recipient of the registered split without a party_id stops the build; one
  outside it is gap 3.
- A link is accepted only by the text of that PDF: the ISRC is written, or the title is a whole cell of the parsed
  track table (or, without a table, stands next to a duration, percent, ISRC or date), in a document whose party is
  the participant. A title that the table holds only as the start of a longer title is rejected.
- A document that transfers named works covers every participant it names next to the work. An assignment to FZ
  whose assignor is a buyer of the buyout register or Zero to Infinity Inc. is a chain step: it goes to the column
  "Чем право закреплено за FZ" and does not cover a participant.
- Two coverage measures: "запись названа" (strict) and "по сторонам" (each participant has a rights document of
  their own). Annex 14 is compared with the second one. A co-publishing agreement is not a master right.
- The label share of a month is that month's rounded receipt times the label rate, so the sheet "Роялти" sums to
  the receipts of every ISRC to the cent.

The sheet "Проверка привязок" lists every ISRC × participant × document with the fragment of PDF text that
proves it. Snippets have e-mail addresses and long numbers removed.

## v11 (2026-11-10, brief «ТЗ v11 — сверка с договорами»)

The inputs of the brief live in `contract_index/ТЗ v10+v11 — разработчику 2026-11-10/`. v11 reads:

- the contract index re-extracted on 2026-11-09 (`contract_index/reindex_2026-11-09`, pypdf 6.4.0, 1233 PDF)
  and three agreements signed in PandaDoc without a PDF (`тексты_без_PDF/`, the API text);
- `05_не_покрывает.csv` (documents that name a recording but grant nothing for it) and
  `06_все_документы_имена.csv` (every document under its exact data-room name: the book uses these names);
- owner decisions `v11` in the decisions file: titles whose versions are not tied to an ISRC, rows kept as in v9
  until the owner answers (read from the v9 internal book), documents held back because they are not in 06.

Matching rules added: ISRC with hyphens and spaces, zero-width marks removed, Sped Up = Speed Up, the catalogue tail
« - artist» and «(feat. X)» dropped, a Russian title compared with its Latin spelling, a version that the table
layout moved past the duration. A version (Slowed, Sped Up, Instrumental…) is its own recording: the base title
does not name it. A row with 0% ownership and 0% royalty names nothing. An assignment to FZ from a person covers
the recordings it names. An agreement under another number is not an edition of an earlier one.

It also writes `Schedules 1-6 — draft from Annex 14 v11 <date>.docx` from the template of the brief
(`catalog_schedules_docx_v11.py`: fields and table markers filled, red marking removed, text checked against the
template and the original), `schedules_fields.json`, the Appendix extract, `изменения_v9_v11.csv` and
`отклонения_02_v11.csv` (every ISRC of 02 whose document did not land in its package, with the reason).

## v12 (2026-11-11, owner's answer on v11)

`build-catalog-registries-v12.py` (with `catalog_registers_en_v12.py`, `catalog_schedules_docx_v12.py`). Changes:

- Believe writes the track title without its version in `track`; that base title no longer stands for the version.
  A version is named only by its marker (Slowed, Sped Up…) or its ISRC; the nine owner titles of v11 item 7 keep
  «version not tied to ISRC».
- Sch2B: a contributor or sample licence is the basis only for its own party and only where it names the recording
  (guarantee 6.6.1); otherwise «credited only in another party's agreement» or «registered split only».
- Inputs from `contract_index/Ответ по v11 — разработчику 2026-11-11/06 Ответ по v11 — приложения/`: the Raiden
  text from the PandaDoc API, the map «PDF of the second space → PandaDoc id», the owner's lists for the checks.
- Owner decisions `v12` in the decisions file: copies of data-room documents under another name, documents outside
  PandaDoc accepted as listed, recordings confirmed by the owner's own PDF check, Eiden XII not naming five versions.
- The sent book writes US$ amounts with a thousands separator and «1 recording».
