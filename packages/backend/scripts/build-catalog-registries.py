#!/usr/bin/env python3
"""Сводные реестры каталога, договоров и роялти.

Денежная сверка с Annex 14 — это packages/backend/scripts/reconcile-coverage.ts.
Этот файл реестр не подменяет формулу calculate() и не является этой сверкой.

Одна команда, один xlsx. Документы читаются только из двух архивов PDF.
Начисления, выплаты и реестр процентов читаются из «0to8 Main.xlsx».
erp.db не используется.

Запуск из корня репозитория:

  context_data/.tools/pdfvenv/bin/python packages/backend/scripts/build-catalog-registries.py
"""

from __future__ import annotations

import hashlib
import io
import json
import re
import shutil
import sqlite3
import sys
import zipfile
from collections import defaultdict
from dataclasses import dataclass, field
from datetime import datetime
from decimal import Decimal, ROUND_HALF_UP
from pathlib import Path

from openpyxl import Workbook
from openpyxl.styles import Alignment, Font
from openpyxl.utils import get_column_letter

SCRIPT_VERSION = "v2"
REPO = Path(__file__).resolve().parents[3]
PANDA = REPO / "context_data" / "PandaDoc_documents_0 (2)"
ROOT = REPO / "context_data" / "Root"
MAIN_XLSX = REPO / "context_data" / "0to8 Main.xlsx"
CACHE = REPO / "context_data" / "contract_index" / "texts.jsonl"
OUT_DIR = REPO / "context_data" / "contract_index"
LABEL_PARTY = 1
CENT = Decimal("0.01")
MONTHS_EN = {
    "january": 1, "february": 2, "march": 3, "april": 4, "may": 5, "june": 6,
    "july": 7, "august": 8, "september": 9, "october": 10, "november": 11, "december": 12,
    "jan": 1, "feb": 2, "mar": 3, "apr": 4, "jun": 6, "jul": 7, "aug": 8, "sep": 9, "oct": 10, "nov": 11, "dec": 12,
}
ILLEGAL = re.compile(r"[\x00-\x08\x0b\x0c\x0e-\x1f]")
ISRC_RE = re.compile(r"\b([A-Z]{2}[A-Z0-9]{3}\d{7})\b")
UPC_RE = re.compile(r"\b(\d{12,14})\b")
DUR_RE = re.compile(r"(\d{1,2}:\d{2})\s+(\d+(?:[.,]\d+)?)\s*%\s+(\d+(?:[.,]\d+)?)\s*%")
PCT_RE = re.compile(r"(\d+(?:[.,]\d+)?)\s*%")
SIGNED_RE = re.compile(r"\bSigned:?\s+(\d{1,2}\s+[A-Za-z]{3,9}\s+\d{4})", re.I)
COMPLETED_RE = re.compile(
    r"document completed by all parties on:?\s+(\d{1,2}\s+[A-Za-z]{3,9}\s+\d{4})",
    re.I,
)
DOC_REF_RE = re.compile(r"(?i)document ref:\s*\S+")
PAGE_RE = re.compile(r"(?i)page\s+\d+\s+of\s+\d+")

OWN_MASTER = "собственный мастер-копирайт"
EXCL_LIFE = "эксклюзивные контрактные права эксплуатации на срок охраны"
EXCL_FIXED = "эксклюзивные контрактные права эксплуатации на фиксированный срок"
NONEXCL = "неэксклюзивные поддерживающие права контрибьютора или сэмпла"

ARTIST_DEAL = "договор с артистом"
SCHEDULE = "приложение SCHEDULE"
CONTRIB = "лицензия контрибьютора"
SAMPLE = "лицензия на сэмпл"
SUBLABEL = "саблейбл"
BUYOUT = "выкуп"
ASSIGNMENT = "уступка"
DISTRIBUTION = "дистрибуция"
SETTLEMENT = "мировое соглашение"


def norm_key(value: str) -> str:
    text = value.casefold().replace("ё", "е")
    return re.sub(r"[^a-z0-9а-я]+", "", text)


def norm_title(value: str) -> str:
    text = value.casefold().replace("ё", "е")
    text = re.sub(r"[^a-z0-9а-я]+", " ", text)
    return re.sub(r"\s+", " ", text).strip()


def clean(value: str | None, limit: int = 500) -> str:
    if not value:
        return ""
    text = ILLEGAL.sub("", value)
    text = re.sub(r"\s+", " ", text).strip()
    if len(text) > limit:
        return text[: limit - 1] + "…"
    return text


def q2(value: Decimal) -> Decimal:
    return value.quantize(CENT, rounding=ROUND_HALF_UP)


def parse_pct(raw: str) -> Decimal | None:
    try:
        return Decimal(raw.replace(",", "."))
    except Exception:
        return None


def iso_from_dmy(day: int, month: int, year: int) -> str:
    if not (1 <= day <= 31 and 1 <= month <= 12 and 1990 <= year <= 2035):
        return ""
    return f"{year:04d}-{month:02d}-{day:02d}"


def iso_from_stamp(stamp: str) -> str:
    match = re.match(r"(\d{1,2})\s+([A-Za-z]{3,9})\s+(\d{4})", stamp.strip())
    if not match:
        return ""
    month = MONTHS_EN.get(match.group(2).lower())
    if not month:
        return ""
    return iso_from_dmy(int(match.group(1)), month, int(match.group(3)))


