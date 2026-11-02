#!/usr/bin/env python3 -I
"""Stage 4.2: Annex "Splits by ISRC" vs the ERP splits in force (read-only dumps)."""
import json, re, sys, collections
sys.path.insert(0, '/Users/nearlydeadhipo/Desktop/0to8/ERP/packages/backend/scripts/mvp')
from common import *

TOL = 0.0005
annex = [r for r in jl('Splits_by_ISRC.json')[2:] if r[0] and len(str(r[0])) == 12]
cov = {r[0]: r for r in jl('Coverage_by_recording.json')[2:] if r[0] and len(str(r[0])) == 12}
perim = set(cov)
buy = [r for r in jl('Sch3C_(ii)_Buy-outs.json')[2:] if r[0] and len(str(r[0])) == 12]
sch1b = {r[0]: r for r in jl('Sch1B_Excluded_register.json')[2:] if r[0] and len(str(r[0])) == 12}

# ERP
art = {}
for a in tsv('artists.tsv'):
    art[a[0]] = {'id': a[0], 'pseudonym': a[1], 'norm': a[2], 'owner': a[3], 'merged': a[4]}
def root(i):
    seen = 0
    while art[i]['merged'] and seen < 20:
        i = art[i]['merged']; seen += 1
    return i
by_norm = collections.defaultdict(list)
for a in art.values():
    by_norm[nn(a['pseudonym'])].append(a['id'])
def resolve(name):
    cand = by_norm.get(nn(name), [])
    exact = [i for i in cand if art[i]['pseudonym'] == name.strip()]
    if len(set(root(i) for i in cand)) > 1 and len(set(root(i) for i in exact)) == 1: cand = exact
    return sorted(set(root(i) for i in cand))

shares = collections.defaultdict(list)
for s in tsv('shares.tsv'):
    shares[s[0]].append((root(s[1]), float(s[2]), s[3] if s[3] != '\\N' else ''))
spl = collections.defaultdict(list)
mid = []
for s in tsv('splits.tsv'):
    sid, isrc, vf, vt, doc, origin, note = (s + [''] * 7)[:7]
    rows = {}
    for aid, p, d in shares.get(sid, []):
        if p > 0: rows[aid] = rows.get(aid, 0) + p
    spl[isrc].append({'id': sid, 'isrc': isrc, 'validFrom': vf, 'validTo': vt or None, 'documentId': doc or None, 'origin': origin, 'note': note, 'rows': rows})
    if not vf.endswith('-01') or (vt and not vt.endswith('-01')):
        mid.append({'splitId': sid, 'isrc': isrc, 'validFrom': vf, 'flooredValidFrom': month_of(vf),
                    'validTo': vt or None, 'flooredValidTo': month_of(vt) if vt else None, 'origin': origin, 'note': note})
for v in spl.values(): v.sort(key=lambda x: x['validFrom'])
tracks = {t[1] for t in tsv('tracks.tsv')}
tr_title = {}
for t in tsv('tracks.tsv'): tr_title.setdefault(t[1], t[3])

def inforce(isrc, m):
    best = None
    for s in spl.get(isrc, []):
        if s['validFrom'] <= m and (s['validTo'] is None or m < s['validTo']):
            if best is None or s['validFrom'] >= best['validFrom']: best = s
    return best

# buy-outs
INTEREST = re.compile(r'([\d.]+) percentage points')
bo = collections.defaultdict(list)
for r in buy:
    iso, note = parse_date(r[6])
    it = str(r[5]); kind = None; pp = None
    if 'whole interest' in it: kind = 'whole'
    elif 'see the instrument' in it: kind = 'see_instrument'
    elif 'transfer between' in it: kind = 'transfer_own_entities'
    else:
        m = INTEREST.search(it)
        if m: kind = 'pp'; pp = float(m.group(1))
    bo[r[0]].append({'basis': r[2], 'seller': seller_name(r[3], r[4]), 'instrument': r[4], 'interest': it, 'interestKind': kind, 'pp': pp,
                     'effectiveDate': iso, 'effectiveMonth': month_of(iso) if iso else None, 'dateNote': note,
                     'vestedInFz': vested(r[7]), 'recording': r[1]})

# documents.json lookup for per-row seller percent (CAPA family)
docs = json.load(open(ROOT + '/context_data/contract_index/documents.json'))
def doc_percent(instr, title):
    toks = [t for t in re.findall(r'[A-Za-z0-9]{5,}', instr) if t.lower() not in ('capa', 'instrument')]
    res = []
    for d in docs:
        if d['kind'] not in ('asset_purchase', 'caa'): continue
        nm = ' '.join(f['name'] for f in d['files']) + ' ' + str(d['meta'].get('number'))
        if not any(t.lower() in nm.lower() for t in toks): continue
        for t in d['tracks']:
            if nn(t.get('title', '')) == nn(title):
                res.append({'document': d['files'][0]['name'], 'title': t['title'], 'masterOwnershipPercent': t.get('master_ownership_percent'), 'royaltyDigitalPercent': t.get('royalty_digital_percent')})
    return res

