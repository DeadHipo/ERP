"""Third catalog registry for the 2026-11-01 specification.

Sources, and only these:
- ClickHouse believe.rows (both Believe accounts already loaded)
- the final split workbook 0to8_Splits_20260814.xlsx
- Annex 14, for the months on which a share was established
- context_data/contract_index/documents.json and texts.jsonl

erp.db is not read. Artist rates are the split's collaborator rates.
The label rate in the final split is sum_rates. Where Annex 14 has a monthly
NLS, that amount is the label share for that month. Months Annex 14 marks
"no share" are left empty. The artist amount is the established receipts
minus that label share. It is the sum due under the split, not a bank payment.
"""

from __future__ import annotations

import base64
import json
import os
import re
import subprocess
import unicodedata
import urllib.request
import zipfile
from collections import defaultdict
from datetime import datetime
from decimal import Decimal, ROUND_HALF_UP
from pathlib import Path

import openpyxl
from openpyxl import Workbook
from openpyxl.cell import WriteOnlyCell

ROOT = Path("/Users/nearlydeadhipo/Desktop/0to8/ERP")
ENV_PATH = ROOT / ".env"
SPLITS = ROOT / "context_data/ERP_data/splits/raw/0to8_Splits_20260814.xlsx"
ANNEX = Path("/Users/nearlydeadhipo/Downloads/Annex 14 — contractual coverage by recording.xlsx")
DOCS = ROOT / "context_data/contract_index/documents.json"
TEXTS = ROOT / "context_data/contract_index/texts.jsonl"
OUT = ROOT / "context_data/contract_index/реестры_каталога_2026-08_v3.xlsx"
LOG = ROOT / "context_data/contract_index/реестры_каталога_2026-08_v3.log"
CENT = Decimal("0.01")
STAMP = (2026, 10, 26, 0, 0, 0)

KIND_TYPE = {
    "recording": "договор с артистом",
    "schedule": "приложение SCHEDULE",
    "sample_license": "лицензия на сэмпл",
    "asset_purchase": "выкуп",
    "assignment": "уступка",
    "sublabel": "саблейбл",
    "co_pub": "паблишинг",
    "remix": "лицензия контрибьютора",
    "beat_purchase": "выкуп",
    "beat_lease": "лицензия на сэмпл",
    "co_ownership": "договор с артистом",
    "work_for_hire": "договор с артистом",
    "advance": "договор с артистом",
    "caa": "прочее",
    "imro": "заявление IMRO",
    "w8": "форма W-8BEN",
    "nda": "NDA",
    "indemnification": "письмо",
    "consulting": "консалтинг",
    "other": "прочее",
}
RIGHTS_KINDS = {
    "recording", "schedule", "sample_license", "asset_purchase", "assignment",
    "sublabel", "remix", "beat_purchase", "beat_lease", "co_ownership",
    "work_for_hire", "advance", "co_pub",
}
COMPLETED_RE = re.compile(
    r"document completed by all parties on:?\s+(\d{1,2}\s+[A-Za-z]{3,9}\s+\d{4})",
    re.I,
)
SIGNED_RE = re.compile(r"\bSigned:?\s+(\d{1,2}\s+[A-Za-z]{3,9}\s+\d{4})", re.I)
MONTHS = {
    "jan": 1, "feb": 2, "mar": 3, "apr": 4, "may": 5, "jun": 6,
    "jul": 7, "aug": 8, "sep": 9, "oct": 10, "nov": 11, "dec": 12,
}


def load_env() -> dict[str, str]:
    env: dict[str, str] = {}
    for line in ENV_PATH.read_text().splitlines():
        line = line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, value = line.split("=", 1)
        env[key] = value
    return env


def clickhouse(env: dict[str, str], query: str) -> str:
    request = urllib.request.Request(
        f"http://127.0.0.1:{env['CLICKHOUSE_HTTP_PORT']}/",
        data=query.encode(),
        method="POST",
    )
    token = base64.b64encode(
        f"{env['CLICKHOUSE_USERNAME']}:{env['CLICKHOUSE_PASSWORD']}".encode()
    ).decode()
    request.add_header("Authorization", "Basic " + token)
    with urllib.request.urlopen(request, timeout=600) as response:
        return response.read().decode()


def postgres_copy(env: dict[str, str], sql: str) -> str:
    result = subprocess.run(
        [
            "docker", "exec", "-e", f"PGPASSWORD={env['DB_PASSWORD']}",
            "royalty-erp-postgres-1", "psql", "-U", env["DB_USERNAME"],
            "-d", env["DB_DATABASE"], "-At", "-F", "\t", "-c", sql,
        ],
        capture_output=True, text=True, check=True,
    )
    return result.stdout


def money(value: Decimal) -> float:
    return float(value.quantize(CENT, rounding=ROUND_HALF_UP))


def q2(value: Decimal) -> Decimal:
    return value.quantize(CENT, rounding=ROUND_HALF_UP)


def allocate(exact: dict[str, Decimal], target: Decimal) -> dict[str, Decimal]:
    """Round each month to cents and put the residue on the last month.

    The months then sum to the once-rounded row total.
    """
    keys = sorted(exact)
    rounded = {key: q2(exact[key]) for key in keys}
    if not keys:
        return rounded
    drift = target - sum(rounded.values(), Decimal(0))
    rounded[keys[-1]] = rounded[keys[-1]] + drift
    return rounded


def norm_isrc(value) -> str:
    return re.sub(r"[^A-Z0-9]", "", str(value or "").upper())


def norm_title(value: str) -> str:
    text = unicodedata.normalize("NFKD", value or "")
    text = "".join(char for char in text if not unicodedata.combining(char))
    text = text.lower().replace("ё", "е")
    return re.sub(r"[^a-z0-9а-я]+", "", text)


def norm_name(value: str) -> str:
    text = (value or "").lower().replace("ё", "е")
    return re.sub(r"[^a-z0-9а-я]+", " ", text).strip()


def iso_from_dmy(day: int, month: int, year: int) -> str:
    try:
        return datetime(year, month, day).date().isoformat()
    except ValueError:
        return ""


