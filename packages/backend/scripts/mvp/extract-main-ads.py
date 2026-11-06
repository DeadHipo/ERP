"""Advertising expenses of 0to8 Main (INCOME/EXPENSE + Echo8 sheets) -> one ad record per Main row, bound to an ISRC.

READ-ONLY on every source:
  - context_data/ERP_data/main_sheet/main.db (SQLite export of the 0to8 Main sheet, opened read-only)
  - ERP PostgreSQL (docker exec $ERP_PG_CONTAINER psql, default royalty-erp-postgres-1, SELECT only): owners.*, splits.*, labels.*, public.source_files
  - ClickHouse <CLICKHOUSE_DATABASE>.rows over HTTP, only files with status `loaded`
  - <MVP_LOAD_DIR>/main/cash_rows.json (the Main loader's rows, optional)
The stores are those of the environment, then of the repo .env (stores.py): DB_DATABASE (default erp), DB_USERNAME,
CLICKHOUSE_DATABASE / _HOST / _HTTP_PORT / _USERNAME / _PASSWORD; MVP_LOAD_DIR (default data/mvp-load).
Writes <MVP_LOAD_DIR>/ads/main_ads_mapping.json (git-ignored). Re-runnable, deterministic.
Run:  python3 -I packages/backend/scripts/mvp/extract-main-ads.py
      DB_DATABASE=erp_x CLICKHOUSE_DATABASE=believe_x MVP_LOAD_DIR=data/test-tmp/x python3 -I packages/backend/scripts/mvp/extract-main-ads.py

Per Main row: gross = `fix_expense_posted_без_флажков` (ads without flags), charged = `expense_posted` (what the
artist was charged), flag = `обнулить_ads_расход` (1 = not charged, i.e. non-recoupable). Month = fix_date_reports
(equals reports_date_for_artists where that is filled; the only month on the separate ad rows).
Spend month = `date` (Main ads per nickname and date month equal PROMO Posted per nickname and month, 1,735 of 1,735
pairs in 2025-10..2026-08); it is usually report month + 2.
ISRC method, in order: a (report-processor track results: not on disk, never fires), b (PROMO per-post track title of
that nickname, title-matched to the artist's ISRCs; only for spend months up to 2025-07, when PROMO still had per-post
titles), c (artist's ISRC with the highest Believe net in the spend month, else the report month), d (highest
all-time net), none. Candidate ISRCs = split rows and participations of the pseudonym valid in the report month
(all of them if none is valid).
"""
import os, sys, re, json, sqlite3, collections, unicodedata
from decimal import Decimal as D, ROUND_HALF_UP

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
from stores import ROOT, psql, mvp_load_dir, ch as ch_raw
MAIN_DB = os.path.join(ROOT, 'context_data', 'ERP_data', 'main_sheet', 'main.db')
OUT = mvp_load_dir('ads')
CENT = D('0.01')
PROMO_TITLE_ERA_END = '2025-07'  # from 2025-08 PROMO rows are per-artist monthly totals (track = nickname)


def q2(x): return x.quantize(CENT, ROUND_HALF_UP)
def spec(s): return re.sub(r'\s+', ' ', str(s or '').strip().lower())
def nn(s):  # = normalizeName of src/shared/identifiers.ts
    s = unicodedata.normalize('NFKC', str(s or '')).lower()
    return re.sub(r'[\W_]+', ' ', s).strip()
def dec(x):
    if x in (None, ''): return D(0)
    try: return q2(D(str(x)))
    except Exception: return D(0)


def ch(sql):
    return ch_raw(sql + ' FORMAT JSONEachRow', timeout=600)


# ---------------------------------------------------------------- ERP reference data
artists = {a[0]: {'id': a[0], 'pseudonym': a[1], 'owner': a[2], 'merged': a[3] or None}
           for a in psql("select id, pseudonym, owner_id, coalesce(merged_into::text,'') from owners.artists")}
def final(aid):
    seen = set()
    while artists.get(aid, {}).get('merged') and aid not in seen:
        seen.add(aid); aid = artists[aid]['merged']
    return aid
