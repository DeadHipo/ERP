#!/usr/bin/env python3 -I
"""Stage 4.4: Echo8 reference data (tracks, splits, coverage). Read-only on every source.
Inputs are dumps in the session scratchpad (loaded-file list, ClickHouse pair/month nets, owners/splits tables of the ERP PostgreSQL),
the Echo8 Backstage export, splits.db and erp.db (read-only). Output: data/mvp-load/echo8/{tracks,splits}.json, coverage.md."""
import csv, json, sys, collections, sqlite3, os
from decimal import Decimal
sys.path.insert(0, '/Users/nearlydeadhipo/Desktop/0to8/ERP/packages/backend/scripts/mvp')
from common import nn
SP = '/private/tmp/claude-501/-Users-nearlydeadhipo-Desktop-0to8-ERP/441975a6-0f8b-4dbd-b984-d2856fc5b0b0/scratchpad/e8'
ROOT = '/Users/nearlydeadhipo/Desktop/0to8/ERP'
OUT = ROOT + '/data/mvp-load/echo8'
CD = ROOT + '/context_data'
D = Decimal
def tsv(n): return [l.rstrip('\n').split('\t') for l in open(SP + '/' + n)]
def money(x): return str(D(x).quantize(D('0.01')))

# ---- Believe family lines
ch = json.load(open(SP + '/ch.json'))
W0, W1 = '2024-01-01', '2026-08-01'
pairs = {}      # (isrc, upc) -> info
noisrc = D(0); noisrc_win = D(0)
for x in ch:
    n = D(x['n']); inwin = W0 <= x['rm'] <= W1
    if not x['isrc']:
        noisrc += n; noisrc_win += n if inwin else 0; continue
    p = pairs.setdefault((x['isrc'], x['upc']), {'net': D(0), 'win': D(0), 'titles': collections.Counter(), 'artists': collections.Counter(),
                                                   'labels': collections.Counter(), 'acc': collections.Counter(), 'months': set()})
    p['net'] += n
    if inwin: p['win'] += n
    p['titles'][x['track_title']] += n; p['artists'][x['artist_name']] += n; p['labels'][x['label_name']] += n
    p['acc'][x['account']] += n; p['months'].add(x['rm'][:7])

# ---- ERP state
erp_pairs = {(t[1], t[2]) for t in tsv('tracks.tsv')}
erp_isrc = {t[1] for t in tsv('tracks.tsv')}
arts = tsv('artists.tsv')
by_id = {a[0]: a for a in arts}
def resolve(aid):
    seen = set()
    while by_id[aid][4] and by_id[aid][4] in by_id and aid not in seen:
        seen.add(aid); aid = by_id[aid][4]
    return aid
art_by_norm = collections.defaultdict(set)
for a in arts: art_by_norm[nn(a[1])].add(resolve(a[0]))
erp_split_isrc = {s[1] for s in tsv('splits.tsv')}

# ---- tracks.json
tr = []
for (i, u), p in sorted(pairs.items(), key=lambda kv: -kv[1]['net']):
    if (i, u) in erp_pairs: continue
    tr.append({'isrc': i, 'upc': u, 'title': p['titles'].most_common(1)[0][0], 'artistName': p['artists'].most_common(1)[0][0],
               'labelStrings': [{'label': k, 'net': money(v)} for k, v in p['labels'].most_common()],
               'accounts': sorted(p['acc']), 'net': money(p['net']), 'netWindow': money(p['win']),
               'firstMonth': min(p['months']), 'lastMonth': max(p['months']), 'isrcKnownWithOtherUpc': i in erp_isrc})
tr_net = sum(D(t['net']) for t in tr)
json.dump({'generated': '2026-11-03', 'window': [W0[:7], W1[:7]], 'count': len(tr), 'netTotal': money(tr_net),
           'netWindowTotal': money(sum(D(t['netWindow']) for t in tr)),
           'isrcCount': len({t['isrc'] for t in tr}), 'tracks': tr}, open(OUT + '/tracks.json', 'w'), ensure_ascii=False, indent=1)