def filename_bits(name: str) -> tuple[str, str]:
    stem = re.sub(r"\.pdf$", "", name, flags=re.I)
    match = re.search(r"(?:#|_)(\d{2})(\d{2})(\d{4})(?!\d)", stem)
    if match:
        day, month, year = (int(match.group(1)), int(match.group(2)), int(match.group(3)))
        rest = stem[match.end():]
    else:
        match = re.search(r"(?:#|_)(\d{2})(\d{2})(\d{2})(?!\d)", stem)
        if not match:
            return "", ""
        day, month = int(match.group(1)), int(match.group(2))
        year = 2000 + int(match.group(3))
        rest = stem[match.end():]
    found = iso_from_dmy(day, month, year) if 2018 <= year <= 2030 else ""
    nick = re.sub(r"[()]+", " ", rest or "")
    nick = re.split(r"(?i)_RU_ENG|_ENG_RU|_RUS_ENG|_PT_ENG|_ENG_ES|_EN_RU|_EN_SP", nick)[0]
    nick = re.sub(r"\s+", " ", nick).strip(" _-.#")
    return found, nick


def stamp_iso(raw: str) -> str:
    match = re.match(r"(\d{1,2})\s+([A-Za-z]{3,9})\s+(\d{4})", raw.strip())
    if not match:
        return ""
    month = MONTHS.get(match.group(2)[:3].lower())
    if not month:
        return ""
    return iso_from_dmy(int(match.group(1)), month, int(match.group(3)))


def signature_of(text: str) -> tuple[str, str, str]:
    completed = COMPLETED_RE.search(text or "")
    if completed:
        return "подписан всеми", stamp_iso(completed.group(1)), "сертификат: document completed by all parties"
    signed = SIGNED_RE.findall(text or "")
    if len(signed) >= 2:
        return "подписан всеми", stamp_iso(signed[-1]), f"сертификат: подписей с датой {len(signed)}"
    if len(signed) == 1:
        return "подписан одной стороной", stamp_iso(signed[0]), "сертификат: одна подпись с датой"
    return "не подписан", "", "в тексте PDF нет сертификата подписи с датой"


def territory_of(text: str) -> str:
    low = (text or "").lower()
    if any(phrase in low for phrase in (
        "throughout the universe", "throughout the world", "worldwide", "whole world", "entire world",
    )):
        return "весь мир"
    return ""


def product_type(raw: str) -> str:
    low = (raw or "").lower()
    if not low:
        return ""
    if "video" in low:
        return "music video"
    if "ringtone" in low or "ring" in low:
        return "ringtone"
    if low in {"album", "single", "ep", "audio", "track", "compilation"}:
        return "audio"
    return raw


def rate_parts(value, names: list[str], label: Decimal | None) -> list[Decimal] | None:
    if isinstance(value, datetime):
        parts = [Decimal(value.month), Decimal(value.day), Decimal(value.year % 100)]
    elif isinstance(value, str):
        parts = []
        for piece in value.split(","):
            piece = piece.strip()
            if not piece:
                continue
            try:
                parts.append(Decimal(piece))
            except Exception:
                return None
    elif isinstance(value, (int, float)):
        parts = [Decimal(str(value))]
    else:
        return None
    if names and len(parts) != len(names):
        return None
    if label is not None and abs(sum(parts, Decimal(0)) + label - Decimal(100)) > Decimal("0.05"):
        return None
    return parts


def split_csv(value) -> list[str]:
    if value is None or isinstance(value, datetime):
        return []
    return [part.strip() for part in str(value).split(",") if part.strip()]


def load_accounts(env: dict[str, str]) -> tuple[list[str], list[str]]:
    text = postgres_copy(
        env,
        "SELECT id::text, account FROM source_files WHERE status = 'loaded'",
    )
    main, echo = [], []
    for line in text.splitlines():
        file_id, account = line.split("\t")
        if account == "1052428":
            main.append(file_id)
        elif account == "1055956":
            echo.append(file_id)
    if len(main) != 34 or len(echo) != 13:
        raise SystemExit(f"ожидались 34 и 13 загруженных файла, получено {len(main)} и {len(echo)}")
    return main, echo


def sql_ids(ids: list[str]) -> str:
    return "[" + ",".join("'" + item + "'" for item in ids) + "]"


def load_clickhouse(env: dict[str, str], main_ids: list[str], echo_ids: list[str]):
    catalog = {}
    raw = clickhouse(env, """
        SELECT isrc,
               argMax(track_title, reporting_month) AS track,
               argMax(artist_name, reporting_month) AS artist,
               argMax(release_type, reporting_month) AS product,
               toString(min(sales_month)) AS first_sale,
               toString(sum(net_revenue)) AS net
        FROM believe.rows
        WHERE isrc != ''
        GROUP BY isrc
        FORMAT JSONEachRow
    """)
    for line in raw.splitlines():
        if not line.strip():
            continue
        row = json.loads(line)
        catalog[row["isrc"]] = row
    upcs: dict[str, set[str]] = defaultdict(set)
    for line in clickhouse(env, """
        SELECT isrc, upc FROM believe.rows
        WHERE isrc != '' AND upc != ''
        GROUP BY isrc, upc
        FORMAT TSV
    """).splitlines():
        isrc, upc = line.split("\t")
        upcs[isrc].add(upc)
    months: dict[str, dict[str, Decimal]] = defaultdict(dict)
    main_months: dict[str, dict[str, Decimal]] = defaultdict(dict)
    month_keys: set[str] = set()
    for line in clickhouse(env, f"""
        SELECT isrc, toString(reporting_month),
               toString(sumIf(net_revenue, file_id IN {sql_ids(main_ids)})),
               toString(sumIf(net_revenue, file_id IN {sql_ids(echo_ids)}))
        FROM believe.rows
        WHERE isrc != ''
        GROUP BY isrc, reporting_month
        FORMAT TSV
    """).splitlines():
        isrc, month, main_net, echo_net = line.split("\t")
        key = month[:7]
        main_value = Decimal(main_net)
        echo_value = Decimal(echo_net)
        if main_value != 0:
            main_months[isrc][key] = main_value
        total = main_value + echo_value
        if total != 0:
            months[isrc][key] = total
            month_keys.add(key)
    def present(ids: list[str]) -> set[str]:
        found = set()
        for line in clickhouse(env, f"""
            SELECT isrc FROM believe.rows
            WHERE isrc != '' AND file_id IN {sql_ids(ids)}
            GROUP BY isrc
            FORMAT TSV
        """).splitlines():
            if line.strip():
                found.add(line.strip())
        return found
    return catalog, upcs, months, main_months, sorted(month_keys), present(main_ids), present(echo_ids)