by_spec = collections.defaultdict(set)
for a in artists.values(): by_spec[spec(a['pseudonym'])].add(final(a['id']))
art_by_owner = collections.defaultdict(set)
for a in artists.values():
    if not a['merged']: art_by_owner[a['owner']].add(a['id'])
by_alias = collections.defaultdict(set)
for o, al in psql("select owner_id, alias from owners.owner_aliases"): by_alias[spec(al)].add(o)

def resolve(nick):
    s = spec(nick)
    if s in by_spec:
        c = sorted(by_spec[s])
        if len(c) == 1: return 'matched', c[0], 'pseudonym', []
        return 'ambiguous', None, 'pseudonym', c
    if s in by_alias:
        os_ = sorted(by_alias[s])
        if len(os_) == 1 and len(art_by_owner[os_[0]]) == 1:
            return 'matched', next(iter(art_by_owner[os_[0]])), 'owner_alias', []
        return 'ambiguous', None, 'owner_alias', sorted(x for o in os_ for x in art_by_owner[o]) or os_
    return 'unmatched', None, None, []

# artist -> isrc -> list of (valid_from, valid_to) of split rows / participations
cand = collections.defaultdict(lambda: collections.defaultdict(list))
for aid, isrc, vf, vt in psql("select sh.artist_id, s.isrc, coalesce(s.valid_from::text,''), coalesce(s.valid_to::text,'') "
                              "from splits.split_shares sh join splits.splits s on s.id = sh.split_id"):
    cand[final(aid)][isrc].append((vf[:7], vt[:7]))
for aid, isrc, vf, vt in psql("select artist_id, isrc, coalesce(valid_from::text,''), coalesce(valid_to::text,'') from splits.participations"):
    cand[final(aid)][isrc].append((vf[:7], vt[:7]))
titles = collections.defaultdict(set)
for isrc, t in psql("select isrc, coalesce(title,'') from owners.tracks"):
    if t: titles[isrc].add(t)

def valid_in(periods, m):
    return any((not vf or vf <= m) and (not vt or m < vt) for vf, vt in periods)

labels = {l[0]: {'id': l[0], 'name': l[1], 'kind': l[2], 'own': l[3] or None} for l in psql("select id, name, kind, coalesce(own_label_id::text,'') from labels.labels")}
label_by_alias = {a: l for a, l in psql("select alias_norm, label_id from labels.label_aliases")}
def label_norm(s):  # = normalizeLabelString of src/modules/labels/service.ts
    return re.sub(r'\s+', ' ', unicodedata.normalize('NFKC', str(s or '')).lower()).strip()
def label_of(label_string):
    l = labels.get(label_by_alias.get(label_norm(label_string)))
    if not l: return None, None
    if l['kind'] == 'own': return l['name'], None
    return labels[l['own']]['name'] if l['own'] in labels else None, l['name']

# ---------------------------------------------------------------- Believe net (loaded files only)
loaded = [r[0] for r in psql("select id from public.source_files where status = 'loaded'")]
net_m = collections.defaultdict(lambda: collections.defaultdict(D))          # isrc -> month -> net
lab_m = collections.defaultdict(lambda: collections.defaultdict(D))          # (isrc, month) -> label string -> net
lab_all = collections.defaultdict(lambda: collections.defaultdict(D))        # isrc -> label string -> net
net_all = collections.defaultdict(D)
if loaded:
    ids = ','.join("'%s'" % i for i in loaded)
    for r in ch("SELECT isrc AS i, toString(reporting_month) AS m, label_name AS l, toString(sum(net_revenue)) AS n "
                "FROM rows WHERE file_id IN (%s) GROUP BY isrc, reporting_month, label_name" % ids):
        n = D(r['n']); m = r['m'][:7]
        net_m[r['i']][m] += n; lab_m[(r['i'], m)][r['l']] += n; lab_all[r['i']][r['l']] += n; net_all[r['i']] += n
    for r in ch("SELECT isrc AS i, track_title AS t FROM rows WHERE file_id IN (%s) GROUP BY isrc, track_title" % ids):
        if r['t']: titles[r['i']].add(r['t'])

