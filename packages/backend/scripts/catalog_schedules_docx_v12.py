"""Schedules 1-6 and the Appendix of the Transaction Agreement, filled from the register (ТЗ v11, section 8).

The template is the text of the agreement with every [●] replaced by a named field {{NAME}} and every table body by
a marker row [[TABLE NAME]]. This module puts the values of one build into it: it never changes the text of the
agreement, removes the red highlighting of the fields and checks that no field or marker is left. Values come from
the build (the English rows of the register sent out), never from parsing cells of a finished workbook.
"""

from __future__ import annotations

import copy
import re
from datetime import date

FIELD = re.compile(r"\{\{([A-Z0-9_]+)\}\}")
MARKER = re.compile(r"\[\[TABLE ([A-Z0-9_]+)\]\]")
W = "{http://schemas.openxmlformats.org/wordprocessingml/2006/main}"
RED = {"FF0000", "C00000", "EE0000", "FF0000FF"}
BULLET = "[●]"
# fields the owner or Believe completes: a [●] is allowed only there (ТЗ v11, 8.4)
OWNER_FIELDS = {"RECEIVABLES_STATEMENT", "CLOSING_ADMIN_FILE", "ASSIGNMENT_DATE", "AGREEMENT_DATE",
                "SELLER_SIGNATORY_NAME", "SELLER_SIGNATORY_CAPACITY", "BANK_HOLDER", "BANK_NAME", "BANK_ADDRESS",
                "BANK_ACCOUNT", "BANK_IBAN", "BANK_SWIFT", "BANK_INTERMEDIARY"}


def words_date(iso: str) -> str:
    day = date.fromisoformat(iso)
    return f"{day.day} {day.strftime('%B')} {day.year}"


def month_words(month: str) -> str:
    return date.fromisoformat(month + "-01").strftime("%B %Y")


def thousands(value) -> str:
    return f"{value:,}"


def amount(value) -> str:
    return f"{value:,.2f}"


def paragraph_text(element) -> str:
    return "".join(node.text or "" for node in element.iter(W + "t"))


def unred(element) -> None:
    """Drop the red colour and the highlight the template uses to mark its fields."""
    for props in element.iter(W + "rPr"):
        for child in list(props):
            if child.tag == W + "color" and (child.get(W + "val") or "").upper() in RED:
                props.remove(child)
            elif child.tag in (W + "highlight", W + "shd") and child.tag == W + "highlight":
                props.remove(child)


def fill_runs(paragraph, values: dict[str, str]) -> list[str]:
    """Replace the fields of one paragraph run by run (the template keeps each field inside one run)."""
    used = []
    for node in paragraph.iter(W + "t"):
        text = node.text or ""
        if "{{" not in text:
            continue

        def put(match):
            used.append(match.group(1))
            return values[match.group(1)]

        node.text = FIELD.sub(put, text)
        node.set("{http://www.w3.org/XML/1998/namespace}space", "preserve")
    return used


def set_cell_text(cell_element, text: str) -> None:
    """Put the text into the first run of the cell's first paragraph, drop the rest of the cell's text."""
    paragraphs = cell_element.findall(W + "p")
    first = paragraphs[0]
    for extra in paragraphs[1:]:
        cell_element.remove(extra)
    runs = first.findall(W + "r")
    if not runs:
        run = first.makeelement(W + "r", {})
        first.append(run)
        runs = [run]
    for extra in runs[1:]:
        first.remove(extra)
    run = runs[0]
    for child in list(run):
        if child.tag in (W + "t", W + "br", W + "tab"):
            run.remove(child)
    node = run.makeelement(W + "t", {})
    node.text = text
    node.set("{http://www.w3.org/XML/1998/namespace}space", "preserve")
    run.append(node)