def parse_rows(txt):
    txt = str(txt or '')
    note = None
    if txt in ('', 'None', 'no split line on this code'): return [], note
    m = re.match(r'^(.*?)\s*\((.*)\)\s*$', txt)
    if m and ';' not in m.group(2): txt, note = m.group(1), m.group(2)
    rows = []
    for part in txt.split('; '):
        m = re.fullmatch(r'(.+?) ([\d.]+)%', part.strip())
        if m: rows.append((m.group(1).strip(), float(m.group(2))))
        else: rows.append((part.strip(), None))
    return rows, note

BUY_RE = re.compile(r'выкуп: (.+)$')
def parse_buyout_src(src):
    m = BUY_RE.search(str(src))
    if not m: return []
    out = []
    for part in m.group(1).split(', '):
        mm = re.fullmatch(r'(.+?) ([\d.]+)%', part.strip())
        if mm: out.append((mm.group(1), float(mm.group(2))))
    return out
APP_RE = re.compile(r'applied from (\d{4}-\d\d)')
TAKES_RE = re.compile(r'takes effect from (\d{4}-\d\d)')

def key_of(name):
    ids = resolve(name)
    return ids[0] if len(ids) == 1 else ('amb:' if len(ids) > 1 else 'name:') + nn(name)

def apply_buyout(rows, sellers):
    out = []; notes = []
    sel = {nn(n): p for n, p in sellers}
    used = set()
    for n, p in rows:
        k = nn(n)
        if k in sel and p is not None:
            used.add(k); left = round(p - sel[k], 6)
            if left > 1e-6: out.append((n, left))
        else: out.append((n, p))
    for k in sel:
        if k not in used: notes.append('seller not among rows: ' + k)
    return out, notes