# ---------------------------------------------------------------- Main sheet (read-only)
con = sqlite3.connect('file:%s?mode=ro' % MAIN_DB, uri=True)
con.row_factory = sqlite3.Row
def table(t): return [dict(r) for r in con.execute('select * from "%s" order by _row' % t)]

# PROMO per-post titles: nickname -> title -> [sum price, months]
promo = collections.defaultdict(lambda: collections.defaultdict(lambda: [D(0), set()]))
for r in table('promo'):
    if r['status'] != 'Posted': continue
    nick, tr = spec(r['a_nickname']), (r['a_track'] or '').strip()
    if not nick or not tr or spec(tr) == nick: continue
    e = promo[nick][tr]; e[0] += dec(r['price'])
    m = (r['date_iso'] or r['a_date_iso'] or '')[:7]
    if m: e[1].add(m)

VARIANT = re.compile(r'\b(slowed|sped|speed|up|ultra|super|reverb|nightcore|remix|version|edit|mix|remake|v\d|phonk|funk|feat|ft)\b')
def core(t): return re.sub(r'\s+', ' ', VARIANT.sub(' ', nn(t))).strip()
def title_score(promo_title, isrc):
    p, pc = nn(promo_title), core(promo_title)
    best = 0
    for t in titles.get(isrc, ()):
        x, xc = nn(t), core(t)
        if not x: continue
        if x == p: best = max(best, 3)
        elif xc and xc == pc: best = max(best, 2)
        elif len(pc) >= 4 and len(xc) >= 4 and (pc in xc or xc in pc): best = max(best, 1)
    return best

def bind(aid, nick, m, sm):
    """-> (isrc, method, confidence, note, label string)"""
    isrcs = cand.get(aid, {})
    if not isrcs: return None, 'none', None, 'artist has no split row or participation', None
    valid = [i for i, p in isrcs.items() if valid_in(p, m)]
    pool = valid or list(isrcs)
    # b: PROMO titles
    if sm <= PROMO_TITLE_ERA_END and spec(nick) in promo:
        ranked = sorted(promo[spec(nick)].items(), key=lambda kv: (-(1 if (sm in kv[1][1] or prev(sm) in kv[1][1]) else 0), -kv[1][0], kv[0]))
        for title, (price, months) in ranked:
            hits = sorted(((title_score(title, i), net_all[i], i) for i in pool), reverse=True)
            if hits and hits[0][0] > 0:
                sc, _, i = hits[0]
                dated = sm in months or prev(sm) in months
                conf = 'high' if sc == 3 and dated else ('medium' if sc >= 2 else 'low')
                return i, 'b', conf, 'PROMO title "%s" (%s posted, %s)' % (title, price, 'dated same/previous month' if dated else 'undated'), top_label(i, m)
    # c: highest net in the spend month (agrees better with dated PROMO titles), else in the report month
    for mo, what in ((sm, 'spend month'), (m, 'report month')):
        mm = sorted(((net_m[i].get(mo, D(0)), i) for i in pool), reverse=True)
        if mm and mm[0][0] > 0:
            n, i = mm[0]
            tot = sum(x for x, _ in mm if x > 0)
            share = n / tot if tot else D(0)
            conf = 'high' if share >= D('0.6') or len([1 for x, _ in mm if x > 0]) == 1 else ('medium' if share >= D('0.3') else 'low')
            return i, 'c', conf, 'top net in %s %s: %s of %s (%d ISRCs with net)' % (what, mo, q2(n), q2(tot), len([1 for x, _ in mm if x > 0])), top_label(i, mo)
    # d: highest all-time net
    aa = sorted(((net_all[i], i) for i in pool), reverse=True)
    if aa and aa[0][0] > 0:
        return aa[0][1], 'd', 'low', 'no net in %s or %s; top all-time net %s' % (sm, m, q2(aa[0][0])), top_label(aa[0][1], None)
    return None, 'none', None, '%d candidate ISRC(s), none with Believe net' % len(pool), None

def prev(m):
    y, mo = int(m[:4]), int(m[5:7])
    return '%04d-%02d' % (y - (mo == 1), 12 if mo == 1 else mo - 1)