# ---- split sources
# 1. Backstage export
EXP = CD + '/ERP_data/believe_echo8/believebackstage-2026-08-05 (1).csv'
exp = collections.defaultdict(list)
for r in list(csv.reader(open(EXP, encoding='utf-8-sig')))[1:]:
    isrc = r[1].replace('-', '')
    names = r[4].split(' / '); rates = [D(x.strip().rstrip('%')) for x in r[5].split(' / ')]
    m, d, y = r[7].split('/')
    exp[isrc].append({'upc': r[3], 'title': r[0], 'rows': list(zip(names, rates[:-1])), 'labelRate': rates[-1], 'rowDate': '%s-%s-%s' % (y, m, d)})
# 2. splits.db (0to8 cabinet, xlsx of 2026-08-14)
db = sqlite3.connect('file:%s/ERP_data/splits/splits.db?mode=ro' % CD, uri=True)
sdb = {}
for isrc, own, upc, mod in db.execute('select isrc, own_rate, upc, modified from split'):
    sdb[isrc] = {'upc': upc, 'own': D(str(own)), 'modified': mod, 'rows': []}
for isrc, name, rate in db.execute('select isrc, name, rate from collab'):
    if isrc in sdb: sdb[isrc]['rows'].append((name, D(str(rate))))
# 3. erp.db deal parties of Echo8 deals (release average share per party, by UPC)
e = sqlite3.connect('file:%s/data/erp/data/erp.db?mode=ro' % CD, uri=True)
deal = collections.defaultdict(list)
for upc, name, share in e.execute("select d.upc, p.name, dp.share from deal d join deal_party dp on dp.deal_id=d.id join party p on p.id=dp.party_id "
                                  "where d.label='Echo8' and dp.src='backstage' and p.kind='artist' and d.upc is not null"):
    deal[upc].append((name, D(str(share))))

LABEL_NORMS = {'echo8', '0to8', 'catcore', 'fate', 'fate music', 'qaraqshy records', 'sf records', 'sf', 'pcr', 'lost', 'odds', 'zero to infinity',
               'enarma records', 'noghost records', '77 records', 'r2r production', 'ahh music', 'vbr', 'bear catalogues'}
RSA = {'dj ksrvx': 'EXCLUSIVE_Echo8_RECORDING SERVICES AGREEMENT_190025DJ KSRVX.pdf',
       'dj veta3': 'Echo8_ RECORDING SERVICES AGREEMENT_#310725DJ VETA3_RU_ENG.pdf',
       'sxllx': 'Echo8_RECORDING SERVICES AGREEMENT_#100325SXLLX.pdf',
       'askl': 'Echo8_RECORDING SERVICES AGREEMENT_070825ASKL hon.pdf'}
RSA_DIR = 'context_data/PandaDoc_documents_0 (2)/Root/'

def mkrows(rows):
    out = []
    for name, pct in rows:
        k = nn(name); lab = k in LABEL_NORMS
        r = {'pseudonym': name, 'percent': float(pct), 'labelRow': lab}
        if lab: r['artistId'] = None; r['newArtist'] = False
        else:
            ids = art_by_norm.get(k, set())
            if len(ids) == 1: r['artistId'] = next(iter(ids)); r['newArtist'] = False
            elif len(ids) > 1: r['artistId'] = None; r['newArtist'] = False; r['ambiguousArtistIds'] = sorted(ids)
            else: r['artistId'] = None; r['newArtist'] = True
        out.append(r)
    return out

fam_isrc = collections.defaultdict(lambda: {'net': D(0), 'win': D(0), 'upcs': set(), 'titles': collections.Counter(), 'artists': collections.Counter()})
for (i, u), p in pairs.items():
    f = fam_isrc[i]; f['net'] += p['net']; f['win'] += p['win']; f['upcs'].add(u)
    f['titles'].update(p['titles']); f['artists'].update(p['artists'])