def sha256_file(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def collect_pdfs() -> list[Path]:
    found: list[Path] = []
    for root in (PANDA, ROOT):
        if not root.is_dir():
            raise SystemExit(f"нет папки документов: {root}")
        for path in root.rglob("*"):
            if path.is_file() and path.suffix.lower() == ".pdf" and path.name != ".DS_Store":
                found.append(path)
    return sorted(found, key=lambda item: str(item))


def load_texts(paths: list[Path]) -> list[dict]:
    cached: dict[str, dict] = {}
    if CACHE.is_file():
        with CACHE.open(encoding="utf-8") as handle:
            for line in handle:
                row = json.loads(line)
                cached[row["path"]] = row
    rows: list[dict] = []
    missing = 0
    for path in paths:
        item = cached.get(str(path))
        if item and item.get("text") is not None and not item.get("error"):
            rows.append(item)
            continue
        missing += 1
        rows.append(extract_pdf(path))
    if missing:
        print(f"дочитано из PDF, потому что кэша не хватило: {missing}", flush=True)
    return rows


def extract_pdf(path: Path) -> dict:
    from pypdf import PdfReader

    data = path.read_bytes()
    digest = hashlib.sha256(data).hexdigest()
    try:
        reader = PdfReader(io.BytesIO(data))
        if reader.is_encrypted:
            try:
                reader.decrypt("")
            except Exception:
                pass
        pages = [(page.extract_text() or "") for page in reader.pages]
        text = "\n\n".join(pages)
        return {
            "path": str(path),
            "name": path.name,
            "sha256": digest,
            "pages": len(pages),
            "chars": len(text),
            "error": None,
            "text": text,
        }
    except Exception as error:
        return {
            "path": str(path),
            "name": path.name,
            "sha256": digest,
            "pages": 0,
            "chars": 0,
            "error": f"{type(error).__name__}: {error}",
            "text": "",
        }


@dataclass
class ScheduleRow:
    title: str
    timing: str
    composition_pct: Decimal | None
    recording_pct: Decimal | None
    coauthors: str
    digital_pct: Decimal | None
    channels_equal: bool


@dataclass
class Doc:
    path: str
    name: str
    sha256: str
    text: str
    flat: str
    doc_type: str
    identifier: str
    number_key: str
    parties: str
    party_ids: list[int] = field(default_factory=list)
    nicknames: list[str] = field(default_factory=list)
    doc_date: str = ""
    sign_date: str = ""
    sign_status: str = "не подписан"
    sign_basis: str = ""
    rights: str = ""
    share: Decimal | None = None
    share_source: str = ""
    term: str = ""
    term_source: str = ""
    territory: str = ""
    territory_source: str = ""
    limits: str = ""
    mechanism: str = ""
    consents: str = ""
    duties: str = ""
    related: str = ""
    replaced_by: str = ""
    category: str = ""
    category_source: str = ""
    chain: str = ""
    schedule: list[ScheduleRow] = field(default_factory=list)
    named_isrcs: set[str] = field(default_factory=set)
    named_upcs: set[str] = field(default_factory=set)
    broad_catalog: bool = False
    dev_fixture: bool = False
    covered: int = 0


@dataclass
class Recording:
    isrc: str
    title: str
    artists: str
    upc: str
    product: str
    release_date: str
    label: str
    in_perimeter: bool
    exclusion: str
    parties: set[int] = field(default_factory=set)


def classify(name: str, flat: str) -> str:
    blob = f"{name}\n{flat[:3500]}".lower()
    file_name = name.lower()
    if "w-8ben" in blob or "fw8ben" in file_name or "w8ben" in file_name:
        return "форма W-8BEN"
    if "imro" in blob and ("writer" in blob or "member" in blob):
        return "заявление IMRO"
    if "non-disclosure" in blob or re.search(r"\bnda\b", file_name):
        return "NDA"
    if "dmca" in file_name or "counter notification" in file_name or "counter-notification" in file_name:
        return "письмо"
    if "sample license" in blob or "sample_license" in file_name or "vocal sample" in blob:
        return SAMPLE
    if "sublabel" in blob or "pass-through" in blob or "royalty share agreement" in blob:
        return SUBLABEL
    if "settlement agreement" in blob or "мировое соглашение" in blob:
        return SETTLEMENT
    if "assignment agreement" in blob or "copyright assignment" in blob or file_name.startswith("assignment"):
        return ASSIGNMENT
    if (
        "asset purchase" in blob
        or "copyright asset purchase" in blob
        or "buyout" in blob
        or "carta de confirma" in blob
    ):
        return BUYOUT
    if file_name.startswith("schedule") or "schedule " in file_name or "(schedule" in file_name:
        return SCHEDULE
    if "co-publishing" in blob or "publishing administration" in blob:
        return "паблишинг"
    if "consulting agreement" in blob:
        return "консалтинг"
    if "exclusive" in blob and ("license" in blob or "licence" in blob):
        return ARTIST_DEAL
    if "recording services agreement" in blob or "recording distribution and administration" in blob:
        return ARTIST_DEAL
    if "distribution agreement" in blob:
        return DISTRIBUTION
    if "license agreement" in blob or "licence agreement" in blob or "лицензион" in blob:
        return CONTRIB
    if "dmca" in blob or "counter notification" in blob or "indemnification" in blob or "letter of consent" in blob or "consent" in file_name:
        return "письмо"
    if "power of attorney" in blob:
        return "доверенность"
    return "прочее"


def filename_number(name: str) -> tuple[str, str, str]:
    stem = re.sub(r"\.pdf$", "", name, flags=re.I)
    match = re.search(r"(?:#|_)(\d{2})(\d{2})(\d{2})(.*)$", stem)
    if not match:
        return "", "", ""
    day, month, year = int(match.group(1)), int(match.group(2)), 2000 + int(match.group(3))
    if not (1 <= day <= 31 and 1 <= month <= 12 and 2018 <= year <= 2030):
        return "", "", ""
    nick = re.sub(r"[()]+", " ", match.group(4) or "")
    nick = re.split(r"(?i)_RU_ENG|_ENG_RU|_RUS_ENG", nick)[0]
    nick = re.sub(r"\s+", " ", nick).strip(" _-.#")
    number = f"{match.group(1)}{match.group(2)}{match.group(3)}{nick}".strip()
    return number, iso_from_dmy(day, month, year), norm_key(nick)


def parse_doc_date(flat: str, filename_date: str) -> str:
    match = re.search(
        r"(?:entered on|made on the|effective as of the|dated)\s+(\d{1,2})(?:st|nd|rd|th)?\s+"
        r"([A-Za-z]+),?\s+(\d{4})",
        flat,
        re.I,
    )
    if match:
        month = MONTHS_EN.get(match.group(2).lower())
        if month:
            found = iso_from_dmy(int(match.group(1)), month, int(match.group(3)))
            if found:
                return found
    match = re.search(r"dated as of\s+(\d{1,2})[./](\d{1,2})[./](\d{4})", flat, re.I)
    if match:
        found = iso_from_dmy(int(match.group(1)), int(match.group(2)), int(match.group(3)))
        if found:
            return found
    match = re.search(
        r"(\d{1,2})\s+([A-Za-z]+),?\s+(\d{4})\s+\(the\s+[“\"]?Effective Date",
        flat,
        re.I,
    )
    if match:
        month = MONTHS_EN.get(match.group(2).lower())
        if month:
            found = iso_from_dmy(int(match.group(1)), month, int(match.group(3)))
            if found:
                return found
    return filename_date


def parse_signature(flat: str) -> tuple[str, str, str]:
    completed = COMPLETED_RE.search(flat)
    if completed:
        return "подписан всеми", iso_from_stamp(completed.group(1)), "сертификат: DOCUMENT COMPLETED BY ALL PARTIES"
    signed = SIGNED_RE.findall(flat)
    if len(signed) >= 2:
        return "подписан всеми", iso_from_stamp(signed[-1]), f"сертификат: подписей с датой {len(signed)}"
    if len(signed) == 1:
        return "подписан одной стороной", iso_from_stamp(signed[0]), "сертификат: одна подпись с датой"
    return "не подписан", "", "в тексте PDF нет сертификата подписи с датой"


def parse_schedule(flat: str) -> list[ScheduleRow]:
    low = flat.lower()
    start = low.find("title of the work")
    if start < 0:
        start = low.find("sound recording ownership")
    if start < 0:
        return []
    stop = len(flat)
    for marker in ("document completed", "signer timestamp", "audit trail"):
        at = low.find(marker, start + 80)
        if at > 0:
            stop = min(stop, at)
    chunk = flat[start:stop]
    matches = list(DUR_RE.finditer(chunk))
    if not matches:
        return []
    head = chunk[: matches[0].start()].lower()
    cut = head.rfind("to the artist")
    header_end = cut + len("to the artist") if cut >= 0 else 0
    royalty_end: list[int] = []
    coauthors: list[str] = []
    royalties: list[list[Decimal]] = []
    for match in matches:
        percents = list(PCT_RE.finditer(chunk, match.end(), match.end() + 240))
        if len(percents) < 4:
            royalty_end.append(match.end())
            coauthors.append("")
            royalties.append([])
            continue
        coauthor = clean(chunk[match.end() : percents[0].start()], 80)
        royalty_end.append(percents[3].end())
        coauthors.append(coauthor)
        parsed = [parse_pct(percents[index].group(1)) for index in range(4)]
        royalties.append([item for item in parsed if item is not None])
    rows: list[ScheduleRow] = []
    for index, match in enumerate(matches):
        rates = royalties[index]
        if len(rates) < 4:
            continue
        left = royalty_end[index - 1] if index else header_end
        title = chunk[left : match.start()]
        title = DOC_REF_RE.sub(" ", title)
        title = PAGE_RE.sub(" ", title)
        title = clean(title, 160).strip(" -;/,")
        if not title or title.lower().startswith("royalt"):
            continue
        if len(title) < 2:
            continue
        digital = rates[0]
        rows.append(
            ScheduleRow(
                title=title,
                timing=match.group(1),
                composition_pct=parse_pct(match.group(2)),
                recording_pct=parse_pct(match.group(3)),
                coauthors=coauthors[index],
                digital_pct=digital,
                channels_equal=len(set(rates)) == 1,
            )
        )
    return rows


def extract_parties(flat: str) -> str:
    label = re.search(r"Record Label\s+(.+?)\s+Record Label Address", flat)
    artist = re.search(r"Artist\(s\)\s+(.+?)\s+Recording Services Term", flat)
    if label and artist:
        return clean(f"{label.group(1)}; {artist.group(1)}", 300)
    seller = re.search(r"\bSeller\s+([A-Z][^.;]{2,80})", flat)
    purchaser = re.search(r"\bPurchaser\s+([A-Z][^.;]{2,80})", flat)
    if seller and purchaser:
        return clean(f"{seller.group(1).strip()}; {purchaser.group(1).strip()}", 300)
    between = re.search(r"BETWEEN:\s*\(1\)\s+(.+?)\s+and\s+\(2\)\s+(.+?)\s+\(", flat)
    if between:
        return clean(f"{between.group(1)}; {between.group(2)}", 300)
    licensor = re.search(r"[«\"]Licensor[»\"]\s+(.{3,80}?)\s*,", flat)
    licensee = re.search(r"[«\"]Licensee[»\"]\s+(.{3,80}?)\s*,", flat)
    if licensor or licensee:
        return clean("; ".join(part.group(1) for part in (licensor, licensee) if part), 300)
    return ""


def extract_term(flat: str) -> tuple[str, str]:
    summary = re.search(r"Recording Services Term\s+(.+?)\s+Territory\b", flat)
    if summary:
        phrase = clean(summary.group(1), 180)
        low = phrase.lower()
        if "copyright" in low or "perpetuit" in low or "protection" in low:
            return "на срок охраны", f"шапка договора: {phrase}"
        return phrase, "шапка договора, Recording Services Term"
    for pattern, label in (
        (r"term of (?:the )?copyright", "на срок охраны"),
        (r"life of copyright", "на срок охраны"),
        (r"in perpetuity", "на срок охраны"),
        (r"entire period of protection", "на срок охраны"),
    ):
        if re.search(pattern, flat, re.I):
            return label, f"текст договора: {pattern}"
    years = re.search(r"(\d+)\s*\(\s*[a-z]+\s*\)\s*years", flat, re.I) or re.search(
        r"for a (?:period|term) of\s+(\d+)\s+years", flat, re.I
    )
    if years:
        return f"{years.group(1)} years", "срок в годах в тексте договора"
    return "", ""


def extract_territory(flat: str) -> tuple[str, str]:
    summary = re.search(r"Territory\s+(.{3,80}?)\s+Recoupable", flat)
    if summary and re.search(r"world|universe", summary.group(1), re.I):
        return "весь мир", f"шапка: Territory {clean(summary.group(1), 80)}"
    if re.search(r"Territory[”\"]?\s+means the world", flat, re.I):
        return "весь мир", "определение Territory means the world"
    if re.search(r"throughout the (?:world|universe)", flat, re.I):
        return "весь мир", "throughout the world / universe"
    if re.search(r"all countries of the world", flat, re.I):
        return "весь мир", "all countries of the world"
    if re.search(r"[«\"]Territory[»\"]\s+Universe", flat, re.I):
        return "весь мир", "Territory Universe"
    return "", ""


def extract_rights(doc_type: str, flat: str) -> str:
    if doc_type == ARTIST_DEAL and re.search(r"exclusive distributor|exclusive right to exploit", flat, re.I):
        return "эксклюзивная дистрибуция и администрирование записей на срок договора"
    if doc_type == SAMPLE:
        return "неисключительная лицензия на использование фрагмента мастер-записи и/или произведения в новой записи"
    if doc_type == ASSIGNMENT:
        return "уступка права, титула и интереса, как описано в договоре"
    if doc_type == BUYOUT:
        return "выкуп / покупка прав на записи, как описано в договоре"
    if doc_type == SUBLABEL:
        return "доля саблейбла или pass-through в поступлениях, как описано в договоре"
    if doc_type == SCHEDULE:
        return "приложение со списком работ и ставками роялти к договору артиста"
    if doc_type in {CONTRIB, DISTRIBUTION}:
        if re.search(r"\bnon-exclusive\b", flat, re.I):
            return "неисключительная лицензия"
        if re.search(r"\bexclusive\b", flat, re.I):
            return "исключительная лицензия или дистрибуция"
        return "лицензия, объём см. текст договора"
    if doc_type in {"форма W-8BEN", "заявление IMRO", "NDA", "консалтинг", "доверенность"}:
        return "документ не предоставляет права на запись каталога"
    return ""


def category_for(doc: Doc) -> tuple[str, str]:
    flat = doc.flat
    if doc.doc_type in {BUYOUT, ASSIGNMENT} and re.search(
        r"all (?:of )?(?:assignor’s |seller’s )?(?:right, title and interest|rights, title and interest)|exclusive property",
        flat,
        re.I,
    ):
        return OWN_MASTER, f"{doc.identifier}: уступка или выкуп права целиком"
    if doc.doc_type == SAMPLE or re.search(r"\bnon-exclusive\b", flat, re.I):
        if doc.doc_type in {SAMPLE, CONTRIB, SUBLABEL}:
            return NONEXCL, f"{doc.identifier}: неисключительное или поддерживающее право"
    exclusive = bool(re.search(r"exclusive distributor|exclusive right|исключительн", flat, re.I))
    life = doc.term == "на срок охраны" or bool(
        re.search(r"term of (?:the )?copyright|in perpetuity|life of copyright|period of protection", flat, re.I)
    )
    fixed = bool(re.search(r"\d+\s+years", doc.term)) or bool(re.search(r"\b\d+\s+years\b", flat, re.I))
    if exclusive and life and doc.doc_type in {ARTIST_DEAL, DISTRIBUTION, CONTRIB, SCHEDULE}:
        return EXCL_LIFE, f"{doc.identifier}: эксклюзив на срок охраны"
    if exclusive and fixed and doc.doc_type in {ARTIST_DEAL, DISTRIBUTION, CONTRIB, SCHEDULE}:
        return EXCL_FIXED, f"{doc.identifier}: эксклюзив на срок в годах"
    if doc.doc_type == SAMPLE:
        return NONEXCL, f"{doc.identifier}: лицензия на сэмпл"
    return "", ""


def mechanism_for(doc: Doc) -> str:
    if doc.doc_type in {"форма W-8BEN", "заявление IMRO", "NDA", "консалтинг", "письмо", "доверенность", "прочее", "паблишинг"}:
        if doc.doc_type == "паблишинг":
            return "только для справки"
        return "только для справки"
    flat = doc.flat.lower()
    if doc.doc_type in {ARTIST_DEAL, DISTRIBUTION, CONTRIB, SAMPLE, SCHEDULE}:
        return "прямая лицензия"
    if "partial" in flat and doc.doc_type in {ASSIGNMENT, BUYOUT}:
        return "уступка части"
    if doc.doc_type in {ASSIGNMENT, BUYOUT}:
        return "уступка целиком"
    if "novation" in flat:
        return "новация"
    if re.search(r"\bsublicen[cs]e\b", flat) and "grant" in flat:
        return "сублицензия"
    return ""


def limits_for(flat: str) -> str:
    found: list[str] = []
    if re.search(r"prior written consent", flat, re.I):
        found.append("нужно предварительное письменное согласие")
    if re.search(r"shall not re-?record|no re-?record", flat, re.I):
        found.append("запрет перезаписи")
    if re.search(r"name, image and likeness|name and likeness", flat, re.I):
        found.append("имя и изображение")
    if re.search(r"synchroni[sz].{0,50}(approval|consent|excluded|not granted)", flat, re.I):
        found.append("ограничение синхронизации")
    return "; ".join(found)


def duties_for(doc: Doc) -> str:
    if doc.doc_type == ARTIST_DEAL and "exclusive distributor" in doc.flat.lower():
        return "лейбл собирает поступления и платит роялти; артист поставляет записи"
    if doc.doc_type in {BUYOUT, ASSIGNMENT}:
        return "покупатель / цессионарий получает права; продавец / цедент передаёт их и подтверждает титул"
    return ""


def build_docs(raw_rows: list[dict], alias_to_party: dict[str, set[int]]) -> list[Doc]:
    docs: list[Doc] = []
    for row in raw_rows:
        flat = re.sub(r"\s+", " ", row.get("text") or "")
        number, filename_date, nick_key = filename_number(row["name"])
        doc = Doc(
            path=row["path"],
            name=row["name"],
            sha256=row.get("sha256") or "",
            text=row.get("text") or "",
            flat=flat,
            doc_type=classify(row["name"], flat),
            identifier=number or re.sub(r"\.pdf$", "", row["name"], flags=re.I),
            number_key=norm_key(number) if number else "",
            parties=extract_parties(flat),
            doc_date=parse_doc_date(flat, filename_date),
            dev_fixture=row["name"].startswith("[DEV]"),
        )
        doc.sign_status, doc.sign_date, doc.sign_basis = parse_signature(flat)
        doc.term, doc.term_source = extract_term(flat)
        doc.territory, doc.territory_source = extract_territory(flat)
        doc.rights = extract_rights(doc.doc_type, flat)
        doc.limits = limits_for(flat)
        doc.mechanism = mechanism_for(doc)
        doc.duties = duties_for(doc)
        doc.consents = "нужно согласие контрагента" if "предварительное письменное согласие" in doc.limits else ""
        doc.category, doc.category_source = category_for(doc)
        doc.schedule = parse_schedule(flat) if not doc.dev_fixture else []
        doc.broad_catalog = doc.doc_type in {BUYOUT, ASSIGNMENT} and bool(
            re.search(r"all (?:of )?(?:the )?(?:right, title|rights, title)|prior works|entire catalog", flat, re.I)
        )
        keys = set()
        if nick_key:
            keys.add(nick_key)
        for piece in re.split(r"[;/,]", doc.parties):
            key = norm_key(piece)
            if len(key) >= 3:
                keys.add(key)
            quoted = re.search(r"[«\"“](.{2,40})[»\"”]", piece)
            if quoted:
                qkey = norm_key(quoted.group(1))
                if len(qkey) >= 3:
                    keys.add(qkey)
        resolved: set[int] = set()
        for key in keys:
            parties = alias_to_party.get(key)
            if parties and len(parties) == 1:
                resolved.add(next(iter(parties)))
        doc.party_ids = sorted(resolved)
        docs.append(doc)
    used_ids: set[str] = set()
    for doc in docs:
        candidate = doc.identifier
        if candidate in used_ids:
            relative = str(Path(doc.path).relative_to(REPO / "context_data"))
            candidate = f"{doc.identifier} · {relative}"
        serial = 2
        base = candidate
        while candidate in used_ids:
            candidate = f"{base} · {serial}"
            serial += 1
        doc.identifier = candidate
        used_ids.add(candidate)
    by_key: dict[str, list[Doc]] = defaultdict(list)
    for doc in docs:
        if doc.number_key:
            by_key[doc.number_key].append(doc)
    for group in by_key.values():
        if len(group) < 2:
            continue
        labels = [item.identifier for item in group]
        for doc in group:
            others = [label for label in labels if label != doc.identifier]
            doc.related = "; ".join(others)
    return docs


def display_title(title: str, version: str | None, vtype: str | None) -> str:
    base = (title or "").strip()
    extra = (version or "").strip()
    if not extra and vtype and vtype.lower() != "original":
        extra = vtype.strip()
    if not extra:
        return base
    if extra.casefold() in base.casefold():
        return base
    return f"{base} ({extra})"


def product_type(title: str, version: str) -> str:
    blob = f"{title} {version}".lower()
    if "ringtone" in blob or "ring tone" in blob:
        return "ringtone"
    if "music video" in blob or re.search(r"\bvideo\b", blob):
        return "music video"
    return "audio"


def load_catalog(connection: sqlite3.Connection) -> tuple[dict[str, Recording], list[str], str, str]:
    meta = dict(connection.execute("select k, v from meta"))
    label = connection.execute("select id, name from party where id = ?", (LABEL_PARTY,)).fetchone()
    if label is None or label[1] != "0to8":
        raise SystemExit("party 1 в erp.db не лейбл 0to8, сборка остановлена")
    tracks = {
        row[0]: row
        for row in connection.execute("select isrc, title, artist, release, upc, label, first_month from track")
    }
    metas = {
        row[0]: row
        for row in connection.execute(
            "select isrc, title, version, vtype, upc, release_date from track_meta"
        )
    }
    split_parties: dict[str, set[int]] = defaultdict(set)
    for isrc, party_id in connection.execute("select isrc, party_id from split_line"):
        split_parties[isrc].add(int(party_id))
    recordings: dict[str, Recording] = {}
    for isrc in sorted(set(tracks) | set(metas)):
        track = tracks.get(isrc)
        info = metas.get(isrc)
        title = (info[1] if info and info[1] else (track[1] if track else "")) or ""
        version = info[2] if info else ""
        vtype = info[3] if info else ""
        artist = track[2] if track else ""
        upc_values = []
        for candidate in ((track[4] if track else ""), (info[4] if info else "")):
            if candidate and candidate not in upc_values:
                upc_values.append(candidate)
        label_name = track[5] if track else ""
        exclusion = ""
        in_perimeter = True
        if label_name and "Echo8" in label_name and "0to8" not in label_name:
            in_perimeter = False
            exclusion = "Echo8"
        release = ""
        if info and info[5] and re.fullmatch(r"\d{4}-\d{2}-\d{2}", info[5]):
            release = info[5]
        parties = set(split_parties.get(isrc, set()))
        for token in re.split(r"[,;/&]+", artist or ""):
            key = norm_key(token)
            if len(key) >= 3:
                parties.add(-1)  # placeholder removed below
        rec = Recording(
            isrc=isrc,
            title=display_title(title, version, vtype),
            artists=clean(re.sub(r"\s*,\s*", "; ", artist or ""), 300),
            upc="; ".join(upc_values),
            product=product_type(title, rec_version(version, vtype)),
            release_date=release,
            label=label_name or "",
            in_perimeter=in_perimeter,
            exclusion=exclusion,
            parties={party for party in parties if party > 0},
        )
        recordings[isrc] = rec
    months = [row[0] for row in connection.execute("select distinct month from revenue order by 1")]
    return recordings, months, meta.get("built_at", ""), meta.get("last_revenue_month", "")


def rec_version(version: str | None, vtype: str | None) -> str:
    if version:
        return version
    if vtype and vtype.lower() != "original":
        return vtype
    return ""


def attach_artist_parties(recordings: dict[str, Recording], alias_to_party: dict[str, set[int]]) -> None:
    for rec in recordings.values():
        for token in re.split(r"[;,&/]+", rec.artists):
            parties = alias_to_party.get(norm_key(token))
            if parties and len(parties) == 1:
                rec.parties.add(next(iter(parties)))


def load_money(
    connection: sqlite3.Connection, months: list[str]
) -> tuple[dict[tuple[str, str], Decimal], dict[str, Decimal]]:
    receipts: dict[tuple[str, str], Decimal] = defaultdict(lambda: Decimal(0))
    for isrc, month, net_x in connection.execute("select isrc, month, net_x from revenue"):
        receipts[(isrc, month)] += Decimal(net_x)
    label_rate: dict[str, Decimal] = {}
    sums: dict[str, Decimal] = defaultdict(lambda: Decimal(0))
    others: dict[str, Decimal] = defaultdict(lambda: Decimal(0))
    for isrc, party_id, rate_x in connection.execute("select isrc, party_id, rate_x from split_line"):
        rate = Decimal(rate_x)
        sums[isrc] += rate
        if int(party_id) == LABEL_PARTY:
            label_rate[isrc] = rate
        else:
            others[isrc] += rate
    for isrc, total in sums.items():
        if isrc not in label_rate and total <= Decimal("100"):
            label_rate[isrc] = Decimal("100") - others[isrc]
    return receipts, label_rate


def load_split_rows(connection: sqlite3.Connection) -> list[tuple[str, int, Decimal]]:
    return [
        (isrc, int(party_id), Decimal(rate_x))
        for isrc, party_id, rate_x in connection.execute(
            "select isrc, party_id, rate_x from split_line where party_id != ?",
            (LABEL_PARTY,),
        )
    ]


def month_cells(
    isrc: str, months: list[str], receipts: dict[tuple[str, str], Decimal], rate: Decimal | None
) -> tuple[list[Decimal | None], Decimal | None]:
    cells: list[Decimal | None] = []
    total = Decimal(0)
    any_value = False
    for month in months:
        raw = receipts.get((isrc, month))
        if raw is None or rate is None and False:
            cells.append(None)
            continue
        if raw is None:
            cells.append(None)
            continue
        amount = q2(raw if rate is None else raw * rate / Decimal(100))
        cells.append(amount)
        total += amount
        any_value = True
    if rate is not None:
        # пересчитать: raw отсутствует уже обработан; rate задан только для доли лейбла
        return cells, (total if any_value else Decimal(0) if any(receipts.get((isrc, month)) is not None for month in months) else None)
    return cells, total if any_value else None


def receipt_row(isrc: str, months: list[str], receipts: dict[tuple[str, str], Decimal]) -> tuple[list[Decimal | None], Decimal | None]:
    cells: list[Decimal | None] = []
    total = Decimal(0)
    any_value = False
    for month in months:
        raw = receipts.get((isrc, month))
        if raw is None:
            cells.append(None)
            continue
        amount = q2(raw)
        cells.append(amount)
        total += amount
        any_value = True
    return cells, total if any_value else None


def label_row(
    isrc: str, months: list[str], receipts: dict[tuple[str, str], Decimal], rate: Decimal | None
) -> tuple[list[Decimal | None], Decimal | None]:
    if rate is None:
        return [None] * len(months), None
    cells: list[Decimal | None] = []
    total = Decimal(0)
    any_value = False
    for month in months:
        raw = receipts.get((isrc, month))
        if raw is None:
            cells.append(None)
            continue
        amount = q2(raw * rate / Decimal(100))
        cells.append(amount)
        total += amount
        any_value = True
    return cells, total if any_value else None


def link_documents(
    docs: list[Doc],
    recordings: dict[str, Recording],
    alias_to_party: dict[str, set[int]],
) -> dict[str, list[tuple[str, str]]]:
    catalog_isrcs = set(recordings)
    upc_to_isrcs: dict[str, list[str]] = defaultdict(list)
    title_to_isrcs: dict[str, list[str]] = defaultdict(list)
    for rec in recordings.values():
        for upc in [part.strip() for part in rec.upc.split(";") if part.strip()]:
            upc_to_isrcs[upc].append(rec.isrc)
        title_to_isrcs[norm_title(rec.title)].append(rec.isrc)
    links: dict[str, list[tuple[str, str]]] = defaultdict(list)

    rights_types = {
        ARTIST_DEAL, SCHEDULE, CONTRIB, SAMPLE, SUBLABEL, BUYOUT, ASSIGNMENT, DISTRIBUTION, SETTLEMENT, "паблишинг",
    }

    def add(isrc: str, doc: Doc, method: str) -> None:
        if isrc not in recordings or doc.dev_fixture or doc.doc_type not in rights_types:
            return
        pair = (doc.identifier, method)
        if pair not in links[isrc]:
            links[isrc].append(pair)

    for doc in docs:
        if doc.dev_fixture:
            continue
        for isrc in ISRC_RE.findall(doc.flat):
            if isrc in catalog_isrcs:
                doc.named_isrcs.add(isrc)
                add(isrc, doc, "ISRC назван")
        for upc in UPC_RE.findall(doc.flat):
            if upc in upc_to_isrcs:
                doc.named_upcs.add(upc)
                for isrc in upc_to_isrcs[upc]:
                    add(isrc, doc, "назван релиз")
        for row in doc.schedule:
            matches = title_to_isrcs.get(norm_title(row.title), [])
            if not matches:
                continue
            filtered = [
                isrc
                for isrc in matches
                if doc.party_ids and recordings[isrc].parties.intersection(doc.party_ids)
            ]
            chosen = filtered or (matches if len(matches) == 1 else [])
            for isrc in chosen:
                add(isrc, doc, "назван трек")
        if doc.schedule or doc.doc_type not in {ARTIST_DEAL, DISTRIBUTION}:
            blanket = False
        else:
            blanket = True
        if doc.broad_catalog:
            blanket = True
        if blanket and doc.party_ids and doc.doc_date:
            years = re.search(r"(\d+)\s+years", doc.term)
            for party_id in doc.party_ids:
                if party_id == LABEL_PARTY:
                    continue
                for rec in recordings.values():
                    if party_id not in rec.parties:
                        continue
                    if doc.broad_catalog:
                        add(rec.isrc, doc, "только по артисту")
                        continue
                    if not rec.release_date or rec.release_date < doc.doc_date:
                        continue
                    if years:
                        end_year = int(doc.doc_date[:4]) + int(years.group(1))
                        end = f"{end_year:04d}{doc.doc_date[4:]}"
                        if rec.release_date > end:
                            continue
                    add(rec.isrc, doc, "только по артисту")
    return links


def join_pairs(pairs: list[tuple[str, str]]) -> tuple[str, str]:
    docs = []
    methods = []
    for identifier, method in sorted(pairs):
        if identifier not in docs:
            docs.append(identifier)
        label = f"{identifier}: {method}"
        if label not in methods:
            methods.append(label)
    return "; ".join(docs), "; ".join(methods)


def governing(docs_by_id: dict[str, Doc], pairs: list[tuple[str, str]]) -> list[Doc]:
    rank = {OWN_MASTER: 4, EXCL_LIFE: 3, EXCL_FIXED: 2, NONEXCL: 1}
    chosen: list[Doc] = []
    for identifier, _method in pairs:
        doc = docs_by_id.get(identifier)
        if doc and doc.category:
            chosen.append(doc)
    chosen.sort(key=lambda doc: rank.get(doc.category, 0), reverse=True)
    return chosen


def chain_for(docs: list[Doc], docs_by_id: dict[str, Doc]) -> str:
    parts: list[str] = []
    assignments = [doc for doc in docs_by_id.values() if doc.doc_type == ASSIGNMENT and "l.l.c-fz" in doc.flat.lower()]
    for doc in docs:
        flat = doc.flat.lower()
        if "l.l.c-fz" in flat or "llc-fz" in flat:
            parts.append(f"напрямую Zero to Infinity L.L.C-FZ, {doc.identifier}, {doc.doc_date or 'дата документа не извлечена'}")
            continue
        if "zero to infinity inc" in flat:
            parts.append(f"напрямую Zero to Infinity Inc, {doc.identifier}, {doc.doc_date or 'дата документа не извлечена'}")
        if doc.doc_type not in {BUYOUT, ASSIGNMENT}:
            continue
        for assignment in assignments:
            if assignment.identifier == doc.identifier:
                continue
            nick_hit = doc.number_key and doc.number_key[:6] and doc.number_key[6:] and doc.number_key[6:] in norm_key(assignment.flat)
            shared_party = set(doc.party_ids).intersection(assignment.party_ids)
            if nick_hit or shared_party:
                parts.append(
                    f"через цепочку {doc.identifier} ({doc.doc_date or 'без даты'}) → {assignment.identifier} ({assignment.doc_date or 'без даты'}) на Zero to Infinity L.L.C-FZ"
                )
                break
    unique: list[str] = []
    for part in parts:
        if part not in unique:
            unique.append(part)
    return "; ".join(unique)


def approval_rows(docs: list[Doc], links: dict[str, list[tuple[str, str]]]) -> list[list]:
    isrcs_by_doc: dict[str, list[str]] = defaultdict(list)
    for isrc, pairs in links.items():
        for identifier, _method in pairs:
            isrcs_by_doc[identifier].append(isrc)
    consent_parties = {
        party
        for doc in docs
        if doc.doc_type == "письмо" and "consent" in doc.flat.lower()
        for party in doc.party_ids
    }
    rows: list[list] = []
    for doc in docs:
        if doc.dev_fixture:
            continue
        touched = "; ".join(sorted(isrcs_by_doc.get(doc.identifier, []))[:40])
        if len(isrcs_by_doc.get(doc.identifier, [])) > 40:
            touched += f"; … ещё {len(isrcs_by_doc[doc.identifier]) - 40}"
        if "предварительное письменное согласие" in doc.limits:
            got = doc.party_ids and all(party in consent_parties for party in doc.party_ids)
            rows.append(
                [
                    doc.identifier,
                    "требуемое согласие",
                    "предварительное письменное согласие контрагента",
                    touched,
                    "получено" if got else "не получено",
                    "",
                    doc.parties or doc.identifier,
                ]
            )
        if "запрет перезаписи" in doc.limits:
            rows.append([doc.identifier, "принятое ограничение", "запрет перезаписи", touched, "не требуется", "", doc.parties])
        if "имя и изображение" in doc.limits:
            rows.append([doc.identifier, "принятое ограничение", "использование имени и изображения", touched, "не требуется", "", doc.parties])
        if "ограничение синхронизации" in doc.limits:
            rows.append([doc.identifier, "принятое ограничение", "синхронизация ограничена или требует согласия", touched, "не получено", "", doc.parties])
    return rows


def write_sheet(workbook: Workbook, title: str, status: str, headers: list[str], rows: list[list], total_row: list | None = None) -> None:
    sheet = workbook.create_sheet(title)
    sheet.sheet_view.showGridLines = False
    sheet["A1"] = status
    sheet["A1"].font = Font(bold=True)
    sheet["A1"].alignment = Alignment(wrap_text=True, vertical="center")
    for column, header in enumerate(headers, start=1):
        cell = sheet.cell(2, column, header)
        cell.font = Font(bold=True)
    data_start = 3
    if total_row is not None:
        for column, value in enumerate(total_row, start=1):
            put(sheet.cell(3, column), value)
        data_start = 4
    for offset, row in enumerate(rows):
        for column, value in enumerate(row, start=1):
            put(sheet.cell(data_start + offset, column), value)
    sheet.freeze_panes = "A3"
    sheet.row_dimensions[1].height = 48
    for column, header in enumerate(headers, start=1):
        sheet.column_dimensions[get_column_letter(column)].width = min(max(len(header) + 2, 14), 42)


def put(cell, value) -> None:
    if value is None or value == "":
        cell.value = None
        return
    if isinstance(value, Decimal):
        cell.value = float(value)
        cell.number_format = "0.00"
        return
    if isinstance(value, str):
        cell.value = clean(value, 32000)
        return
    cell.value = value


def money_or_blank(value: Decimal | None) -> Decimal | None:
    return value


def month_key(value) -> str:
    if isinstance(value, datetime):
        return f"{value.year:04d}-{value.month:02d}"
    text = str(value or "").strip()
    dotted = re.match(r"(\d{1,2})[.](\d{1,2})[.](\d{4})", text)
    if dotted:
        return f"{int(dotted.group(3)):04d}-{int(dotted.group(2)):02d}"
    if re.fullmatch(r"\d{4}-\d{2}-\d{2}.*", text) or re.fullmatch(r"\d{4}-\d{2}", text[:7]):
        return text[:7]
    return ""


def remember_nick(value, index: dict[str, str]) -> str:
    if value is None:
        return ""
    text = clean(str(value), 120)
    key = norm_key(text)
    if len(key) < 2:
        return ""
    index.setdefault(key, text)
    return index[key]


def decimal_of(value) -> Decimal | None:
    if value is None or value == "":
        return None
    if isinstance(value, Decimal):
        return value
    try:
        return Decimal(str(value))
    except Exception:
        return None


def load_main() -> dict:
    from openpyxl import load_workbook

    if not MAIN_XLSX.is_file():
        raise SystemExit(f"нет файла {MAIN_XLSX}")
    workbook = load_workbook(MAIN_XLSX, read_only=True, data_only=True)
    index: dict[str, str] = {}
    contracts: dict[str, dict] = {}
    for row in workbook["Contracts"].iter_rows(min_row=2, values_only=True):
        nick = remember_nick(row[2] if len(row) > 2 else "", index)
        if not nick:
            continue
        key = norm_key(nick)
        percent = decimal_of(row[4] if len(row) > 4 else None)
        if percent is not None and percent <= 1:
            percent = percent * Decimal(100)
        term = month_key(row[1]) if len(row) > 1 else ""
        if isinstance(row[1], datetime):
            term = row[1].date().isoformat()
        contracts[key] = {
            "nick": nick,
            "name": clean(str(row[3] or ""), 160) if len(row) > 3 else "",
            "percent": percent,
            "term": term,
            "report": clean(str(row[6] or ""), 180) if len(row) > 6 else "",
            "note": clean(str(row[8] or ""), 180) if len(row) > 8 else "",
        }
    no_contract: list[str] = []
    for row in workbook["Нет контрактов"].iter_rows(min_row=2, values_only=True):
        nick = remember_nick(row[0] if row else "", index)
        if nick and nick not in no_contract:
            no_contract.append(nick)
    for row in workbook["Для выплат (EXP)"].iter_rows(min_row=6, values_only=True):
        if len(row) > 1:
            remember_nick(row[1], index)

    def read_ledger(sheet_name: str, contour: str) -> list[dict]:
        rows: list[dict] = []
        for offset, row in enumerate(workbook[sheet_name].iter_rows(values_only=True), start=1):
            if offset == 1 or len(row) < 7:
                continue
            nick = remember_nick(row[3], index)
            amount = decimal_of(row[6])
            kind = clean(str(row[4] or ""), 40)
            if not nick or amount is None or kind not in {"Income", "Expense"}:
                continue
            month = month_key(row[2])
            if not month:
                continue
            rows.append(
                {
                    "contour": contour,
                    "nick": index[norm_key(nick)],
                    "month": month,
                    "kind": kind,
                    "category": clean(str(row[5] or ""), 40) or "без категории",
                    "amount": amount,
                }
            )
        return rows

    ledger = read_ledger("INCOME  EXPENSE", "0to8") + read_ledger("Echo8", "Echo8")
    label_revenue: dict[str, Decimal] = {}
    label_profit: dict[str, Decimal] = {}
    for row in workbook["NEW СВОДКА (НЕ ТРОГАТЬ)"].iter_rows(min_row=2, values_only=True):
        if len(row) < 16:
            continue
        period = month_key(row[13])
        revenue = decimal_of(row[14])
        profit = decimal_of(row[15])
        if period and revenue is not None:
            label_revenue[period] = revenue
        if period and profit is not None:
            label_profit[period] = profit
    payout_header = None
    for row in workbook["Для выплат (EXP)"].iter_rows(min_row=4, max_row=4, values_only=True):
        payout_header = decimal_of(row[2] if len(row) > 2 else None)
    workbook.close()
    return {
        "index": index,
        "contracts": contracts,
        "no_contract": no_contract,
        "ledger": ledger,
        "label_revenue": label_revenue,
        "label_profit": label_profit,
        "payout_header": payout_header,
        "sha256": sha256_file(MAIN_XLSX),
    }


def bind_nicknames(docs: list[Doc], index: dict[str, str]) -> None:
    for doc in docs:
        found: list[str] = []
        number, _date, nick_norm = filename_number(doc.name)
        raw = number[6:].strip() if len(number) >= 6 and number[:6].isdigit() else ""
        if nick_norm and nick_norm in index:
            found.append(index[nick_norm])
        elif raw:
            found.append(raw)
        for piece in re.split(r"[;/,]", doc.parties):
            quoted = re.search(r"[«\"“](.{2,40})[»\"”]", piece)
            token = quoted.group(1) if quoted else piece
            key = norm_key(token)
            if key in index and index[key] not in found:
                found.append(index[key])
        doc.nicknames = found


def aggregate(ledger: list[dict], kind: str) -> tuple[dict[tuple[str, str, str], Decimal], list[str]]:
    cells: dict[tuple[str, str, str], Decimal] = defaultdict(lambda: Decimal(0))
    months: set[str] = set()
    for row in ledger:
        if row["kind"] != kind:
            continue
        cells[(row["contour"], row["nick"], row["month"])] += row["amount"]
        months.add(row["month"])
    return cells, sorted(months)


def build() -> None:
    print("читаю 0to8 Main.xlsx", flush=True)
    main = load_main()
    index: dict[str, str] = main["index"]
    contracts: dict[str, dict] = main["contracts"]
    ledger: list[dict] = main["ledger"]
    income_cells, income_months = aggregate(ledger, "Income")
    expense_cells, expense_months = aggregate(ledger, "Expense")
    months = sorted(set(income_months) | set(expense_months))
    echo_nicks = {norm_key(row["nick"]) for row in ledger if row["contour"] == "Echo8"}
    own_nicks = {norm_key(row["nick"]) for row in ledger if row["contour"] == "0to8"}
    raw_expense = sum((row["amount"] for row in ledger if row["contour"] == "0to8" and row["kind"] == "Expense"), Decimal(0))
    raw_income = sum((row["amount"] for row in ledger if row["contour"] == "0to8" and row["kind"] == "Income"), Decimal(0))
    category_income: dict[str, Decimal] = defaultdict(lambda: Decimal(0))
    category_expense: dict[str, Decimal] = defaultdict(lambda: Decimal(0))
    for row in ledger:
        if row["contour"] != "0to8":
            continue
        if row["kind"] == "Income":
            category_income[row["category"]] += row["amount"]
        else:
            category_expense[row["category"]] += row["amount"]

    print("читаю договоры", flush=True)
    pdfs = collect_pdfs()
    raw_rows = load_texts(pdfs)
    outside = [
        row["path"]
        for row in raw_rows
        if not str(row["path"]).startswith(str(PANDA)) and not str(row["path"]).startswith(str(ROOT))
    ]
    if outside:
        raise SystemExit("в выборке есть документ вне двух разрешённых папок")
    docs = build_docs(raw_rows, {})
    if len({doc.identifier for doc in docs}) != len(docs):
        raise SystemExit("идентификаторы договоров не уникальны")
    bind_nicknames(docs, index)
    docs_by_id = {doc.identifier: doc for doc in docs}
    rights_types = {
        ARTIST_DEAL, SCHEDULE, CONTRIB, SAMPLE, SUBLABEL, BUYOUT, ASSIGNMENT, DISTRIBUTION, SETTLEMENT, "паблишинг",
    }

    works: dict[tuple[str, str], dict] = {}
    isrc_rows: dict[str, dict] = {}
    for doc in docs:
        if doc.dev_fixture or doc.doc_type not in rights_types:
            continue
        nick = doc.nicknames[0] if doc.nicknames else ""
        for isrc in sorted(set(ISRC_RE.findall(doc.flat))):
            slot = isrc_rows.setdefault(
                isrc,
                {"isrc": isrc, "title": "", "nick": nick, "docs": [], "methods": [], "schedule": []},
            )
            if doc.identifier not in slot["docs"]:
                slot["docs"].append(doc.identifier)
            if "ISRC назван" not in slot["methods"]:
                slot["methods"].append("ISRC назван")
            if not slot["nick"] and nick:
                slot["nick"] = nick
        for row in doc.schedule:
            key = (norm_key(nick), norm_title(row.title))
            slot = works.setdefault(
                key,
                {
                    "isrc": "",
                    "title": row.title,
                    "nick": nick,
                    "docs": [],
                    "methods": [],
                    "digital": [],
                    "coauthors": [],
                },
            )
            if doc.identifier not in slot["docs"]:
                slot["docs"].append(doc.identifier)
            if "назван трек" not in slot["methods"]:
                slot["methods"].append("назван трек")
            if row.digital_pct is not None and row.channels_equal:
                slot["digital"].append((doc.identifier, row.digital_pct))
            if row.coauthors and row.coauthors not in slot["coauthors"]:
                slot["coauthors"].append(row.coauthors)

    def work_rows() -> list[dict]:
        rows = list(works.values()) + list(isrc_rows.values())
        for row in rows:
            if "digital" not in row:
                row["digital"] = []
            if "coauthors" not in row:
                row["coauthors"] = []
        return rows

    recording_source = work_rows()
    recording_source.sort(key=lambda item: (item["nick"].casefold(), item["title"].casefold(), item["isrc"]))

    def docs_for(identifiers: list[str]) -> list[Doc]:
        return [docs_by_id[item] for item in identifiers if item in docs_by_id]

    recording_rows: list[list] = []
    gap4: list[list] = []
    for work in recording_source:
        chosen = docs_for(work["docs"])
        categories, terms, territories, limits = [], [], [], []
        category_source, term_source, territory_source = [], [], []
        for doc in chosen:
            if doc.category and doc.category not in categories:
                categories.append(doc.category)
                category_source.append(doc.category_source)
            if doc.term and doc.term not in terms:
                terms.append(doc.term)
                term_source.append(f"{doc.identifier}: {doc.term_source}")
            if doc.territory and doc.territory not in territories:
                territories.append(doc.territory)
                territory_source.append(f"{doc.identifier}: {doc.territory_source}")
            if doc.limits and doc.limits not in limits:
                limits.append(doc.limits)
        nick_key = norm_key(work["nick"])
        main_contract = contracts.get(nick_key)
        share = None
        share_source = ""
        if main_contract and main_contract["percent"] is not None:
            share = Decimal(100) - main_contract["percent"]
            share_source = f"100 − {main_contract['percent']} процент артиста на листе Contracts в 0to8 Main.xlsx"
        elif len({rate for _doc, rate in work["digital"]}) == 1 and not work["coauthors"]:
            rate = work["digital"][0][1]
            share = Decimal(100) - rate
            share_source = f"{work['digital'][0][0]}: 100 − ставка Digital Distribution, не процент владения фонограммой"
        outside = nick_key in echo_nicks and nick_key not in own_nicks
        if any(item in {EXCL_LIFE, EXCL_FIXED, NONEXCL} for item in categories) and (not terms or not territories):
            gap4.append([work["isrc"], work["nick"], work["title"], "; ".join(categories), "; ".join(terms), "; ".join(territories)])
        recording_rows.append(
            [
                work["isrc"],
                work["title"],
                work["nick"],
                "; ".join(work["coauthors"]),
                "вне периметра" if outside else "в периметре",
                "Echo8" if outside else "",
                "; ".join(categories),
                "; ".join(category_source),
                share,
                share_source,
                "; ".join(terms),
                "; ".join(term_source),
                "; ".join(territories),
                "; ".join(territory_source),
                "; ".join(limits),
                "; ".join(work["docs"]),
                "; ".join(f"{doc_id}: {method}" for doc_id in work["docs"] for method in work["methods"]),
                "",
            ]
        )

    royalty_rows: list[list] = []
    gap2: list[list] = []
    gap3: list[list] = []
    seen_gap3: set[tuple[str, str]] = set()
    for key, contract in sorted(contracts.items(), key=lambda item: item[1]["nick"].casefold()):
        titles = sorted({work["title"] for work in recording_source if norm_key(work["nick"]) == key and work["title"]})
        doc_ids = sorted({doc_id for work in recording_source if norm_key(work["nick"]) == key for doc_id in work["docs"]})
        royalty_rows.append(
            [
                contract["nick"],
                contract["nick"],
                "; ".join(titles),
                "; ".join(doc_ids),
                "реестр Main, лист Contracts; процент артиста от выплат, не доля владения фонограммой",
                contract["percent"],
                None,
                "",
                f"по {contract['term']}" if contract["term"] else "",
                "",
                "",
                "лейбл",
                "да",
                "0to8 Main.xlsx, лист Contracts",
            ]
        )
    for work in recording_source:
        main_contract = contracts.get(norm_key(work["nick"]))
        main_rate = main_contract["percent"] if main_contract else None
        for doc_id, rate in work["digital"]:
            if main_rate is not None and abs(main_rate - rate) > Decimal("0.05"):
                gap2.append([work["isrc"], work["nick"], work["title"], doc_id, rate, main_rate])
            if main_rate is None:
                royalty_rows.append(
                    [
                        work["nick"] or doc_id,
                        work["nick"],
                        work["title"] or work["isrc"],
                        doc_id,
                        "ставка Digital Distribution в schedule; четыре канала строки совпали",
                        rate,
                        None,
                        "",
                        "",
                        "",
                        "",
                        "лейбл",
                        "нет",
                        f"PDF {doc_id}; на листе Contracts этого псевдонима нет",
                    ]
                )
        for coauthor in work["coauthors"]:
            for piece in re.split(r"[,;/]", coauthor):
                token = clean(piece, 80)
                if not token or norm_key(token) in index:
                    continue
                doc_id = work["docs"][0] if work["docs"] else ""
                if (doc_id, token) in seen_gap3:
                    continue
                seen_gap3.add((doc_id, token))
                gap3.append([doc_id, token, work["title"], "соавтор schedule не найден среди псевдонимов Main"])
        if work["nick"] and norm_key(work["nick"]) not in index:
            key = ("", work["nick"])
            if key not in seen_gap3:
                seen_gap3.add(key)
                gap3.append(["; ".join(work["docs"]), work["nick"], work["title"], "псевдоним договора не найден в Main"])

    income_by_nick: dict[str, Decimal] = defaultdict(lambda: Decimal(0))
    for row in ledger:
        if row["contour"] == "0to8" and row["kind"] == "Income" and row["category"] == "Royalties":
            income_by_nick[norm_key(row["nick"])] += row["amount"]
    covered_nicks = {norm_key(nick) for doc in docs if doc.doc_type in rights_types for nick in doc.nicknames}
    gap1 = []
    for key, amount in sorted(income_by_nick.items(), key=lambda item: (-item[1], index.get(item[0], ""))):
        if key in contracts or key in covered_nicks:
            continue
        gap1.append([index.get(key, key), q2(amount), "начисления роялти есть, договора в PDF и на листе Contracts нет"])
    for nick in main["no_contract"]:
        key = norm_key(nick)
        if not any(row[0] == nick for row in gap1):
            gap1.append([nick, q2(income_by_nick.get(key, Decimal(0))), "лист Main «Нет контрактов»"])

    gap5 = [
        [doc.identifier, doc.doc_type, doc.parties, doc.sign_status, doc.doc_date, doc.nicknames[0] if doc.nicknames else "", doc.name]
        for doc in docs
        if doc.sign_status in {"подписан одной стороной", "не подписан"}
    ]
    by_nick: dict[str, list[str]] = defaultdict(list)
    for doc in docs:
        if doc.doc_type not in {ARTIST_DEAL, BUYOUT, ASSIGNMENT}:
            continue
        for nick in doc.nicknames[:1]:
            by_nick[nick].append(doc.identifier)
    gap10 = []
    for nick, identifiers in sorted(by_nick.items()):
        unique = tuple(sorted(set(identifiers)))
        if len(unique) >= 2:
            gap10.append([nick, "; ".join(unique)])

    def matrix(cells: dict[tuple[str, str, str], Decimal], month_list: list[str]) -> tuple[list, list[list]]:
        keys = sorted({(contour, nick) for contour, nick, _month in cells})
        body = []
        grand = [Decimal(0)] * len(month_list)
        grand_total = Decimal(0)
        echo_grand = [Decimal(0)] * len(month_list)
        echo_total = Decimal(0)
        for contour, nick in keys:
            row_cells = []
            total = Decimal(0)
            any_value = False
            for index_month, month in enumerate(month_list):
                raw = cells.get((contour, nick, month))
                if raw is None:
                    row_cells.append(None)
                    continue
                amount = q2(raw)
                row_cells.append(amount)
                if contour == "0to8":
                    grand[index_month] += amount
                else:
                    echo_grand[index_month] += amount
                total += amount
                any_value = True
            if not any_value:
                continue
            if contour == "0to8":
                grand_total += total
            else:
                echo_total += total
            body.append([nick, contour, total, *row_cells])
        if echo_total:
            body.insert(0, ["Total Echo8", "Echo8", echo_total, *echo_grand])
        return ["Total 0to8", "0to8", grand_total, *grand], body

    income_total, income_body = matrix(income_cells, months)
    expense_total, expense_body = matrix(expense_cells, months)
    label_months = sorted(set(main["label_revenue"]) | set(main["label_profit"]))

    def series_row(title: str, values: dict[str, Decimal]) -> list:
        cells = []
        total = Decimal(0)
        any_value = False
        for month in label_months:
            raw = values.get(month)
            if raw is None:
                cells.append(None)
                continue
            amount = q2(raw)
            cells.append(amount)
            total += amount
            any_value = True
        return [title, total if any_value else None, *cells]

    label_rows = [
        series_row("Выручка лейбла", main["label_revenue"]),
        series_row("Прибыль лейбла", main["label_profit"]),
    ]

    failures: list[str] = []
    for body, label in ((income_body, "начисления"), (expense_body, "выплаты")):
        for row in body:
            got = sum((item for item in row[3:] if item is not None), Decimal(0))
            if got != row[2]:
                failures.append(f"месяцы не сходятся: {label} {row[0]}")
                break
    if main["payout_header"] is None or q2(raw_expense) != q2(main["payout_header"]):
        failures.append(f"расход 0to8 {q2(raw_expense)} не равен листу «Для выплат (EXP)» {main['payout_header']}")
    known_docs = set(docs_by_id)
    for row in recording_rows:
        for part in [item.strip() for item in str(row[15] or "").split(";") if item.strip()]:
            if part not in known_docs:
                failures.append(f"ссылка на договор не найдена: {part}")
                break
        else:
            continue
        break

    contract_rows = []
    for doc in sorted(docs, key=lambda item: item.identifier):
        primary = doc.nicknames[0] if doc.nicknames else ""
        registered = contracts.get(norm_key(primary))
        contract_rows.append(
            [
                doc.identifier,
                doc.doc_type,
                doc.parties,
                primary,
                registered["percent"] if registered else None,
                registered["term"] if registered else "",
                doc.doc_date,
                doc.sign_date,
                doc.sign_status,
                doc.sign_basis,
                doc.rights,
                doc.term,
                doc.term_source,
                doc.territory,
                doc.territory_source,
                doc.limits,
                doc.mechanism,
                doc.consents,
                doc.duties,
                doc.related,
                doc.replaced_by,
                len({work["title"] or work["isrc"] for work in recording_source if doc.identifier in work["docs"]}),
                doc.path,
            ]
        )

    last_month = months[-1] if months else "unknown"
    status = (
        f"Сборка {SCRIPT_VERSION}. Деньги и проценты артистов из 0to8 Main.xlsx, sha256 {main['sha256']}. "
        f"Начисления — строки Income, выплаты — строки Expense, контур 0to8 с листа INCOME EXPENSE, Echo8 с листа Echo8. "
        f"Доля лейбла — лист NEW СВОДКА, без разбивки по ISRC: в Main её нет. "
        f"Документы только из двух папок PDF, файлов {len(docs)}. erp.db не читался. "
        "Связка трека с договором автоматическая, по названию в schedule или по ISRC в тексте PDF. "
        "Пустая ячейка значит, что в этих источниках факта нет."
    )
    rec_headers = [
        "ISRC", "Запись и версия", "Псевдоним", "Соавторы в schedule", "Статус", "Основание исключения",
        "Категория прав", "Источник категории", "Наша доля, %", "Источник доли", "Срок", "Источник срока",
        "Территория", "Источник территории", "Объём разрешённого использования", "Договоры-основания",
        "Как запись идентифицирована в документе", "Чем право закреплено за FZ",
    ]
    contract_headers = [
        "Идентификатор", "Тип", "Стороны", "Псевдоним в Main", "Процент артиста в Main, %", "Окончание в Main",
        "Дата документа", "Дата подписания", "Статус подписания", "Основание статуса подписания",
        "Какие права предоставлены", "Срок", "Источник срока", "Территория", "Источник территории",
        "Существенные ограничения", "Механизм передачи", "Требуемые согласия", "Распределение обязательств",
        "Изменения и приложения", "Заменён документом", "Записей покрывает", "Файл",
    ]
    royalty_headers = [
        "Получатель", "Идентификатор получателя", "Записи", "Договор-основание", "База расчёта",
        "Ставка, %", "Фиксированная сумма", "Разрешённые вычеты", "Период применения",
        "Срок и порядок выплаты", "Удержание налога", "Чьё обязательство",
        "Отражено в реестре Main", "Источник",
    ]
    month_headers = ["Псевдоним", "Контур", "Итог за период, $", *months]
    label_headers = ["Показатель", "Итог по заполненным месяцам, $", *label_months]
    summary_rows: list[list] = [
        ["Записей из schedule и ISRC в PDF", len(recording_rows)],
        ["В периметре", sum(1 for row in recording_rows if row[4] == "в периметре")],
        ["Вне периметра Echo8", sum(1 for row in recording_rows if row[4] == "вне периметра")],
        ["Псевдонимов с начислениями роялти без договора", len([row for row in gap1 if row[2].startswith("начисления")])],
        ["Начисления 0to8, Income, $", q2(raw_income)],
        ["Выплаты 0to8, Expense, $", q2(raw_expense)],
        ["Лист «Для выплат (EXP)», $", q2(main["payout_header"]) if main["payout_header"] is not None else None],
        ["Выручка лейбла по сводке, сумма заполненных месяцев, $", label_rows[0][1]],
        ["Прибыль лейбла по сводке, сумма заполненных месяцев, $", label_rows[1][1]],
    ]
    for category, amount in sorted(category_income.items()):
        summary_rows.append([f"Начисления 0to8, {category}, $", q2(amount)])
    for category, amount in sorted(category_expense.items()):
        summary_rows.append([f"Выплаты 0to8, {category}, $", q2(amount)])

    print("пишу книгу", flush=True)
    OUT_DIR.mkdir(parents=True, exist_ok=True)
    out_path = OUT_DIR / f"реестры_каталога_main_{last_month}_{SCRIPT_VERSION}.xlsx"
    log_path = OUT_DIR / f"реестры_каталога_main_{last_month}_{SCRIPT_VERSION}.log"
    workbook = Workbook()
    workbook.remove(workbook.active)
    stamp = datetime(2026, 10, 26, 0, 0, 0)
    workbook.properties.creator = "build-catalog-registries"
    workbook.properties.title = f"реестры каталога main {last_month} {SCRIPT_VERSION}"
    workbook.properties.created = stamp
    workbook.properties.modified = stamp
    write_sheet(workbook, "Записи", status, rec_headers, recording_rows)
    write_sheet(workbook, "Договоры", status, contract_headers, contract_rows)
    write_sheet(workbook, "Роялти", status, royalty_headers, royalty_rows)
    write_sheet(workbook, "Согласования и ограничения", status, [
        "Договор или договорённость", "Тип", "Что именно", "Затронутые записи", "Статус", "Срок", "Ответственный",
    ], approval_rows(docs, {work["isrc"] or work["title"]: [(doc_id, "назван трек") for doc_id in work["docs"]] for work in recording_source}))
    write_sheet(
        workbook,
        "Ассеты",
        status + " В двух папках PDF и в 0to8 Main.xlsx нет файлов обложек, стемов и мастеров.",
        ["Запись или релиз", "Тип ассета", "Правовой статус", "Правообладатель", "Формат и качество", "Где лежит"],
        [],
    )
    write_sheet(workbook, "Начисления по месяцам", status, month_headers, income_body, income_total)
    write_sheet(workbook, "Выплаты по месяцам", status, month_headers, expense_body, expense_total)
    write_sheet(
        workbook,
        "Доля лейбла по месяцам",
        status + " Две строки сводки лейбла, не сумма по записям.",
        label_headers,
        label_rows,
    )
    summary = workbook.create_sheet("Сводка")
    summary["A1"] = status
    summary["A1"].font = Font(bold=True)
    summary["A1"].alignment = Alignment(wrap_text=True)
    summary["A2"] = "Показатель"
    summary["B2"] = "Значение"
    summary["A2"].font = Font(bold=True)
    summary["B2"].font = Font(bold=True)
    for index_row, row in enumerate(summary_rows, start=3):
        summary.cell(index_row, 1, row[0])
        put(summary.cell(index_row, 2), row[1])
    cursor = 3 + len(summary_rows) + 2

    def add_gap(title: str, headers: list[str], rows: list[list]) -> None:
        nonlocal cursor
        summary.cell(cursor, 1, title).font = Font(bold=True)
        cursor += 1
        for column, header in enumerate(headers, start=1):
            summary.cell(cursor, column, header).font = Font(bold=True)
        cursor += 1
        if not rows:
            summary.cell(cursor, 1, "пусто")
            cursor += 2
            return
        for row in rows:
            for column, value in enumerate(row, start=1):
                put(summary.cell(cursor, column), value)
            cursor += 1
        cursor += 1

    add_gap("Пробел 1. Псевдоним с начислениями или в списке «Нет контрактов» без договора", ["Псевдоним", "Начисления роялти, $", "Почему"], gap1)
    add_gap("Пробел 2. Ставка в schedule и процент в Main не совпадают", ["ISRC", "Псевдоним", "Запись", "Договор", "Ставка в договоре, %", "Процент в Main, %"], gap2)
    add_gap("Пробел 3. Участник договора не найден в Main", ["Договор", "Кто", "Запись", "Почему"], gap3)
    add_gap("Пробел 4. Лицензионный интерес без срока или территории", ["ISRC", "Псевдоним", "Запись", "Категория", "Срок", "Территория"], gap4)
    add_gap("Пробел 5. Подписан одной стороной или не подписан", ["Идентификатор", "Тип", "Стороны", "Статус", "Дата документа", "Псевдоним", "Файл"], gap5)
    add_gap("Пробел 6. UPC без полного списка ISRC", ["Пояснение"], [["В 0to8 Main.xlsx нет UPC и каталога ISRC, проверить раскрытие нечем."]])
    add_gap("Пробел 7. Нет даты первого релиза", ["Пояснение"], [["Даты релиза нет ни в Main, ни в извлечённом тексте schedule."]])
    add_gap("Пробел 8. Сумма долей больше 100%", ["Пояснение"], [["Реестр Main хранит один процент артиста, сумма долей по ISRC там не ведётся."]])
    add_gap("Пробел 9. В периметре и в Echo8", ["Псевдоним"], [[index[key]] for key in sorted(echo_nicks & own_nicks)])
    add_gap("Пробел 10. Не выбрана действующая редакция", ["Псевдоним", "Документы-кандидаты"], gap10)
    summary.column_dimensions["A"].width = 92
    summary.column_dimensions["B"].width = 36
    summary.freeze_panes = "A3"
    summary.row_dimensions[1].height = 48

    if failures:
        log_path.write_text("СБОРКА ОТКЛОНЕНА\n" + "\n".join(failures) + "\n", encoding="utf-8")
        print("\n".join(failures), flush=True)
        raise SystemExit(1)

    tmp = out_path.with_suffix(".building.xlsx")
    workbook.save(tmp)
    normalize_xlsx(tmp, out_path)
    tmp.unlink(missing_ok=True)
    lines = [
        f"файл {out_path}",
        f"записей {len(recording_rows)}",
        f"договоров {len(contract_rows)}",
        f"роялти {len(royalty_rows)}",
        f"без договора при начислениях {len(gap1)}",
        f"расхождение ставок {len(gap2)}",
        f"не найдены в Main {len(gap3)}",
        f"без срока или территории {len(gap4)}",
        f"неполное подписание {len(gap5)}",
        f"несколько редакций {len(gap10)}",
        f"начисления 0to8 {q2(raw_income)}",
        f"выплаты 0to8 {q2(raw_expense)}",
        "источник денег: 0to8 Main.xlsx; erp.db не использовался",
    ]
    log_path.write_text("\n".join(lines) + "\n", encoding="utf-8")
    print("\n".join(lines), flush=True)


def pack_isrcs(isrcs: list[str]) -> str:
    chunks: list[str] = []
    current: list[str] = []
    size = 0
    for isrc in isrcs:
        if size + len(isrc) + 2 > 30000 and current:
            chunks.append("; ".join(current))
            current = [isrc]
            size = len(isrc)
        else:
            current.append(isrc)
            size += len(isrc) + 2
    if current:
        chunks.append("; ".join(current))
    return chunks[0] if len(chunks) == 1 else chunks[0]


def normalize_xlsx(source: Path, target: Path) -> None:
    stamp = (2026, 10, 26, 0, 0, 0)
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
            replacement = zipfile.ZipInfo(filename=info.filename, date_time=stamp)
            replacement.compress_type = zipfile.ZIP_DEFLATED
            replacement.external_attr = 0o600 << 16
            out.writestr(replacement, data, compresslevel=6)


if __name__ == "__main__":
    build()
