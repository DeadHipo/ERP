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

VERSION = "v7"
BUILD_DATE = "2026-11-02"
ROOT = Path(__file__).resolve().parents[3]
CD = ROOT / "context_data"
CI = CD / "contract_index"
ENV_PATH = ROOT / ".env"
RAW_DIRS = [CD / "ERP_data/believe/raw", CD / "ERP_data/believe_echo8"]
PDF_DIRS = [CD / "PandaDoc_documents_0 (2)", CD / "Root"]
# the documents of the due-diligence pack the register lists without a file, sent separately on 2026-11-02
EXTRA_DIR = CD / "для_разработчика_37_документов_2026-11-02"
EXTRA_TEXTS = CI / "texts_dd_pack.jsonl"
DECISIONS = CI / "решения_владельца_2026-11-02.json"
BACKSTAGE = CD / "20261102_my_catalog_export.csv"
SPLITS = CD / "ERP_data/splits/raw/0to8_Splits_20260814.xlsx"
ERP_DB = CD / "data/erp/data/erp.db"
ZERO_TRACKS = CD / "ERP_data/zero/catalog_tracks_2026-10-16.json"
ZERO_FILES = CD / "ERP_data/zero/distribution_files_2026-10-16.json"
ZERO_RELEASES = CD / "ERP_data/zero/distribution_releases_2026-10-16.json"
ANNEX = CD / "Annex 14_beta (обновлено покрытие).xlsx"
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
COMPLETED_RE = re.compile(r"document\s+completed\s+by\s+all\s+parties\s+on:?\s+(?:[A-Z0-9]{5}(?:-[A-Z0-9]{5}){3}\s+)?"
                          r"(\d{1,2}\s+[A-Za-z]{3,9}\s+\d{4})",
                          re.I)