splits = []; bucket = {}   # isrc -> bucket
src_count = collections.Counter(); skipped_erp = 0
for i, f in sorted(fam_isrc.items(), key=lambda kv: -kv[1]['net']):
    if f['net'] <= 0: bucket[i] = 'nonpositive'; continue
    if i in erp_split_isrc: bucket[i] = 'erp_split'; skipped_erp += 1; continue
    found = None; notes = []
    cands = exp.get(i, [])
    if cands:
        match = [c for c in cands if c['upc'] in f['upcs']] or cands
        if len(match) > 1 and len({tuple(c['rows']) for c in match}) > 1: notes.append('export has %d rows for the ISRC with different splits: latest row date taken' % len(match))
        c = sorted(match, key=lambda c: c['rowDate'])[-1]
        if c['upc'] not in f['upcs']: notes.append('export UPC differs from the Believe UPC')
        found = ('backstage-export', '2026-08-05', c['rowDate'], c['rows'], c['labelRate'], c['upc'], notes)
    elif i in sdb and sdb[i]['rows'] and sum(r for _, r in sdb[i]['rows']) + sdb[i]['own'] == 100:
        s = sdb[i]
        found = ('splits.db', '2026-08-14', s['modified'], s['rows'], s['own'], s['upc'], notes)
    else:
        for u in sorted(f['upcs']):
            if u in deal and sum(s for _, s in deal[u]) <= 100:
                notes.append('release average per party over the tracks of the UPC, not a per-ISRC split')
                found = ('erp.db-deal', None, None, deal[u], 100 - sum(s for _, s in deal[u]), u, notes); break
    if not found: bucket[i] = 'nosplit'; continue
    srcname, sdate, rdate, rows, lab, upc, notes = found
    mr = mkrows(rows)
    art_rows = [r for r in mr if not r['labelRow']]
    labshare = 100 - sum(r['percent'] for r in art_rows)
    docs = [RSA_DIR + RSA[nn(r['pseudonym'])] for r in art_rows if nn(r['pseudonym']) in RSA]
    bucket[i] = 'split_' + srcname; src_count[srcname] += 1
    splits.append({'isrc': i, 'upcs': sorted(f['upcs']), 'title': f['titles'].most_common(1)[0][0], 'net': money(f['net']), 'netWindow': money(f['win']),
                   'source': srcname, 'sourceDate': sdate, 'rowDate': rdate, 'sourceUpc': upc, 'rows': mr,
                   'sourceLabelRate': float(lab), 'labelRowsPercent': float(sum(r['percent'] for r in mr if r['labelRow'])),
                   'labelShare': round(labshare, 6), 'document': docs[0] if docs else None, 'notes': notes})
new_names = {}
for s in splits:
    for r in s['rows']:
        if r['newArtist']: new_names.setdefault(nn(r['pseudonym']), r['pseudonym'])
amb = sorted({r['pseudonym'] for s in splits for r in s['rows'] if r.get('ambiguousArtistIds')})
json.dump({'generated': '2026-11-03', 'count': len(splits), 'bySource': dict(src_count), 'newArtists': sorted(new_names.values(), key=str.lower),
           'newArtistCount': len(new_names), 'ambiguousPseudonyms': amb, 'splits': splits}, open(OUT + '/splits.json', 'w'), ensure_ascii=False, indent=1)

# ---- coverage (net in window by ISRC bucket; pair-unknown dominates)
def pair_bucket(i, u):
    if (i, u) not in erp_pairs: return 'pair unknown'
    b = bucket.get(i)
    if b == 'erp_split': return 'ERP split exists'
    if b and b.startswith('split_'): return 'split source: ' + b[6:]
    if b == 'nosplit': return 'no split anywhere'
    return 'nonpositive ISRC net (not counted)'