def top_label(isrc, m):
    src = lab_m.get((isrc, m)) if m else None
    if not src: src = lab_all.get(isrc)
    if not src: return None
    return sorted(src.items(), key=lambda kv: (-kv[1], kv[0]))[0][0]

def month_view(aid, m):
    """(ISRC with the top net in the month or None, share of the artist's month net per label of record)."""
    isrcs = cand.get(aid, {})
    pool = [i for i, p in isrcs.items() if valid_in(p, m)] or list(isrcs)
    mm = sorted(((net_m[i].get(m, D(0)), i) for i in pool), reverse=True)
    top = mm[0][1] if mm and mm[0][0] > 0 else None
    by = collections.defaultdict(D)
    for i in pool:
        for l, n in lab_m.get((i, m), {}).items():
            if n > 0:
                o, sb = label_of(l)
                by[sb or o or 'unmapped'] += n
    tot = sum(by.values())
    return top, ({k: str(q2(v / tot * 100)) for k, v in sorted(by.items())} if tot else None)

# the Main loader's choice: operations carry `mvp:main:<row>`; nickname -> artists it used (resolves ambiguous names)
loader_rows = collections.defaultdict(set)
for cm, aid in psql("select comment, coalesce(artist_id::text,'') from settlements.operations where comment like 'mvp:main:%' and artist_id is not null"):
    mt = re.match(r'mvp:main:(\d+)', cm)
    if mt: loader_rows[int(mt.group(1))].add(final(aid))
loader_by_nick = collections.defaultdict(set)  # row numbers are those of the loader's xlsx (main/cash_rows.json), not of main.db
CASH = mvp_load_dir('main', 'cash_rows.json')
for r in (json.load(open(CASH)) if os.path.exists(CASH) else []):
    for aid in loader_rows.get(r['rowNo'], ()): loader_by_nick[spec(r['nickname'])].add(aid)

# ---------------------------------------------------------------- ad rows
def ad_rows(t, charged_col):
    for r in table(t):
        g, c = dec(r['fix_expense_posted_без_флажков']), dec(r[charged_col])
        if g == 0 and c == 0: continue
        yield r, g, c

records, excluded = [], []
seen = {}
for src, col in (('income_expense', 'expense_posted_x'), ('echo8', 'expense_posted')):
    for r, g, c in ad_rows(src, col):
        nick = (r['nickname'] or '').strip()
        m = (r['fix_date_reports_iso'] or r['reports_date_for_artists_iso'] or r['date_iso'] or '')[:7]
        sm = (r['date_iso'] or m)[:7]  # spend month: Main ads per (nickname, date month) = PROMO Posted per (nickname, month)
        key = (spec(nick), m, g, c)
        if src == 'echo8' and key in seen:
            excluded.append({'source': src, 'row': r['_row'], 'nickname': nick, 'month': m, 'gross': str(g), 'charged': str(c),
                             'reason': 'duplicate of income_expense row %d (same nickname, month and amounts)' % seen[key]})
            continue
        if src == 'income_expense': seen[key] = r['_row']
        flag = (r['обнулить_ads_расход'] or '').strip()
        if flag == '1' and c == 0: rp, rule = 0, 'flag 1, not charged'
        elif flag != '1' and c == g: rp, rule = 100, 'flag %s, charged in full' % (flag or 'empty')
        else:
            rp = float(q2(c / g * 100)) if g else 100
            rule = 'exception: flag %s, charged %s of %s' % (flag or 'empty', c, g)
        st, aid, via, cands = resolve(nick)
        used = sorted(loader_by_nick.get(spec(nick), ()))
        if st == 'ambiguous' and len(used) == 1:
            st, aid, via = 'matched', used[0], 'main_loader'
        loader_note = None if not used or (aid and used == [aid]) else 'Main loader used %s for this nickname' % ','.join(used)
        isrc, method, conf, note, lstr = (None, 'none', None, 'nickname %s' % st, None) if not aid else bind(aid, nick, m, sm)
        lor, sub = label_of(lstr) if lstr else (None, None)
        top, mix = month_view(aid, m) if aid else (None, None)
        top_s = month_view(aid, sm)[0] if aid else None
        records.append({
            'source': src, 'row': r['_row'], 'nickname': nick, 'nicknameStatus': st, 'via': via,
            'artistId': aid, 'ownerId': artists[aid]['owner'] if aid else None, 'candidates': cands or None,
            'month': m, 'spendMonth': sm, 'gross': str(g), 'charged': str(c), 'flag': flag or None, 'recoveryPercent': rp,
            'rowKind': (r['type'] or '-') + '/' + (r['category'] or '-') if (r['reports_date_for_artists_iso'] or '') else 'separate ad row',
            'isrc': isrc, 'method': method, 'confidence': conf, 'labelString': lstr,
            'labelOfRecord': (sub + ' (sublabel of ' + (lor or '?') + ')') if sub else lor, 'ownLabel': lor, 'sublabel': sub,
            'topNetIsrc': top, 'topNetIsrcSpendMonth': top_s, 'labelMix': mix,
            'comment': '; '.join(x for x in (rule, note, loader_note) if x),
        })