def merge_row(row_element) -> None:
    """One cell across the row: a table filled by reference."""
    cells = row_element.findall(W + "tc")
    if len(cells) < 2:
        return
    props = cells[0].find(W + "tcPr")
    if props is None:
        props = cells[0].makeelement(W + "tcPr", {})
        cells[0].insert(0, props)
    for old in props.findall(W + "gridSpan"):
        props.remove(old)
    span = props.makeelement(W + "gridSpan", {W + "val": str(len(cells))})
    props.insert(0, span)
    for width in props.findall(W + "tcW"):
        props.remove(width)
    for extra in cells[1:]:
        row_element.remove(extra)


def fill_table(table_element, rows: list[list[str]], merged: bool) -> None:
    marker_row = next(r for r in table_element.findall(W + "tr") if MARKER.search(paragraph_text(r)))
    position = list(table_element).index(marker_row)
    for offset, values in enumerate(rows):
        row = copy.deepcopy(marker_row)
        cells = row.findall(W + "tc")
        for cell, text in zip(cells, values + [""] * (len(cells) - len(values))):
            set_cell_text(cell, text)
        if merged:
            merge_row(row)
        table_element.insert(position + offset, row)
    table_element.remove(marker_row)


def build(template, out_path, values: dict[str, str], tables: dict[str, tuple[list[list[str]], bool]],
          first_line: str) -> dict:
    """Fill the template; return what the checks of 8.4 need."""
    import docx

    document = docx.Document(str(template))
    body = document.element.body
    template_paragraphs = [paragraph_text(p) for p in body.iter(W + "p")]
    used = []
    for paragraph in list(body.iter(W + "p")):
        if "{{" in paragraph_text(paragraph):
            used += fill_runs(paragraph, values)
    for table in list(body.iter(W + "tbl")):
        found = MARKER.search(paragraph_text(table))
        if found:
            rows, merged = tables[found.group(1)]
            fill_table(table, rows, merged)
    # the template's own note gives way to the line the brief asks for (8.1, item 5)
    note = next(p for p in body.iter(W + "p") if paragraph_text(p).startswith("TEMPLATE"))
    for node in list(note.iter(W + "t"))[1:]:
        node.text = ""
    node = next(note.iter(W + "t"))
    node.text = first_line
    body.remove(note)
    body.insert(0, note)
    unred(body)
    document.core_properties.author = "build-catalog-registries"
    document.core_properties.last_modified_by = "build-catalog-registries"
    document.core_properties.revision = 1
    document.save(str(out_path))
    filled = [paragraph_text(p) for p in body.iter(W + "p")]
    return {"template": template_paragraphs, "filled": filled, "used": used}


def contract_text_kept(template_paragraphs, filled_paragraphs, values) -> list[str]:
    """Every paragraph of the template outside the tables appears in the result with only its fields filled."""
    missing = []
    filled = set(filled_paragraphs)
    for text in template_paragraphs:
        if not text.strip() or MARKER.search(text) or text.startswith("TEMPLATE"):
            continue
        expected = FIELD.sub(lambda m: values[m.group(1)], text)
        if expected not in filled:
            missing.append(text[:120])
    return missing


def original_matches(original, filled_paragraphs, values) -> list[str]:
    """The original Schedules (changes accepted), [●] standing for any value: each of its paragraphs is found in
    the result, so not one phrase of the agreement was lost or changed."""
    import docx

    document = docx.Document(str(original))
    # compared without whitespace: the original breaks the signature lines with <w:br>, the template with paragraphs
    flat = re.sub(r"\s+", "", "".join(filled_paragraphs))
    lost = []
    for paragraph in document.element.body.iter(W + "p"):
        text = paragraph_text(paragraph).strip()
        if not text:
            continue
        # every bracketed placeholder of the original ([●], [file name], [●; otherwise none]...) stands for any value
        parts = [re.escape(re.sub(r"\s+", "", part)) for part in re.split(r"\[[^\]]{0,120}\]", text)]
        pattern = r".{0,600}?".join(part for part in parts if part)
        if pattern and not re.search(pattern, flat):
            lost.append(text[:120])
    return lost