unresolved = collections.Counter(); ambiguous = collections.Counter()
records = []
for r in annex:
    isrc = r[0]; title = r[1]
    rows, rnote = parse_rows(r[5])
    src = str(r[9] or ''); label = r[7] if isinstance(r[7], float) else None
    settled = r[6]
    alloc = 0.0
    if settled:
        m = re.search(r'([\d.]+)%', str(settled)); alloc = float(m.group(1)) if m else 0.0
    sellers = parse_buyout_src(src)
    variants = {'as_printed': rows}
    notes = []
    if sellers:
        v2, n2 = apply_buyout(rows, sellers); variants['after_buyout'] = v2; notes += n2
    def derived(rs): return 1 - sum(p or 0 for _, p in rs) / 100 - alloc / 100
    chosen = 'as_printed'
    if label is not None:
        if 'after_buyout' in variants:
            d1 = abs(derived(variants['as_printed']) - label); d2 = abs(derived(variants['after_buyout']) - label)
            chosen = 'after_buyout' if d2 <= d1 + 1e-9 else 'as_printed'
    elif 'after_buyout' in variants: chosen = 'after_buyout'
    exp_rows = variants[chosen]
    lcheck = None if label is None else (abs(derived(exp_rows) - label) < 0.0015)
    af, at, pk = parse_period(r[8])
    mm_from = APP_RE.search(src) or TAKES_RE.search(src)
    instr_month = mm_from.group(1) + '-01' if mm_from else None
    # evaluation months
    if pk == 'first_release': months = ['2026-10-01']
    elif pk == 'ok':
        end = at or af
        months = []
        y, m = int(af[:4]), int(af[5:7])
        while True:
            cur = '%04d-%02d-01' % (y, m)
            if cur > end: break
            if cur >= '2024-01-01': months.append(cur)
            m += 1
            if m == 13: y += 1; m = 1
        if not months: months = [af]
    else: months = []
    aexp = {}
    ann_rows = []
    for n, p in exp_rows:
        ids = resolve(n)
        if not ids and p: unresolved[nn(n)] += 1
        if len(ids) > 1: ambiguous[nn(n)] += 1
        k = key_of(n)
        aexp[k] = aexp.get(k, 0) + (p or 0)
        ann_rows.append({'name': n, 'percent': p, 'artistId': ids[0] if len(ids) == 1 else None, 'candidates': ids if len(ids) > 1 else None})
    printed_rows = [{'name': n, 'percent': p} for n, p in rows]
    def matches(erows, ex):
        erows = erows or {}
        if ex:
            return set(erows) == set(ex) and all(abs(erows[k] - ex[k]) <= TOL for k in ex)
        if label is None: return True
        d0 = 1 - sum(erows.values()) / 100
        return abs(d0 - label) < 0.0015 or abs(d0 - alloc / 100 - label) < 0.0015
    # ambiguous names: accept the ERP candidate present in the rows being compared
    amb_keys = [x['candidates'] for x in ann_rows if x['candidates']]
    def ctx_fix(erows):
        if not amb_keys: return aexp
        fixed = dict(aexp)
        for x in ann_rows:
            if x['candidates']:
                k = 'amb:' + nn(x['name'])
                hit = [c for c in x['candidates'] if c in (erows or {})]
                if k in fixed and len(hit) == 1:
                    fixed[hit[0]] = fixed.pop(k)
        return fixed
    eq = ne = nosp = 0; first_bad = None; erp_used = {}
    def matches2(erows):
        return matches(erows, ctx_fix(erows) if amb_keys else aexp)
    for m_ in months:
        s = inforce(isrc, m_)
        erows = s['rows'] if s else None
        if s: erp_used[s['id']] = s
        if matches2(erows): eq += 1
        else:
            ne += 1; first_bad = first_bad or m_
            if s is None: nosp += 1
    erp_any = [s for s in spl.get(isrc, [])]
    erp_nonempty = [s for s in erp_any if s['rows']]
    subtype = None; detail = {}
    if not months:
        cls = 'unclassified'; subtype = 'period_unparsed'
    elif ne == 0:
        cls = 'same'
        subtype = 'rows' if aexp else ('label_share_only' if label is not None else 'annex_share_not_established')
    elif not erp_nonempty:
        cls = 'missing_in_erp'; subtype = 'no_split_for_isrc' if not erp_any else 'only_all_zero_splits'
    else:
        target = [s for s in erp_nonempty + [x for x in erp_any if not x['rows']] if matches2(s['rows'])]
        if target:
            cls = 'different_period'
            t = target[0]
            detail['erpTargetSplit'] = {'id': t['id'], 'validFrom': t['validFrom'], 'validTo': t['validTo']}
            subtype = 'erp_starts_later' if t['validFrom'] > months[0] else 'erp_boundary_differs'
            if not t['validFrom'].endswith('-01'): subtype = 'mid_month_' + subtype
        elif not aexp:
            cls = 'erp_only'; subtype = 'erp_rows_annex_prints_none_and_label_share_differs'
            detail['erpDerivedLabelShare'] = round(1 - sum(erp_nonempty[-1]['rows'].values()) / 100, 6)
        else:
            cls = 'different_rows'
            best = erp_nonempty[-1]
            for s_ in erp_nonempty:
                if s_['id'] in erp_used: best = s_
            fx = ctx_fix(best['rows'])
            ks = set(best['rows']) ^ set(fx)
            subtype = 'participants' if ks else 'percent_only'
            detail['onlyAnnex'] = sorted(k for k in fx if k not in best['rows'])
            detail['onlyErp'] = sorted(k for k in best['rows'] if k not in fx)
            detail['percentDiffs'] = {k: [fx[k], best['rows'][k]] for k in fx if k in best['rows'] and abs(fx[k] - best['rows'][k]) > TOL}
    def serial(s):
        return {'id': s['id'], 'validFrom': s['validFrom'], 'validTo': s['validTo'], 'origin': s['origin'], 'note': s['note'] or None,
                'documentId': s['documentId'],
                'rows': [{'artistId': k, 'pseudonym': art[k]['pseudonym'], 'percent': p} for k, p in sorted(s['rows'].items(), key=lambda x: -x[1])]}
    shown = list(erp_used.values()) if erp_used else erp_any[-3:]
    rec = {'isrc': isrc, 'title': title, 'product': r[3], 'upc': r[4],
           'annex': {'period': {'raw': r[8], 'from': af, 'to': at, 'kind': pk}, 'rowsPrinted': printed_rows, 'rowsExpected': ann_rows,
                     'rowsBasis': chosen, 'labelShare': label, 'labelShareConsistent': lcheck, 'settledOutside': settled, 'source': src,
                     'instrumentMonth': instr_month, 'notes': ([rnote] if rnote else []) + notes},
           'classification': cls, 'subtype': subtype, 'monthsChecked': len(months), 'monthsEqual': eq, 'monthsDifferent': ne,
           'firstDifferentMonth': first_bad, 'erp': [serial(s) for s in shown], 'erpTrack': isrc in tracks,
           'receipts': cov[isrc][13] if isrc in cov else None}
    rec.update(detail)
    if isrc in bo: rec['buyouts'] = bo[isrc]
    records.append(rec)