# ---------------------------------------------------------------- summary
def agg(keyf, rs=None):
    out = collections.defaultdict(lambda: {'rows': 0, 'gross': D(0), 'charged': D(0), 'notCharged': D(0)})
    for x in rs if rs is not None else records:
        e = out[keyf(x)]; e['rows'] += 1; e['gross'] += D(x['gross']); e['charged'] += D(x['charged']); e['notCharged'] += D(x['gross']) - D(x['charged'])
    return {str(k): {kk: (str(v) if isinstance(v, D) else v) for kk, v in e.items()} for k, e in sorted(out.items(), key=lambda kv: str(kv[0]))}

# agreement of b with c where both are possible
agree = collections.defaultdict(lambda: {'both': 0, 'same': 0})
for x in records:
    if x['method'] == 'b' and x['topNetIsrc']:
        a = agree[x['confidence']]; a['both'] += 1; a['same'] += x['topNetIsrc'] == x['isrc']; a['sameSpendMonth'] = a.get('sameSpendMonth', 0) + (x['topNetIsrcSpendMonth'] == x['isrc'])
mixed = [x for x in records if x['labelMix'] and len(x['labelMix']) > 1]

summary = {
    'total': agg(lambda x: 'all'),
    'byYear': agg(lambda x: x['month'][:4]),
    'byYearFlag': agg(lambda x: (x['month'][:4], x['flag'] or 'empty')),
    'byRecovery': agg(lambda x: x['recoveryPercent']),
    'byRowKind': agg(lambda x: x['rowKind']),
    'byMethod': agg(lambda x: x['method']),
    'byMethodConfidence': agg(lambda x: (x['method'], x['confidence'])),
    'byNicknameStatus': agg(lambda x: x['nicknameStatus']),
    'byLabelOfRecord': agg(lambda x: x['labelOfRecord'] or ('no label string' if not x['isrc'] else 'label string unmapped')),
    'notChargedBySublabel': agg(lambda x: x['sublabel'] or ('ours: ' + (x['ownLabel'] or 'unmapped/no ISRC')), [x for x in records if x['recoveryPercent'] != 100]),
    'promoVsTopNet': dict(agree),
    'artistMonthsWithSeveralLabels': agg(lambda x: 'several labels of record in the month', mixed),
    'unmatchedNicknames': agg(lambda x: x['nickname'], [x for x in records if x['nicknameStatus'] == 'unmatched']),
    'ambiguousNicknames': agg(lambda x: x['nickname'], [x for x in records if x['nicknameStatus'] == 'ambiguous']),
    'matchedWithoutIsrc': agg(lambda x: x['nickname'], [x for x in records if x['artistId'] and not x['isrc']]),
    'excluded': excluded,
    'loadedBelieveFiles': len(loaded),
}
os.makedirs(OUT, exist_ok=True)
with open(os.path.join(OUT, 'main_ads_mapping.json'), 'w') as f:
    json.dump({'generatedBy': 'packages/backend/scripts/mvp/extract-main-ads.py', 'summary': summary, 'records': records}, f, ensure_ascii=False, indent=1)
print(json.dumps({k: summary[k] for k in ('total', 'byMethod', 'byNicknameStatus', 'promoVsTopNet')}, indent=1))
