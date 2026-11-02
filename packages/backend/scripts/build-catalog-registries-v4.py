"""Fourth catalog registry for the 2026-11-01 specification.

One row per ISRC of every Believe report line (both accounts, loaded files
only), plus the ISRCs the final split or the Zero catalog know and Believe
has not reported yet. Money comes from ClickHouse. Rates come from the final
split workbook, and from the buyout register from its effective month.

Every document link is checked against the text of that PDF, after the PDF
bytes are checked against the index sha256:
- the ISRC is written in the PDF;
- the recording title is written in a PDF whose party is a participant of
  the recording;
- the title without its version is written there;
- the release title is written there;
- the participant has a rights document that names none of the above.
A participant who appears only inside another party's document that names
the recording is shown as such and does not count as covered.

Annex 14 and 0to8 Main.xlsx are read only to compare. Their figures never
replace a figure computed here.

Nothing is opened for writing: erp.db is copied to a temporary directory
first, the PDFs and workbooks are read only.
"""

from __future__ import annotations

import base64
import hashlib
import json
import os
import re
import shutil
import sqlite3
import subprocess
import sys
import tempfile
import unicodedata
import urllib.request
import zipfile
from collections import Counter, defaultdict
from datetime import date, datetime
from decimal import Decimal, ROUND_HALF_UP
from pathlib import Path

import openpyxl
from openpyxl import Workbook
from openpyxl.cell.cell import ILLEGAL_CHARACTERS_RE

VERSION = "v4"
BUILD_DATE = "2026-11-02"
ROOT = Path(__file__).resolve().parents[3]
CD = ROOT / "context_data"
CI = CD / "contract_index"
ENV_PATH = ROOT / ".env"
RAW_DIRS = [CD / "ERP_data/believe/raw", CD / "ERP_data/believe_echo8"]
PDF_DIRS = [CD / "PandaDoc_documents_0 (2)", CD / "Root"]
SPLITS = CD / "ERP_data/splits/raw/0to8_Splits_20260814.xlsx"
ERP_DB = CD / "data/erp/data/erp.db"
ZERO_TRACKS = CD / "ERP_data/zero/catalog_tracks_2026-10-16.json"
ZERO_FILES = CD / "ERP_data/zero/distribution_files_2026-10-16.json"
ZERO_RELEASES = CD / "ERP_data/zero/distribution_releases_2026-10-16.json"
ANNEX = CD / "Annex 14 — contractual coverage by recording.xlsx"
MAIN = CD / "0to8 Main.xlsx"
DOCS = CI / "documents.json"
TEXTS = CI / "texts.jsonl"
OUT = CI / f"реестры_каталога_2026-08_{VERSION}.xlsx"
LOG = CI / f"реестры_каталога_2026-08_{VERSION}.log"
MAIN_ACCOUNT, ECHO_ACCOUNT = "1052428", "1055956"
CENT = Decimal("0.01")
STAMP = (2026, 11, 2, 0, 0, 0)
GAP_LIMIT = Decimal(20)

CATEGORIES = (
    "собственный мастер-копирайт",
    "эксклюзивные контрактные права эксплуатации на фиксированный срок",
    "эксклюзивные контрактные права эксплуатации на срок охраны",
    "неэксклюзивные поддерживающие права контрибьютора или сэмпла",
)
OWN, FIXED, LIFE, SUPPORT = CATEGORIES

# Document type read from the heading of the PDF text. The first pattern that
# matches wins; the index kind is used only when none matches.
HEADING_TYPES = [
    (r"DEV-?DJ-?TEST|DEVTEST", "test", "тестовый документ"),
    (r"TRANSFEREXCLUSIVEINTELLECTUALPROPERTY|ПЕРЕДАЧЕИСКЛЮЧИТЕЛЬНЫХ", "transfer", "уступка"),
    (r"COPYRIGHTASSIGNMENTAGREEMENT", "transfer", "уступка"),
    (r"^.{0,80}ASSIGNMENTAGREEMENT", "transfer", "уступка"),
    (r"PARTIALASSETPURCHASE", "partial_purchase", "выкуп"),
    (r"ASSETPURCHASE|MASTERPURCHASEAGREEMENT|BEATPURCHASEAGREEMENT", "purchase", "выкуп"),
    (r"SUBLABELAGREEMENT|SONGROYALTYSHAREAGREEMENT", "sublabel", "саблейбл"),
    (r"SETTLEMENT", "settlement", "мировое соглашение"),
    (r"^.{0,40}SCHEDULE[A-HСЕ]|^.{0,40}SCHEDULE[A-HСЕ]?[-–]?LISTOF", "schedule", "приложение SCHEDULE"),
    (r"^.{0,40}(ADDENDUM|AMENDMENT|APPENDIX|RATIFICATION)", "addendum", "изменение или приложение"),
    (r"DERIVATIVE(WORKS)?CLEARANCE|REMIXLICENSE", "contributor", "лицензия контрибьютора"),
    (r"SAMPLELICENSE|USELICENSE|SAMPLEUSE|BEATLEASE|PERMISSION/?CONSENTFORUSE", "sample", "лицензия на сэмпл"),
    (r"^.{0,40}(LICENSEAGREEMENT|ЛИЦЕНЗИОННЫЙДОГОВОР)", "contributor", "лицензия контрибьютора"),
    (r"ROYALTYPARTICIPATIONAGREEMENT", "participation", "соглашение об участии в роялти"),
    (r"CO-?PUBLISHING|PUBLISHINGADMINISTRATION", "publishing", "паблишинг"),
    (r"WORK-?FOR-?HIRE", "work_for_hire", "работа по найму"),
    (r"CO-?OWNERSHIPAGREEMENT", "co_ownership", "договор о совместном владении"),
    (r"DISTRIBUTIONANDADMINISTRATIONAGREEMENT|RECORDINGSERVICESAGREEMENT|EXCLUSIVELICENSEAGREEMENT|"
     r"MASTERRECORDINGAGREEMENT|MASTERLICENSE&ROYALTY|PLATFORMLICENSEAGREEMENT|RECORDINGAGREEMENT",
     "recording", "договор с артистом"),
    (r"POWEROFATTORNEY", "reference", "доверенность"),
    (r"DMCA|INDEMNIFICATION|RIGHTSASSERTION|HEADEDLETTER", "reference", "письмо"),
    (r"NON-?DISCLOSURE", "reference", "NDA"),
    (r"W-?8BEN", "reference", "форма W-8BEN"),
    (r"IMRO|COPYRIGHTHOUSE", "reference", "заявление IMRO"),
    (r"CONSULTINGAGREEMENT|EMPLOYMENTLETTER|SERVICEAGREEMENT|INVOICE", "reference", "консалтинг"),
    (r"LETTEROFCONSENT", "reference", "согласие законного представителя"),
]
INDEX_KIND = {
    "recording": ("recording", "договор с артистом"),
    "schedule": ("schedule", "приложение SCHEDULE"),
    "advance": ("addendum", "изменение или приложение"),
    "asset_purchase": ("purchase", "выкуп"),
    "beat_purchase": ("purchase", "выкуп"),
    "assignment": ("transfer", "уступка"),
    "caa": ("transfer", "уступка"),
    "sample_license": ("sample", "лицензия на сэмпл"),
    "beat_lease": ("sample", "лицензия на сэмпл"),
    "remix": ("contributor", "лицензия контрибьютора"),
    "co_pub": ("publishing", "паблишинг"),
    "co_ownership": ("co_ownership", "договор о совместном владении"),
    "work_for_hire": ("work_for_hire", "работа по найму"),
    "sublabel": ("sublabel", "саблейбл"),
}
TABLE_AFTER = re.compile(r"[A-Z]{2}-?[A-Z0-9]{3}-?\d{2}-?\d{5}|\b\d{1,2}:\d{2}\b|\d+(?:[.,]\d+)?\s?%|"
                         r"\b\d{2}[./]\d{2}[./]\d{4}\b")
TRANSFER_KINDS = {"transfer", "work_for_hire"}
RIGHTS = {"chain", "recording", "schedule", "addendum", "purchase", "partial_purchase", "transfer", "contributor",
          "sample", "co_ownership", "work_for_hire", "sublabel", "settlement", "participation"}