def load_splits() -> tuple[dict[str, dict], dict]:
    book = openpyxl.load_workbook(SPLITS, read_only=True, data_only=False)
    sheet = book["Splits"]
    grouped: dict[str, list[dict]] = defaultdict(list)
    stats = {"rows": 0, "empty_isrc": 0, "unparsed_rates": 0, "duplicate_isrc": 0, "rate_conflict": 0}
    for index, row in enumerate(sheet.iter_rows(values_only=True)):
        if index == 0:
            continue
        stats["rows"] += 1
        code = norm_isrc(row[1])
        if not code:
            stats["empty_isrc"] += 1
            continue
        label = Decimal(str(row[8])) if isinstance(row[8], (int, float)) else None
        names = split_csv(row[10])
        ids = split_csv(row[12])
        parts = rate_parts(row[11], names, label)
        if parts is None:
            stats["unparsed_rates"] += 1
        grouped[code].append({
            "isrc_text": str(row[1]).strip(),
            "track": str(row[0] or "").strip(),
            "upc": "" if row[2] is None else str(row[2]).split(".")[0],
            "release": str(row[3] or "").strip(),
            "label": label,
            "names": names,
            "rates": parts,
            "ids": ids if parts and len(ids) == len(names) else [],
            "modified": row[9] if isinstance(row[9], datetime) else datetime.min,
        })
    book.close()
    chosen = {}
    for code, items in grouped.items():
        items.sort(key=lambda item: item["modified"])
        if len(items) > 1:
            stats["duplicate_isrc"] += 1
            winner = items[-1]
            for other in items[:-1]:
                if other["label"] != winner["label"] or other["rates"] != winner["rates"]:
                    stats["rate_conflict"] += 1
                    winner["conflict"] = True
                    break
        else:
            winner = items[-1]
        winner.setdefault("conflict", False)
        chosen[code] = winner
    return chosen, stats


def load_annex() -> tuple[dict[str, dict[str, Decimal]], dict[str, set[str]]]:
    """Monthly label share from Annex 14. 'no share' months stay blocked."""
    book = openpyxl.load_workbook(ANNEX, read_only=True, data_only=True)
    sheet = book["Monthly NLS by ISRC"]
    rows = sheet.iter_rows(values_only=True)
    next(rows)
    header = list(next(rows))
    months = [value for value in header[5:] if isinstance(value, str) and len(value) == 7]
    nls: dict[str, dict[str, Decimal]] = defaultdict(dict)
    blocked: dict[str, set[str]] = defaultdict(set)
    for row in rows:
        if not row or row[0] in (None, "Total"):
            continue
        code = norm_isrc(row[0])
        if not code:
            continue
        for index, month in enumerate(months):
            if 5 + index >= len(row):
                break
            value = row[5 + index]
            if value in (None, ""):
                continue
            if isinstance(value, str):
                if value.strip().lower() == "no share":
                    blocked[code].add(month)
                continue
            nls[code][month] = Decimal(str(value))
    book.close()
    return nls, blocked


def share_months(
    code: str,
    combined: dict[str, Decimal],
    main_exact: dict[str, Decimal],
    split: dict | None,
    annex_nls: dict[str, dict[str, Decimal]],
    blocked: dict[str, set[str]],
) -> tuple[dict[str, Decimal], dict[str, Decimal], dict[str, Decimal], str]:
    """Label, artist and the receipts those two explain.

    Annex 14 decides the months. A recording it does not contain uses the
    final split on every month. A 'no share' month explains nothing.
    """
    if code in annex_nls or code in blocked:
        label: dict[str, Decimal] = {}
        artist: dict[str, Decimal] = {}
        established: dict[str, Decimal] = {}
        for month, value in annex_nls.get(code, {}).items():
            if month not in main_exact:
                continue
            receipt = q2(main_exact[month])
            lab = q2(value)
            low = min(Decimal(0), receipt)
            high = max(Decimal(0), receipt)
            if lab < low - Decimal("0.05") or lab > high + Decimal("0.05"):
                raise SystemExit(f"{code} {month}: NLS {lab} вне поступлений {receipt}")
            if lab < low:
                lab = low
            if lab > high:
                lab = high
            label[month] = lab
            artist[month] = receipt - lab
            established[month] = receipt
        for month in blocked.get(code, ()):
            if month in label:
                raise SystemExit(f"{code} {month}: месяц no share заполнен долей")
        return label, artist, established, "annex"
    if split and split.get("label") is not None and combined:
        shown = q2(sum(combined.values(), Decimal(0)))
        rounded = allocate(combined, shown)
        label_exact = {key: value * split["label"] / Decimal(100) for key, value in combined.items()}
        label = allocate(label_exact, q2(shown * split["label"] / Decimal(100)))
        artist = {}
        for month, lab in list(label.items()):
            receipt = rounded[month]
            low = min(Decimal(0), receipt)
            high = max(Decimal(0), receipt)
            if lab < low:
                lab = low
            if lab > high:
                lab = high
            label[month] = lab
            artist[month] = receipt - lab
        return label, artist, rounded, "split"
    return {}, {}, {}, ""


