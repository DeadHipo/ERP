"""Dumps the Annex sheets "Monthly NLS by ISRC" and "Monthly receipts by ISRC" to a JSON cache (read-only).

Usage: python3 -I annex_nls.py <workbook.xlsx> <out.json>
Cache: {"months": [...], "nls": {isrc: {month: number | "no share"}}, "receipts": {isrc: {month: number}}}
Header is row 2 (index 1); month columns are 'YYYY-MM'; the 'Total' row is skipped.
"""
import json, os, re, sys
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import xl

def sheet(w, name):
    out, months = {}, []
    for i, r in enumerate(xl.rows(w[name])):
        if i == 1:
            months = [(j, c) for j, c in enumerate(r) if isinstance(c, str) and re.fullmatch(r'\d{4}-\d\d', c)]
            continue
        if i < 2 or not r or not isinstance(r[0], str) or r[0] == 'Total':
            continue
        cells = {}
        for j, m in months:
            v = r[j] if j < len(r) else None
            if v is None or v == '':
                continue
            cells[m] = v if isinstance(v, (int, float)) else str(v)
        out[r[0].strip()] = cells
    return [m for _, m in months], out

src, dst = sys.argv[1], sys.argv[2]
w = xl.load(src)
months, nls = sheet(w, 'Monthly NLS by ISRC')
_, rec = sheet(w, 'Monthly receipts by ISRC')
os.makedirs(os.path.dirname(os.path.abspath(dst)), exist_ok=True)
json.dump({'source': os.path.basename(src), 'months': months, 'nls': nls, 'receipts': rec}, open(dst, 'w'))
print('isrc nls', len(nls), 'receipts', len(rec), 'months', len(months))