# buy-out section (one entry per Sch3C(ii) row)
by_isrc = collections.defaultdict(list)
for x in records: by_isrc[x['isrc']].append(x)
buyouts = []
see = []
for r in buy:
    isrc = r[0]; b = [x for x in bo[isrc] if x['recording'] == r[1] and x['instrument'] == r[4]][0]
    e = dict(b); e['isrc'] = isrc
    recs = by_isrc.get(isrc, [])
    e['annexClassifications'] = sorted({x['classification'] for x in recs})
    after = [x for x in recs if e['effectiveMonth'] and x['annex']['period']['from'] and x['annex']['period']['from'] >= e['effectiveMonth']]
    e['annexLabelShareFromEffective'] = after[0]['annex']['labelShare'] if after else None
    e['annexRowsFromEffective'] = [[x['name'], x['percent']] for x in after[0]['annex']['rowsExpected']] if after else None
    e['erpSplitsStartingInEffectiveMonth'] = [{'id': x['id'], 'validFrom': x['validFrom'], 'origin': x['origin']} for x in spl.get(isrc, []) if e['effectiveMonth'] and month_of(x['validFrom']) == e['effectiveMonth']]
    if b['interestKind'] == 'see_instrument':
        found = doc_percent(b['instrument'], r[1])
        e['sellerPercentPerRow'] = found[0]['royaltyDigitalPercent'] if found else None
        e['sellerPercentSource'] = found if found else None
        see.append(e)
    buyouts.append(e)

# ERP-only ISRC (not in the Annex perimeter)
erp_only = []
for isrc, lst in spl.items():
    if isrc in perim: continue
    rows_nonempty = [s for s in lst if s['rows']]
    cat = None
    if isrc in sch1b: cat = sch1b[isrc][4]
    erp_only.append({'isrc': isrc, 'title': tr_title.get(isrc), 'sch1bCategory': cat, 'imprint': sch1b[isrc][3] if isrc in sch1b else None,
                     'splits': len(lst), 'hasNonZeroRows': bool(rows_nonempty),
                     'lastRows': [{'pseudonym': art[k]['pseudonym'], 'percent': p} for k, p in (rows_nonempty[-1]['rows'].items() if rows_nonempty else [])]})
cnt = collections.Counter(x['classification'] for x in records)
sub = collections.Counter((x['classification'], x['subtype']) for x in records)
perim_with_rows = len({x['isrc'] for x in records})
out = {
 'generated': '2026-11-02', 'sources': ['Annex 14_beta (обновлено покрытие).xlsx sheets Splits by ISRC, Coverage by recording, Sch3C (ii) Buy-outs, Sch1B Excluded register',
   'ERP PostgreSQL splits.splits / split_shares / owners.artists / owners.tracks (read-only)', 'contract_index/documents.json'],
 'method': {'percentTolerance': TOL, 'inForce': 'ERP split with valid_from <= first day of the month < valid_to (D-025), checked for every month of the Annex period clipped to 2024-01…2026-08 (open or "from first release" periods: the first month / 2026-10)',
   'expectedRows': 'Annex printed rows; where the Source text names a buy-out ("выкуп: X n%") the seller row is reduced by n pp (whole seller row removed when it is used up) if that makes the derived label share (100 - rows - sublabel allocation) match the Annex "Share of 0to8" better; rowsBasis says which',
   'nameResolution': 'exact normalised pseudonym (NFKC, lower, non-alphanumerics collapsed) against owners.artists following merged_into; unresolved names keep artistId null'},
 'counts': {'annexRows': len(records), 'annexDistinctIsrc': perim_with_rows, 'perimeterIsrc': len(perim), 'byClassification': dict(cnt),
            'bySubtype': {'%s/%s' % k: v for k, v in sorted(sub.items(), key=lambda kv: -kv[1])},
            'buyoutRows': len(buyouts), 'seeInstrumentRows': len(see), 'seeInstrumentWithPercent': sum(1 for e in see if e['sellerPercentPerRow'] is not None),
            'erpOnlyIsrc': len(erp_only), 'm52MidMonthValidFrom': sum(1 for m in mid if not m['validFrom'].endswith('-01')), 'm52MidMonthValidToOnly': sum(1 for m in mid if m['validFrom'].endswith('-01')), 'unresolvedNames': len(unresolved), 'ambiguousNames': len(ambiguous)},
 'records': records, 'buyouts': buyouts, 'm51SeeInstrument': see, 'erpOnly': erp_only, 'm52Normalisations': mid,
 'unresolvedNames': [{'norm': k, 'rows': v, 'exampleIsrc': next(x['isrc'] for x in records for y in x['annex']['rowsExpected'] if nn(y['name']) == k)} for k, v in unresolved.most_common()],
 'ambiguousNames': [{'norm': k, 'rows': v} for k, v in ambiguous.most_common()],
}
json.dump(out, open(OUT + '/splits_diff.json', 'w'), ensure_ascii=False)
print(json.dumps(out['counts'], indent=1, ensure_ascii=False))