def period_runs(
    label: dict[str, Decimal],
    established: dict[str, Decimal],
    final_rate: Decimal | None,
) -> list[dict]:
    """Group months by the label rate that actually explains their dollars.

    A difference of a cent on a small month is not a new rate. A month joins
    the final split when the label is that share of the receipt within a cent
    or 0.3%. Anything left is rounded to half a point, and only from a month
    of at least $20, so a one-dollar month cannot invent a period.
    """
    usable = [
        month for month in sorted(label)
        if not (established[month] == 0 and label[month] == 0)
    ]
    if not usable:
        return []

    def close(lab: Decimal, receipt: Decimal, rate: Decimal) -> bool:
        if receipt == 0:
            return True
        limit = max(CENT, abs(receipt) * Decimal("0.003"))
        return abs(lab - receipt * rate / Decimal(100)) <= limit

    def half_point(lab: Decimal, receipt: Decimal) -> Decimal:
        rate = lab / receipt * Decimal(100)
        steps = (rate / Decimal("0.5")).quantize(Decimal("1"), rounding=ROUND_HALF_UP)
        return steps * Decimal("0.5")

    receipt_sum = sum((established[month] for month in usable), Decimal(0))
    label_sum = sum((label[month] for month in usable), Decimal(0))
    if final_rate is not None and close(label_sum, receipt_sum, final_rate):
        return [{"rate": final_rate, "months": usable}]

    buckets: dict[Decimal, list[str]] = defaultdict(list)
    loose: list[str] = []
    for month in usable:
        receipt = established[month]
        lab = label[month]
        if abs(receipt) < Decimal(20):
            loose.append(month)
            continue
        if final_rate is not None and close(lab, receipt, final_rate):
            buckets[final_rate].append(month)
        elif receipt == 0:
            loose.append(month)
        else:
            buckets[half_point(lab, receipt)].append(month)
    if not buckets:
        if receipt_sum == 0 or label_sum == 0 and receipt_sum == 0:
            rate = final_rate if final_rate is not None else Decimal(0)
        elif receipt_sum == 0:
            rate = final_rate if final_rate is not None else Decimal(0)
        else:
            rate = half_point(label_sum, receipt_sum)
            if final_rate is not None and abs(rate - final_rate) <= Decimal("0.5"):
                rate = final_rate
        return [{"rate": rate, "months": usable}]
    for month in loose:
        receipt = established[month]
        lab = label[month]
        rate = min(
            buckets,
            key=lambda item: abs(lab - receipt * item / Decimal(100)) if receipt != 0 else Decimal(0),
        )
        buckets[rate].append(month)
    assigned = {month: rate for rate, months in buckets.items() for month in months}
    runs: list[dict] = []
    for month in sorted(assigned):
        rate = assigned[month]
        if runs and runs[-1]["rate"] == rate:
            runs[-1]["months"].append(month)
        else:
            runs.append({"rate": rate, "months": [month]})
    return runs


def portion(total: Decimal, weights: list[Decimal]) -> list[Decimal]:
    base = sum(weights, Decimal(0))
    if not weights:
        return []
    if base == 0:
        shares = [Decimal(0) for _ in weights]
        shares[-1] = total
        return shares
    shares = [q2(total * weight / base) for weight in weights]
    shares[-1] = total - sum(shares[:-1], Decimal(0))
    return shares


def load_documents() -> tuple[dict[str, dict], dict[str, list[str]], dict[str, list[str]]]:
    text_by_sha = {}
    with TEXTS.open(encoding="utf-8") as handle:
        for line in handle:
            row = json.loads(line)
            text_by_sha[row["sha256"]] = row.get("text") or ""
    documents = json.load(DOCS.open(encoding="utf-8"))
    by_id = {}
    by_isrc = defaultdict(list)
    by_title = defaultdict(list)
    for doc in documents:
        file_row = (doc.get("files") or [{}])[0]
        name = file_row.get("name") or ""
        text = text_by_sha.get(doc.get("sha256") or "", "")
        signed, signed_on, signed_source = signature_of(text)
        date, nick = filename_bits(name)
        meta = doc.get("meta") or {}
        term = meta.get("term") or ""
        record = {
            "id": name,
            "path": file_row.get("path") or "",
            "kind": doc.get("kind") or "other",
            "type": KIND_TYPE.get(doc.get("kind") or "", doc.get("kind") or "прочее"),
            "nick": nick,
            "date": date,
            "signed": signed,
            "signed_on": signed_on,
            "signed_source": signed_source,
            "term": term,
            "territory": territory_of(text),
            "consent": "prior written consent" in text.lower() or "written approval" in text.lower(),
            "tracks": [],
        }
        by_id[name] = record
        for item in doc.get("isrc_catalog") or []:
            code = norm_isrc(item.get("isrc") if isinstance(item, dict) else item)
            if code:
                by_isrc[code].append(name)
        for track in doc.get("tracks") or []:
            if track.get("parse") != "full":
                continue
            key = norm_title(track.get("title") or "")
            if len(key) < 6:
                continue
            record["tracks"].append(track)
            by_title[key].append(name)
    return by_id, by_isrc, by_title


def category_of(doc: dict) -> str:
    kind = doc["kind"]
    if kind in {"asset_purchase", "assignment", "beat_purchase"}:
        return "собственный мастер-копирайт"
    if kind in {"sample_license", "beat_lease", "remix"}:
        return "неэксклюзивные поддерживающие права контрибьютора или сэмпла"
    if kind in RIGHTS_KINDS:
        term = (doc.get("term") or "").lower()
        if "life" in term or "copyright" in term or "срок охраны" in term:
            return "эксклюзивные контрактные права эксплуатации на срок охраны"
        if term:
            return "эксклюзивные контрактные права эксплуатации на фиксированный срок"
    return ""


def cell(sheet, value, numeric=False):
    item = WriteOnlyCell(sheet, value=value)
    if numeric and isinstance(value, float):
        item.number_format = "0.00"
    return item