cov = collections.defaultdict(lambda: [D(0), 0, 0]); isr = collections.defaultdict(set)
for (i, u), p in pairs.items():
    # a pair unknown to the ERP is "pair unknown" even if a split source exists; its split bucket is shown separately
    b = pair_bucket(i, u); cov[b][0] += p['win']; cov[b][1] += 1; isr[b].add(i)
# bucket after this load: tracks are created, so classify by split availability only
after = collections.defaultdict(lambda: [D(0), 0, set()])
for (i, u), p in pairs.items():
    b = bucket.get(i)
    if b == 'erp_split': k = 'ERP split already exists'
    elif b and b.startswith('split_'): k = 'split source found: ' + b[6:]
    elif b == 'nosplit': k = 'no split anywhere'
    else: k = 'ISRC net <= 0'
    after[k][0] += p['win']; after[k][1] += 1; after[k][2].add(i)
tot = sum(p['win'] for p in pairs.values())
unknown_before = sum(p['win'] for k, p in pairs.items() if k not in erp_pairs)
nosplit = sorted(((i, f) for i, f in fam_isrc.items() if bucket[i] == 'nosplit'), key=lambda kv: -kv[1]['win'])
L = ['# Echo8 family coverage', '',
     'Echo8 family = every loaded line of account 1055956 plus lines with `label_name = Echo8` of account 1052428 (`0to8/Echo8` and `0to8, Echo8` are 0to8 by owner answer 1 and are not in the family). '
     'Net window 2024-01..2026-08 (USD). Lines without ISRC: %s (window %s), outside all buckets.' % (money(noisrc), money(noisrc_win)), '',
     'Family net in the window with an ISRC: **%s** over %d (ISRC, UPC) pairs, %d ISRC.' % (money(tot), len(pairs), len(fam_isrc)), '',
     '## After this load (tracks created for every unknown pair, splits as found)', '',
     '| bucket | net | pairs | ISRC | share |', '|---|---:|---:|---:|---:|']
for k in sorted(after, key=lambda k: -after[k][0]):
    v = after[k]; L.append('| %s | %s | %d | %d | %.2f %% |' % (k, money(v[0]), v[1], len(v[2]), 100 * v[0] / tot if tot else 0))
L += ['', '## Today (before this load)', '', '| bucket | net | pairs |', '|---|---:|---:|']
for k in sorted(cov, key=lambda k: -cov[k][0]): L.append('| %s | %s | %d |' % (k, money(cov[k][0]), cov[k][1]))
L += ['', '"pair unknown" = the (ISRC, UPC) pair is not in `owners.tracks`: such net is in C whatever the splits (`unknown_pair`). '
      '"Split source" buckets after the load count the ISRC whose split was found in the named source; `ERP split already exists` = an `splits.splits` row exists for the ISRC (any period).', '',
      '## Top 30 ISRC without any split (by window net)', '', '| ISRC | title | artist (as printed) | net window | net total | UPC count |', '|---|---|---|---:|---:|---:|']
for i, f in nosplit[:30]:
    L.append('| %s | %s | %s | %s | %s | %d |' % (i, f['titles'].most_common(1)[0][0].replace('|', '/'), f['artists'].most_common(1)[0][0].replace('|', '/'), money(f['win']), money(f['net']), len(f['upcs'])))
L += ['', 'ISRC without any split: %d, window net %s, total net %s.' % (len(nosplit), money(sum(f['win'] for _, f in nosplit)), money(sum(f['net'] for _, f in nosplit)))]
open(OUT + '/coverage.md', 'w').write('\n'.join(L) + '\n')
print('pairs', len(pairs), 'isrc', len(fam_isrc), 'tracks.json', len(tr), money(tr_net), 'splits', len(splits), dict(src_count), 'erp split', skipped_erp,
      'nosplit', len(nosplit), 'newArtists', len(new_names), 'amb', len(amb))
for k, v in after.items(): print(k, money(v[0]), v[1], len(v[2]))
print('noisrc', money(noisrc), 'total win', money(tot), 'unknown pair win', money(unknown_before))