LEVELS = ["ISRC назван", "назван трек", "назван трек без версии", "назван релиз"]
VERSION_RE = re.compile(
    r"(?i)\s*(?:[\(\[]|\s[-–]\s)\s*(?:super |ultra |hyper )?(slowed|sped up|speed up|nightcore|remix|edit|"
    r"radio edit|extended|instrumental|acapella|a cappella|reverb|version|mix|remake|phonk|funk|bass boosted|"
    r"tiktok|8d)\b.*$"
)
COMPLETED_RE = re.compile(r"document completed by all parties on:?\s+(\d{1,2}\s+[A-Za-z]{3,9}\s+\d{4})", re.I)
SIGNED_RE = re.compile(r"\bSigned:?\s+(\d{1,2}\s+[A-Za-z]{3,9}\s+\d{4})", re.I)
ISRC_RE = re.compile(r"\b([A-Z]{2})[\s-]?([A-Z0-9]{3})[\s-]?(\d{2})[\s-]?(\d{5})\b")
MONTHS = {m: i + 1 for i, m in enumerate(
    ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"])}
GENERIC_ALIASES = {"producer", "purchaser", "artist", "catalog recordings", "label", "licensor", "licensee",
                   "seller", "buyer", "summary", "final", "en", "ru", "eng", "pt", "es"}


class Log:
    def __init__(self):
        self.lines: list[str] = []
        self.failures: list[str] = []

    def info(self, text: str):
        self.lines.append(text)
        print(text, flush=True)

    def check(self, ok: bool, text: str):
        self.info(("OK    " if ok else "ОТКАЗ ") + text)
        if not ok:
            self.failures.append(text)


LOGGER = Log()


# ---------------------------------------------------------------- helpers

def q2(value: Decimal) -> Decimal:
    return value.quantize(CENT, rounding=ROUND_HALF_UP)


def money(value: Decimal | None):
    return None if value is None else float(q2(value))


def norm_isrc(value) -> str:
    return re.sub(r"[^A-Z0-9]", "", str(value or "").upper())


def tokens(value) -> list[str]:
    text = unicodedata.normalize("NFKD", str(value or ""))
    text = "".join(char for char in text if not unicodedata.combining(char)).lower().replace("ё", "е")
    return re.sub(r"[^a-z0-9а-я$!]+", " ", text).split()


def key(value) -> str:
    return " ".join(tokens(value))


def spaced(value) -> str:
    return " " + key(value) + " "


def squash(value) -> str:
    return re.sub(r"[^A-Z0-9А-Я]", "", unicodedata.normalize("NFC", str(value or "")).upper())


def file_key(name: str) -> str:
    name = unicodedata.normalize("NFC", os.path.basename(name or ""))
    name = re.sub(r"\s*\[\d\]|\s*\(\d\)", "", name)
    return re.sub(r"\s+", " ", name).strip().lower()


def iso(day: int, month: int, year: int) -> str:
    try:
        return date(year, month, day).isoformat()
    except ValueError:
        return ""


def stamp_iso(raw: str) -> str:
    match = re.match(r"(\d{1,2})\s+([A-Za-z]{3,9})\s+(\d{4})", raw.strip())
    if not match:
        return ""
    month = MONTHS.get(match.group(2)[:3].lower())
    return iso(int(match.group(1)), month, int(match.group(3))) if month else ""


def text_date(raw: str) -> str:
    raw = (raw or "").strip()
    match = re.match(r"(\d{4})-(\d{2})-(\d{2})", raw)
    if match:
        return iso(int(match.group(3)), int(match.group(2)), int(match.group(1)))
    match = re.match(r"(\d{1,2})\s+([A-Za-z]+),?\s+(\d{4})", raw)
    if match and match.group(2)[:3].lower() in MONTHS:
        return iso(int(match.group(1)), MONTHS[match.group(2)[:3].lower()], int(match.group(3)))
    match = re.match(r"([A-Za-z]+)\s+(\d{1,2}),?\s+(\d{4})", raw)
    if match and match.group(1)[:3].lower() in MONTHS:
        return iso(int(match.group(2)), MONTHS[match.group(1)[:3].lower()], int(match.group(3)))
    return ""


def filename_bits(name: str) -> tuple[str, str, str]:
    """Number, date and nickname written in a file name like ..._160924vinter.pdf."""
    stem = re.sub(r"\.(pdf|docx)$", "", unicodedata.normalize("NFC", name), flags=re.I)
    stem = re.sub(r"\.docx$", "", stem, flags=re.I)
    match = re.search(r"(?:#|_|\s)\s*(\d{6}|\d{8})(?!\d)([^)]*)", stem)
    if not match:
        return "", "", ""
    digits, rest = match.group(1), match.group(2)
    day, month = int(digits[:2]), int(digits[2:4])
    year = int(digits[4:]) if len(digits) == 8 else 2000 + int(digits[4:])
    found = iso(day, month, year) if 2018 <= year <= 2030 else ""
    nick = re.split(r"(?i)_RU_ENG|_ENG_RU|_RUS_ENG|_PT_ENG|_EN_PT|_ENG_ES|_EN_RU|_EN_SP|_ENG_SP|_ENG\b|_RU\b|"
                    r"\(\d\)|\.docx|\[\d\]", rest)[0]
    nick = re.sub(r"\s+", " ", nick).strip(" _-.#)(")
    return digits + nick.replace(" ", ""), found, nick


def months_between(first: str, last: str) -> list[str]:
    year, month = int(first[:4]), int(first[5:7])
    out = []
    while f"{year:04d}-{month:02d}" <= last:
        out.append(f"{year:04d}-{month:02d}")
        month += 1
        if month == 13:
            year, month = year + 1, 1
    return out


def split_names(value) -> list[str]:
    return [part.strip() for part in str(value or "").split(",") if part.strip()]


def credit_names(artist: str) -> list[str]:
    out = []
    for part in re.split(r"\s*(?:,|&|\bfeat\.?\b|\bft\.?\b|\bx\b|/|\bvs\.?\b)\s*", artist or "", flags=re.I):
        part = part.strip()
        if part and part not in out:
            out.append(part)
    return out


def redact(text: str) -> str:
    """A snippet proves a link; it must not carry contact or identity numbers."""
    text = re.sub(r"[\w.+-]+@[\w-]+(\.[\w-]+)+", "[почта]", text)
    text = re.sub(r"\+?\d[\d\s()-]{8,}\d", "[номер]", text)
    return text


def base_title(title: str) -> str:
    base = VERSION_RE.sub("", title or "").strip()
    return base if base and key(base) != key(title) else ""


# ---------------------------------------------------------------- storage

def load_env() -> dict[str, str]:
    env = {}
    for line in ENV_PATH.read_text().splitlines():
        line = line.strip()
        if line and not line.startswith("#") and "=" in line:
            name, value = line.split("=", 1)
            env[name] = value
    return env


def clickhouse(env, query: str) -> str:
    request = urllib.request.Request(
        f"http://127.0.0.1:{env['CLICKHOUSE_HTTP_PORT']}/", data=query.encode(), method="POST")
    token = base64.b64encode(f"{env['CLICKHOUSE_USERNAME']}:{env['CLICKHOUSE_PASSWORD']}".encode()).decode()
    request.add_header("Authorization", "Basic " + token)
    with urllib.request.urlopen(request, timeout=900) as response:
        return response.read().decode()


def postgres(env, sql: str) -> list[list[str]]:
    result = subprocess.run(
        ["docker", "exec", "-e", f"PGPASSWORD={env['DB_PASSWORD']}", "royalty-erp-postgres-1", "psql",
         "-U", env["DB_USERNAME"], "-d", env["DB_DATABASE"], "-At", "-F", "\t", "-c", sql],
        capture_output=True, text=True, check=True)
    return [line.split("\t") for line in result.stdout.splitlines() if line]


def sha256_file(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for block in iter(lambda: handle.read(1 << 20), b""):
            digest.update(block)
    return digest.hexdigest()


def count_csv_lines(path: Path) -> int:
    with path.open("rb") as handle:
        return sum(block.count(b"\n") for block in iter(lambda: handle.read(1 << 22), b""))


def load_registry(env):
    rows = postgres(env, "SELECT id::text, account, reporting_month::text, file_name, sha256, status, "
                         "coalesce(line_count, 0)::text, coalesce(net_total, 0)::text FROM source_files")
    loaded = [row for row in rows if row[5] == "loaded"]
    files = {"main": [r[0] for r in loaded if r[1] == MAIN_ACCOUNT],
             "echo": [r[0] for r in loaded if r[1] == ECHO_ACCOUNT]}
    by_sha = {row[4]: row for row in loaded}
    by_month = defaultdict(list)
    for row in loaded:
        by_month[(row[1], row[2][:7])].append(row)
    raw_report = []
    for folder in RAW_DIRS:
        for path in sorted(folder.iterdir()):
            if path.name.startswith(".") or not path.is_file():
                continue
            digest = sha256_file(path)
            if digest in by_sha:
                raw_report.append((path.name, "загружен", by_sha[digest][2][:7]))
                continue
            account = MAIN_ACCOUNT if ECHO_ACCOUNT not in path.name and folder == RAW_DIRS[0] else ECHO_ACCOUNT
            if path.suffix.lower() == ".csv":
                with path.open(encoding="utf-8", errors="replace") as handle:
                    header = handle.readline()
                    if "Net Revenue" not in header:
                        raw_report.append((path.name, "не отчёт продаж: нет колонки Net Revenue", ""))
                        LOGGER.info(f"OK    сырой файл {path.name}: не отчёт продаж (нет колонки Net Revenue), не грузится")
                        continue
                    first = handle.readline().split(";")[0].strip('"').replace("/", "-")[:7]
                lines = count_csv_lines(path) - 1
                twin = [r for r in by_month.get((account, first), []) if int(r[6]) in (lines, lines - 1, lines + 1)]
                raw_report.append((path.name, "дубль загруженного файла" if twin else "не загружен", first))
                LOGGER.check(bool(twin), f"сырой файл {path.name}: {lines} строк, месяц {first}, "
                                         + ("совпал по месяцу и числу строк с загруженным" if twin else "нет пары"))
            else:
                raw_report.append((path.name, "не загружен", ""))
                LOGGER.check(False, f"сырой файл {path.name} не загружен в ClickHouse")
    LOGGER.check(len(files["main"]) >= 34 and len(files["echo"]) >= 13,
                 f"загружено файлов Believe: основной {len(files['main'])}, Echo8 {len(files['echo'])}")
    totals = {MAIN_ACCOUNT: sum(Decimal(r[7]) for r in loaded if r[1] == MAIN_ACCOUNT),
              ECHO_ACCOUNT: sum(Decimal(r[7]) for r in loaded if r[1] == ECHO_ACCOUNT)}
    return files, raw_report, totals


def ids_sql(ids: list[str]) -> str:
    return "[" + ",".join(f"'{item}'" for item in ids) + "]"


def load_clickhouse(env, files):
    main, echo = ids_sql(files["main"]), ids_sql(files["echo"])
    every = ids_sql(files["main"] + files["echo"])
    catalog = {}
    for line in clickhouse(env, f"""
        SELECT isrc,
               argMax(track_title, reporting_month) AS track,
               arraySort(groupUniqArray(track_title)) AS tracks,
               argMax(artist_name, reporting_month) AS artist,
               arraySort(groupUniqArray(artist_name)) AS artists,
               arraySort(groupUniqArray(release_title)) AS releases,
               arraySort(groupUniqArray(release_type)) AS types,
               arraySort(groupUniqArray(label_name)) AS imprints,
               arraySort(groupUniqArrayIf(label_name, file_id IN {main})) AS main_imprints,
               toString(min(sales_month)) AS first_sale,
               max(file_id IN {main}) AS in_main,
               max(file_id IN {echo}) AS in_echo
        FROM believe.rows WHERE isrc != '' AND file_id IN {every}
        GROUP BY isrc FORMAT JSONEachRow""").splitlines():
        if line.strip():
            row = json.loads(line)
            catalog[norm_isrc(row["isrc"])] = row
    upcs = defaultdict(set)
    for line in clickhouse(env, f"""
        SELECT isrc, upc FROM believe.rows WHERE isrc != '' AND upc != '' AND file_id IN {every}
        GROUP BY isrc, upc FORMAT TSV""").splitlines():
        isrc, upc = line.split("\t")
        upcs[norm_isrc(isrc)].add(upc)
    net = {"main": defaultdict(dict), "echo": defaultdict(dict)}
    for line in clickhouse(env, f"""
        SELECT isrc, toString(reporting_month),
               toString(sumIf(net_revenue, file_id IN {main})), toString(sumIf(net_revenue, file_id IN {echo}))
        FROM believe.rows WHERE isrc != '' AND file_id IN {every}
        GROUP BY isrc, reporting_month FORMAT TSV""").splitlines():
        isrc, month, main_net, echo_net = line.split("\t")
        code = norm_isrc(isrc)
        if Decimal(main_net) != 0:
            net["main"][code][month[:7]] = Decimal(main_net)
        if Decimal(echo_net) != 0:
            net["echo"][code][month[:7]] = Decimal(echo_net)
    no_isrc = []
    for line in clickhouse(env, f"""
        SELECT upc, min(release_title), min(artist_name), if(file_id IN {main}, '{MAIN_ACCOUNT}', '{ECHO_ACCOUNT}') AS acc,
               count(), toString(sum(net_revenue)), toString(min(reporting_month)), toString(max(reporting_month))
        FROM believe.rows WHERE isrc = '' AND file_id IN {every}
        GROUP BY upc, acc ORDER BY upc, acc FORMAT TSV""").splitlines():
        upc, release, artist, account, lines, amount, first, last = line.split("\t")
        no_isrc.append({"upc": upc, "release": release, "artist": artist, "account": account,
                        "lines": int(lines), "net": Decimal(amount), "first": first[:7], "last": last[:7]})
    totals = {}
    for line in clickhouse(env, f"""
        SELECT if(file_id IN {main}, '{MAIN_ACCOUNT}', '{ECHO_ACCOUNT}') AS acc, count(), toString(sum(net_revenue))
        FROM believe.rows WHERE file_id IN {every} GROUP BY acc FORMAT TSV""").splitlines():
        account, lines, amount = line.split("\t")
        totals[account] = (int(lines), Decimal(amount))
    return catalog, upcs, net, no_isrc, totals


def load_splits():
    book = openpyxl.load_workbook(SPLITS, read_only=True, data_only=False)
    grouped = defaultdict(list)
    stats = Counter()
    for index, row in enumerate(book["Splits"].iter_rows(values_only=True)):
        if index == 0:
            continue
        stats["строк"] += 1
        code = norm_isrc(row[1])
        if not code:
            stats["пустой ISRC"] += 1
            continue
        label = Decimal(str(row[8])) if isinstance(row[8], (int, float)) else None
        names = split_names(row[10])
        ids = split_names(row[12])
        rates = None
        if isinstance(row[11], datetime):
            rates = [Decimal(row[11].month), Decimal(row[11].day), Decimal(row[11].year % 100)]
        elif row[11] is not None:
            try:
                rates = [Decimal(part) for part in split_names(row[11])]
            except Exception:
                rates = None
        elif not names:
            rates = []
        if rates is not None and (len(rates) != len(names) or (
                label is not None and abs(sum(rates, Decimal(0)) + label - 100) > Decimal("0.05"))):
            rates = None
        if rates is None:
            stats["ставки не разобраны"] += 1
        grouped[code].append({
            "track": str(row[0] or "").strip(), "upc": "" if row[2] is None else str(row[2]).split(".")[0],
            "release": str(row[3] or "").strip(), "status": str(row[7] or ""), "label": label,
            "names": names, "rates": rates, "ids": ids if len(ids) == len(names) else [],
            "modified": row[9] if isinstance(row[9], datetime) else datetime.min,
        })
    book.close()
    chosen, conflicts = {}, []
    for code, items in grouped.items():
        items.sort(key=lambda item: (item["modified"], item["label"] or 0))
        winner = items[-1]
        if len(items) > 1:
            stats["ISRC с несколькими строками"] += 1
            if any(other["label"] != winner["label"] or other["rates"] != winner["rates"] for other in items[:-1]):
                conflicts.append((code, [(str(o["label"]), ", ".join(o["names"])) for o in items]))
        chosen[code] = winner
    stats["конфликт ставок"] = len(conflicts)
    return chosen, stats, conflicts


def load_erp():
    """Read erp.db from a private copy, never from the working file."""
    folder = tempfile.mkdtemp(prefix="erp_ro_")
    copy = Path(folder) / "erp.db"
    shutil.copyfile(ERP_DB, copy)
    db = sqlite3.connect(f"file:{copy}?mode=ro&immutable=1", uri=True)
    party = {row[0]: {"id": row[0], "name": row[1], "cid": row[2], "kind": row[3], "house": row[4]}
             for row in db.execute("SELECT id, name, bs_cid, kind, is_house FROM party")}
    by_cid = {p["cid"]: p for p in party.values() if p["cid"]}
    by_name = defaultdict(list)
    for p in party.values():
        by_name[key(p["name"])].append(p)
    for alias, party_id in db.execute("SELECT alias, party_id FROM alias") if _has_columns(db, "alias", {"alias", "party_id"}) else []:
        if party_id in party:
            by_name[key(alias)].append(party[party_id])
    contracts = []
    for row in db.execute("SELECT c.id, c.number, c.date, c.nick, c.doc_type, c.category, c.file, p.name "
                          "FROM contract c LEFT JOIN party p ON p.id = c.party_id"):
        contracts.append({"id": row[0], "number": row[1] or "", "date": row[2] or "", "nick": row[3] or "",
                          "type": row[4] or "", "category": row[5] or "", "file": row[6] or "", "party": row[7] or ""})
    buyouts = defaultdict(list)
    for row in db.execute("SELECT b.id, b.contract, b.purchaser, b.effective, b.assigned_doc, p.name, t.isrc, "
                          "t.seller_pct FROM buyout b JOIN buyout_track t ON t.buyout_id = b.id "
                          "LEFT JOIN party p ON p.id = b.seller_id"):
        buyouts[norm_isrc(row[6])].append({
            "id": row[0], "contract": row[1] or "", "purchaser": row[2] or "", "effective": row[3] or "",
            "assigned": row[4] or "", "seller": row[5] or "", "pct": None if row[7] is None else Decimal(str(row[7])),
        })
    release_dates = {}
    for upc, value in db.execute("SELECT upc, release_date FROM deal WHERE release_date IS NOT NULL"):
        if upc and value:
            release_dates[str(upc)] = value[:10]
    track_dates = {norm_isrc(i): d[:10] for i, d in db.execute(
        "SELECT isrc, release_date FROM track_meta WHERE release_date IS NOT NULL AND release_date != ''")}
    duetti = sorted({norm_isrc(row[0]) for row in db.execute(
        "SELECT DISTINCT isrc FROM unallocated_income WHERE reason LIKE '%Duetti%'")})
    pandadoc = defaultdict(list)
    for name, state, completed in db.execute("SELECT name, status, completed FROM pd_doc"):
        name = name or ""
        pandadoc[file_key(name if name.lower().endswith(".pdf") else name + ".pdf")].append(
            (state or "", (completed or "")[:10]))
    db.close()
    shutil.rmtree(folder)
    return {"party": party, "by_cid": by_cid, "by_name": by_name, "contracts": contracts, "buyouts": buyouts,
            "release_dates": release_dates, "track_dates": track_dates, "duetti": duetti, "pandadoc": pandadoc}


def _has_columns(db, table: str, columns: set[str]) -> bool:
    found = {row[1] for row in db.execute(f"PRAGMA table_info({table})")}
    return columns <= found


def load_zero():
    data = json.load(ZERO_TRACKS.open(encoding="utf-8"))
    tracks = {}
    for row in data["rows"]:
        record = dict(zip(data["cols"], row))
        tracks[norm_isrc(record["isrc"])] = record
    files = json.load(ZERO_FILES.open(encoding="utf-8"))
    releases = {str(r["id"]): r for r in json.load(ZERO_RELEASES.open(encoding="utf-8"))}
    return tracks, files, releases


# ---------------------------------------------------------------- documents

def signature_of(text: str) -> tuple[str, str, str]:
    completed = COMPLETED_RE.search(text or "")
    if completed:
        return "подписан всеми", stamp_iso(completed.group(1)), "сертификат PandaDoc: document completed by all parties"
    signed = SIGNED_RE.findall(text or "")
    if len(signed) >= 2:
        return "подписан всеми", stamp_iso(signed[-1]), f"сертификат PandaDoc: подписей с датой {len(signed)}"
    if len(signed) == 1:
        return "подписан одной стороной", stamp_iso(signed[0]), "сертификат PandaDoc: одна подпись с датой"
    return "не подписан", "", "в тексте PDF нет сертификата подписи с датой"


def classify(text: str, index_kind: str) -> tuple[str, str, str]:
    head = squash(text[:600])
    for pattern, kind, label in HEADING_TYPES:
        if re.search(pattern, head):
            return kind, label, "заголовок PDF"
    if index_kind in INDEX_KIND:
        kind, label = INDEX_KIND[index_kind]
        return kind, label, "вид в documents.json"
    return "reference", "прочее", "заголовок не распознан, вид в documents.json: " + index_kind


def term_of(text: str, meta_term: str) -> tuple[str, str]:
    low = re.sub(r"\s+", " ", (text or "").lower())
    if re.search(r"life of (the )?copyright|full term of copyright|entire term of copyright|"
                 r"full period of copyright|duration of copyright protection|срок действия исключительного права|"
                 r"весь срок действия (авторских|исключительных) прав|in perpetuity|perpetual", low):
        return "на срок охраны", "текст договора"
    match = re.search(r"(?:term|срок)[^.]{0,120}?\b(\d{1,2}|one|two|three|four|five|six|seven|eight|nine|ten)\s*"
                      r"(?:\(\d+\)\s*)?(year|years|год|года|лет)", low)
    if match:
        words = {"one": 1, "two": 2, "three": 3, "four": 4, "five": 5, "six": 6, "seven": 7, "eight": 8,
                 "nine": 9, "ten": 10}
        value = words.get(match.group(1), match.group(1))
        return f"{value} лет с даты договора", "текст договора"
    if meta_term:
        return meta_term, "documents.json, meta.term"
    return "", ""


def territory_of(text: str) -> str:
    low = (text or "").lower()
    if any(phrase in low for phrase in ("throughout the universe", "throughout the world", "worldwide",
                                         "whole world", "entire world", "the universe", "весь мир", "всего мира")):
        return "весь мир"
    return ""


def clauses_of(text: str) -> dict[str, str]:
    low = re.sub(r"\s+", " ", (text or "").lower())
    found = {}
    rules = [
        ("согласие", r"[^.]{0,160}(prior written consent|written approval|prior approval)[^.]{0,160}"),
        ("синхронизация", r"[^.]{0,120}synchroni[sz]ation[^.]{0,120}"),
        ("перезапись", r"[^.]{0,120}(re-?record)[^.]{0,120}"),
        ("имя и изображение", r"[^.]{0,120}(name and likeness|name, likeness|likeness)[^.]{0,120}"),
        ("производные", r"[^.]{0,120}(derivative works?|remix(es)?)[^.]{0,120}"),
        ("физические носители", r"[^.]{0,120}(physical (formats?|copies|products?)|vinyl|cd)[^.]{0,80}"),
        ("рекуп", r"[^.]{0,120}(recoup)[^.]{0,120}"),
    ]
    for name, pattern in rules:
        match = re.search(pattern, low)
        if match:
            found[name] = redact(match.group(0).strip()[:240])
    return found


def label_entity(text: str) -> str:
    head = (text or "")[:4000]
    if re.search(r"L\.?\s?L\.?\s?C\.?[-\s]?FZ", head, re.I):
        return "FZ"
    if re.search(r"Zero\s*to\s*Infinity,?\s*Inc", head, re.I):
        return "Inc"
    if re.search(r"Individual entrepreneur|ИП |индивидуальный предприниматель", head, re.I):
        return "ИП"
    return ""


def load_documents(erp):
    texts = {}
    with TEXTS.open(encoding="utf-8") as handle:
        for line in handle:
            row = json.loads(line)
            texts[row["sha256"]] = row.get("text") or ""
    index = json.load(DOCS.open(encoding="utf-8"))
    on_disk = {}
    for folder in PDF_DIRS:
        for path in folder.rglob("*"):
            if path.is_file() and path.suffix.lower() == ".pdf":
                on_disk[str(path)] = path
    indexed_paths = set()
    erp_by_file = defaultdict(list)
    for contract in erp["contracts"]:
        erp_by_file[file_key(contract["file"])].append(contract)
    docs = {}
    name_count = Counter((item.get("files") or [{}])[0].get("name") or "" for item in index)
    insiders = {frozenset(tokens(b["purchaser"])) for rows in erp["buyouts"].values() for b in rows if b["purchaser"]}
    insiders.add(frozenset(tokens("Zero to Infinity Inc")))
    for item in index:
        file_row = (item.get("files") or [{}])[0]
        name, path = file_row.get("name") or "", file_row.get("path") or ""
        ident = name if name_count[name] == 1 else str(Path(path).relative_to(CD))
        indexed_paths.add(path)
        disk = on_disk.get(path)
        actual = sha256_file(disk) if disk else ""
        text = texts.get(item.get("sha256") or "", "")
        kind, type_label, type_source = classify(text, item.get("kind") or "")
        assignor = re.search(r"BETWEEN:?\s*\(1\)\s*(.+?)(?:,| of |\(“|\(\")", text[:1500], re.S)
        if kind == "transfer" and assignor and re.search(r"\(2\)\s*Zero\s*to\s*Infinity\s*L\.?L\.?C", text[:2500]) \
                and frozenset(tokens(assignor.group(1))) in insiders:
            kind, type_label, type_source = "chain", "уступка на FZ по цепочке", \
                "заголовок PDF: цедент — покупатель из реестра выкупов или Inc., цессионарий — FZ"
        signed, signed_on, signed_source = signature_of(text)
        number, doc_date, nick = filename_bits(name)
        meta = item.get("meta") or {}
        term, term_source = term_of(text, meta.get("term") or "")
        aliases = set()
        alias_sources = defaultdict(set)

        def add(value, source):
            value_key = key(value)
            if len(value_key.replace(" ", "")) < 2 or value_key in GENERIC_ALIASES or value_key.isdigit():
                return
            aliases.add(value_key)
            alias_sources[value_key].add(source)

        for part in re.split(r"_|\s+-\s+", nick):
            add(part, "имя файла")
        if not nick:
            tail = re.sub(r"\.(pdf|docx)$", "", name, flags=re.I).rstrip("_ ").rsplit("_", 1)[-1]
            tail = re.sub(r"\s*\(\d+\)$", "", tail).strip()
            if tail and tail != name and len(tokens(tail)) <= 4 and re.search(r"[A-Za-zА-Яа-я]", tail):
                add(tail, "имя файла")
        for found in re.findall(r"Artist name:\s*[\'\"“‘]+([^\'\"”’\n]{2,40})", text[:3000], re.I):
            add(found, "псевдоним в тексте (Artist name)")
        party = item.get("party") or {}
        for value in (party.get("pseudonyms") or []):
            if spaced(value) in spaced(text) or key(value) in key(name):
                add(value, "псевдоним в тексте")
        if party.get("filename_pseudonym"):
            add(party["filename_pseudonym"], "имя файла")
        for contract in erp_by_file.get(file_key(name), []):
            for value in (contract["party"], contract["nick"]):
                for part in re.split(r"/|-", value or ""):
                    add(part, "реестр договоров erp.db")
        docs[ident] = {
            "id": ident, "file_name": name, "path": path, "sha": item.get("sha256") or "", "sha_ok": actual == item.get("sha256"),
            "index_kind": item.get("kind") or "", "kind": kind, "type": type_label, "type_source": type_source,
            "number": number, "date": doc_date, "nick": nick, "signed": signed, "signed_on": signed_on,
            "signed_source": signed_source, "term": term, "term_source": term_source,
            "territory": territory_of(text), "clauses": clauses_of(text), "entity": label_entity(text),
            "aliases": aliases, "alias_sources": alias_sources, "spaced": spaced(text), "text": text,
            "tracks": item.get("tracks") or [],
            "track_keys": {key(t.get("title")) for t in item.get("tracks") or [] if t.get("title")},
            "erp": [c["type"] or c["category"] for c in erp_by_file.get(file_key(name), [])],
            "pandadoc": erp["pandadoc"].get(file_key(name), []), "ghost": False,
        }
    LOGGER.check(len(docs) == len(index), f"документов в индексе {len(index)}, ключей {len(docs)}")
    LOGGER.check(all(d["sha_ok"] for d in docs.values()),
                 f"PDF: sha256 файла совпал с индексом у {sum(d['sha_ok'] for d in docs.values())} из {len(docs)}")
    missing = sorted(set(on_disk) - indexed_paths)
    LOGGER.check(not missing, f"PDF на диске без записи в индексе: {len(missing)}")
    LOGGER.check(all(d["text"] for d in docs.values()), "у каждого PDF есть текстовый слой")
    # Documents the erp.db register records outside PandaDoc whose file is not in the two folders.
    # They are listed so the register is complete, and they never count as naming a recording.
    on_disk_keys = {file_key(d["file_name"]) for d in docs.values()}
    ghost_kind = {"уступка прав": ("transfer", "уступка"), "договор рекординга": ("recording", "договор с артистом"),
                  "лицензия": ("sample", "лицензия на сэмпл"), "приложение": ("schedule", "приложение SCHEDULE"),
                  "мировое соглашение": ("settlement", "мировое соглашение"),
                  "выкуп (Duetti)": ("reference", "продажа записей Duetti")}
    ghosts = 0
    for contract in erp["contracts"]:
        if not contract["category"].startswith("вне_PandaDoc") or file_key(contract["file"]) in on_disk_keys:
            continue
        file_name = os.path.basename(contract["file"])
        if not file_name:
            continue
        ident = "реестр erp.db: " + file_name
        if ident in docs:
            continue
        kind, label = ghost_kind.get(contract["type"], ("reference", contract["type"] or "прочее"))
        aliases, sources = set(), defaultdict(set)
        for part in re.split(r"/", contract["nick"] or ""):
            if len(key(part).replace(" ", "")) >= 2:
                aliases.add(key(part))
                sources[key(part)].add("реестр договоров erp.db")
        number, doc_date, _ = filename_bits(file_name)
        found = re.search(r"(\d{2})\.(\d{2})\.(\d{4})", file_name)
        docs[ident] = {
            "id": ident, "file_name": file_name, "path": "нет в папках PDF; в архиве: " + contract["file"],
            "sha": "", "sha_ok": None, "index_kind": "", "kind": kind, "type": label,
            "type_source": "реестр договоров erp.db", "number": number or squash(contract["number"]),
            "date": doc_date or (iso(int(found.group(1)), int(found.group(2)), int(found.group(3))) if found else "")
            or contract["date"][:10],
            "nick": contract["nick"], "signed": "не проверено: файла нет", "signed_on": "",
            "signed_source": "файл не передан, статус не установлен", "term": "", "term_source": "",
            "territory": "", "clauses": {}, "entity": "FZ" if "L.L.C-FZ" in file_name else "",
            "aliases": aliases, "alias_sources": sources, "spaced": " ", "text": "", "tracks": [], "track_keys": set(),
            "erp": [contract["type"] or contract["category"]], "pandadoc": [], "ghost": True,
        }
        ghosts += 1
    LOGGER.info(f"OK    документов из реестра erp.db без файла в папках: {ghosts}")
    return docs


class DocIndex:
    def __init__(self, docs):
        self.docs = docs
        self.tokens = defaultdict(set)
        self.isrc = defaultdict(set)
        self.alias = defaultdict(set)
        for name, doc in docs.items():
            if doc["kind"] == "test":
                continue
            for token in set(doc["spaced"].split()):
                self.tokens[token].add(name)
            for match in ISRC_RE.finditer(doc["text"].upper()):
                self.isrc["".join(match.groups())].add(name)
            for alias in doc["aliases"]:
                self.alias[alias].add(name)
        self.cache = {}

    def phrase(self, value: str) -> set[str]:
        words = tokens(value)
        if not words or len("".join(words)) < 3:
            return set()
        joined = " " + " ".join(words) + " "
        if joined in self.cache:
            return self.cache[joined]
        rare = min(words, key=lambda word: len(self.tokens.get(word, ())))
        found = {name for name in self.tokens.get(rare, ()) if joined in self.docs[name]["spaced"]}
        self.cache[joined] = found
        return found

    def names_title(self, name: str, title: str) -> bool:
        """The title is a whole cell of the parsed track table, or it is only in the text.

        A title that the table holds only as the start of a longer title (a version or a sequel)
        is not named by this document.
        """
        doc = self.docs[name]
        cells = doc["track_keys"]
        wanted = key(title)
        if cells:
            # a parse may glue a row number or the party's name before the title, or the duration after it
            pattern = re.compile(r"(.* )?" + re.escape(wanted) + r"(?: \d{1,2} \d{2})?")
            for cell in cells:
                match = pattern.fullmatch(cell)
                if not match:
                    continue
                prefix = (match.group(1) or "").strip()
                if not prefix or prefix.replace(" ", "").isdigit() or any(
                        alias.replace(" ", "") in prefix.replace(" ", "") for alias in doc["aliases"]):
                    return True
            return False
        # no parsed table: the title must stand in a table or a list, not in prose
        words = [re.escape(part) for part in re.split(r"\s+", title.strip()) if part]
        if not words:
            return False
        for match in re.finditer(r"[\W_]*".join(words), doc["text"], re.I):
            after = doc["text"][match.end():match.end() + 100]
            before = doc["text"][max(0, match.start() - 40):match.start()]
            if TABLE_AFTER.search(after) or re.search(r"(^|\n)\s*\d{1,3}[.)]?\s*$", before):
                return True
        return False

    def snippet(self, name: str, value: str) -> str:
        text = self.docs[name]["text"]
        if not value:
            return ""
        pattern = r"[\s\W_]*".join(re.escape(part) for part in re.split(r"\s+", value.strip()) if part)
        matches = list(re.finditer(pattern, text, re.I)) if pattern else []
        if not matches:
            return ""
        match = next((m for m in matches if TABLE_AFTER.search(text[m.end():m.end() + 100])), matches[0])
        start, end = max(0, match.start() - 60), min(len(text), match.end() + 60)
        return redact(re.sub(r"\s+", " ", text[start:end]).strip())


# ---------------------------------------------------------------- reference workbooks

def load_annex():
    book = openpyxl.load_workbook(ANNEX, read_only=True, data_only=True)
    coverage = {}
    for row in list(book["Coverage by recording"].iter_rows(values_only=True))[2:]:
        code = norm_isrc(row[0])
        if code:
            coverage[code] = {"status": str(row[1] or ""), "establishes": str(row[8] or ""),
                              "without": str(row[9] or ""), "instrument": str(row[10] or ""),
                              "imprint": str(row[11] or "")}
    splits = {}
    for row in list(book["Splits by ISRC"].iter_rows(values_only=True))[2:]:
        code = norm_isrc(row[0])
        if code:
            splits[code] = {"registered": str(row[5] or ""), "outside": str(row[6] or ""),
                            "share": row[7], "period": str(row[8] or ""), "source": str(row[9] or "")}

    def monthly(sheet_name):
        rows = book[sheet_name].iter_rows(values_only=True)
        next(rows)
        header = list(next(rows))
        months = [(i, h) for i, h in enumerate(header) if isinstance(h, str) and re.fullmatch(r"\d{4}-\d{2}", h)]
        out, blocked = {}, defaultdict(set)
        for row in rows:
            code = norm_isrc(row[0]) if row and row[0] != "Total" else ""
            if not code:
                continue
            series = {}
            for i, month in months:
                value = row[i] if i < len(row) else None
                if isinstance(value, (int, float)):
                    series[month] = Decimal(str(value))
                elif isinstance(value, str) and value.strip().lower() == "no share":
                    blocked[code].add(month)
            out[code] = series
        return out, blocked, [m for _, m in months]

    receipts, _, months = monthly("Monthly receipts by ISRC")
    nls, blocked, _ = monthly("Monthly NLS by ISRC")
    book.close()
    return {"coverage": coverage, "splits": splits, "receipts": receipts, "nls": nls, "blocked": blocked,
            "months": months}


def annex_class(status: str) -> str:
    """Annex 14 status in the three classes of the party-level measure."""
    status = status or ""
    if status.startswith("covered"):
        return "covered"
    if status.startswith("partly covered") or status.startswith("co-author"):
        return "partly covered"
    return "not covered"


def load_main():
    book = openpyxl.load_workbook(MAIN, read_only=True, data_only=True)
    contracts = []
    for index, row in enumerate(book["Contracts"].iter_rows(values_only=True)):
        if index == 0 or not row or not row[2]:
            continue
        term = row[1].date().isoformat() if isinstance(row[1], datetime) else str(row[1] or "")
        share = Decimal(str(row[4])) * 100 if isinstance(row[4], (int, float)) else None
        contracts.append({"nick": str(row[2]).strip(), "term": term, "share": share})
    royalties = defaultdict(lambda: defaultdict(Decimal))
    for index, row in enumerate(book["INCOME  EXPENSE"].iter_rows(values_only=True)):
        if index == 0 or not row or len(row) < 7:
            continue
        if row[4] != "Income" or row[5] != "Royalties" or not isinstance(row[6], (int, float)):
            continue
        period = row[1] if isinstance(row[1], datetime) else row[2] if isinstance(row[2], datetime) else None
        if period is None or not row[3]:
            continue
        royalties[key(row[3])][period.strftime("%Y-%m")] += Decimal(str(row[6]))
    names = {}
    for index, row in enumerate(book["INCOME  EXPENSE"].iter_rows(values_only=True)):
        if index and row and row[3]:
            names.setdefault(key(row[3]), str(row[3]).strip())
    book.close()
    return {"contracts": contracts, "royalties": royalties, "names": names}


# ---------------------------------------------------------------- money

def allocate(exact: dict[str, Decimal]) -> dict[str, Decimal]:
    """Round each month to cents; the residue goes to the last month so the row sums to its rounded total."""
    if not exact:
        return {}
    keys = sorted(exact)
    rounded = {month: q2(exact[month]) for month in keys}
    rounded[keys[-1]] += q2(sum(exact.values(), Decimal(0))) - sum(rounded.values(), Decimal(0))
    return rounded


def rate_schedule(split, buyouts, months):
    """Label and participant rates per month: the final split, then buyouts from their effective month."""
    if not split or split["label"] is None or split["rates"] is None:
        return None, []
    events, problems = [], []
    for buyout in buyouts:
        effective = text_date(buyout["effective"])[:7]
        seller = key(buyout["seller"])
        index = next((i for i, name in enumerate(split["names"]) if key(name) == seller), None)
        if index is None:
            problems.append(f"продавец {buyout['seller'] or '—'} по выкупу {buyout['contract'] or buyout['id']} "
                            f"не участник финального сплита")
            continue
        events.append((effective or "0000-00", index, buyout))
    schedule = {}
    for month in months:
        rates = list(split["rates"])
        label = split["label"]
        applied = []
        for effective, index, buyout in sorted(events, key=lambda e: (e[0], e[2]["id"])):
            if effective > month:
                continue
            pct = buyout["pct"]
            take = rates[index] if pct is None or pct >= 100 or pct >= rates[index] else pct
            rates[index] -= take
            label += take
            applied.append(buyout)
        schedule[month] = (label, rates, tuple(b["id"] for b in applied))
    return schedule, problems


# ---------------------------------------------------------------- build

def build():
    env = load_env()
    LOGGER.info(f"Сборка {VERSION}, {BUILD_DATE}")
    files, raw_report, registry_totals = load_registry(env)
    catalog, upcs, net, no_isrc, ch_totals = load_clickhouse(env, files)
    for account, (lines, amount) in sorted(ch_totals.items()):
        LOGGER.check(abs(amount - registry_totals[account]) < Decimal("0.01"),
                     f"ClickHouse {account}: {lines} строк, net {q2(amount)}; реестр файлов {q2(registry_totals[account])}")
    splits, split_stats, split_conflicts = load_splits()
    erp = load_erp()
    zero_tracks, zero_files, zero_releases = load_zero()
    zero_dates = {}
    for release in zero_releases.values():
        if release.get("upc") and release.get("d"):
            zero_dates.setdefault(str(release["upc"]), release["d"][:10])
    docs = load_documents(erp)
    index = DocIndex(docs)
    annex = load_annex()
    main = load_main()
    LOGGER.info(f"ISRC в Believe {len(catalog)}, в сплите {len(splits)}, в каталоге Zero {len(zero_tracks)}, "
                f"документов {len(docs)}, Annex 14 {len(annex['coverage'])}")

    report_months = sorted({m for series in net["main"].values() for m in series}
                           | {m for series in net["echo"].values() for m in series})
    first_month, last_month = report_months[0], report_months[-1]
    all_months = months_between(first_month, last_month)
    duetti = set(erp["duetti"])

    codes = sorted(set(catalog) | set(splits) | set(zero_tracks))
    rows, links, royalty, gaps = [], [], [], defaultdict(list)
    revenue, label_money, artist_money = {}, {}, {}
    doc_links = defaultdict(set)
    party_ids = {p["id"] for p in erp["party"].values()}
    house_names = {key(p["name"]) for p in erp["party"].values() if p["house"]} | {"0to8"}
    duetti_parties = {alias for d in docs.values() if d["type"] == "продажа записей Duetti" for alias in d["aliases"]}

    for code in codes:
        ch = catalog.get(code)
        split = splits.get(code)
        zero = zero_tracks.get(code)
        title = (ch or {}).get("track") or (split or {}).get("track") or (zero or {}).get("title") or ""
        if zero and zero.get("version") and key(zero["version"]) not in key(title):
            title = f"{title} ({zero['version']})"
        titles = list(dict.fromkeys([t for t in ((ch or {}).get("tracks") or []) + [title] if t]))
        artist_line = (ch or {}).get("artist") or ""
        credits = []
        for value in ((ch or {}).get("artists") or []) + [artist_line]:
            for name in credit_names(value):
                if key(name) not in {key(c) for c in credits}:
                    credits.append(name)
        participants = list(split["names"]) if split and split["names"] else []
        for name in participants:
            if key(name) not in {key(c) for c in credits}:
                credits.append(name)
        product_upcs = sorted(upcs.get(code, set()) | ({split["upc"]} if split and split["upc"] else set())
                              | ({zero["upc"]} if zero and zero.get("upc") else set()))
        types = (ch or {}).get("types") or []
        product = "; ".join(sorted({"music video" if "video" in t.lower() else "ringtone" if "ringtone" in t.lower()
                                    else "audio" for t in types})) if types else ("audio" if split or zero else "")
        # first release date
        first, first_source = "", ""
        if zero and zero.get("release_date"):
            first, first_source = zero["release_date"][:10], "каталог Zero, дата релиза"
        elif code in erp["track_dates"]:
            first, first_source = erp["track_dates"][code], "erp.db track_meta, дата релиза"
        else:
            dates = sorted(erp["release_dates"][u] for u in product_upcs if u in erp["release_dates"])
            if dates:
                first, first_source = dates[0], "erp.db deal, дата релиза по UPC"
            elif any(u in zero_dates for u in product_upcs):
                first = min(zero_dates[u] for u in product_upcs if u in zero_dates)
                first_source = "отгрузка Zero, дата релиза по UPC"
            elif ch:
                first, first_source = ch["first_sale"][:10], "первый месяц продаж в отчётах Believe"
        in_main = bool(ch and ch["in_main"])
        in_echo = bool(ch and ch["in_echo"])
        echo_imprint = in_main and all(name == "Echo8" for name in ch["main_imprints"])
        if in_main and not echo_imprint:
            status, reason = "в периметре", ""
        elif echo_imprint:
            status, reason = "вне периметра", "Echo8: в аккаунте 1052428 все строки под импринтом Echo8"
        elif in_echo:
            status, reason = "вне периметра", "Echo8"
        else:
            status, reason = "вне периметра", "иное: нет строк в отчётах Believe по " + last_month
        if code in duetti:
            status, reason = "вне периметра", "Duetti"
        excluded_by = [x for x, cond in (("аккаунт Echo8 1055956", in_echo), ("Duetti", code in duetti)) if cond]
        if status == "в периметре" and excluded_by:
            gaps["9"].append([code, title, "; ".join(excluded_by)])

        # ---- documents, per participant
        by_isrc = index.isrc.get(code, set())
        named = {d for t in titles for d in index.phrase(t) if index.names_title(d, t)}
        bases = [b for b in (base_title(t) for t in titles) if b]
        based = {d for b in bases for d in index.phrase(b) if index.names_title(d, b)} - named
        releases = [r for r in ((ch or {}).get("releases") or []) + ([split["release"]] if split else []) if r]
        released = {d for r in releases if key(r) not in {key(t) for t in titles}
                    for d in index.phrase(r) if index.names_title(d, r)} - named - based
        pools = [(LEVELS[0], by_isrc), (LEVELS[1], named), (LEVELS[2], based), (LEVELS[3], released)]
        evidence_value = {LEVELS[0]: code, LEVELS[1]: titles[0] if titles else "", LEVELS[2]: bases[0] if bases else "",
                          LEVELS[3]: releases[0] if releases else ""}
        people = participants or credits
        buyout_rows = erp["buyouts"].get(code, [])
        part_results = []
        recording_docs = set()
        for name in people:
            alias = key(name)
            if alias in house_names:
                part_results.append((name, "доля самого лейбла, договор с участником не нужен", [], True, []))
                continue
            own = {d for d in index.alias.get(alias, set()) if docs[d]["kind"] in RIGHTS - {"chain"}}
            for buyout in buyout_rows:
                if key(buyout["seller"]) == alias and buyout["contract"]:
                    number = squash(buyout["contract"])[:12]
                    own |= {d for d in docs if docs[d]["kind"] in RIGHTS - {"chain"} and number and number in squash(d)}
            mention = index.phrase(name) if len(alias.replace(" ", "")) >= 3 else set()
            # a document that transfers named works covers every participant it names next to the work
            transfers = {d for d in mention if docs[d]["kind"] in TRANSFER_KINDS}
            level, used = "", []
            for label, pool in pools:
                hit = (own | transfers) & pool
                if hit:
                    level, used = label, sorted(hit)
                    break
            if not level:
                for label, pool in pools[:2]:
                    hit = (pool & mention) - own
                    hit = {d for d in hit if docs[d]["kind"] in RIGHTS}
                    if hit:
                        level, used = "назван соавтором в чужом договоре", sorted(hit)
                        break
            artist_only = sorted(own) if level not in LEVELS else []
            if not level and own:
                level, used = "только по артисту", sorted(own)
            part_results.append((name, level, used, bool(own), artist_only))
            for doc_name in list(dict.fromkeys(used + artist_only)):
                found = level if doc_name in used else "только по артисту"
                if found in LEVELS:
                    recording_docs.add(doc_name)
                if docs[doc_name]["ghost"]:
                    evidence = "договор есть только в реестре erp.db, файла в папках нет"
                elif found == "только по артисту":
                    evidence = "в тексте не названы ни ISRC, ни запись, ни релиз"
                else:
                    evidence = index.snippet(doc_name, evidence_value.get(found, "") if found in LEVELS else name)
                links.append([code, title, name, doc_name, found, docs[doc_name]["type"], docs[doc_name]["signed"],
                              evidence, ", ".join(sorted(docs[doc_name]["alias_sources"].get(alias, [])))
                              or "участник назван в тексте документа"])
            if not used:
                links.append([code, title, name, "", "не идентифицирована", "", "", "", ""])
        # assignments to FZ along the chain prove where the right ended up, not that a participant granted it
        chain_docs = sorted(d for d in by_isrc | named if docs[d]["kind"] == "chain")
        recording_docs -= set(chain_docs)
        for doc_name in chain_docs:
            links.append([code, title, "цепочка на FZ", doc_name, LEVELS[0] if doc_name in by_isrc else LEVELS[1],
                          docs[doc_name]["type"], docs[doc_name]["signed"],
                          index.snippet(doc_name, code if doc_name in by_isrc else title), ""])
        # documents that name the ISRC and belong to nobody on the split (catalog purchases, sublabels)
        for doc_name in sorted(by_isrc - recording_docs - set(chain_docs)):
            if docs[doc_name]["kind"] in RIGHTS:
                recording_docs.add(doc_name)
                links.append([code, title, "не участник сплита", doc_name, LEVELS[0], docs[doc_name]["type"],
                              docs[doc_name]["signed"], index.snippet(doc_name, code) or code, ""])
        for doc_name in recording_docs | set(chain_docs):
            doc_links[doc_name].add(code)
        named_levels = [lvl for _, lvl, _, _, _ in part_results if lvl in LEVELS or lvl.startswith("доля самого")]
        party_ok = [lvl in LEVELS or has_own for _, lvl, _, has_own, _ in part_results]
        if people and party_ok and all(party_ok):
            party_coverage = "covered"
        elif any(party_ok):
            party_coverage = "partly covered"
        else:
            party_coverage = "covered" if recording_docs else "not covered"
        if people and all(lvl.startswith("доля самого") for _, lvl, _, _, _ in part_results):
            coverage = "собственная запись лейбла: договор с участником не нужен"
        elif people and len(named_levels) == len(people):
            coverage = "covered"
        elif named_levels:
            coverage = "partly covered"
        elif recording_docs:
            coverage = "covered: документ называет ISRC, сторона не участник сплита"
        elif any(lvl == "только по артисту" for _, lvl, _, _, _ in part_results):
            coverage = "только договор с артистом, запись не названа"
        elif any(lvl == "назван соавтором в чужом договоре" for _, lvl, _, _, _ in part_results):
            coverage = "co-author named in another party's agreement, none of its own"
        else:
            coverage = "not covered"
        how_order = LEVELS + ["только по артисту"]
        found_levels = [lvl for _, lvl, _, _, _ in part_results if lvl in how_order]
        if recording_docs and LEVELS[0] not in found_levels and by_isrc & recording_docs:
            found_levels.append(LEVELS[0])
        best = min(found_levels, key=how_order.index) if found_levels else ""
        how = {LEVELS[0]: "ISRC назван", LEVELS[1]: "назван трек", LEVELS[2]: "назван трек",
               LEVELS[3]: "назван релиз", "только по артисту": "только по артисту"}.get(best, "не идентифицирована")

        # ---- legal columns from the documents that name the recording
        categories, terms, territories, chain, scope = [], [], [], [], []
        for doc_name in sorted(recording_docs, key=lambda d: (docs[d]["signed_on"] or docs[d]["date"] or "9999", d)):
            doc = docs[doc_name]
            if doc["kind"] in {"purchase", "transfer", "work_for_hire"}:
                category = OWN
            elif doc["kind"] in {"sample", "contributor"}:
                category = SUPPORT
            elif doc["term"] == "на срок охраны":
                category = LIFE
            elif doc["term"]:
                category = FIXED
            else:
                category = ""
            if category and category not in categories:
                categories.append(category)
            if doc["kind"] not in {"purchase", "transfer", "work_for_hire"}:
                if doc["term"]:
                    terms.append(f"{doc['term']} ({doc_name})")
                if doc["territory"]:
                    territories.append(f"{doc['territory']} ({doc_name})")
            for clause in ("синхронизация", "физические носители", "производные"):
                if clause in doc["clauses"] and clause not in scope:
                    scope.append(clause)
            entity = doc["entity"] or "сторона лейбла не распознана"
            chain.append(f"{doc['type']} {doc_name} → {entity}, {doc['signed_on'] or 'дата подписи не найдена'}")
        for doc_name in chain_docs:
            doc = docs[doc_name]
            chain.append(f"{doc['type']} {doc_name}, {doc['signed_on'] or 'дата подписи не найдена'}")
        for buyout in buyout_rows:
            step = f"выкуп {buyout['contract'] or buyout['id']} у {buyout['seller'] or '—'} → {buyout['purchaser']}, " \
                   f"{text_date(buyout['effective']) or buyout['effective']}"
            if buyout["assigned"]:
                step += f" → FZ: {buyout['assigned']}"
            elif "fz" not in key(buyout["purchaser"]):
                step += " → FZ: уступка в реестре выкупов не указана"
            chain.append(step)
        own_share = ""
        own_source = ""
        if split and split["label"] is not None:
            own_share = float(split["label"])
            own_source = ("финальный сплит 0to8_Splits_20260814, sum_rates: доля net, которая остаётся лейблу после "
                          "ставок участников; это не процент владения фонограммой")
            if buyout_rows:
                own_source += "; с месяца выкупа растёт на выкупленную долю (лист «Роялти»)"
        if categories and not territories and any(c != OWN for c in categories):
            gaps["4"].append([code, title, "; ".join(categories), "; ".join(terms), ""])
        elif any(c in (FIXED, LIFE, SUPPORT) for c in categories) and not terms:
            gaps["4"].append([code, title, "; ".join(categories), "", "; ".join(territories)])

        # ---- money
        main_exact = net["main"].get(code, {})
        echo_exact = net["echo"].get(code, {})
        combined = defaultdict(Decimal)
        for series in (main_exact, echo_exact):
            for month, value in series.items():
                combined[month] += value
        revenue[code] = allocate(dict(combined))
        main_rounded = allocate(main_exact)
        schedule, buyout_problems = rate_schedule(split, buyout_rows, sorted(main_exact))
        for problem in buyout_problems:
            gaps["выкуп"].append([code, title, problem])
        label_series, artist_series = {}, {}
        if schedule and status == "в периметре":
            # the label share of each month is taken from that month's rounded receipt, so a 100% month
            # leaves no cent to a participant whose rate a buyout has taken to zero
            label_series = {m: q2(main_rounded[m] * schedule[m][0] / 100) for m in main_exact}
            for month in label_series:
                artist_series[month] = main_rounded[month] - label_series[month]
            # royalty rows: one per participant per period of constant rate
            runs = []
            for month in sorted(main_exact):
                state = schedule[month]
                if runs and runs[-1]["state"] == state:
                    runs[-1]["months"].append(month)
                else:
                    runs.append({"state": state, "months": [month]})
            ids = split["ids"] or [""] * len(split["names"])
            for run in runs:
                label_rate, rates, applied = run["state"]
                period = f"{run['months'][0]} — {run['months'][-1]}"
                artist_total = sum((artist_series[m] for m in run["months"]), Decimal(0))
                weights = [r for r in rates]
                amounts = []
                if sum(weights, Decimal(0)) > 0:
                    for weight in weights[:-1]:
                        amounts.append(q2(artist_total * weight / sum(weights, Decimal(0))))
                    amounts.append(artist_total - sum(amounts, Decimal(0)))
                else:
                    amounts = [Decimal(0)] * len(weights)
                for name, rate, cid, amount in zip(split["names"], rates, ids, amounts):
                    party = erp["by_cid"].get(cid) or next(iter(erp["by_name"].get(key(name), [])), None)
                    docs_for = [d for n, lvl, used, _, _ in part_results if n == name for d in used]
                    royalty.append({
                        "name": name, "party": party["id"] if party else "", "isrc": code,
                        "docs": "; ".join(docs_for), "base": "net Believe, аккаунт 1052428, отчётный месяц",
                        "rate": rate, "amount": amount, "period": period, "obligation": "лейбл",
                        "in_split": "да" if rate == split["rates"][split["names"].index(name)] else
                        "нет: ставка уменьшена выкупом",
                        "source": "финальный сплит 0to8_Splits_20260814" + (
                            "; реестр выкупов erp.db" if applied else ""),
                    })
                royalty.append({
                    "name": "0to8", "party": next((p["id"] for p in erp["party"].values() if p["house"]), ""),
                    "isrc": code, "docs": "; ".join(sorted(recording_docs)), "base": "net Believe, аккаунт 1052428, отчётный месяц",
                    "rate": label_rate, "amount": sum((label_series[m] for m in run["months"]), Decimal(0)),
                    "period": period, "obligation": "лейбл",
                    "in_split": "да" if label_rate == split["label"] else "нет: доля выросла по выкупу",
                    "source": "финальный сплит, sum_rates" + ("; реестр выкупов erp.db" if applied else ""),
                })
        elif status == "в периметре" and main_exact:
            gaps["3"].append([code, title, artist_line, money(sum(main_rounded.values(), Decimal(0)))])
        label_money[code] = label_series
        artist_money[code] = artist_series
        # participations in a document but not in the split
        if split and split["names"] is not None:
            on_split = {key(n).replace(" ", "") for n in split["names"]} | {h.replace(" ", "") for h in house_names}
            reported = set()
            for doc_name in sorted(recording_docs):
                for track in docs[doc_name]["tracks"]:
                    if key(track.get("title")) not in {key(t) for t in titles}:
                        continue
                    for coauthor in track.get("co_authors") or []:
                        for person in credit_names(coauthor):
                            person_key = key(person).replace(" ", "")
                            if len(person_key) >= 3 and person_key not in on_split and person_key not in reported:
                                reported.add(person_key)
                                known = next(iter(erp["by_name"].get(key(person), [])), None)
                                royalty.append({
                                    "name": person, "party": known["id"] if known else "", "isrc": code, "docs": doc_name,
                                    "base": "по договору, четыре канала роялти в schedule", "rate": None,
                                    "amount": None, "period": "", "obligation": "лейбл", "in_split": "нет",
                                    "source": "соавтор в таблице schedule этого договора",
                                })
                                gaps["участие вне сплита"].append([code, title, person, doc_name])
                    digital = track.get("royalty_digital_percent")
                    if digital is not None and split["rates"] is not None:
                        figure = Decimal(str(digital))
                        party = key(docs[doc_name]["nick"])
                        index_on_split = next((i for i, n in enumerate(split["names"]) if key(n) == party), None)
                        # a third written as 16.6, 16.67 or 17 is the same rate
                        if index_on_split is not None and abs(split["rates"][index_on_split] - figure) > Decimal("0.5"):
                            gaps["2"].append([code, title, split["names"][index_on_split], doc_name, float(figure),
                                              float(split["rates"][index_on_split])])
        if split and split["rates"] is not None and sum(split["rates"], Decimal(0)) > 100:
            gaps["8"].append([code, title, "; ".join(split["names"]), float(sum(split["rates"], Decimal(0)))])

        receipts = sum(revenue[code].values(), Decimal(0)) if revenue[code] else None
        in_scope = sum(main_rounded.values(), Decimal(0)) if main_rounded else None
        label_total = sum(label_series.values(), Decimal(0)) if label_series else None
        artist_total = sum(artist_series.values(), Decimal(0)) if artist_series else None
        if label_total is not None and in_scope is not None and label_total + artist_total != in_scope:
            LOGGER.check(False, f"{code}: доля лейбла и участников не равна поступлениям")

        # ---- comparison with Annex 14
        reference = annex["coverage"].get(code)
        annex_receipts = sum(annex["receipts"].get(code, {}).values(), Decimal(0)) if code in annex["receipts"] else None
        annex_nls = sum(annex["nls"].get(code, {}).values(), Decimal(0)) if code in annex["nls"] else None
        window = [m for m in annex["months"]]
        ours_window = sum((main_rounded.get(m, Decimal(0)) for m in window), Decimal(0))
        ours_label_window = sum((label_series.get(m, Decimal(0)) for m in window), Decimal(0))
        verdict = ""
        if reference:
            theirs = annex_class(reference["status"])
            agree = theirs == party_coverage
            verdict = "совпало" if agree else \
                f"расхождение: Annex «{reference['status']}», здесь по сторонам «{party_coverage}»"
            if not agree:
                gaps["annex"].append([code, title, "; ".join(people), reference["status"], party_coverage, coverage,
                                      reference["establishes"][:500], "; ".join(sorted(recording_docs))[:500],
                                      money(ours_window)])
            if annex_receipts is not None and abs(annex_receipts - ours_window) >= GAP_LIMIT:
                gaps["annex деньги"].append([code, title, money(annex_receipts), money(ours_window),
                                             money(ours_window - annex_receipts), "поступления"])
            if annex_nls is not None and label_series and abs(annex_nls - ours_label_window) >= GAP_LIMIT:
                gaps["annex деньги"].append([code, title, money(annex_nls), money(ours_label_window),
                                             money(ours_label_window - annex_nls), "доля лейбла"])
        elif status == "в периметре" and any(m in window for m in main_exact):
            verdict = "нет в Annex 14"
            sold = sorted({c for c in credits if key(c) in duetti_parties})
            gaps["нет в annex"].append([code, title, "; ".join(credits), money(ours_window),
                                        ("да: " + ", ".join(sold)) if sold else ""])
        if status == "в периметре" and not recording_docs:
            gaps["1"].append([code, "; ".join(credits), title, money(in_scope), coverage])

        rows.append({
            "isrc": code, "title": title, "credits": "; ".join(credits), "upc": "; ".join(product_upcs),
            "product": product, "first": first, "first_source": first_source, "status": status, "reason": reason,
            "imprint": "; ".join(sorted((ch or {}).get("imprints") or [])),
            "in_believe": "да" if ch else "нет",
            "category": "; ".join(categories), "own": own_share, "own_source": own_source,
            "term": "; ".join(dict.fromkeys(terms)) or ("не применимо" if categories == [OWN] else ""),
            "territory": "; ".join(dict.fromkeys(territories)) or ("не применимо" if categories == [OWN] else ""),
            "scope": "; ".join(scope), "docs": "; ".join(sorted(recording_docs)), "how": how,
            "chain_docs": chain_docs,
            "participants": "; ".join(f"{n} {float(r):g}%" for n, r in zip(split["names"], split["rates"]))
            if split and split["rates"] else "; ".join(split["names"]) if split else "",
            "per_party": "; ".join(f"{n}: {lvl or 'нет документа'}" for n, lvl, _, _, _ in part_results),
            "artist_docs": "; ".join(sorted({d for _, _, _, _, extra in part_results for d in extra})),
            "coverage": coverage, "party_coverage": party_coverage, "chain": "; ".join(chain), "receipts": receipts, "in_scope": in_scope,
            "label": label_total, "artist": artist_total, "annex": verdict,
            "annex_receipts": annex_receipts, "annex_nls": annex_nls,
        })

    # ---- documents: replaced editions and amendments
    replaced, related = {}, defaultdict(set)
    by_number = defaultdict(list)
    for name, doc in docs.items():
        if doc["number"]:
            by_number[doc["number"].lower()].append(name)
    for number, names in by_number.items():
        for name in names:
            related[name] |= set(names) - {name}
    groups = defaultdict(list)
    for name, doc in docs.items():
        if doc["kind"] in {"recording", "schedule"} and doc_links.get(name):
            for alias in doc["aliases"]:
                groups[(alias, doc["kind"])].append(name)
    ambiguous = []
    seen_pairs = set()
    for (alias, kind), names in sorted(groups.items()):
        for a in names:
            for b in names:
                if a >= b or (a, b) in seen_pairs:
                    continue
                overlap = doc_links[a] & doc_links[b]
                if not overlap:
                    continue
                seen_pairs.add((a, b))
                date_a = docs[a]["signed_on"] or ""
                date_b = docs[b]["signed_on"] or ""
                if date_a and date_b and date_a != date_b:
                    old, new = (a, b) if date_a < date_b else (b, a)
                    replaced.setdefault(old, set()).add(new)
                else:
                    ambiguous.append([alias, a, b, len(overlap), date_a or "не подписан", date_b or "не подписан"])
    gaps["10"] = ambiguous

    # ---- checks before writing
    sheet_codes = [row["isrc"] for row in rows]
    LOGGER.check(len(sheet_codes) == len(set(sheet_codes)), "каждый ISRC встречается на листе «Записи» один раз")
    LOGGER.check(set(catalog) <= set(sheet_codes), f"все {len(catalog)} ISRC из отчётов Believe есть на листе")
    total_rows = sum((r["receipts"] or Decimal(0) for r in rows), Decimal(0))
    total_cells = sum((sum(s.values(), Decimal(0)) for s in revenue.values()), Decimal(0))
    LOGGER.check(total_rows == total_cells, f"поступления: строки {total_rows} = помесячные ячейки {total_cells}")
    ch_isrc_total = sum((sum(s.values(), Decimal(0)) for part in net.values() for s in part.values()), Decimal(0))
    no_isrc_total = sum((item["net"] for item in no_isrc), Decimal(0))
    believe_total = sum((amount for _, amount in ch_totals.values()), Decimal(0))
    LOGGER.check(abs(ch_isrc_total + no_isrc_total - believe_total) < Decimal("0.000001"),
                 f"строки с ISRC {q2(ch_isrc_total)} + без ISRC {q2(no_isrc_total)} = все строки Believe {q2(believe_total)}")
    LOGGER.check(abs(total_rows - q2(ch_isrc_total)) <= Decimal("0.01") * len(revenue),
                 f"сумма ISRC после округления {total_rows}, точная {q2(ch_isrc_total)}")
    label_rows = sum((r["label"] or Decimal(0) for r in rows), Decimal(0))
    label_cells = sum((sum(s.values(), Decimal(0)) for s in label_money.values()), Decimal(0))
    LOGGER.check(label_rows == label_cells, f"доля лейбла: строки {label_rows} = помесячные ячейки {label_cells}")
    paid = defaultdict(Decimal)
    for item in royalty:
        if item["amount"] is not None:
            paid[item["isrc"]] += item["amount"]
    broken = [r["isrc"] for r in rows if r["label"] is not None and paid[r["isrc"]] != r["in_scope"]]
    for code in broken[:5]:
        r = next(r for r in rows if r["isrc"] == code)
        LOGGER.info(f"  {code}: роялти {paid[code]}, в периметре {r['in_scope']}, лейбл {r['label']}, участники {r['artist']}, "
                    f"сплит {splits[code]['label']} {splits[code]['names']} {splits[code]['rates']}")
    LOGGER.check(not broken, f"лист «Роялти» по каждому ISRC сходится с поступлениями в периметре (расхождений {len(broken)})")
    unresolved = sorted({str(item["name"]) for item in royalty
                         if item["amount"] is not None and item["party"] not in party_ids})
    LOGGER.info(("ПРОБЕЛ " if unresolved else "OK    ") +
                f"получатели с суммой без party_id в erp.db: {len(unresolved)} (список на листе «Сводка»)")
    contract_ids = set(docs)
    LOGGER.check(all(d in contract_ids for r in rows for d in r["docs"].split("; ") if d),
                 "каждая ссылка на договор на листе «Записи» есть на листе «Договоры»")
    dated = sum(bool(r["first"]) for r in rows)
    LOGGER.check(all(r["first"] for r in rows if r["in_believe"] == "да"),
                 "дата первого релиза заполнена у каждой записи из отчётов Believe")
    LOGGER.info(("ПРОБЕЛ " if dated < len(rows) else "OK    ") +
                f"дата первого релиза заполнена у {dated} из {len(rows)}; без даты — только записи вне Believe, пробел 7")
    LOGGER.info(("ПРОБЕЛ " if gaps["4"] else "OK    ") + f"лицензионные интересы без срока или территории: {len(gaps['4'])}")
    if LOGGER.failures:
        LOG.write_text("\n".join(LOGGER.lines) + "\n")
        raise SystemExit(f"сборка остановлена: {len(LOGGER.failures)} проверок не прошли")

    write_book(rows, docs, doc_links, related, replaced, royalty, links, gaps, revenue, label_money, artist_money,
               all_months, no_isrc, raw_report, split_stats, split_conflicts, unresolved, annex, main, splits,
               zero_files, zero_releases, ch_totals, first_month, last_month)
    LOG.write_text("\n".join(LOGGER.lines) + "\n")


# ---------------------------------------------------------------- writing

def write_book(rows, docs, doc_links, related, replaced, royalty, links, gaps, revenue, label_money, artist_money,
               months, no_isrc, raw_report, split_stats, split_conflicts, unresolved, annex, main, splits,
               zero_files, zero_releases, ch_totals, first_month, last_month):
    status = (
        f"Сборка {VERSION}, {BUILD_DATE}, скрипт build-catalog-registries-v4.py. "
        f"Каталог и деньги: ClickHouse believe.rows, только загруженные файлы, аккаунты {MAIN_ACCOUNT} (believe/raw) и "
        f"{ECHO_ACCOUNT} (believe_echo8), отчётные месяцы {first_month}…{last_month}. Ставки: финальный сплит "
        f"0to8_Splits_20260814.xlsx и реестр выкупов erp.db с месяца выкупа. Договоры: 1146 PDF двух папок, sha256 "
        f"сверен с индексом; каждая привязка проверена по тексту PDF (лист «Проверка привязок»). Annex 14 и "
        f"0to8 Main.xlsx только для сверки. Степень проверки: автоматическая, ручная проверка не проводилась. "
        f"Пустая ячейка значит, что в этих источниках факта нет."
    )
    book = Workbook(write_only=True)
    book.properties.creator = f"build-catalog-registries-{VERSION}"
    book.properties.created = datetime(*STAMP)
    book.properties.modified = datetime(*STAMP)

    def sheet(name, header, note=""):
        item = CleanSheet(book.create_sheet(name))
        item.append([status + (" " + note if note else "")])
        item.append(header)
        return item

    out = sheet("Записи", [
        "ISRC", "Запись и версия", "Артисты и кредиты", "UPC", "Тип продукта", "Дата первого релиза",
        "Источник даты релиза", "Статус", "Основание исключения", "Импринт в отчёте Believe", "Есть в отчётах Believe",
        "Категория прав", "Наша доля, %", "Источник доли", "Срок", "Территория", "Объём разрешённого использования",
        "Договоры-основания", "Как запись идентифицирована в документе", "Документ по каждому участнику",
        "Договоры участников, где запись не названа", "Покрытие: запись названа в договоре",
        "Покрытие по сторонам: у каждого участника есть свой договор", "Участники сплита и ставки, %",
        "Чем право закреплено за FZ", "Поступления за период, $", "Поступления в периметре, $",
        "Доля лейбла за период, $", "Причитается участникам, $", "Сверка покрытия с Annex 14",
        "Поступления по Annex 14, $", "Доля лейбла по Annex 14, $",
    ])
    for r in rows:
        out.append([r["isrc"], r["title"], r["credits"], r["upc"], r["product"], r["first"], r["first_source"],
                    r["status"], r["reason"], r["imprint"], r["in_believe"], r["category"], r["own"], r["own_source"],
                    r["term"], r["territory"], r["scope"], r["docs"], r["how"], r["per_party"], r["artist_docs"],
                    r["coverage"], r["party_coverage"], r["participants"], r["chain"], money(r["receipts"]), money(r["in_scope"]),
                    money(r["label"]), money(r["artist"]), r["annex"], money(r["annex_receipts"]),
                    money(r["annex_nls"])])

    out = sheet("Договоры", [
        "Идентификатор", "Тип", "Источник типа", "Вид в индексе", "Тип в реестре erp.db", "Стороны",
        "Сторона лейбла в тексте", "Дата документа", "Дата подписания", "Статус подписания",
        "Основание статуса подписания", "Статус в PandaDoc (снимок 13.10, erp.db)", "Какие права предоставлены", "Доля, %", "Срок", "Источник срока",
        "Территория", "Существенные ограничения", "Механизм передачи", "Требуемые согласия",
        "Распределение обязательств", "Изменения и приложения", "Заменён документом", "Записей покрывает",
        "sha256 сверен", "Файл",
    ])
    for name in sorted(docs):
        doc = docs[name]
        mechanism = {"transfer": "уступка целиком", "purchase": "уступка целиком", "partial_purchase": "уступка части",
                     "work_for_hire": "уступка целиком", "contributor": "сублицензия", "sample": "сублицензия"}.get(
            doc["kind"], "только для справки" if doc["kind"] not in RIGHTS else "не применимо")
        granted = {"recording": "исключительная лицензия на запись и распространение",
                   "schedule": "перечень записей к договору", "transfer": "исключительные права на записи",
                   "purchase": "исключительные права на записи", "partial_purchase": "часть прав на записи",
                   "contributor": "разрешение на производную запись", "sample": "разрешение на использование сэмпла",
                   "work_for_hire": "результат работ по найму", "sublabel": "саблейбл: доля от выручки каталога",
                   "publishing": "издательские права"}.get(doc["kind"], "")
        rates = [t.get("royalty_digital_percent") for t in doc["tracks"] if t.get("royalty_digital_percent") is not None]
        share = Counter(rates).most_common(1)[0][0] if rates else None
        restrictions = "; ".join(f"{k}: «{v}»" for k, v in doc["clauses"].items() if k != "согласие")
        consent = doc["clauses"].get("согласие", "")
        out.append([
            name, doc["type"], doc["type_source"], doc["index_kind"], "; ".join(sorted(set(doc["erp"]))),
            "; ".join(sorted(doc["aliases"])), doc["entity"], doc["date"], doc["signed_on"], doc["signed"],
            doc["signed_source"], "; ".join(sorted({f"{st} {dt}".strip() for st, dt in doc["pandadoc"]})),
            granted, share, doc["term"], doc["term_source"], doc["territory"], restrictions,
            mechanism, f"«{consent}»" if consent else "", "", "; ".join(sorted(related.get(name, ()))),
            "; ".join(sorted(replaced.get(name, ()))), len(doc_links.get(name, ())),
            "файла нет" if doc["ghost"] else "да" if doc["sha_ok"] else "нет", doc["path"],
        ])

    out = sheet("Роялти", [
        "Получатель", "Идентификатор получателя", "Записи", "Договор-основание", "База расчёта", "Ставка, %",
        "Сумма за период, $", "Фиксированная сумма", "Разрешённые вычеты", "Период применения",
        "Срок и порядок выплаты", "Удержание налога", "Чьё обязательство", "Отражено в зарегистрированном сплите",
        "Источник",
    ], "Идентификатор получателя — party.id в erp.db (через Backstage collaborator id сплита).")
    for item in royalty:
        out.append([item["name"], item["party"], item["isrc"], item["docs"], item["base"],
                    None if item["rate"] is None else float(item["rate"]), money(item["amount"]), "", "",
                    item["period"], "", "", item["obligation"], item["in_split"], item["source"]])

    out = sheet("Согласования и ограничения", ["Договор или договорённость", "Тип", "Что именно",
                                                "Затронутые записи", "Статус", "Срок", "Ответственный"])
    for name in sorted(docs):
        doc = docs[name]
        if doc["kind"] not in RIGHTS:
            continue
        affected = "; ".join(sorted(doc_links.get(name, ())))
        if "согласие" in doc["clauses"]:
            out.append([name, "требуемое согласие", doc["clauses"]["согласие"], affected, "", "", ""])
        for clause in ("синхронизация", "перезапись", "имя и изображение", "физические носители"):
            if clause in doc["clauses"]:
                out.append([name, "принятое ограничение", f"{clause}: {doc['clauses'][clause]}", affected, "", "", ""])
        if "рекуп" in doc["clauses"]:
            out.append([name, "обременение", f"рекуп: {doc['clauses']['рекуп']}", affected, "", "", ""])

    out = sheet("Ассеты", ["Запись или релиз", "Тип ассета", "Правовой статус", "Правообладатель",
                           "Формат и качество", "Где лежит"],
                "Источник: выгрузка отгрузок Zero distribution_files 2026-10-16. Обложек, видео и стемов в источниках нет.")
    category_by_upc = defaultdict(set)
    for r in rows:
        for upc in r["upc"].split("; "):
            for category in r["category"].split("; "):
                if upc and category:
                    category_by_upc[upc].add(category)
    for release_id in sorted(zero_files, key=lambda x: int(x) if x.isdigit() else 0):
        entry = zero_files[release_id]
        upc = entry.get("upc") or ""
        cats = category_by_upc.get(upc, set())
        legal = "наше" if cats == {OWN} else "по лицензии" if cats else ""
        for file_name in sorted(entry.get("f") or []):
            out.append([upc or f"заявка Zero {release_id}", "мастер-файл", legal, "",
                        file_name.rsplit(".", 1)[-1].upper() if "." in file_name else "",
                        f"бот Zero, отгрузка {release_id}: {file_name}"])

    def matrix(name, values, note=""):
        out = sheet(name, ["ISRC", "Трек и версия", "Артисты", "UPC", f"Итог {months[0]} — {months[-1]}", *months], note)
        totals = defaultdict(Decimal)
        body = []
        for r in rows:
            series = values.get(r["isrc"]) or {}
            if not series:
                continue
            for month, value in series.items():
                totals[month] += value
            body.append([r["isrc"], r["title"], r["credits"], r["upc"], money(sum(series.values(), Decimal(0))),
                         *[money(series.get(m)) if m in series else None for m in months]])
        grand = sum(totals.values(), Decimal(0))
        out.append(["Total", "", "", "", money(grand), *[money(totals.get(m, Decimal(0))) for m in months]])
        for line in body:
            out.append(line)
        return grand

    revenue_total = matrix("Выручка по месяцам", revenue, "Оба аккаунта Believe.")
    label_total = matrix("Доля лейбла по месяцам", label_money, "Только записи в периметре, аккаунт 1052428.")
    artist_total = matrix("Участникам по месяцам", artist_money,
                          "Начисление по сплиту, не банковская выплата.")

    out = sheet("Проверка привязок", ["ISRC", "Запись", "Участник", "Документ", "Что найдено", "Тип документа",
                                      "Статус подписания", "Фрагмент текста PDF", "Как документ связан с участником"])
    for line in links:
        out.append(line)

    out = sheet("Сверка с Annex 14", ["ISRC", "Запись", "Участники", "Статус в Annex 14", "Здесь по сторонам",
                                      "Здесь: запись названа",
                                      "What establishes coverage в Annex 14", "Договоры-основания здесь",
                                      f"Поступления в окне Annex {annex['months'][0]}…{annex['months'][-1]}, $"],
                "Только записи, где покрытие по сторонам не совпало со статусом Annex 14.")
    for line in gaps["annex"]:
        out.append(line)
    out.append([])
    out.append(["Денежные расхождения от 20 $"])
    out.append(["ISRC", "Запись", "Annex 14, $", "Здесь, $", "Разница, $", "Показатель"])
    for line in gaps["annex деньги"]:
        out.append(line)

    out = sheet("Сверка с Main", ["Псевдоним", "Роялти начислено в Main, $", "Причитается по сплиту здесь, $",
                                  "Разница, $", "Месяцы", "Ставка в Contracts Main, %", "Ставка в финальном сплите, %",
                                  "Срок в Contracts Main", "Срок в договорах"],
                "Main: лист INCOME EXPENSE, Income/Royalties по месяцу отчёта; здесь: доли участника по сплиту за те же месяцы.")
    ours = defaultdict(lambda: defaultdict(Decimal))
    rates_by_name = defaultdict(Counter)
    for item in royalty:
        if item["amount"] is None or item["name"] == "0to8":
            continue
        rates_by_name[key(item["name"])][float(item["rate"])] += 1
    for r in rows:
        split = splits.get(r["isrc"])
        series = artist_money.get(r["isrc"]) or {}
        if not split or not series or not split["rates"]:
            continue
        total_rate = sum(split["rates"], Decimal(0))
        for name, rate in zip(split["names"], split["rates"]):
            if total_rate == 0:
                continue
            for month, value in series.items():
                ours[key(name)][month] += value * rate / total_rate
    contract_terms = defaultdict(set)
    for doc in docs.values():
        for alias in doc["aliases"]:
            if doc["term"] and doc["kind"] in {"recording", "schedule"}:
                contract_terms[alias].add(doc["term"])
    main_contracts = {key(c["nick"]): c for c in main["contracts"]}
    for nick_key in sorted(set(main["royalties"]) | set(main_contracts)):
        theirs = main["royalties"].get(nick_key, {})
        common = sorted(set(theirs) & set(ours.get(nick_key, {})))
        a = sum((theirs[m] for m in common), Decimal(0))
        b = sum((ours[nick_key][m] for m in common), Decimal(0))
        contract = main_contracts.get(nick_key, {})
        rate = rates_by_name.get(nick_key)
        out.append([main["names"].get(nick_key) or contract.get("nick") or nick_key, money(a) if common else None,
                    money(b) if common else None, money(b - a) if common else None,
                    f"{common[0]} — {common[-1]} ({len(common)})" if common else "нет общих месяцев",
                    None if contract.get("share") is None else float(contract["share"]),
                    rate.most_common(1)[0][0] if rate else None, contract.get("term", ""),
                    "; ".join(sorted(contract_terms.get(nick_key, ())))])

    out = sheet("Строки без ISRC", ["UPC", "Релиз", "Артист", "Аккаунт", "Строк", "Net, $", "Первый месяц",
                                    "Последний месяц"], "Скачивания релиза целиком: в отчёте нет ISRC.")
    for item in no_isrc:
        out.append([item["upc"], item["release"], item["artist"], item["account"], item["lines"], money(item["net"]),
                    item["first"], item["last"]])

    # ---- summary
    out = sheet("Сводка", ["Показатель", "Значение"])
    in_rows = [r for r in rows if r["status"] == "в периметре"]
    out_rows = [r for r in rows if r["status"] != "в периметре"]
    year = defaultdict(lambda: [Decimal(0), Decimal(0), Decimal(0)])
    for code, series in revenue.items():
        for month, value in series.items():
            year[month[:4]][0] += value
    for code, series in label_money.items():
        for month, value in series.items():
            year[month[:4]][1] += value
    for r in in_rows:
        for month, value in (artist_money.get(r["isrc"]) or {}).items():
            year[month[:4]][2] += value
    fiscal = defaultdict(lambda: [Decimal(0), Decimal(0)])
    for r in in_rows:
        for month, value in (label_money.get(r["isrc"]) or {}).items():
            fiscal[month[:4]][1] += value
    in_scope_by_year = defaultdict(Decimal)
    for r in in_rows:
        split_known = bool(label_money.get(r["isrc"]))
        for month, value in (revenue.get(r["isrc"]) or {}).items():
            if split_known:
                in_scope_by_year[month[:4]] += value
    summary = [
        ("Записей всего", len(rows)),
        ("из них есть в отчётах Believe", sum(r["in_believe"] == "да" for r in rows)),
        ("из них только в сплите или каталоге Zero", sum(r["in_believe"] == "нет" for r in rows)),
        ("В периметре", len(in_rows)),
        ("Вне периметра", len(out_rows)),
    ]
    for reason, count in sorted(Counter(r["reason"] for r in out_rows).items()):
        summary.append((f"вне периметра: {reason}", count))
    for category in CATEGORIES:
        summary.append((f"Категория: {category}", sum(category in r["category"] for r in rows)))
    summary.append(("Без категории прав (в периметре)", sum(not r["category"] for r in in_rows)))
    for label, count in sorted(Counter(r["coverage"] for r in in_rows).items()):
        money_sum = sum((r["in_scope"] or Decimal(0) for r in in_rows if r["coverage"] == label), Decimal(0))
        summary.append((f"Покрытие в периметре: {label}, записей / $", f"{count} / {q2(money_sum)}"))
    with_doc = [r for r in in_rows if r["docs"]]
    summary.append(("В периметре с договором-основанием, записей / $",
                    f"{len(with_doc)} / {q2(sum((r['in_scope'] or Decimal(0) for r in with_doc), Decimal(0)))}"))
    without = [r for r in in_rows if not r["docs"]]
    summary.append(("В периметре без договора-основания, записей / $",
                    f"{len(without)} / {q2(sum((r['in_scope'] or Decimal(0) for r in without), Decimal(0)))}"))
    for how, count in sorted(Counter(r["how"] for r in in_rows).items()):
        summary.append((f"Как идентифицирована (в периметре): {how}", count))
    summary.append(("Поступления, все строки Believe с ISRC, $", money(revenue_total)))
    summary.append(("Строки Believe без ISRC, $", money(sum((i["net"] for i in no_isrc), Decimal(0)))))
    for account, (lines, amount) in sorted(ch_totals.items()):
        summary.append((f"Все строки Believe, аккаунт {account}: строк / net $", f"{lines} / {q2(amount)}"))
    summary.append(("Доля лейбла, $", money(label_total)))
    summary.append(("Причитается участникам по сплиту, $", money(artist_total)))
    for y in sorted(year):
        base = in_scope_by_year[y]
        pct = f"{(year[y][1] / base * 100).quantize(Decimal('0.1'))}%" if base else ""
        summary.append((f"{y}: поступления / доля лейбла / участникам, $ / доля лейбла от поступлений со сплитом",
                        f"{q2(year[y][0])} / {q2(year[y][1])} / {q2(year[y][2])} / {pct}"))
    summary.append(("Финансовый год считается равным календарному (FY2024 = 2024-01…2024-12); текущий год — "
                    f"{last_month[:4]} по {last_month}", ""))
    for kind, count in sorted(Counter(d["type"] for d in docs.values()).items()):
        summary.append((f"Договоров по типу: {kind}", count))
    for state, count in sorted(Counter(d["signed"] for d in docs.values()).items()):
        summary.append((f"Договоров по статусу подписания: {state}", count))
    summary.append(("Тип по заголовку PDF не совпал с видом в индексе",
                    sum(1 for d in docs.values() if d["type_source"] == "заголовок PDF"
                        and INDEX_KIND.get(d["index_kind"], ("", ""))[1] not in ("", d["type"]))))
    for name, value in split_stats.items():
        summary.append((f"Сплит: {name}", value))
    for name, state, month in raw_report:
        summary.append((f"Сырой файл Believe {name}", f"{state} {month}".strip()))
    for label_text, value in summary:
        out.append([label_text, value])

    def section(title, header, body):
        out.append([])
        out.append([title])
        out.append(header)
        for line in body:
            out.append(line)
        if not body:
            out.append(["пусто: проверка выполнена, таких записей нет"])

    section("1. Записи в периметре без договора-основания",
            ["ISRC", "Артисты", "Запись", "Поступления в периметре, $", "Покрытие"],
            sorted(gaps["1"], key=lambda x: -(x[3] or 0)))
    section("2. Ставка участника в договоре не совпала со ставкой в сплите",
            ["ISRC", "Запись", "Участник", "Документ", "Ставка digital в договоре, %", "Ставка в сплите, %"], gaps["2"])
    section("3. Участия: есть в договоре и нет в сплите; записи в периметре без сплита",
            ["ISRC", "Запись", "Участник или артист", "Документ или поступления, $"],
            gaps["участие вне сплита"] + [[c, t, a, m] for c, t, a, m in gaps["3"]])
    section("4. Лицензионные интересы с незаполненным сроком или территорией",
            ["ISRC", "Запись", "Категория", "Срок", "Территория"], gaps["4"])
    section("5. Договоры, подписанные одной стороной, и неподписанные",
            ["Идентификатор", "Тип", "Статус", "Файл"],
            [[n, d["type"], d["signed"], d["path"]] for n, d in sorted(docs.items()) if d["signed"] != "подписан всеми"])
    upc_rows = defaultdict(set)
    for r in rows:
        for upc in r["upc"].split("; "):
            if upc:
                upc_rows[upc].add(r["isrc"])
    known = {r["isrc"] for r in rows}
    hidden = []
    for code, split in splits.items():
        if split["upc"] and code not in known:
            hidden.append([split["upc"], code])
    section("6. UPC, у которых не все ISRC раскрыты построчно", ["UPC", "ISRC без строки"], hidden)
    section("7. Записи без даты первого релиза", ["ISRC", "Запись"], [[r["isrc"], r["title"]] for r in rows if not r["first"]])
    section("8. Сумма ставок участников больше 100%", ["ISRC", "Запись", "Участники", "Сумма, %"], gaps["8"])
    section("9. В периметре и одновременно в списке исключённых", ["ISRC", "Запись", "Исключение"], gaps["9"])
    section("10. Договоры без определённой действующей редакции",
            ["Сторона", "Документ А", "Документ Б", "Общих записей", "Подписан А", "Подписан Б"], gaps["10"])
    section("В периметре, есть поступления в окне Annex 14, но записи нет в Annex 14",
            ["ISRC", "Запись", "Артисты", "Поступления в окне Annex, $",
             "У артиста есть Duetti Master Purchase Agreement в реестре erp.db (файла нет)"],
            sorted(gaps["нет в annex"], key=lambda x: -(x[3] or 0)))
    section("Выкупы, которые не легли на сплит", ["ISRC", "Запись", "Пояснение"], gaps["выкуп"])
    section("Получатели с суммой без party_id в erp.db", ["Получатель"], [[n] for n in unresolved])
    section("Конфликт ставок между строками сплита одного ISRC", ["ISRC", "Строки: доля лейбла, участники"],
            [[c, "; ".join(f"{a} [{b}]" for a, b in items)] for c, items in split_conflicts])

    temporary = OUT.with_suffix(".tmp.xlsx")
    book.save(temporary)
    normalize_xlsx(temporary, OUT)
    temporary.unlink()
    LOGGER.info(f"файл {OUT}")
    LOGGER.info(json.dumps({
        "записей": len(rows), "в периметре": len(in_rows), "договоров": len(docs), "роялти строк": len(royalty),
        "проверок привязки": len(links), "поступления": str(q2(revenue_total)), "доля лейбла": str(q2(label_total)),
        "без договора в периметре": len(gaps["1"]), "расхождений покрытия с Annex": len(gaps["annex"]),
        "денежных расхождений с Annex": len(gaps["annex деньги"]),
    }, ensure_ascii=False))


XML_UNSAFE = re.compile("[\ufffe\uffff\ud800-\udfff]")


class CleanSheet:
    """A write-only sheet that drops characters XML cannot hold (PDF text carries control characters)."""

    def __init__(self, sheet):
        self.sheet = sheet

    def append(self, values):
        self.sheet.append([XML_UNSAFE.sub("", ILLEGAL_CHARACTERS_RE.sub("", v)) if isinstance(v, str) else v
                           for v in values])


def normalize_xlsx(source: Path, target: Path) -> None:
    with zipfile.ZipFile(source) as incoming, zipfile.ZipFile(target, "w") as out:
        for info in sorted(incoming.infolist(), key=lambda item: item.filename):
            data = incoming.read(info.filename)
            if info.filename == "docProps/core.xml":
                data = re.sub(rb"<dcterms:(created|modified)([^>]*)>[^<]*</dcterms:\1>",
                              rb"<dcterms:\1\2>2026-11-02T00:00:00Z</dcterms:\1>", data)
            entry = zipfile.ZipInfo(filename=info.filename, date_time=STAMP)
            entry.compress_type = zipfile.ZIP_DEFLATED
            entry.external_attr = 0o600 << 16
            out.writestr(entry, data, compresslevel=6)


if __name__ == "__main__":
    sys.setrecursionlimit(10000)
    build()