SIGNED_RE = re.compile(r"\bSigned:?\s+(\d{1,2}\s+[A-Za-z]{3,9}\s+\d{4})", re.I)
ISRC_RE = re.compile(r"\b([A-Z]{2})[\s-]?([A-Z0-9]{3})[\s-]?(\d{2})[\s-]?(\d{5})\b")
MONTHS = {m: i + 1 for i, m in enumerate(
    ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"])}
GENERIC_ALIASES = {"agreement", "original agreement", "producer", "purchaser", "artist", "catalog recordings", "label", "licensor", "licensee",
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
    imprints = []
    for line in clickhouse(env, f"""
        SELECT if(file_id IN {main}, '{MAIN_ACCOUNT}', '{ECHO_ACCOUNT}') AS acc, label_name, count(),
               toString(sum(net_revenue)), arraySort(groupUniqArray(isrc))
        FROM believe.rows WHERE file_id IN {every}
        GROUP BY acc, label_name ORDER BY acc, label_name FORMAT JSONCompactEachRow""").splitlines():
        if line.strip():
            account, label, lines, amount, codes = json.loads(line)
            imprints.append({"account": account, "label": label, "lines": int(lines), "net": Decimal(amount),
                             "isrc": {norm_isrc(c) for c in codes if c}})
    totals = {}
    for line in clickhouse(env, f"""
        SELECT if(file_id IN {main}, '{MAIN_ACCOUNT}', '{ECHO_ACCOUNT}') AS acc, count(), toString(sum(net_revenue))
        FROM believe.rows WHERE file_id IN {every} GROUP BY acc FORMAT TSV""").splitlines():
        account, lines, amount = line.split("\t")
        totals[account] = (int(lines), Decimal(amount))
    return catalog, upcs, net, no_isrc, totals, imprints


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
    advances = [dict(zip(("id", "party", "date", "amount", "recoup_from", "remaining", "status", "note"), row))
                for row in db.execute("SELECT a.id, p.name, a.date, a.amount, a.recoup_from, a.remaining, a.status, "
                                      "a.note FROM advance a LEFT JOIN party p ON p.id = a.party_id "
                                      "WHERE a.status IN ('open', 'partial') ORDER BY a.date, a.id")]
    pandadoc = defaultdict(list)
    for name, state, completed in db.execute("SELECT name, status, completed FROM pd_doc"):
        name = name or ""
        pandadoc[file_key(name if name.lower().endswith(".pdf") else name + ".pdf")].append(
            (state or "", (completed or "")[:10]))
    db.close()
    shutil.rmtree(folder)
    return {"party": party, "by_cid": by_cid, "by_name": by_name, "contracts": contracts, "buyouts": buyouts,
            "release_dates": release_dates, "track_dates": track_dates, "duetti": duetti, "pandadoc": pandadoc,
            "advances": advances}


def _has_columns(db, table: str, columns: set[str]) -> bool:
    found = {row[1] for row in db.execute(f"PRAGMA table_info({table})")}
    return columns <= found


def load_backstage():
    """Believe Backstage release export: UPC -> (earliest release date, label)."""
    import csv
    out = {}
    if not BACKSTAGE.exists():
        return out
    with BACKSTAGE.open(encoding="utf-8-sig") as handle:
        for row in csv.DictReader(handle, delimiter=";"):
            upc = re.sub(r"\D", "", row.get("UPC") or "")
            day = (row.get("Release date / Hour / Time zone") or "")[:10]
            if upc and re.fullmatch(r"\d{4}-\d{2}-\d{2}", day):
                tracks = int(row.get("# of track") or 0) if str(row.get("# of track") or "").isdigit() else 0
                if upc not in out or day < out[upc][0]:
                    out[upc] = (day, row.get("Label") or "", tracks)
    return out


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
    completed = sorted(filter(None, (stamp_iso(m) for m in COMPLETED_RE.findall(text or ""))))
    if completed:
        # a PDF may carry an earlier agreement with its own certificate; the latest one is this document's
        note = "" if len(completed) == 1 else f"; в PDF сертификатов {len(completed)}, взят последний"
        return "подписан всеми", completed[-1], "сертификат PandaDoc: document completed by all parties" + note
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


def sentence(text: str, pattern: str, limit: int = 260) -> str:
    match = re.search(r"[^.]{0,160}" + pattern + r"[^.]{0,200}", re.sub(r"\s+", " ", text or ""), re.I)
    return redact(match.group(0).strip()[:limit]) if match else ""


def terms_of(text: str) -> dict[str, str]:
    """Contract terms the Schedules ask for, read from the text; an empty value means the text has no such clause."""
    flat = re.sub(r"\s+", " ", text or "")
    out = {}
    whole = re.search(r"Label\s*may\s*assign\s*its\s*rights\s*under\s*this\s*Agreement\s*in\s*whole", flat, re.I)
    any_part = re.search(r"Label\s*may\s*assign\s*this\s*Agreement,?\s*in\s*whole\s*or\s*in\s*part", flat, re.I)
    if any_part:
        out["assignment"] = "лейбл вправе уступить договор целиком или частично без согласия артиста"
    elif whole:
        out["assignment"] = ("лейбл вправе уступить права по договору только целиком лицу, принимающему обязательства, "
                             "без согласия артиста")
    else:
        found = sentence(flat, r"assign")
        out["assignment"] = f"по тексту: «{found}»" if found else ""
    out["accounting"] = sentence(flat, r"(Statements?\s*will\s*be\s*made\s*available|Accounting\s*and\s*payments?|"
                                       r"Payments?\s*will\s*be\s*made)")
    out["withholding"] = (sentence(flat, r"deduct\s*from\s*all\s*payments[^.]{0,120}withh?olding")
                          or sentence(flat, r"(required|obliged)\s*to\s*(pay\s*or\s*)?withh?old"))
    out["base"] = sentence(flat, r"percentage\s*of\s*all\s*gross\s*receipts\s*actually\s*received", 300)
    out["renewal"] = sentence(flat, r"renewal\s*terms?")
    out["reversion"] = sentence(flat, r"(revert|reversion)")
    out["recoup"] = sentence(flat, r"recoupable\s*costs?", 160)
    out["escalator"] = sentence(flat, r"escalat")
    return out


def label_entity(text: str) -> str:
    head = (text or "")[:4000]
    if re.search(r"L\.?\s?L\.?\s?C\.?[-\s]?FZ", head, re.I):
        return "FZ"
    if re.search(r"Zero\s*to\s*Infinity,?\s*Inc", head, re.I):
        return "Inc"
    if re.search(r"Individual entrepreneur|ИП |индивидуальный предприниматель", head, re.I):
        return "ИП"
    return ""


def pdf_text(path: Path) -> tuple[str, str]:
    """Text layer of a PDF; a page without one is read by tesseract from a 300 dpi render."""
    import pdfplumber
    pages, method = [], "текстовый слой"
    with pdfplumber.open(path) as pdf:
        for page in pdf.pages:
            text = page.extract_text() or ""
            if len(text.strip()) < 20:
                image = page.to_image(resolution=300).original
                folder = tempfile.mkdtemp(prefix="ocr_")
                png = Path(folder) / "page.png"
                image.save(png)
                result = subprocess.run(["tesseract", str(png), "stdout", "-l", "eng"],
                                        capture_output=True, text=True, check=True)
                shutil.rmtree(folder)
                text, method = result.stdout, "OCR tesseract"
            pages.append(text)
    return "\n".join(pages), method


def load_extra_pdfs():
    """The due-diligence pack folder, indexed here: sha256, text (cached by sha), no parsed track table."""
    cache = {}
    if EXTRA_TEXTS.exists():
        for line in EXTRA_TEXTS.open(encoding="utf-8"):
            row = json.loads(line)
            cache[row["sha256"]] = row
    items, texts, fresh = [], {}, {}
    if not EXTRA_DIR.exists():
        return items, texts
    for path in sorted(EXTRA_DIR.rglob("*.pdf")):
        digest = sha256_file(path)
        if digest not in cache:
            text, method = pdf_text(path)
            cache[digest] = {"sha256": digest, "text": text, "method": method}
            fresh[digest] = True
        texts[digest] = cache[digest]["text"]
        items.append({"sha256": digest, "files": [{"name": path.name, "path": str(path)}], "kind": "",
                      "party": {}, "meta": {}, "tracks": [], "isrc_catalog": [],
                      "text_method": cache[digest].get("method", "")})
    if fresh:
        with EXTRA_TEXTS.open("w", encoding="utf-8") as handle:
            for digest in sorted(cache):
                handle.write(json.dumps(cache[digest], ensure_ascii=False) + "\n")
    LOGGER.info(f"OK    пакет DD: PDF {len(items)}, распознано OCR "
                f"{sum(1 for i in items if i['text_method'] == 'OCR tesseract')}")
    return items, texts


def load_documents(erp):
    texts = {}
    with TEXTS.open(encoding="utf-8") as handle:
        for line in handle:
            row = json.loads(line)
            texts[row["sha256"]] = row.get("text") or ""
    index = json.load(DOCS.open(encoding="utf-8"))
    extra_items, extra_texts = load_extra_pdfs()
    known_sha = {item.get("sha256"): (item.get("files") or [{}])[0].get("name") for item in index}
    for item in extra_items:
        if item["sha256"] in known_sha:
            item["same_as"] = known_sha[item["sha256"]]
    index = index + extra_items
    for digest, text in extra_texts.items():
        texts.setdefault(digest, text)
    on_disk = {}
    for folder in PDF_DIRS + [EXTRA_DIR]:
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
        seller = re.search(r"\bSeller\s+([^\n]+)", text[:3000])
        if "MASTERPURCHASEAGREEMENT" in squash(text[:600]) and seller and any(
                insider <= frozenset(tokens(seller.group(1))) for insider in insiders):
            kind, type_source = "divestment", "заголовок PDF: продавец — наша сторона (покупатель из реестра выкупов)"
            type_label = "продажа записей Duetti" if re.search(r"Duetti", text, re.I) else "продажа записей"
        if kind == "transfer" and assignor and re.search(r"\(2\)\s*Zero\s*to\s*Infinity\s*L\.?L\.?C", text[:2500]) \
                and frozenset(tokens(assignor.group(1))) in insiders:
            kind, type_label, type_source = "chain", "уступка на FZ по цепочке", \
                "заголовок PDF: цедент — покупатель из реестра выкупов или Inc., цессионарий — FZ"
        signed, signed_on, signed_source = signature_of(text)
        if item.get("text_method") and signed == "не подписан":
            signed = "не установлено: подпись вне PandaDoc"
            signed_source = "пакет DD 22.09.2026, исполненный экземпляр по описи; сертификата подписи в PDF нет"
        if item.get("text_method") == "OCR tesseract":
            signed_source += "; текст получен OCR"
        if item.get("same_as"):
            signed_source += f"; побайтно тот же файл, что {item['same_as']}"
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
            "terms": terms_of(text),
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
            "territory": "", "clauses": {}, "entity": "FZ" if "L.L.C-FZ" in file_name else "", "terms": {},
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

def isrc_or_empty(value) -> str:
    code = norm_isrc(value)
    return code if re.fullmatch(r"[A-Z]{2}[A-Z0-9]{3}\d{7}", code) else ""


def load_annex():
    book = openpyxl.load_workbook(ANNEX, read_only=True, data_only=True)
    coverage = {}
    for row in list(book["Coverage by recording"].iter_rows(values_only=True))[2:]:
        code = isrc_or_empty(row[0])
        if code:
            coverage[code] = {"status": str(row[1] or ""), "establishes": str(row[8] or ""),
                              "without": str(row[9] or ""), "instrument": str(row[10] or ""),
                              "imprint": str(row[11] or ""), "recording": str(row[4] or ""),
                              "credits": str(row[5] or ""), "upc": str(row[6] or "").split(".")[0]}
    splits = {}
    for row in list(book["Splits by ISRC"].iter_rows(values_only=True))[2:]:
        code = isrc_or_empty(row[0])
        if not code:
            continue
        names, rates = [], []
        for part in str(row[5] or "").split(";"):
            match = re.fullmatch(r"\s*(.+?)\s+(\d+(?:[.,]\d+)?)%\s*", part)
            if match:
                names.append(match.group(1))
                rates.append(Decimal(match.group(2).replace(",", ".")))
        outside = re.search(r"sub-label allocation\s+(\d+(?:\.\d+)?)%", str(row[6] or ""))
        period = re.findall(r"\d{4}-\d{2}", str(row[8] or ""))
        splits[code] = {"registered": str(row[5] or ""), "outside": str(row[6] or ""),
                        "outside_rate": Decimal(outside.group(1)) if outside else None,
                        "names": names, "rates": rates,
                        "share": Decimal(str(row[7])) * 100 if isinstance(row[7], (int, float)) else None,
                        "period": (period[0], period[-1]) if period else None, "source": str(row[9] or "")}
    derivatives = {}
    if "Derivative authorisations" in book.sheetnames:
        for row in list(book["Derivative authorisations"].iter_rows(values_only=True))[2:]:
            code = isrc_or_empty(row[0])
            if not code or not row[1]:
                continue
            remixer = str(row[4] or "")
            alias = remixer.split("p/k/a", 1)[-1].split("(")[0].strip() if "p/k/a" in remixer else remixer
            receives = str(row[7] or "")
            rate = re.search(r"(\d+(?:\.\d+)?)%", receives)
            agreed = str(row[6] or "")[:7]
            derivatives[code] = {
                "status": str(row[1]), "remixer": alias, "agreement": str(row[5] or ""), "date": str(row[6] or "")[:10],
                "rate": Decimal(rate.group(1)) if rate else None, "term": str(row[8] or ""),
                "from": "" if "earned before" in receives.lower() else agreed,
                "receipts": row[10] if len(row) > 10 else None, "note": str(row[9] or ""),
            }
    acquired = {}
    if "Acquired recordings" in book.sheetnames:
        for row in list(book["Acquired recordings"].iter_rows(values_only=True))[2:]:
            code = isrc_or_empty(row[0])
            if code and row[9]:
                acquired[(code, key(row[5]))] = {"effective": str(row[9])[:10], "vested": str(row[10] or ""),
                                                 "instrument": str(row[7] or "")}

    def monthly(sheet_name):
        rows = book[sheet_name].iter_rows(values_only=True)
        next(rows)
        header = list(next(rows))
        months = [(i, h) for i, h in enumerate(header) if isinstance(h, str) and re.fullmatch(r"\d{4}-\d{2}", h)]
        out, blocked = {}, defaultdict(set)
        for row in rows:
            code = isrc_or_empty(row[0]) if row and row[0] != "Total" else ""
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
    matters = []
    for sheet_name, kind in (("Sch4A Known claims", "известная претензия"),
                             ("Sch2C Required consents", "требуемое согласие"),
                             ("Sch2D Accepted limitations", "принятое ограничение"),
                             ("Sch4B Documentation matters", "вопрос документации")):
        if sheet_name in book.sheetnames:
            for row in list(book[sheet_name].iter_rows(values_only=True))[2:]:
                if row and row[0]:
                    matters.append((kind, str(row[0]), " — ".join(str(v) for v in row[1:] if v), sheet_name))
    excluded = {}
    if "Sch1B Excluded register" in book.sheetnames:
        for row in list(book["Sch1B Excluded register"].iter_rows(values_only=True))[2:]:
            code = isrc_or_empty(row[0])
            if code:
                excluded[code] = (str(row[4] or ""), str(row[5] or ""))
    book.close()
    return {"matters": matters, "excluded": excluded, "coverage": coverage, "splits": splits, "receipts": receipts, "nls": nls,
            "blocked": blocked,
            "months": months, "derivatives": derivatives, "acquired": acquired}


def annex_class(status: str) -> str:
    """Annex 14 status in the three classes of the party-level measure."""
    status = status or ""
    if status.startswith("first released after"):
        return "не оценено"
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


def legal_interest(code, recording_docs, chain_docs, buyouts, coverage, docs):
    """Our legal interest in the master, by the owner's rule of 2026-11-02 (not the economic share of net)."""
    numeric, notes = [], []
    whole = [b for b in buyouts if b["pct"] is None or b["pct"] >= 100]
    if whole:
        numeric.append(Decimal(100))
        notes.append("выкуп всей доли: " + ", ".join(sorted({b["contract"] or str(b["id"]) for b in whole})))
    part = [b for b in buyouts if b not in whole]
    if part:
        numeric.append(min(Decimal(100), sum((b["pct"] for b in part), Decimal(0))))
        notes.append("выкуп части доли (реестр выкупов, seller_pct): "
                     + ", ".join(sorted({b["contract"] or str(b["id"]) for b in part})))
    owned = sorted(d for d in recording_docs if docs[d]["kind"] in {"transfer", "work_for_hire"}
                   or (docs[d]["kind"] == "purchase" and not buyouts))
    if owned:
        numeric.append(Decimal(100))
        notes.append("права у FZ по документу: " + "; ".join(owned))
    if coverage.startswith("собственная запись лейбла") and chain_docs:
        numeric.append(Decimal(100))
        notes.append("собственная запись лейбла, цепочка на FZ: " + "; ".join(chain_docs))
    if numeric:
        return float(max(numeric)), "; ".join(notes)
    kinds = {docs[d]["kind"] for d in recording_docs}
    if kinds & {"recording", "schedule", "addendum"}:
        return 0.0, "эксклюзивная лицензия на распространение и администрирование на срок договора, права не переходят"
    if "partial_purchase" in kinds or ("purchase" in kinds and buyouts):
        return "не установлено: доля частичного выкупа по документу не извлечена", ""
    if "co_ownership" in kinds:
        return "не установлено: доля по договору совместного владения не извлечена", ""
    if kinds and kinds <= {"sample", "contributor"}:
        return "не применимо: лицензия третьего лица на сэмпл или вокал, это ограничение, а не наша доля", ""
    if kinds:
        return "не установлено: из типа документа передача прав не следует", ""
    return "не установлено: нет документа", ""


def rate_schedule(split, buyouts, months, rules):
    """Rates per month.

    Order: the base split; an owner decision that a participant counts only from a month; the label floor;
    buyouts from their effective month; then participations outside the split: a remixer on top of everyone,
    a sub-label out of the label share. A month outside the base's own period has no share.
    """
    if not split or split["label"] is None or split["rates"] is None:
        return None, []
    events, problems = [], []
    for buyout in buyouts:
        effective = text_date(buyout["effective"])[:7]
        seller = key(buyout["seller"])
        index = next((i for i, name in enumerate(split["names"]) if key(name) == seller), None)
        if index is None:
            problems.append(f"продавец {buyout['seller'] or '—'} по выкупу {buyout['contract'] or buyout['id']} "
                            f"не участник сплита")
            continue
        events.append((effective or "0000-00", index, buyout))
    period = split.get("period")
    schedule = {}
    for month in months:
        if period and not (period[0] <= month <= period[1]):
            schedule[month] = None
            continue
        rates = list(split["rates"])
        label = split["label"]
        notes, settled = [], []
        for i, name in enumerate(split["names"]):
            since = rules["from"].get(key(name))
            if since and month < since[0]:
                # before the settlement the share is neither the participant's under the split nor the label's
                settled.append((f"{name}: до {since[0]} урегулировано мировым соглашением", rates[i], since[1], "", ""))
                rates[i] = Decimal(0)
        floor = rules.get("floor")
        if floor and label < floor[0] and sum(rates, Decimal(0)) > 0:
            scale = (100 - floor[0]) / sum(rates, Decimal(0))
            rates = [rate * scale for rate in rates]
            label = floor[0]
            notes.append(floor[1])
        applied = []
        for effective, index, buyout in sorted(events, key=lambda e: (e[0], e[2]["id"])):
            if effective > month:
                continue
            pct = buyout["pct"]
            take = rates[index] if pct is None or pct >= 100 or pct >= rates[index] else pct
            rates[index] -= take
            label += take
            applied.append(buyout["id"])
        outside = list(settled)
        for extra in sorted(rules["outside"], key=lambda x: (x["mode"] != "on_top", x["mode"] == "half_label")):
            if extra["from"] and month < extra["from"]:
                continue
            if extra["mode"] == "on_top":
                factor = (100 - extra["rate"]) / 100
                rates = [rate * factor for rate in rates]
                label *= factor
                outside.append((extra["name"], extra["rate"], extra["source"], extra["party"], extra["docs"]))
            elif extra["mode"] == "half_label":
                # the owner's rule: the sub-label takes half of what the label keeps after everyone else
                take = label / 2
                label -= take
                outside.append((extra["name"], take, extra["source"], extra["party"], extra["docs"]))
            else:
                take = min(extra["rate"], label)
                label -= take
                outside.append((extra["name"], take, extra["source"], extra["party"], extra["docs"]))
        schedule[month] = (label, tuple(rates), tuple(applied), tuple(outside), tuple(dict.fromkeys(notes)))
    return schedule, problems


# ---------------------------------------------------------------- build

def build():
    env = load_env()
    LOGGER.info(f"Сборка {VERSION}, {BUILD_DATE}")
    files, raw_report, registry_totals = load_registry(env)
    catalog, upcs, net, no_isrc, ch_totals, imprint_totals = load_clickhouse(env, files)
    for account, (lines, amount) in sorted(ch_totals.items()):
        LOGGER.check(abs(amount - registry_totals[account]) < Decimal("0.01"),
                     f"ClickHouse {account}: {lines} строк, net {q2(amount)}; реестр файлов {q2(registry_totals[account])}")
    splits, split_stats, split_conflicts = load_splits()
    erp = load_erp()
    zero_tracks, zero_files, zero_releases = load_zero()
    backstage = load_backstage()
    LOGGER.info(f"OK    каталог Believe Backstage: UPC с датой релиза {len(backstage)}")
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
    # Duetti: the ISRCs written in the two master purchase agreements (Schedule 1), and the register's own
    duetti = set(erp["duetti"])
    for doc in docs.values():
        if doc["kind"] == "divestment":
            duetti |= {"".join(m.groups()) for m in ISRC_RE.finditer(doc["text"].upper())}
    LOGGER.info(f"OK    Duetti: ISRC в договорах продажи и реестре {len(duetti)}")
    decisions = json.load(DECISIONS.open(encoding="utf-8")) if DECISIONS.exists() else {}
    participant_from = {key(item["name"]): (item["from"], item["source"])
                        for item in decisions.get("participant_from", [])}
    floor_rule = decisions.get("label_floor") or {}
    floor_titles = [key(t) for t in floor_rule.get("titles", [])]
    sublabel_ok = {}
    for group in ("sublabel_with_document", "sublabel_without_document"):
        for imprint in (decisions.get(group) or {}).get("imprints", []):
            rate = decisions[group]["rate"]
            sublabel_ok[key(imprint)] = (decisions[group]["source"], (decisions[group].get("document_hint") or ""),
                                         rate if rate == "half" else Decimal(str(rate)))
    own_imprints = {key(i) for i in (decisions.get("own_imprints") or {}).get("imprints", [])}
    perimeter = set(annex["coverage"])

    codes = sorted((set(catalog) | set(splits) | set(zero_tracks) | perimeter)
                   - {c for c in set(zero_tracks) | set(splits) if c.startswith("DEVTEST")})
    rows, links, royalty, gaps = [], [], [], defaultdict(list)
    revenue, label_money, artist_money, established_money = {}, {}, {}, {}
    doc_links = defaultdict(set)
    party_ids = {p["id"] for p in erp["party"].values()}
    house_names = {key(p["name"]) for p in erp["party"].values() if p["house"]} | {"0to8"}
    known_people = {key(p["name"]).replace(" ", "") for p in erp["party"].values()}
    known_people |= {k.replace(" ", "") for k in erp["by_name"]}
    known_people |= {key(n).replace(" ", "") for sp in splits.values() for n in sp["names"]}
    known_people |= {key(n).replace(" ", "") for ch_row in catalog.values() for a in ch_row["artists"]
                     for n in credit_names(a)}
    duetti_parties = {alias for d in docs.values() if d["type"] == "продажа записей Duetti" for alias in d["aliases"]}

    for code in codes:
        ch = catalog.get(code)
        split = splits.get(code)
        zero = zero_tracks.get(code)
        reference_row = annex["coverage"].get(code) or {}
        title = (ch or {}).get("track") or (split or {}).get("track") or (zero or {}).get("title") \
            or reference_row.get("recording") or ""
        if zero and zero.get("version") and key(zero["version"]) not in key(title):
            title = f"{title} ({zero['version']})"
        titles = list(dict.fromkeys([t for t in ((ch or {}).get("tracks") or []) + [title] if t]))
        artist_line = (ch or {}).get("artist") or ""
        credits = []
        for value in ((ch or {}).get("artists") or []) + [artist_line] + (
                [reference_row["credits"]] if not ch and reference_row.get("credits") else []):
            for name in credit_names(value):
                if key(name) not in {key(c) for c in credits}:
                    credits.append(name)
        participants = list(split["names"]) if split and split["names"] else []
        for name in participants:
            if key(name) not in {key(c) for c in credits}:
                credits.append(name)
        product_upcs = sorted(upcs.get(code, set()) | ({split["upc"]} if split and split["upc"] else set())
                              | ({zero["upc"]} if zero and zero.get("upc") else set())
                              | ({reference_row["upc"]} if not ch and reference_row.get("upc") else set()))
        types = (ch or {}).get("types") or []
        product = "; ".join(sorted({"music video" if "video" in t.lower() else "ringtone" if "ringtone" in t.lower()
                                    else "audio" for t in types})) if types else ("audio" if split or zero else "")
        # first release date
        first, first_source = "", ""
        dated = sorted(backstage[u][0] for u in product_upcs if u in backstage)
        if dated:
            first, first_source = dated[0], "каталог Believe Backstage 02.11.2026, дата релиза по UPC"
        elif zero and zero.get("release_date"):
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
        # the perimeter is the list of Annex 14 (owner decision of 2026-11-02); the book only says why not
        listed = annex["excluded"].get(code)
        if code in duetti:
            status, reason = "вне периметра", "Duetti: ISRC в Schedule 1 договора продажи"
        elif listed and code not in perimeter:
            word = {"Duetti Agreements": "Duetti", "identified Echo8 repertoire": "Echo8",
                    "withdrawn recordings": "отозвана"}.get(listed[0], "иное")
            status, reason = "вне периметра", f"{word}: {listed[1]} (Annex 14 beta, Sch1B)"
        elif code in perimeter:
            status, reason = "в периметре", ""
        elif echo_imprint:
            status, reason = "вне периметра", "Echo8: в аккаунте 1052428 все строки под импринтом Echo8"
        elif in_echo and not in_main:
            status, reason = "вне периметра", "Echo8"
        elif ch:
            status, reason = "вне периметра", "иное: нет в перечне периметра Annex 14 beta и нет в Sch1B"
        else:
            status, reason = "вне периметра", ("иное: нет строк в отчётах Believe по " + last_month
                                               + " и нет в перечне периметра Annex 14")
        excluded_by = [x for x, cond in (("аккаунт Echo8 1055956", in_echo), ("импринт Echo8", echo_imprint),
                                         ("Duetti", code in duetti),
                                         ("Sch1B: " + (listed or ("", ""))[0], bool(listed))) if cond]
        if code in perimeter and excluded_by:
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
        legal, legal_source = legal_interest(code, recording_docs, chain_docs, buyout_rows, coverage, docs)
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
        base_split, base_source = split, "финальный сплит 0to8_Splits_20260814"
        reference_split = annex["splits"].get(code) or {}
        if (not split or split["rates"] is None) and reference_split.get("share") is not None:
            names = reference_split["names"]
            rates = reference_split["rates"]
            label = reference_split["share"]
            if abs(sum(rates, Decimal(0)) + label - 100) > Decimal("0.05"):
                names, rates = names + ["участники не названы в источнике"], rates + [100 - label - sum(rates, Decimal(0))]
            base_split = {"names": names, "rates": rates, "label": label, "ids": [],
                          "period": reference_split["period"]}
            base_source = f"Annex 14, Splits by ISRC: {reference_split['source']}"
            if own_share == "":
                own_share = float(label)
                own_source = (f"{base_source}; доля net, которая остаётся лейблу, только в периоде "
                              f"{reference_split['period'][0]} — {reference_split['period'][1]}"
                              if reference_split["period"] else base_source)
        rules = {"from": participant_from, "outside": [], "floor": None}
        if floor_titles and any(key(title).startswith(t) for t in floor_titles):
            rules["floor"] = (Decimal(str(floor_rule["rate"])), floor_rule["source"])
            if base_split and base_split["label"] is not None and base_split["label"] < rules["floor"][0]:
                gaps["2"].append([code, title, "доля лейбла в сплите", "решение владельца 02.11.2026",
                                  float(rules["floor"][0]), float(base_split["label"])])
        derivative = annex["derivatives"].get(code)
        if derivative and derivative["status"] == "authorised" and derivative["rate"]:
            known = next(iter(erp["by_name"].get(key(derivative["remixer"]), [])), None)
            remix_docs = sorted(index.alias.get(key(derivative["remixer"]), set()))
            rules["outside"].append({
                "name": derivative["remixer"], "rate": derivative["rate"], "mode": "on_top",
                "from": derivative["from"], "party": known["id"] if known else "", "docs": "; ".join(remix_docs),
                "source": f"{derivative['agreement']} от {derivative['date']} (Annex 14, Derivative authorisations): "
                          f"доля сверху, остальные пропорционально",
            })
        elif derivative:
            gaps["производные"].append([code, title, derivative["remixer"], derivative["status"],
                                        derivative["note"][:200], money(sum(main_rounded.values(), Decimal(0)))])
        imprint = reference_row.get("imprint") or "; ".join((ch or {}).get("main_imprints") or [])
        allowed = next(((k, v) for k, v in sublabel_ok.items() if k and k in key(imprint)), None)
        if allowed:
            sublabel_key, (sub_source, sub_hint, sub_rate) = allowed
            sublabel_name = next(n for n in (decisions["sublabel_with_document"]["imprints"]
                                             + decisions["sublabel_without_document"]["imprints"])
                                 if key(n) == sublabel_key)
            known = next(iter(erp["by_name"].get(sublabel_key, [])), None)
            sub_docs = sorted(d for d in docs if sub_hint and key(sub_hint) in key(d))
            rules["outside"].append({
                "name": sublabel_name, "rate": sub_rate, "mode": "half_label" if sub_rate == "half" else "from_label",
                "from": "",
                "party": known["id"] if known else "", "docs": "; ".join(sub_docs), "source": sub_source,
            })
        elif reference_split.get("outside_rate") is not None and not any(o in key(imprint) for o in own_imprints):
            gaps["саблейбл"].append([code, title, imprint, float(reference_split["outside_rate"]),
                                     money(sum(main_rounded.values(), Decimal(0)))])
        acquired_dates = {seller: item["effective"] for (isrc, seller), item in annex["acquired"].items()
                          if isrc == code}
        buyout_rows_dated = [dict(b, effective=acquired_dates.get(key(b["seller"]), b["effective"]))
                             for b in buyout_rows]
        schedule, buyout_problems = rate_schedule(base_split, buyout_rows_dated, sorted(main_exact), rules)
        for problem in buyout_problems:
            gaps["выкуп"].append([code, title, problem])
        label_series, artist_series, established = {}, {}, {}
        if schedule and status == "в периметре":
            months_set = [m for m in sorted(main_exact) if schedule[m] is not None]
            outside_series = defaultdict(dict)
            for month in months_set:
                label_rate, rates, applied, outside, notes = schedule[month]
                receipt = main_rounded[month]
                established[month] = receipt
                label_series[month] = q2(receipt * label_rate / 100)
                taken = Decimal(0)
                for name, rate, _, _, _ in outside:
                    outside_series[name][month] = q2(receipt * rate / 100)
                    taken += outside_series[name][month]
                artist_series[month] = receipt - label_series[month] - taken
            runs = []
            for month in months_set:
                state = schedule[month]
                if runs and runs[-1]["state"] == state:
                    runs[-1]["months"].append(month)
                else:
                    runs.append({"state": state, "months": [month]})
            ids = list(base_split["ids"] or []) + [""] * (len(base_split["names"]) - len(base_split["ids"] or []))
            for run in runs:
                label_rate, rates, applied, outside, notes = run["state"]
                period = f"{run['months'][0]} — {run['months'][-1]}"
                artist_total = sum((artist_series[m] for m in run["months"]), Decimal(0))
                weights = list(rates)
                amounts = []
                if sum(weights, Decimal(0)) > 0:
                    for weight in weights[:-1]:
                        amounts.append(q2(artist_total * weight / sum(weights, Decimal(0))))
                    amounts.append(artist_total - sum(amounts, Decimal(0)))
                else:
                    amounts = [Decimal(0)] * len(weights)
                    if weights:
                        amounts[-1] = artist_total
                suffix = "".join(f"; {note}" for note in notes) + ("; реестр выкупов erp.db" if applied else "")
                for position, (name, rate, cid, amount) in enumerate(zip(base_split["names"], rates, ids, amounts)):
                    party = erp["by_cid"].get(cid) or next(iter(erp["by_name"].get(key(name), [])), None)
                    docs_for = [d for n, lvl, used, _, _ in part_results if n == name for d in used]
                    registered = base_split["rates"][position]
                    royalty.append({
                        "name": name, "party": party["id"] if party else "", "isrc": code,
                        "docs": "; ".join(docs_for), "base": "net Believe, аккаунт 1052428, отчётный месяц",
                        "rate": q2(rate) if rate != registered else rate, "amount": amount, "period": period,
                        "obligation": "лейбл",
                        "in_split": "да" if rate == registered and base_split is split else
                        "да, по Catalog Shares" if rate == registered else "нет: ставка изменена",
                        "source": base_source + suffix,
                    })
                for name, rate, source, party, docs_text in outside:
                    royalty.append({
                        "name": name, "party": party, "isrc": code, "docs": docs_text,
                        "base": "net Believe, аккаунт 1052428, отчётный месяц", "rate": q2(rate),
                        "amount": sum((outside_series[name][m] for m in run["months"]), Decimal(0)),
                        "period": period, "obligation": "лейбл", "in_split": "нет", "source": source,
                    })
                royalty.append({
                    "name": "0to8", "party": next((p["id"] for p in erp["party"].values() if p["house"]), ""),
                    "isrc": code, "docs": "; ".join(sorted(recording_docs)),
                    "base": "net Believe, аккаунт 1052428, отчётный месяц",
                    "rate": q2(label_rate), "amount": sum((label_series[m] for m in run["months"]), Decimal(0)),
                    "period": period, "obligation": "лейбл",
                    "in_split": "да" if label_rate == base_split["label"] else "нет: доля лейбла изменена",
                    "source": base_source + ", доля лейбла" + suffix,
                })
            # Schedule 3 Part C: (i) participations outside the registered split, (ii) what buy-outs add to the label
            for name, series in sorted(outside_series.items()):
                source = next((o[2] for m in months_set for o in schedule[m][3] if o[0] == name), "")
                gaps["adj_part"].append([code, title, name, money(sum(series.values(), Decimal(0))), source])
            if buyout_rows_dated:
                plain, _ = rate_schedule(base_split, [], sorted(main_exact), rules)
                without = sum((q2(main_rounded[m] * plain[m][0] / 100) for m in months_set if plain.get(m)), Decimal(0))
                added = sum((label_series[m] for m in months_set), Decimal(0)) - without
                if added:
                    gaps["adj_buyout"].append([code, title, "; ".join(sorted({b["contract"] or str(b["id"])
                                                                              for b in buyout_rows_dated})),
                                               money(without), money(added)])
            missing = [m for m in sorted(main_exact) if schedule[m] is None]
            if missing:
                gaps["нет доли"].append([code, title, f"{missing[0]} — {missing[-1]}",
                                         money(sum((main_rounded[m] for m in missing), Decimal(0)))])
        elif status == "в периметре" and main_exact:
            gaps["3"].append([code, title, artist_line, money(sum(main_rounded.values(), Decimal(0)))])
        label_money[code] = label_series
        artist_money[code] = artist_series
        established_money[code] = established
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
                            # the parsed co-author cell also holds addresses and headings; only a known name counts
                            if person_key not in known_people:
                                continue
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
        established_total = sum(established.values(), Decimal(0)) if established else None

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
            agree = theirs in (party_coverage, "не оценено")
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
            "legal": legal, "legal_source": legal_source,
            "term": "; ".join(dict.fromkeys(terms)) or ("не применимо" if categories == [OWN] else ""),
            "territory": "; ".join(dict.fromkeys(territories)) or ("не применимо" if categories == [OWN] else ""),
            "scope": "; ".join(scope), "docs": "; ".join(sorted(recording_docs)) or "нет документа (статус на 02.11.2026)",
            "how": how,
            "chain_docs": chain_docs, "doc_list": sorted(recording_docs),
            "participants": "; ".join(f"{n} {float(r):g}%" for n, r in zip(split["names"], split["rates"]))
            if split and split["rates"] else "; ".join(split["names"]) if split else "",
            "per_party": "; ".join(f"{n}: {lvl or 'нет документа'}" for n, lvl, _, _, _ in part_results),
            "artist_docs": "; ".join(sorted({d for _, _, _, _, extra in part_results for d in extra})),
            "coverage": coverage, "party_coverage": party_coverage, "chain": "; ".join(chain),
            "receipts": receipts if status == "в периметре" else None,
            "receipts_out": receipts if status != "в периметре" else None, "in_scope": in_scope,
            "label": label_total, "artist": artist_total, "established": established_total, "annex": verdict,
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
                if not overlap or (docs[a]["sha"] and docs[a]["sha"] == docs[b]["sha"]):
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

    perimeter_now = {r["isrc"] for r in rows if r["status"] == "в периметре"}
    for item in imprint_totals:
        gaps["импринты"].append([item["account"], item["label"] or "(без имени)", item["lines"], money(item["net"]),
                                 len(item["isrc"]), len(item["isrc"] & perimeter_now)])

    # ---- checks before writing
    sheet_codes = [row["isrc"] for row in rows]
    LOGGER.check(len(sheet_codes) == len(set(sheet_codes)), "каждый ISRC встречается на листе «Записи» один раз")
    LOGGER.check(set(catalog) <= set(sheet_codes), f"все {len(catalog)} ISRC из отчётов Believe есть на листе")
    # the monthly sheets carry the perimeter (0to8) only; every other Believe ISRC keeps its receipts in its own column
    perimeter_codes = {r["isrc"] for r in rows if r["status"] == "в периметре"}
    revenue_out = {c: v for c, v in revenue.items() if c not in perimeter_codes}
    revenue = {c: v for c, v in revenue.items() if c in perimeter_codes}
    total_rows = sum((r["receipts"] or Decimal(0) for r in rows), Decimal(0))
    total_cells = sum((sum(s.values(), Decimal(0)) for s in revenue.values()), Decimal(0))
    LOGGER.check(total_rows == total_cells, f"поступления периметра: строки {total_rows} = помесячные ячейки {total_cells}")
    total_out = sum((r["receipts_out"] or Decimal(0) for r in rows), Decimal(0))
    LOGGER.check(total_out == sum((sum(s.values(), Decimal(0)) for s in revenue_out.values()), Decimal(0)),
                 f"поступления вне периметра на листе «Записи»: {total_out}")
    total_rows_all = total_rows + total_out
    ch_isrc_total = sum((sum(s.values(), Decimal(0)) for part in net.values() for s in part.values()), Decimal(0))
    no_isrc_total = sum((item["net"] for item in no_isrc), Decimal(0))
    believe_total = sum((amount for _, amount in ch_totals.values()), Decimal(0))
    LOGGER.check(abs(ch_isrc_total + no_isrc_total - believe_total) < Decimal("0.000001"),
                 f"строки с ISRC {q2(ch_isrc_total)} + без ISRC {q2(no_isrc_total)} = все строки Believe {q2(believe_total)}")
    LOGGER.check(abs(total_rows_all - q2(ch_isrc_total)) <= Decimal("0.01") * (len(revenue) + len(revenue_out)),
                 f"сумма ISRC после округления {total_rows}, точная {q2(ch_isrc_total)}")
    label_rows = sum((r["label"] or Decimal(0) for r in rows), Decimal(0))
    label_cells = sum((sum(s.values(), Decimal(0)) for s in label_money.values()), Decimal(0))
    LOGGER.check(label_rows == label_cells, f"доля лейбла: строки {label_rows} = помесячные ячейки {label_cells}")
    paid = defaultdict(Decimal)
    for item in royalty:
        if item["amount"] is not None:
            paid[item["isrc"]] += item["amount"]
    broken = [r["isrc"] for r in rows if r["established"] is not None and paid[r["isrc"]] != r["established"]]
    for code in broken[:5]:
        r = next(r for r in rows if r["isrc"] == code)
        LOGGER.info(f"  {code}: роялти {paid[code]}, с установленной долей {r['established']}")
    LOGGER.check(not broken, "лист «Роялти» по каждому ISRC сходится с поступлениями с установленной долей "
                             f"(расхождений {len(broken)})")
    # A recipient of the registered split must resolve to a party. A participation that is not in the
    # registered split is by its nature gap 3 of the specification: it is listed, it does not stop the build.
    in_split_missing = sorted({str(item["name"]) for item in royalty
                               if str(item["in_split"]).startswith("да") and item["party"] not in party_ids
                               and not str(item["name"]).startswith("участники не названы")})
    LOGGER.check(not in_split_missing, f"получатели зарегистрированного сплита разрешаются в party_id erp.db "
                                       f"(не разрешились: {len(in_split_missing)})")
    for name in in_split_missing[:10]:
        LOGGER.info(f"  без party_id: {name}")
    unresolved = sorted({str(item["name"]) for item in royalty if item["party"] not in party_ids})
    LOGGER.info(("ПРОБЕЛ " if unresolved else "OK    ") +
                f"получатели вне зарегистрированного сплита без party_id: {len(unresolved)} (пробел 3, лист «Сводка»)")
    contract_ids = set(docs)
    LOGGER.check(all(d in contract_ids for r in rows for d in r["doc_list"]),
                 "каждая ссылка на договор на листе «Записи» есть на листе «Договоры»")
    dated = sum(bool(r["first"]) for r in rows)
    LOGGER.check(all(r["first"] for r in rows if r["in_believe"] == "да"),
                 "дата первого релиза заполнена у каждой записи из отчётов Believe")
    LOGGER.check(all(r["first"] for r in rows if r["status"] == "в периметре"),
                 "дата первого релиза заполнена у 100% записей периметра")
    LOGGER.info(("ПРОБЕЛ " if dated < len(rows) else "OK    ") +
                f"дата первого релиза заполнена у {dated} из {len(rows)}; без даты — только записи вне Believe, пробел 7")
    LOGGER.info(("ПРОБЕЛ " if gaps["4"] else "OK    ") + f"лицензионные интересы без срока или территории: {len(gaps['4'])}")
    if LOGGER.failures:
        LOG.write_text("\n".join(LOGGER.lines) + "\n")
        raise SystemExit(f"сборка остановлена: {len(LOGGER.failures)} проверок не прошли")

    write_book(rows, docs, doc_links, related, replaced, royalty, links, gaps, revenue, label_money, artist_money,
               all_months, no_isrc, raw_report, split_stats, split_conflicts, unresolved, annex, main, splits,
               zero_files, zero_releases, ch_totals, first_month, last_month,
               extra={"advances": erp["advances"], "backstage_products": backstage, "duetti_parties": duetti_parties,
                      "zero_files": zero_files, "revenue": revenue, "label_money": label_money,
                      "established_money": established_money})
    LOG.write_text("\n".join(LOGGER.lines) + "\n")


# ---------------------------------------------------------------- writing

def write_book(rows, docs, doc_links, related, replaced, royalty, links, gaps, revenue, label_money, artist_money,
               months, no_isrc, raw_report, split_stats, split_conflicts, unresolved, annex, main, splits,
               zero_files, zero_releases, ch_totals, first_month, last_month, extra=None):
    status = (
        f"Сборка {VERSION}, {BUILD_DATE}, скрипт build-catalog-registries-v7.py. "
        f"Каталог и деньги: ClickHouse believe.rows, только загруженные файлы, аккаунты {MAIN_ACCOUNT} (believe/raw) и "
        f"{ECHO_ACCOUNT} (believe_echo8), отчётные месяцы {first_month}…{last_month}. Периметр: перечень Annex 14 "
        f"beta от 02.11.2026 (обновлено покрытие), причины исключения из его Sch1B; Duetti — ISRC из Schedule 1 договоров продажи. Ставки: финальный сплит "
        f"0to8_Splits_20260814.xlsx, без строки сплита — Catalog Shares из Annex 14 в его периоде; выкупы с даты "
        f"документа; решения владельца 02.11.2026 (саблейблы, мировое соглашение, доля лейбла 50%, ремиксеры). Договоры: PDF двух "
        f"папок и пакета DD 22.09.2026, sha256 сверен; каждая привязка проверена по тексту PDF (лист «Проверка "
        f"привязок»). 0to8 Main.xlsx только для сверки. Степень проверки: автоматическая, ручная проверка не "
        f"проводилась. Пустая ячейка значит, что в этих источниках факта нет."
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
        "Категория прав", "Наша доля, % (юридический интерес)", "Основание юридического интереса",
        "Экономическая доля лейбла, % net", "Источник экономической доли", "Срок", "Территория", "Объём разрешённого использования",
        "Договоры-основания", "Как запись идентифицирована в документе", "Документ по каждому участнику",
        "Договоры участников, где запись не названа", "Покрытие: запись названа в договоре",
        "Покрытие по сторонам: у каждого участника есть свой договор", "Участники сплита и ставки, %",
        "Чем право закреплено за FZ", "Поступления за период, $",
        "Поступления вне периметра (Echo8, Duetti и др.), $", "Поступления в периметре, аккаунт 1052428, $",
        "Доля лейбла за период, $", "Причитается участникам, $", "Сверка покрытия с Annex 14",
        "Поступления по Annex 14, $", "Доля лейбла по Annex 14, $",
    ])
    for r in rows:
        out.append([r["isrc"], r["title"], r["credits"], r["upc"], r["product"], r["first"], r["first_source"],
                    r["status"], r["reason"], r["imprint"], r["in_believe"], r["category"], r["legal"],
                    r["legal_source"], r["own"], r["own_source"],
                    r["term"], r["territory"], r["scope"], r["docs"], r["how"], r["per_party"], r["artist_docs"],
                    r["coverage"], r["party_coverage"], r["participants"], r["chain"], money(r["receipts"]),
                    money(r["receipts_out"]), money(r["in_scope"]),
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
    # documents the owner names as existing or pending that the developer does not hold: the status is fixed here,
    # the files are collected by hand later (owner's instruction of 2026-11-02)
    decisions = json.load(DECISIONS.open(encoding="utf-8")) if DECISIONS.exists() else {}
    expected = decisions.get("expected_documents", [])
    for item in expected:
        out.append([item["name"], item["type"], "ответы владельца 02.11.2026", "", "", item["party"], "", "", "",
                    "нет документа", item["status"], "", "", "", "", "", "", "", "", "", "", "", "", 0,
                    "нет документа", "нет документа"])

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
            out.append([name, "требуемое согласие", doc["clauses"]["согласие"], affected, "не назначен", "",
                        "не назначен"])
        for clause in ("синхронизация", "перезапись", "имя и изображение", "физические носители"):
            if clause in doc["clauses"]:
                out.append([name, "принятое ограничение", f"{clause}: {doc['clauses'][clause]}", affected,
                            "не назначен", "", "не назначен"])
        if "рекуп" in doc["clauses"]:
            out.append([name, "обременение", f"рекуп: {doc['clauses']['рекуп']}", affected, "не назначен", "",
                        "не назначен"])
    for kind, arrangement, what, sheet_name in annex["matters"]:
        out.append([arrangement, kind, f"{what} (Annex 14 beta, {sheet_name})", "", "не получено"
                    if kind == "требуемое согласие" else "не назначен", "до Completion", "не назначен"])

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

    revenue_total = matrix("Выручка по месяцам", revenue, "Только записи периметра 0to8.")
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
    with_doc = [r for r in in_rows if r["doc_list"]]
    summary.append(("В периметре с договором-основанием, записей / $",
                    f"{len(with_doc)} / {q2(sum((r['in_scope'] or Decimal(0) for r in with_doc), Decimal(0)))}"))
    without = [r for r in in_rows if not r["doc_list"]]
    summary.append(("В периметре без договора-основания, записей / $",
                    f"{len(without)} / {q2(sum((r['in_scope'] or Decimal(0) for r in without), Decimal(0)))}"))
    for how, count in sorted(Counter(r["how"] for r in in_rows).items()):
        summary.append((f"Как идентифицирована (в периметре): {how}", count))
    summary.append(("Поступления периметра 0to8, $", money(revenue_total)))
    summary.append(("Поступления записей вне периметра (Echo8, Duetti и др.), $",
                    money(sum((r["receipts_out"] or Decimal(0) for r in rows), Decimal(0)))))
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
    section("Отчёты Believe по аккаунтам и импринтам: не только 0to8; периметр — только 0to8 по Annex 14",
            ["Аккаунт", "Импринт в отчёте", "Строк отчёта", "Net, $", "ISRC", "Из них в периметре"],
            gaps["импринты"])
    section("Документы, которых нет у разработчика: статус зафиксирован, файлы дособираются вручную",
            ["Документ", "Тип", "Сторона", "Статус"],
            [[i["name"], i["type"], i["party"], i["status"]] for i in
             (json.load(DECISIONS.open(encoding="utf-8")) if DECISIONS.exists() else {}).get("expected_documents", [])])
    section("Выкупы, которые не легли на сплит", ["ISRC", "Запись", "Пояснение"], gaps["выкуп"])
    section("Саблейбл в Annex 14 без документа и без решения владельца: доля не вычтена",
            ["ISRC", "Запись", "Импринт", "Доля саблейбла в Annex 14, %", "Поступления в периметре, $"],
            sorted(gaps["саблейбл"], key=lambda x: -(x[4] or 0)))
    section("Производные записи вне авторизации ремиксера", ["ISRC", "Запись", "Ремиксер", "Статус в Annex 14",
                                                             "Пояснение", "Поступления в периметре, $"],
            gaps["производные"])
    section("Месяцы поступлений без установленной доли (вне периода Catalog Shares)",
            ["ISRC", "Запись", "Месяцы", "Поступления, $"], sorted(gaps["нет доли"], key=lambda x: -(x[3] or 0)))
    section("Дата подписания раньше даты документа", ["Идентификатор", "Дата документа", "Дата подписания"],
            [[n, d["date"], d["signed_on"]] for n, d in sorted(docs.items())
             if d["date"] and d["signed_on"] and d["signed_on"] < d["date"]])
    section("Получатели с суммой без party_id в erp.db", ["Получатель"], [[n] for n in unresolved])
    section("Конфликт ставок между строками сплита одного ISRC", ["ISRC", "Строки: доля лейбла, участники"],
            [[c, "; ".join(f"{a} [{b}]" for a, b in items)] for c, items in split_conflicts])

    write_schedules(book, status, rows, docs, doc_links, related, replaced, royalty, links, gaps, annex, extra, months)
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


# ---------------------------------------------------------------- Schedules 1 to 6 of the Transaction Agreement

class StrictSheet(CleanSheet):
    """A Schedule sheet: an empty cell is not disclosure (clause 6.1.2), so it stops the build."""

    def __init__(self, sheet, name, header):
        super().__init__(sheet)
        self.name, self.header, self.count = name, header, 0

    def append(self, values):
        if self.count >= 2:
            for position, value in enumerate(values):
                if value is None or (isinstance(value, str) and not value.strip()):
                    raise SystemExit(f"лист «{self.name}», строка {self.count + 1}, колонка "
                                     f"«{self.header[position]}»: пустая ячейка")
        self.count += 1
        super().append(values)


def or_reason(value, reason: str):
    if value is None or (isinstance(value, str) and not value.strip()):
        return reason
    return value


def write_schedules(book, status, rows, docs, doc_links, related, replaced, royalty, links, gaps, annex, extra,
                    months):
    def ssheet(name, header, note=""):
        item = StrictSheet(book.create_sheet(name), name, header)
        item.append([status + (" " + note if note else "")])
        item.append(header)
        return item

    by_code = {r["isrc"]: r for r in rows}
    perimeter = [r for r in rows if r["status"] == "в периметре"]
    excluded = [r for r in rows if r["status"] != "в периметре"]
    window = [m for m in months if "2024-01" <= m <= months[-1]]
    inside_window = set(window)
    # Schedule 3 Part C: one population, one period (clause 6.9.2)
    net_total = sum((v for r in perimeter for m, v in (extra["revenue"].get(r["isrc"]) or {}).items()
                     if m in inside_window), Decimal(0))
    nls_total = sum((v for r in perimeter for m, v in (extra["label_money"].get(r["isrc"]) or {}).items()
                     if m in inside_window), Decimal(0))
    established = sum((v for r in perimeter for m, v in (extra["established_money"].get(r["isrc"]) or {}).items()
                       if m in inside_window), Decimal(0))
    operative = {}
    for name, doc in docs.items():
        if name in replaced:
            operative[name] = "заменён: " + "; ".join(sorted(replaced[name]))
        elif doc.get("ghost"):
            operative[name] = "не установлено: файла нет, редакция не проверена"
        else:
            operative[name] = "действующая редакция: более поздней редакции с теми же записями не найдено"
    for item in gaps["10"]:
        for name in item[1:3]:
            operative[name] = "не определено: несколько редакций с одной датой подписи (пробел 10)"

    # ---- map
    out = ssheet("Schedule map", ["Schedule / Part", "Что требует договор", "Где в этой книге", "Статус сборки"])
    plan = [
        ("Sch 1 A", "реестр приобретаемых записей: запись и версия, ISRC, категория права, доля, пакет Sch 2, срок, "
                    "территория, объём", "Sch1A Каталог", "собрано из данных; правовые поля автоматически, по записям не проверены"),
        ("Sch 1 B", "исключённые записи: Duetti, Echo8, отозванные, прочие", "Sch1B Исключения", "собрано из данных"),
        ("Sch 1 C", "ассеты по четырём категориям", "Sch1C Ассеты", "частично: реестра доставки ассетов нет"),
        ("Sch 2 A", "реестр договоров и пакеты артистов", "Sch2A Договоры; Sch2A Пакеты артистов",
         "собрано из данных; способ передачи и распределение обязательств — решения по сделке"),
        ("Sch 2 B", "лицензии контрибьюторов и основание по каждому", "Sch2B Контрибьюторы", "собрано из данных"),
        ("Sch 2 C", "ограниченные лицензии и требуемые согласия", "Sch2C Согласия", "собрано из данных и Annex 14 beta"),
        ("Sch 2 D", "принятые ограничения", "Sch2D Ограничения", "кандидаты из текста договоров; покупателем не приняты"),
        ("Sch 3 A", "реестр роялти и участия вне сплита, комиссии каналов", "Sch3A Роялти; Sch3A Участия вне сплита; "
                    "Sch3A Комиссии", "собрано из данных; сроки, налог и эскалаторы — из текста договоров"),
        ("Sch 3 B", "авансы и исторические суммы", "Sch3B Авансы", "собрано из erp.db; режим на Completion не решён"),
        ("Sch 3 C", "справочная финансовая информация и две корректировки по ISRC", "Sch3C Финансы; Sch3C (i) Участия; "
                    "Sch3C (ii) Выкупы", "собрано из данных"),
        ("Sch 3 D", "принимаемые обязательства и администрирование", "Sch3D Обязательства",
         "частично: closing administration file не из данных"),
        ("Sch 4 A", "известные претензии", "Sch4A Претензии", "из Annex 14 beta; из данных ERP не формируется"),
        ("Sch 4 B", "вопросы документации", "Sch4B Документация", "собрано из данных и Annex 14 beta"),
        ("Sch 4 C", "отложенные пункты", "Sch4C Отложенные", "none"),
        ("Sch 4 D", "легаси-уступки и их охват по записям", "Sch4D Цепочка; Sch4D Охват", "собрано из данных"),
        ("Sch 5", "раскрытие", "Sch5 Раскрытие", "собрано из списков пробелов"),
        ("Sch 6", "банковские реквизиты продавца", "Sch6 Банк", "не из данных: вносит владелец"),
        ("п. 4.2.3", "индекс архива документации", "Договоры (колонки Файл и sha256 сверен)", "собрано из данных"),
        ("Фронтлайн", "счётчик продуктов по UPC для лимита сторонней дистрибуции", "Фронтлайн Продукты",
         "собрано из выгрузки Backstage"),
    ]
    for line in plan:
        out.append(list(line))

    # ---- Sch 1 A
    out = ssheet("Sch1A Каталог", ["ISRC", "Запись и версия", "Тип продукта", "Категория права",
                                   "Приобретаемая доля (юридический интерес)", "Основание доли",
                                   "Договорный пакет (Sch 2)", "Срок", "Территория", "Разрешённый объём",
                                   "Как запись идентифицирована", "Покрытие"],
                 "Одна строка — одна приобретаемая запись (периметр).")
    for r in perimeter:
        owned_only = r["category"] == OWN
        out.append([
            r["isrc"], or_reason(r["title"], "не установлено: названия нет в отчётах и сплите"),
            or_reason(r["product"], "не установлено: тип продукта не указан в источниках"),
            or_reason(r["category"], "не установлено: нет документа, который называет запись"),
            r["legal"] if r["legal"] != "" else "не установлено",
            or_reason(r["legal_source"], "правило владельца 02.11.2026 по типу основания"),
            "; ".join(r["doc_list"]) or "нет документа (статус на 02.11.2026)",
            "не применимо: собственный мастер-копирайт" if owned_only or r["term"] == "не применимо"
            else or_reason(r["term"], "не установлено: срок не найден в тексте документов записи"),
            "не применимо: собственный мастер-копирайт" if owned_only or r["territory"] == "не применимо"
            else or_reason(r["territory"], "не установлено: территория не найдена в тексте документов записи"),
            or_reason(r["scope"], "не установлено: ограничений по медиа, синхронизации и производным в тексте не найдено"),
            or_reason(r["how"], "не идентифицирована"), or_reason(r["coverage"], "not covered"),
        ])

    # ---- Sch 1 B
    out = ssheet("Sch1B Исключения", ["ISRC", "Запись", "Артисты", "Категория исключения", "Причина и источник"])
    counts = Counter()
    for r in excluded:
        word = r["reason"].split(":")[0]
        category = {"Duetti": "Duetti Agreements", "Echo8": "identified Echo8 repertoire",
                    "отозвана": "withdrawn recordings"}.get(word, "other expressly excluded recordings")
        counts[category] += 1
        out.append([r["isrc"], or_reason(r["title"], "не установлено: названия нет в источниках"),
                    or_reason(r["credits"], "не установлено"), category, or_reason(r["reason"], "иное")])
    credited = sorted(r["isrc"] for r in perimeter
                      if any(key(c) in extra["duetti_parties"] for c in r["credits"].split("; ")))
    out.append(["контроль", "записи с кредитом продавцов Duetti, оставленные в периметре", str(len(credited)),
                "не исключены только по кредиту (Sch 1 B)", "; ".join(credited[:50]) or "none"])

    # ---- Sch 1 C
    files = sum(len(entry.get("f") or []) for entry in extra["zero_files"].values())
    likeness = sum(1 for d in docs.values() if "имя и изображение" in d["clauses"])
    out = ssheet("Sch1C Ассеты", ["Категория", "Приобретаемый интерес", "Что есть в данных"])
    out.append(["Artwork and release assets", "собственные права на обложки и промо по реестру доставки ассетов",
                "не установлено: реестра доставки ассетов (asset-delivery register) в данных нет; обложек и видео нет"])
    out.append(["Names, likenesses and biographies", "договорные разрешения на имена и образы артистов",
                f"пункт об имени и образе найден в тексте {likeness} договоров; остальные — не установлено"])
    out.append(["Files, metadata and records", "мастер-файлы, стемы, метаданные, учёт прав и роялти",
                f"мастер-файлов в выгрузке Zero: {files} по {len(extra['zero_files'])} отгрузкам; стемов нет; "
                "метаданные и роялти — эта книга"])
    out.append(["Additional branded or online assets", "none", "none"])

    # ---- Sch 2 A
    out = ssheet("Sch2A Договоры", [
        "Договор", "Тип", "Стороны", "Поправки и приложения", "Предоставленные права", "Приобретаемая доля",
        "Срок", "Продление и уведомление", "Реверсия", "Территория", "Существенные ограничения",
        "Уступка по тексту договора", "Способ передачи (п. 2.3–2.5)", "Согласие на сделку",
        "Одобрения отдельных использований", "Распределение обязательств", "Статус редакции", "Подписание",
        "Записей в периметре", "Записей вне периметра"])
    perimeter_codes = {r["isrc"] for r in perimeter}
    for name in sorted(docs):
        doc = docs[name]
        if doc["kind"] not in RIGHTS | {"divestment"} or doc["kind"] == "test":
            continue
        codes = doc_links.get(name, set())
        inside = len(codes & perimeter_codes)
        outside = len(codes - perimeter_codes)
        terms = doc.get("terms") or {}
        assignment = terms.get("assignment", "")
        if doc["kind"] in {"recording", "schedule", "addendum"}:
            if "только целиком" in assignment:
                consent = ("не требуется для уступки договора целиком; для уступки каталожной части (п. 2.5) — "
                           "нужно согласие артиста")
                if outside:
                    consent += f"; договор называет {outside} записей вне периметра — целиком без выделения не передаётся"
            elif "целиком или частично" in assignment:
                consent = "не требуется: договор разрешает уступку целиком или частично"
            else:
                consent = "не установлено: пункт об уступке не распознан"
        elif doc["kind"] in {"sample", "contributor"}:
            consent = "не установлено: проверить пункт об уступке лицензии (Sch 2 C)"
        else:
            consent = "не применимо: документ не передаётся покупателю как договор, он подтверждает титул"
        share = [t.get("royalty_digital_percent") for t in doc["tracks"] if t.get("royalty_digital_percent") is not None]
        out.append([
            name, doc["type"], or_reason("; ".join(sorted(doc["aliases"])), "не установлено: сторона не распознана"),
            "; ".join(sorted(related.get(name, ()))) or "не найдено: других документов с тем же номером нет",
            {"recording": "исключительная лицензия на запись и распространение",
             "schedule": "перечень записей к договору с артистом",
             "transfer": "уступка исключительных прав на записи", "chain": "уступка на FZ по цепочке титула",
             "purchase": "выкуп прав на записи", "partial_purchase": "выкуп части прав",
             "contributor": "разрешение на производную запись", "sample": "разрешение на сэмпл или вокал",
             "work_for_hire": "результат работ по найму", "sublabel": "саблейбл", "divestment": "продажа записей",
             "settlement": "мировое соглашение", "participation": "участие в роялти",
             "addendum": "изменение договора", "co_ownership": "совместное владение"}.get(doc["kind"], doc["type"]),
            (f"ставка артиста по таблице: {Counter(share).most_common(1)[0][0]}% net (не юридическая доля)" if share
             else "не установлено: доля в тексте не извлечена"),
            or_reason(doc["term"], "не установлено: срок в тексте не найден"),
            or_reason(terms.get("renewal"), "не установлено: пункт о продлении в тексте не найден"),
            or_reason(terms.get("reversion"), "не найдено: пункта о реверсии в тексте нет"),
            or_reason(doc["territory"], "не установлено: территория в тексте не найдена"),
            or_reason("; ".join(f"{k}: «{v}»" for k, v in doc["clauses"].items() if k != "согласие"),
                      "в тексте не найдено: ограничений по медиа, синхронизации, физике, производным, имени"),
            or_reason(assignment, "не установлено: пункт об уступке не найден"),
            "не назначен: решение по сделке (уступка целиком, каталожной части, сублицензия или новация)",
            consent,
            or_reason(doc["clauses"].get("согласие"), "в тексте не найдено"),
            "не распределено: решение по сделке (п. 2.5.1)", operative.get(name, "не установлено"),
            f"{doc['signed']}" + (f", {doc['signed_on']}" if doc["signed_on"] else ""),
            inside, outside,
        ])
    for item in (json.load(DECISIONS.open(encoding="utf-8")) if DECISIONS.exists() else {}).get("expected_documents", []):
        out.append([item["name"], item["type"], item["party"], "нет документа", "нет документа", "нет документа",
                    "нет документа", "нет документа", "нет документа", "нет документа", "нет документа",
                    "нет документа", "не назначен", "нет документа", "нет документа", "не распределено",
                    item["status"], "нет документа", 0, 0])

    # ---- Sch 2 A packages
    out = ssheet("Sch2A Пакеты артистов", ["Артист", "Действующие договоры и приложения", "Заменённые редакции",
                                           "Записей в периметре", "Записей вне периметра в этих договорах",
                                           "Единица передачи"])
    by_artist = defaultdict(set)
    for code, _, participant, doc_name, level, *_ in links:
        if doc_name and doc_name in docs and docs[doc_name]["kind"] in {"recording", "schedule", "addendum"} \
                and level in LEVELS + ["только по артисту"]:
            by_artist[participant].add(doc_name)
    for artist in sorted(by_artist, key=str.lower):
        names = by_artist[artist]
        live = sorted(n for n in names if n not in replaced)
        old = sorted(n for n in names if n in replaced)
        codes = set().union(*[doc_links.get(n, set()) for n in live]) if live else set()
        inside, outside = len(codes & perimeter_codes), len(codes - perimeter_codes)
        why = Counter(by_code[c]["reason"].split(":")[0] for c in codes - perimeter_codes if c in by_code)
        carved = sum(v for k, v in why.items() if k in ("Echo8", "Duetti", "отозвана"))
        unknown = why.get("иное", 0)
        if carved:
            unit = (f"каталожная часть с согласием артиста (п. 2.5): договоры называют исключённые записи — "
                    + ", ".join(f"{k} {v}" for k, v in sorted(why.items()) if k != "иное"))
        else:
            unit = "договор целиком: исключённых записей договоры не называют"
        if unknown:
            unit += (f"; ещё {unknown} записей из договоров нет ни в отчётах Believe, ни в периметре — "
                     "проверить, выпускались ли")
        unit += "; будущие релизы по договору зарезервированы продавцом — проверить"
        out.append([artist, "; ".join(live) or "нет действующей редакции", "; ".join(old) or "none", inside, outside,
                    unit])

    # ---- Sch 2 B
    out = ssheet("Sch2B Контрибьюторы", ["Контрибьютор или договор", "Основание", "Записи",
                                         "Режим передачи", "Риск по п. 6.6.1"])
    groups = defaultdict(lambda: defaultdict(set))
    for code, _, participant, doc_name, level, *_ in links:
        if code not in perimeter_codes or participant in ("не участник сплита", "цепочка на FZ"):
            continue
        if doc_name and docs.get(doc_name, {}).get("kind") in {"sample", "contributor"}:
            groups[f"{participant} — {doc_name}"]["лицензия контрибьютора или сэмпла"].add(code)
        elif level == "назван соавтором в чужом договоре":
            groups[participant]["назван соавтором только в договоре другой стороны"].add(code)
        elif level == "не идентифицирована":
            groups[participant]["только зарегистрированный сплит, документа нет"].add(code)
    for name in sorted(groups, key=str.lower):
        for basis, codes in sorted(groups[name].items()):
            out.append([name, basis, f"{len(codes)}: " + "; ".join(sorted(codes)[:30]),
                        "не назначен: сублицензия или уступка по решению сделки (п. 2.7)",
                        "нет: есть документ" if basis.startswith("лицензия") else
                        "да: кредит или сплит не заменяет предоставление прав"])

    # ---- Sch 2 C
    out = ssheet("Sch2C Согласия", ["Договорённость", "Требуемое согласие", "Действие к Completion", "Источник"])
    for kind, arrangement, what, sheet_name in annex["matters"]:
        if kind == "требуемое согласие":
            out.append([arrangement, what or "не установлено", "получить до Completion (п. 2.6.1)",
                        f"Annex 14 beta, {sheet_name}"])
    mixed = sum(1 for a in by_artist.values()
                if any(by_code.get(c, {}).get("reason", "").split(":")[0] in ("Echo8", "Duetti", "отозвана")
                       for n in a if n not in replaced for c in doc_links.get(n, set()) - perimeter_codes))
    out.append(["договоры с артистами, где названы записи вне периметра", f"согласие артиста на уступку каталожной "
                f"части, договор называет исключённые записи (Echo8, Duetti, отозванные): таких артистов {mixed} "
                "(лист «Sch2A Пакеты артистов»)", "решить по каждому пакету",
                "текст договоров: уступка разрешена только целиком"])

    # ---- Sch 2 D
    out = ssheet("Sch2D Ограничения", ["Договорённость", "Конкретное ограничение", "Статус"])
    out.append(["все договоры", "ни одно ограничение пока не принято покупателем (Sch 2 D)", "не согласовано"])
    for name in sorted(docs):
        doc = docs[name]
        if doc["kind"] in RIGHTS and doc_links.get(name, set()) & perimeter_codes:
            for clause in ("синхронизация", "физические носители", "производные", "имя и изображение"):
                if clause in doc["clauses"]:
                    out.append([name, f"{clause}: «{doc['clauses'][clause]}»", "кандидат: не принято покупателем"])

    # ---- Sch 3 A
    out = ssheet("Sch3A Роялти", ["Получатель", "Идентификатор получателя", "Запись", "Договор", "База расчёта",
                                  "Ставка, %", "Сумма за период, $", "Эскалаторы", "Разрешённые удержания",
                                  "Сроки отчётов и выплат", "Налоговое удержание", "Авансы и рекуп",
                                  "Чьё обязательство", "Учтено один раз", "Период", "Отражено в сплите", "Источник"])
    for item in royalty:
        first = next((d for d in str(item["docs"] or "").split("; ") if d in docs), "")
        terms = docs[first]["terms"] if first else {}
        no_doc = "не установлено: нет договора-основания"
        out.append([
            item["name"], item["party"] if item["party"] != "" else "нет party_id: участие вне зарегистрированного сплита",
            item["isrc"], first or "нет документа",
            item["base"] + (f"; по договору: «{terms['base']}»" if terms.get("base") else ""),
            float(item["rate"]) if item["rate"] is not None else "не установлено: ставка в договоре не извлечена",
            money(item["amount"]) if item["amount"] is not None else "не рассчитано: ставки нет",
            (f"«{terms['escalator']}»" if terms.get("escalator") else "не предусмотрены: в тексте договора нет")
            if first else no_doc,
            "только по Sch 3 A: НДС, комиссии каналов (EasyStaff 6%, Tipalti 0,5%), возвраты"
            + (f"; рекупируемые расходы: «{terms['recoup']}»" if terms.get("recoup") else ""),
            (f"«{terms['accounting']}»" if terms.get("accounting") else "не установлено: пункт в тексте не найден")
            if first else no_doc,
            (f"«{terms['withholding']}»" if terms.get("withholding") else "не установлено: пункт в тексте не найден")
            if first else no_doc,
            "открытые авансы — лист «Sch3B Авансы»; право рекупа остаётся у продавца (Sch 3 B)",
            "покупатель фондирует выплаты с поступлений после Completion (п. 5, Sch 3 D)",
            "да: зарегистрированный сплит, вычитается один раз" if str(item["in_split"]).startswith("да")
            else "да: вне зарегистрированного сплита, из доли лейбла один раз",
            or_reason(item["period"], "не рассчитан: нет поступлений"), item["in_split"], item["source"],
        ])
    out = ssheet("Sch3A Участия вне сплита", ["Получатель", "Записей", "Основание", "Правило", "Отражено в сплите"])
    outside_by = defaultdict(lambda: [set(), set()])
    for item in royalty:
        if str(item["in_split"]) == "нет" and item["amount"] is not None:
            outside_by[item["name"]][0].add(item["isrc"])
            outside_by[item["name"]][1].add(item["source"])
    for name in sorted(outside_by, key=str.lower):
        codes, sources = outside_by[name]
        rates = sorted({str(q2(Decimal(str(i["rate"])))) for i in royalty
                        if i["name"] == name and i["rate"] is not None and str(i["in_split"]) == "нет"})
        out.append([name, len(codes), "; ".join(sorted(sources))[:500],
                    "ставка в месяцах с поступлениями, % net: " + ", ".join(rates[:6]), "нет"])
    out = ssheet("Sch3A Комиссии", ["Статья", "Ставка", "Режим"])
    out.append(["EasyStaff", "6%", "фондирует покупатель сверх суммы получателю (Sch 3 A b)"])
    out.append(["Tipalti", "0,5%", "фондирует покупатель сверх суммы получателю (Sch 3 A b)"])
    out.append(["Комиссия Future Distribution Agreement 15%", "none", "к каталогу не применяется (Sch 3 A)"])

    # ---- Sch 3 B
    out = ssheet("Sch3B Авансы", ["Получатель", "Дата", "Аванс, $", "Остаток, $", "Откуда гасится", "Статус",
                                  "Режим на Completion", "Влияние на срок лицензии", "Право рекупа"])
    for adv in extra["advances"]:
        out.append([or_reason(adv["party"], "не установлено"), or_reason(adv["date"], "не установлено"),
                    money(Decimal(str(adv["amount"] or 0))), money(Decimal(str(adv["remaining"] or 0))),
                    or_reason(adv["recoup_from"], "не установлено"), adv["status"],
                    "не решено: погасить, освободить или оставить со взысканием только из Future Releases",
                    "не установлено: проверить, привязан ли срок договора к рекупу",
                    "остаётся у продавца, не Transferred Receivable (Sch 3 B)"])

    # ---- Sch 3 C
    out = ssheet("Sch3C Финансы", ["Строка договора", "Значение"])
    part_total = sum((Decimal(str(x[3] or 0)) for x in gaps["adj_part"]), Decimal(0))
    buy_total = sum((Decimal(str(x[4] or 0)) for x in gaps["adj_buyout"]), Decimal(0))
    video = sum((r["receipts"] or Decimal(0) for r in perimeter if "audio" not in r["product"]), Decimal(0))
    out.append(["Reference period", f"{window[0]} — {window[-1]}: последний закрытый отчётный месяц в данных; "
                                    "на Completion продлить до последнего закрытого месяца (гарантия 6.9.4)"])
    out.append(["Final reconciliation file, date and version", f"{OUT.name}, {BUILD_DATE}, {VERSION}"])
    out.append(["Matched acquisition population", f"{len(perimeter)} записей = Sch1A; исключено {len(excluded)}: "
                + "; ".join(f"{k} {v}" for k, v in sorted(counts.items()))])
    out.append(["Net revenues for that population and period",
                f"US${q2(net_total)} ({window[0]}…{window[-1]}, записи Sch1A, оба аккаунта Believe по этим ISRC)"])
    pct = (nls_total / established * 100).quantize(Decimal("0.1")) if established else Decimal(0)
    out.append(["Net Label Share after all continuing participations",
                f"US${q2(nls_total)}; {pct}% от поступлений аккаунта 1052428 с установленной долей за тот же период "
                f"(US${q2(established)}); база — net, которую лейбл получил от Believe"])
    out.append(["Estimates, non-recurring items and agreed adjustments", "none"])
    out.append(["Outstanding Transferred Receivables at Completion",
                "не входит в данные книги: выписка по п. 3.3.4 готовится отдельным файлом"])
    out.append(["Сверка: Duetti, Echo8, прочие исключения", "; ".join(f"{k}: {v}" for k, v in sorted(counts.items()))])
    out.append(["Сверка: не-аудио продукты в периметре", f"US${q2(video)} поступлений клипов и рингтонов"])
    out.append(["(i) Участия вне зарегистрированного сплита", f"US${q2(part_total)}: лист «Sch3C (i) Участия»"])
    out.append(["(ii) Прибавка доли лейбла от выкупов и уступок", f"US${q2(buy_total)}: лист «Sch3C (ii) Выкупы»"])
    out = ssheet("Sch3C (i) Участия", ["ISRC", "Запись", "Получатель", "Сумма за период, $", "Основание"])
    for line in gaps["adj_part"]:
        out.append([line[0], or_reason(line[1], "не установлено"), line[2], line[3], or_reason(line[4], "см. Роялти")])
    out = ssheet("Sch3C (ii) Выкупы", ["ISRC", "Запись", "Выкупы", "Доля лейбла без выкупов, $",
                                       "Прибавка от выкупов, $"])
    for line in gaps["adj_buyout"]:
        out.append([line[0], or_reason(line[1], "не установлено"), or_reason(line[2], "реестр выкупов"),
                    line[3], line[4]])

    # ---- Sch 3 D
    out = ssheet("Sch3D Обязательства", ["Обязательство", "Значение"])
    out.append(["Фондируемые Third-Party Payments", "выплаты по листу «Sch3A Роялти» с поступлений после Completion"])
    out.append(["Продолжающиеся обязанности", "кредиты, одобрения и ограничения использования — «Sch2A Договоры»"])
    out.append(["Более широкие обязательства по требованию контрагента", "none"])
    out.append(["Дополнительные сервисные или минимальные платежи", "none"])
    out.append(["Административное вознаграждение продавца", "nil; покупатель оплачивает комиссии Sch 3 A"])
    out.append(["Closing administration file", "не входит в данные книги: готовится отдельным файлом"])
    out.append(["Крупные авансовые платежи и предоплаченные лицензии", "none в данных книги"])

    # ---- Sch 4
    out = ssheet("Sch4A Претензии", ["Претензия", "Затронутые записи и режим", "Источник"])
    claims = [m for m in annex["matters"] if m[0] == "известная претензия"]
    for _, arrangement, what, sheet_name in claims:
        out.append([arrangement, or_reason(what, "не установлено"), f"Annex 14 beta, {sheet_name}"])
    if not claims:
        out.append(["не установлено", "в данных книги претензий нет", "нет источника"])
    out = ssheet("Sch4B Документация", ["Вопрос", "Требуемое действие и защита", "Источник"])
    for kind, arrangement, what, sheet_name in annex["matters"]:
        if kind == "вопрос документации":
            out.append([arrangement, or_reason(what, "не установлено"), f"Annex 14 beta, {sheet_name}"])
    unsigned = sorted(n for n, d in docs.items() if not d.get("ghost") and d["signed"] not in ("подписан всеми",)
                      and d["kind"] in RIGHTS)
    out.append(["договоры без подписи всех сторон по сертификату", f"{len(unsigned)}: " + "; ".join(unsigned[:40])
                if unsigned else "none", "лист «Договоры»"])
    for item in (json.load(DECISIONS.open(encoding="utf-8")) if DECISIONS.exists() else {}).get("expected_documents", []):
        out.append([item["name"], item["status"], "ответы владельца 02.11.2026"])
    out = ssheet("Sch4C Отложенные", ["Пункт и затронутые права", "Допустимый временный режим", "Действие и срок"])
    out.append(["none", "none", "none"])
    out = ssheet("Sch4D Цепочка", ["Цедент", "Документ", "Подписание", "Записей в периметре по тексту документа"])
    chain_docs = sorted(n for n, d in docs.items() if d["kind"] == "chain")
    for name in chain_docs:
        doc = docs[name]
        out.append([or_reason("; ".join(sorted(doc["aliases"])), "цедент не распознан"), name,
                    f"{doc['signed']}" + (f", {doc['signed_on']}" if doc["signed_on"] else ""),
                    len(doc_links.get(name, set()) & perimeter_codes)])
    out = ssheet("Sch4D Охват", ["ISRC", "Запись", "Документ цепочки"])
    for name in chain_docs:
        for code in sorted(doc_links.get(name, set()) & perimeter_codes):
            out.append([code, or_reason(by_code[code]["title"], "не установлено"), name])

    # ---- Sch 5
    out = ssheet("Sch5 Раскрытие", ["Запись раскрытия / гарантия", "Конкретное раскрытие", "Ссылка на документ"])
    no_doc = [r for r in perimeter if not r["doc_list"]]
    entries = [
        ("6.5.1, 6.6.1: записи без договора-основания", f"{len(no_doc)} записей периметра, "
         f"US${q2(sum((r['receipts'] or Decimal(0) for r in no_doc), Decimal(0)))}", "Сводка, пробел 1"),
        ("6.6.1: соавторы только в чужом договоре или только в сплите",
         f"{sum(1 for n in groups for b in groups[n] if not b.startswith('лицензия'))} групп", "Sch2B Контрибьюторы"),
        ("6.9.1: ставки договора и сплита расходятся", f"{len(gaps['2'])} строк", "Сводка, пробел 2"),
        ("6.5.2: срок или территория не установлены", f"{len(gaps['4'])} записей", "Сводка, пробел 4"),
        ("6.5.1: неподписанные документы", f"{len(unsigned)} документов", "Sch4B Документация"),
        ("6.5.1: несколько редакций без выбранной", f"{len(gaps['10'])} пар", "Сводка, пробел 10"),
        ("6.3.3: записи в периметре, которые есть и в исключённых источниках", f"{len(gaps['9'])} записей",
         "Сводка, пробел 9"),
        ("6.10.1: расхождения каталога, денег и договоров", "сверки с Annex 14 и 0to8 Main",
         "Сверка с Annex 14; Сверка с Main"),
        ("Additional entries", "none", "none"),
    ]
    for line in entries:
        out.append(list(line))

    # ---- Sch 6
    out = ssheet("Sch6 Банк", ["Реквизит", "Значение"])
    for particular in ("Account holder", "Bank name", "Bank address", "Account number", "IBAN", "SWIFT / BIC",
                       "Any intermediary bank details"):
        out.append([particular, "не из данных ERP: вносит владелец на Completion"])
    out.append(["Account currency", "USD"])

    # ---- frontline product counter
    out = ssheet("Фронтлайн Продукты", ["Лейбл в Backstage", "Продуктов (UPC)", "из них 1 трек", "2–6 треков",
                                        "7 и более", "Первый релиз", "Последний релиз"],
                 "Лимит сторонней дистрибуции считается по продуктам (UPC), не по ISRC.")
    groups_bs = defaultdict(list)
    for upc, (day, label, tracks) in sorted(extra["backstage_products"].items()):
        groups_bs[label or "без лейбла"].append((day, tracks))
    for label in sorted(groups_bs, key=str.lower):
        items = groups_bs[label]
        out.append([label, len(items), sum(1 for _, t in items if t == 1), sum(1 for _, t in items if 2 <= t <= 6),
                    sum(1 for _, t in items if t >= 7), min(d for d, _ in items), max(d for d, _ in items)])


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