def build() -> None:
    env = load_env()
    print("accounts", flush=True)
    main_ids, echo_ids = load_accounts(env)
    print("clickhouse", flush=True)
    catalog, upcs, months, main_months, month_keys, main_isrcs, echo_isrcs = load_clickhouse(env, main_ids, echo_ids)
    print("splits, annex and documents", len(catalog), flush=True)
    splits, split_stats = load_splits()
    annex_nls, annex_blocked = load_annex()
    print("annex", len(annex_nls), len(annex_blocked), flush=True)
    documents, by_isrc, by_title = load_documents()
    pdf_isrcs = json.loads(Path("/tmp/isrc_in_pdfs.json").read_text())
    for code, names in pdf_isrcs.items():
        for name in names:
            if name in documents and name not in by_isrc[code]:
                by_isrc[code].append(name)
    phrase_path = Path("/tmp/phrase_links_strict.json")
    phrase_links = json.loads(phrase_path.read_text()) if phrase_path.exists() else {}
    print("phrase links kept", len(phrase_links), flush=True)

    if set(catalog) != (main_isrcs | echo_isrcs):
        raise SystemExit("набор ISRC ClickHouse не совпал с двумя аккаунтами Believe")
    isrcs = sorted(catalog)
    rows = []
    revenue = {}
    label_money = {}
    artist_money = {}
    established_money = {}
    royalty = []
    gap_over = []
    gap_mismatch = []
    gap_not_in_split = []
    share_gap = []
    linked_counts = defaultdict(int)
    annex_used = 0
    split_used = 0

    for code in isrcs:
        source = catalog.get(code)
        split = splits.get(code)
        title = (source or {}).get("track") or (split or {}).get("track") or ""
        artist = (source or {}).get("artist") or ""
        if split and split["names"]:
            extra = [name for name in split["names"] if norm_name(name) and norm_name(name) not in norm_name(artist)]
            if extra:
                artist = "; ".join([part for part in [artist, *extra] if part])
        codes = sorted(upcs.get(code, []))
        if not codes and split and split["upc"]:
            codes = [split["upc"]]
        first = ((source or {}).get("first_sale") or "")[:10]
        in_main = code in main_isrcs
        in_echo = code in echo_isrcs
        if in_main:
            status, reason = "в периметре", ""
        elif in_echo:
            status, reason = "вне периметра", "Echo8"
        else:
            raise SystemExit(f"ISRC {code} нет ни в одном аккаунте Believe")
        doc_ids = list(dict.fromkeys(by_isrc.get(code, [])))
        how = "ISRC назван" if doc_ids else ""
        title_key = norm_title(title)
        if title_key and len(title_key) >= 6 and title_key in by_title:
            for name in by_title[title_key]:
                if name not in doc_ids:
                    doc_ids.append(name)
            how = how or "назван трек"
        for name in phrase_links.get(code, []):
            if name in documents and name not in doc_ids:
                doc_ids.append(name)
                how = how or "назван трек"
        if not how:
            how = "не идентифицирована" if source else ""
        categories, terms, territories = [], [], []
        for name in doc_ids:
            doc = documents[name]
            linked_counts[name] += 1
            category = category_of(doc)
            if category and category not in categories:
                categories.append(category)
            if doc["term"] and doc["term"] not in terms:
                terms.append(doc["term"])
            if doc["territory"] and doc["territory"] not in territories:
                territories.append(doc["territory"])
        own = ""
        own_source = ""
        if split and split["label"] is not None and split["rates"] is not None:
            own = float(split["label"])
            own_source = "финальный сплит 0to8_Splits_20260814, колонка sum_rates; это остаток после ставок участников, не процент владения фонограммой"
            if sum(split["rates"], Decimal(0)) > 100:
                gap_over.append((code, title, artist, str(sum(split["rates"], Decimal(0)))))
        elif split and split["label"] is not None:
            own = float(split["label"])
            own_source = "финальный сплит, sum_rates; ставки участников из ячейки не разобраны"
        term_text = "; ".join(terms)
        if categories == ["собственный мастер-копирайт"] and not term_text:
            term_text = "не применимо"
        month_map = months.get(code, {})
        exact_net = sum(month_map.values(), Decimal(0)) if month_map else None
        rounded = allocate(month_map, q2(exact_net)) if exact_net is not None else {}
        receipts = sum(rounded.values(), Decimal(0)) if rounded else None
        label_row, artist_row, established_row, share_tag = share_months(
            code, month_map, main_months.get(code, {}), split, annex_nls, annex_blocked,
        )
        if share_tag == "annex" and label_row:
            annex_used += 1
            if label_row:
                own_source = (own_source + ". " if own_source else "") + (
                    "Доллары доли лейбла и артистов — Annex 14, Monthly NLS, только месяцы с установленной долей. "
                    "Месяцы no share не отданы ни лейблу, ни артисту. Echo8 в эти суммы не входит."
                )
            else:
                own_source = (own_source + ". " if own_source else "") + (
                    "Annex 14 не установил долю ни на один месяц этих поступлений, доллары доли пустые."
                )
        elif share_tag == "split":
            split_used += 1
        label_total = sum(label_row.values(), Decimal(0)) if label_row else None
        artist_total = sum(artist_row.values(), Decimal(0)) if artist_row else None
        established_total = sum(established_row.values(), Decimal(0)) if established_row else None
        if label_total is not None and artist_total is not None and label_total + artist_total != established_total:
            raise SystemExit(f"{code}: доля лейбла {label_total} и артистов {artist_total} не равны базе {established_total}")
        revenue[code] = rounded
        label_money[code] = label_row
        artist_money[code] = artist_row
        established_money[code] = established_row
        if status == "в периметре" and not doc_ids and receipts is not None:
            pass
        identified = how if doc_ids or source else "не идентифицирована"
        rows.append({
            "isrc": code,
            "title": title,
            "artist": artist,
            "upc": "; ".join(codes),
            "product": product_type((source or {}).get("product") or ""),
            "first": first,
            "status": status,
            "reason": reason,
            "category": "; ".join(categories),
            "own": own,
            "own_source": own_source,
            "term": term_text,
            "term_source": "documents.json meta.term" if terms else "",
            "territory": "; ".join(territories),
            "territory_source": "текст договора: throughout the world / universe" if territories else "",
            "scope": "",
            "docs": "; ".join(doc_ids),
            "how": identified if (source or doc_ids) else "",
            "chain": "",
            "receipts": None if receipts is None else money(receipts),
            "label_total": None if label_total is None else money(label_total),
            "established": None if established_total is None else money(established_total),
            "artist_total": None if artist_total is None else money(artist_total),
            "doc_ids": doc_ids,
            "in_ch": source is not None,
        })
        final_rate = split["label"] if split and split.get("label") is not None else None
        runs = period_runs(label_row, established_row, final_rate) if label_row else []
        base = "net revenue Believe, месяцы с установленной долей"
        docs_text = "; ".join(doc_ids)
        named = bool(split and split.get("rates"))
        for run in runs:
            months_run = run["months"]
            period = months_run[0] if len(months_run) == 1 else f"{months_run[0]} — {months_run[-1]}"
            receipt_sum = sum((established_row[item] for item in months_run), Decimal(0))
            label_sum = sum((label_row[item] for item in months_run), Decimal(0))
            artist_sum = receipt_sum - label_sum
            matched = named and final_rate is not None and abs(run["rate"] - final_rate) <= Decimal("0.2")
            if matched:
                amounts = portion(artist_sum, list(split["rates"]))
                idents = split["ids"] or [""] * len(split["names"])
                for name, rate, ident, amount in zip(split["names"], split["rates"], idents, amounts):
                    royalty.append({
                        "name": name, "id": ident, "isrc": code, "docs": docs_text, "base": base,
                        "rate": float(rate), "amount": amount, "period": period, "in_split": "да",
                        "source": "финальный сплит; сумма по месяцам, где доля лейбла совпала с sum_rates",
                    })
            elif artist_sum != 0 or label_sum != 0:
                royalty.append({
                    "name": "участники записи", "id": "", "isrc": code, "docs": docs_text, "base": base,
                    "rate": float(q2(Decimal(100) - run["rate"])), "amount": artist_sum, "period": period,
                    "in_split": "нет",
                    "source": (
                        "Annex 14 Monthly NLS; финальный сплит на этот период другую ставку, получатели не разложены"
                        if share_tag == "annex"
                        else "финальный сплит; месяц не сошёлся со ставкой из-за округления, получатели не разложены"
                    ),
                })
                if share_tag == "annex":
                    share_gap.append([
                        code, period, str(run["rate"]), "" if final_rate is None else str(final_rate), str(artist_sum),
                    ])
            royalty.append({
                "name": "0to8", "id": "0to8", "isrc": code, "docs": docs_text, "base": base,
                "rate": float(run["rate"]), "amount": label_sum, "period": period,
                "in_split": "да" if matched else "нет",
                "source": "Annex 14 Monthly NLS" if share_tag == "annex" else "финальный сплит, sum_rates",
            })
        if named and not runs:
            idents = split["ids"] or [""] * len(split["names"])
            note = "ставка есть в финальном сплите; Annex 14 не установил долю ни на один месяц поступлений"
            for name, rate, ident in zip(split["names"], split["rates"], idents):
                royalty.append({
                    "name": name, "id": ident, "isrc": code, "docs": docs_text, "base": base,
                    "rate": float(rate), "amount": None, "period": note, "in_split": "да",
                    "source": "финальный сплит 0to8_Splits_20260814",
                })
            royalty.append({
                "name": "0to8", "id": "0to8", "isrc": code, "docs": docs_text, "base": base,
                "rate": float(split["label"]), "amount": None, "period": note, "in_split": "да",
                "source": "финальный сплит, sum_rates",
            })
        if split and split["rates"] is not None:
            for name in doc_ids:
                for track in documents[name]["tracks"]:
                    if norm_title(track.get("title") or "") != title_key:
                        continue
                    digital = track.get("royalty_digital_percent")
                    if digital is None:
                        continue
                    figure = Decimal(str(digital))
                    known = list(split["rates"]) + [split["label"]]
                    if not any(abs(figure - item) <= Decimal("0.2") for item in known):
                        gap_mismatch.append((code, title, name, str(figure), str(split["label"])))
        elif source is not None and status == "в периметре":
            gap_not_in_split.append(code)

    # Reconciliation before writing.
    ch_codes = set(catalog)
    sheet_codes = {row["isrc"] for row in rows}
    missing = ch_codes - sheet_codes
    if missing:
        raise SystemExit(f"в листе нет {len(missing)} ISRC из ClickHouse")
    ch_exact = sum((sum(months[code].values(), Decimal(0)) for code in ch_codes), Decimal(0))
    once = q2(ch_exact)
    per_row = sum((q2(sum(months[code].values(), Decimal(0))) for code in ch_codes), Decimal(0))
    sheet_exact = sum((sum(revenue[code].values(), Decimal(0)) for code in ch_codes), Decimal(0))
    if sheet_exact != per_row:
        raise SystemExit(f"поступления строк {sheet_exact} не равны сумме округлённых ISRC {per_row}")
    if not main_isrcs <= sheet_codes or not echo_isrcs <= sheet_codes:
        raise SystemExit("не все ISRC аккаунтов попали в лист")
    believe_split_missing = [code for code in splits if code in catalog and code not in sheet_codes]
    if believe_split_missing:
        raise SystemExit(f"в листе нет {len(believe_split_missing)} ISRC, которые есть и в Believe, и в сплите")
    split_only = sum(1 for code in splits if code not in catalog)
    paid = defaultdict(lambda: Decimal(0))
    for item in royalty:
        if item["amount"] is not None:
            paid[item["isrc"]] += item["amount"]
    unpaid = [
        code for code, series in established_money.items()
        if sum(series.values(), Decimal(0)) != paid[code]
    ]
    if unpaid:
        sample = unpaid[0]
        raise SystemExit(
            f"суммы листа Роялти не сошлись у {len(unpaid)} ISRC, пример {sample}: "
            f"{paid[sample]} против {sum(established_money[sample].values(), Decimal(0))}"
        )

    month_headers = month_keys
    book = Workbook(write_only=True)
    book.properties.creator = "build-catalog-registries-v3"
    book.properties.created = datetime(2026, 10, 26)
    book.properties.modified = datetime(2026, 10, 26)
    status_line = (
        "Сборка v3, 2026-11-02. Только ISRC, которые есть в отчётах Believe. "
        "Каталог и поступления: ClickHouse believe.rows, net_revenue, "
        "аккаунты 1052428 (believe/raw) и 1055956 (believe_echo8), отчётные месяцы 2023-11…2026-08. "
        "Доля лейбла по записям Annex 14 — лист Monthly NLS, только месяцы с установленной долей. "
        "Причитается артистам — эти поступления минус доля лейбла, разложенная по ставкам финального сплита, "
        "когда ставка месяца с ней совпала. Это начисление по сплиту, не банковская выплата. "
        "Месяцы Annex 14 со статусом no share и поступления Echo8 в эти суммы не входят. "
        "Записи, которых нет в Annex 14, считаются по финальному сплиту 0to8_Splits_20260814 на все месяцы. "
        "Договоры: documents.json и texts.jsonl по двум папкам PDF. erp.db не читался. "
        "Пустая ячейка значит, что в этих источниках факта нет."
    )

    recordings = book.create_sheet("Записи")
    recordings.append([status_line])
    recordings.append([
        "ISRC", "Запись и версия", "Артисты и кредиты", "UPC", "Тип продукта", "Дата первого релиза",
        "Статус", "Основание исключения", "Категория прав", "Наша доля, %", "Источник доли",
        "Срок", "Источник срока", "Территория", "Источник территории", "Объём разрешённого использования",
        "Договоры-основания", "Как запись идентифицирована в документе", "Чем право закреплено за FZ",
        "Поступления за период, $", "Доля лейбла за период, $",
        "Поступления с установленной долей, $", "Причитается артистам, $",
    ])
    for row in rows:
        recordings.append([
            row["isrc"], row["title"], row["artist"], row["upc"], row["product"], row["first"],
            row["status"], row["reason"], row["category"], row["own"], row["own_source"],
            row["term"], row["term_source"], row["territory"], row["territory_source"], row["scope"],
            row["docs"], row["how"], row["chain"], row["receipts"], row["label_total"],
            row["established"], row["artist_total"],
        ])

    contracts = book.create_sheet("Договоры")
    contracts.append([status_line])
    contracts.append([
        "Идентификатор", "Тип", "Стороны", "Дата документа", "Дата подписания", "Статус подписания",
        "Основание статуса подписания", "Какие права предоставлены", "Доля, %", "Срок", "Источник срока",
        "Территория", "Источник территории", "Существенные ограничения", "Механизм передачи",
        "Источник механизма", "Требуемые согласия", "Распределение обязательств", "Изменения и приложения",
        "Заменён документом", "Записей покрывает", "Файл",
    ])
    for name in sorted(documents):
        doc = documents[name]
        mechanism = ""
        mechanism_source = ""
        if doc["kind"] in {"asset_purchase", "assignment", "beat_purchase"}:
            mechanism, mechanism_source = "уступка целиком", "вид документа в documents.json"
        elif doc["kind"] in RIGHTS_KINDS:
            mechanism_source = "в словаре ТЗ нет значения для прямой лицензии артисту; вид " + doc["kind"]
        elif doc["kind"] not in RIGHTS_KINDS:
            mechanism, mechanism_source = "только для справки", "документ не передаёт права на записи"
        contracts.append([
            doc["id"], doc["type"], doc["nick"], doc["date"], doc["signed_on"], doc["signed"],
            doc["signed_source"], "", "", doc["term"], "documents.json meta.term" if doc["term"] else "",
            doc["territory"], "текст договора" if doc["territory"] else "", "",
            mechanism, mechanism_source,
            "письменное согласие" if doc["consent"] else "", "", "", "",
            linked_counts[name], doc["path"],
        ])

    royalties = book.create_sheet("Роялти")
    royalties.append([status_line])
    royalties.append([
        "Получатель", "Идентификатор получателя", "Записи", "Договор-основание", "База расчёта",
        "Ставка, %", "Сумма за период, $", "Фиксированная сумма", "Разрешённые вычеты", "Период применения",
        "Срок и порядок выплаты", "Удержание налога", "Чьё обязательство",
        "Отражено в зарегистрированном сплите", "Источник",
    ])
    for item in royalty:
        royalties.append([
            item["name"], item["id"], item["isrc"], item["docs"], item["base"], item["rate"],
            "" if item["amount"] is None else money(item["amount"]),
            "", "", item["period"], "", "", "лейбл", item["in_split"], item["source"],
        ])
    for code in sorted(gap_not_in_split):
        royalties.append(["", "", code, "", "net revenue Believe", "", "", "", "", "", "", "лейбл", "нет", "ISRC есть в ClickHouse и нет в финальном сплите"])

    limits = book.create_sheet("Согласования и ограничения")
    limits.append([status_line])
    limits.append(["Договор или договорённость", "Тип", "Что именно", "Затронутые записи", "Статус", "Срок", "Ответственный"])
    for name in sorted(documents):
        doc = documents[name]
        if doc["consent"] and doc["kind"] in RIGHTS_KINDS:
            limits.append([name, "требуемое согласие", "текст требует письменного согласия", "", "не получено", "", doc["nick"]])
        elif doc["kind"] == "indemnification":
            limits.append([name, "принятое ограничение", "письмо о возмещении", "", "не требуется", "", doc["nick"]])
        elif doc["kind"] == "nda":
            limits.append([name, "принятое ограничение", "NDA", "", "не требуется", "", doc["nick"]])

    assets = book.create_sheet("Ассеты")
    assets.append([status_line + " Файлов обложек, видео, стемов и мастеров в этих источниках нет."])
    assets.append(["Запись или релиз", "Тип ассета", "Правовой статус", "Правообладатель", "Формат и качество", "Где лежит"])

    def matrix(sheet_name: str, values: dict[str, dict[str, Decimal]]):
        sheet = book.create_sheet(sheet_name)
        sheet.append([status_line])
        sheet.append(["ISRC", "Трек и версия", "Артисты", "UPC", "Итог за период", *month_headers])
        totals = [Decimal(0) for _ in month_headers]
        body = []
        for row in rows:
            if not row["in_ch"]:
                continue
            series = values.get(row["isrc"], {})
            numbers = [series.get(key) for key in month_headers]
            present = [item for item in numbers if item is not None]
            total = sum(present, Decimal(0)) if series else None
            for index, item in enumerate(numbers):
                if item is not None:
                    totals[index] += item
            body.append((row, total, numbers))
        grand = sum(totals, Decimal(0))
        sheet.append(["Total", "", "", "", money(grand), *[money(item) for item in totals]])
        for row, total, numbers in body:
            sheet.append([
                row["isrc"], row["title"], row["artist"], row["upc"],
                "" if total is None else money(total),
                *["" if item is None else money(item) for item in numbers],
            ])
        return grand

    print("writing monthly sheets", len(rows), flush=True)
    revenue_total = matrix("Выручка по месяцам", revenue)
    label_total = matrix("Доля лейбла по месяцам", label_money)
    artist_sheet_total = matrix("Причитается артистам по месяцам", artist_money)

    in_rows = [row for row in rows if row["status"] == "в периметре"]
    out_rows = [row for row in rows if row["status"] != "в периметре"]
    no_contract = [row for row in in_rows if not row["doc_ids"] and row["in_ch"]]
    no_date = [row for row in rows if row["in_ch"] and not row["first"]]
    no_term = [row for row in rows if row["category"].startswith("эксклюзив") and (not row["term"] or not row["territory"])]
    unsigned = [doc for doc in documents.values() if doc["signed"] != "подписан всеми"]
    by_nick = defaultdict(list)
    for doc in documents.values():
        if doc["nick"] and doc["kind"] in {"recording", "asset_purchase", "assignment"}:
            by_nick[norm_name(doc["nick"])].append(doc["id"])
    multi = [(nick, names) for nick, names in sorted(by_nick.items()) if len(names) > 1]

    summary = book.create_sheet("Сводка")
    summary.append([status_line])
    summary.append(["Показатель", "Значение"])
    year_net = defaultdict(lambda: Decimal(0))
    year_label = defaultdict(lambda: Decimal(0))
    year_artist = defaultdict(lambda: Decimal(0))
    for code, series in revenue.items():
        for key, value in series.items():
            year_net[key[:4]] += value
    for code, series in label_money.items():
        for key, value in series.items():
            year_label[key[:4]] += value
    for code, series in artist_money.items():
        for key, value in series.items():
            year_artist[key[:4]] += value
    summary_rows = [
        ("Записей всего", len(rows)),
        ("ISRC в ClickHouse", len(ch_codes)),
        ("ISRC только в сплите, нет в ClickHouse", sum(1 for row in rows if not row["in_ch"])),
        ("В периметре", len(in_rows)),
        ("Вне периметра Echo8", len(out_rows)),
        ("С договором-основанием", sum(1 for row in rows if row["doc_ids"])),
        ("В периметре без договора", len(no_contract)),
        ("Поступления ClickHouse, точная сумма net, округление один раз, $", money(once)),
        ("Поступления, сумма помесячных ячеек, $", money(revenue_total)),
        ("Доля лейбла, сумма помесячных ячеек, $", money(label_total)),
        ("Причитается артистам, сумма помесячных ячеек, $", money(artist_sheet_total)),
        ("Записей, доля взята из Annex 14", annex_used),
        ("Записей, доля взята только из финального сплита", split_used),
        ("Периодов, где ставка Annex 14 не совпала с финальным сплитом", len(share_gap)),
        ("Сплит: строк", split_stats["rows"]),
        ("Сплит: пустой ISRC", split_stats["empty_isrc"]),
        ("Сплит: ставка не разобрана", split_stats["unparsed_rates"]),
        ("Сплит: ISRC с несколькими строками", split_stats["duplicate_isrc"]),
        ("Сплит: конфликт ставок между строками одного ISRC", split_stats["rate_conflict"]),
        ("Договоров", len(documents)),
        ("Не подписан всеми", len(unsigned)),
    ]
    for year in sorted(year_net):
        summary_rows.append((f"Поступления {year}, сумма месяцев, $", money(year_net[year])))
        summary_rows.append((f"Доля лейбла {year}, $", money(year_label[year])))
        summary_rows.append((f"Причитается артистам {year}, $", money(year_artist[year])))
    for category in (
        "собственный мастер-копирайт",
        "эксклюзивные контрактные права эксплуатации на фиксированный срок",
        "эксклюзивные контрактные права эксплуатации на срок охраны",
        "неэксклюзивные поддерживающие права контрибьютора или сэмпла",
    ):
        summary_rows.append((category, sum(1 for row in rows if category in row["category"])))
    for label, value in summary_rows:
        summary.append([label, value])

    def section(title: str, header: list[str], body: list[list]):
        summary.append([])
        summary.append([title])
        summary.append(header)
        for item in body:
            summary.append(item)
        if not body:
            summary.append(["пусто: проверка выполнена, таких записей нет"])

    section(
        "1. Записи в периметре без договора-основания",
        ["ISRC", "Артист", "Запись", "Поступления, $"],
        [[row["isrc"], row["artist"], row["title"], row["receipts"]] for row in no_contract],
    )
    section(
        "2. Доля в договоре не совпала ни с одной ставкой финального сплита",
        ["ISRC", "Запись", "Документ", "Ставка в договоре", "Доля лейбла в сплите"],
        [list(item) for item in gap_mismatch],
    )
    section(
        "3. Участия есть в каталоге ClickHouse и отсутствуют в финальном сплите",
        ["ISRC"],
        [[code] for code in sorted(gap_not_in_split)],
    )
    section(
        "4. Лицензионные интересы без срока или территории",
        ["ISRC", "Запись", "Категория", "Срок", "Территория"],
        [[row["isrc"], row["title"], row["category"], row["term"], row["territory"]] for row in no_term],
    )
    section(
        "5. Договоры не подписаны всеми",
        ["Идентификатор", "Тип", "Статус", "Файл"],
        [[doc["id"], doc["type"], doc["signed"], doc["path"]] for doc in unsigned],
    )
    section(
        "6. UPC, у которых не все ISRC раскрыты",
        ["UPC", "Пояснение"],
        [],
    )
    section(
        "7. Записи без даты первого релиза",
        ["ISRC", "Запись"],
        [[row["isrc"], row["title"]] for row in no_date],
    )
    section(
        "8. Сумма ставок участников больше 100",
        ["ISRC", "Запись", "Артист", "Сумма ставок"],
        [list(item) for item in gap_over],
    )
    section(
        "9. Запись в периметре и одновременно в списке исключённых",
        ["ISRC"],
        [],
    )
    section(
        "10. Несколько документов одного псевдонима без выбранной действующей редакции",
        ["Псевдоним", "Документы"],
        [[nick, "; ".join(names)] for nick, names in multi],
    )
    section(
        "Ставка месяца в Annex 14 не совпала с финальным сплитом: артисты этого периода не разложены",
        ["ISRC", "Период", "Доля лейбла в этом периоде, %", "Доля лейбла в финальном сплите, %", "Причитается артистам, $"],
        share_gap,
    )

    temporary = OUT.with_suffix(".tmp.xlsx")
    book.save(temporary)
    normalize_xlsx(temporary, OUT)
    temporary.unlink()
    report = {
        "recordings": len(rows),
        "clickhouse_isrc": len(ch_codes),
        "missing_from_sheet": len(missing),
        "split_isrc_not_in_believe": split_only,
        "revenue_cells": str(revenue_total),
        "revenue_once": str(once),
        "label_cells": str(label_total),
        "artist_cells": str(artist_sheet_total),
        "annex_used": annex_used,
        "split_used": split_used,
        "rate_periods_differ": len(share_gap),
        "no_contract": len(no_contract),
        "no_split": len(gap_not_in_split),
        "rate_mismatch": len(gap_mismatch),
        "unsigned": len(unsigned),
        "split": split_stats,
    }
    LOG.write_text(json.dumps(report, ensure_ascii=False, indent=2) + "\n")
    print(json.dumps(report, ensure_ascii=False, indent=2))


def normalize_xlsx(source: Path, target: Path) -> None:
    with zipfile.ZipFile(source, "r") as incoming, zipfile.ZipFile(target, "w") as out:
        for info in sorted(incoming.infolist(), key=lambda item: item.filename):
            data = incoming.read(info.filename)
            if info.filename == "docProps/core.xml":
                text = data.decode("utf-8")
                text = re.sub(
                    r"<dcterms:modified[^>]*>.*?</dcterms:modified>",
                    '<dcterms:modified xsi:type="dcterms:W3CDTF">2026-10-26T00:00:00Z</dcterms:modified>',
                    text,
                )
                data = text.encode("utf-8")
            replacement = zipfile.ZipInfo(filename=info.filename, date_time=STAMP)
            replacement.compress_type = zipfile.ZIP_DEFLATED
            replacement.external_attr = 0o600 << 16
            out.writestr(replacement, data, compresslevel=6)


if __name__ == "__main__":
    build()
