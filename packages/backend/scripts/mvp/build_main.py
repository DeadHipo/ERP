"""Stage 4.5 data preparation: classify every cash row of 0to8 Main.xlsx (INCOME/EXPENSE).

READ-ONLY on every source. Writes JSON + README + reconciliation under data/mvp-load/main/.
Run:  python3 -I packages/backend/scripts/mvp/build_main.py
Needs the ERP PostgreSQL container (royalty-erp-postgres-1) for owners.artists / owner_aliases (SELECT only).
"""
import sys, os, re, json, subprocess, collections, unicodedata
from decimal import Decimal as D, ROUND_HALF_UP
HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
import readmain, xl

ROOT = os.path.abspath(os.path.join(HERE, '..', '..', '..', '..'))
OUT = os.path.join(ROOT, 'data', 'mvp-load', 'main')
os.makedirs(OUT, exist_ok=True)
CENT = D('0.01')

def q2(x): return x.quantize(CENT, ROUND_HALF_UP)
def spec(s): return re.sub(r'\s+', ' ', s.strip().lower())

def psql(sql):
    out = subprocess.run(['docker', 'exec', 'royalty-erp-postgres-1', 'psql', '-U', 'erp', '-d', 'erp', '-At', '-F', '\t', '-c', sql],
                         capture_output=True, text=True, check=True).stdout
    return [l.split('\t') for l in out.splitlines()]

# ---------------------------------------------------------------- reference data (read-only SELECT)
artists = psql("select id, pseudonym, pseudonym_norm, owner_id from owners.artists")
aliases = psql("select owner_id, alias, alias_norm from owners.owner_aliases")
by_spec = collections.defaultdict(list)
art_by_owner = collections.defaultdict(list)
for a in artists:
    by_spec[spec(a[1])].append(a); art_by_owner[a[3]].append(a)
norm_count = collections.Counter(a[2] for a in artists)
by_alias = collections.defaultdict(set)
for o, al, _ in aliases: by_alias[spec(al)].add(o)

# ---------------------------------------------------------------- ledger
def amt(r):
    v = r['amount']
    if isinstance(v, float): return D(repr(v))
    return D(0)           # '' or None: empty amount cell
rows = [r for r in readmain.ledger()]
allnicks = sorted({r['nick'] for r in rows if r['nick']})
typed = [r for r in rows if r['type']]

# ---------------------------------------------------------------- 1. nicknames
stats = collections.defaultdict(lambda: collections.Counter())
sums = collections.defaultdict(lambda: collections.defaultdict(D))
for r in typed:
    stats[r['nick']][r['type'] + '_rows'] += 1
    sums[r['nick']][r['type']] += amt(r)
nicknames = {}
for n in allnicks:
    s = spec(n)
    e = {'nickname': n, 'normalised': s}
    if s in by_spec:
        c = by_spec[s]
        if len(c) == 1:
            a = c[0]
            e.update(status='matched', via='pseudonym', artistId=a[0], ownerId=a[3], pseudonym=a[1])
            if norm_count[a[2]] > 1:
                e['note'] = 'pseudonym_norm of the ERP (punctuation stripped) is shared with another artist; matched here only by the exact lower-cased pseudonym'
        else:
            e.update(status='ambiguous', via='pseudonym', artistId=None, ownerId=None, pseudonym=None,
                     candidates=[{'artistId': a[0], 'ownerId': a[3], 'pseudonym': a[1]} for a in c])
    elif s in by_alias:
        os_ = sorted(by_alias[s])
        if len(os_) == 1:
            arts = art_by_owner[os_[0]]
            if len(arts) == 1:
                e.update(status='matched', via='owner_alias', artistId=arts[0][0], ownerId=os_[0], pseudonym=arts[0][1])
            else:
                e.update(status='ambiguous', via='owner_alias', artistId=None, ownerId=os_[0], pseudonym=None,
                         candidates=[{'artistId': a[0], 'ownerId': a[3], 'pseudonym': a[1]} for a in arts],
                         note='alias identifies one owner, but the owner has %d artists' % len(arts))
        else:
            e.update(status='ambiguous', via='owner_alias', artistId=None, ownerId=None, pseudonym=None,
                     candidates=[{'ownerId': o} for o in os_])
    else:
        e.update(status='unmatched', via=None, artistId=None, ownerId=None, pseudonym=None)
    st = stats[n]
    e['rows'] = {k: v for k, v in sorted(st.items())}
    e['sums'] = {k: str(q2(v)) for k, v in sorted(sums[n].items())}
    nicknames[n] = e

# ---------------------------------------------------------------- Sch3B (registry v7)
sch = json.loads(subprocess.run([sys.executable, '-I', os.path.join(HERE, 'dump_sch3b.py')], capture_output=True, text=True, check=True).stdout)
sch_rows = []
for r in sch['rows'][2:]:
    if not r[0]: continue
    sch_rows.append({'nick': spec(r[0]), 'date': r[1], 'amount': D(repr(r[2])), 'scope': r[4], 'status': r[5], 'left': D(repr(r[3])), 'used': False})
def sch_match(r):
    n = spec(r['nick']); a = q2(amt(r)); ds = str(r['date'])
    c = [s for s in sch_rows if s['nick'] == n and s['amount'] == a and not s['used']]
    c1 = [s for s in c if s['date'] == ds]
    if len(c1) >= 1: pick = c1[0]; how = 'nickname+date+amount'
    elif len(c) >= 1: pick = c[0]; how = 'nickname+amount (date differs)'
    else: return None, None
    pick['used'] = True
    return pick, how

# ---------------------------------------------------------------- helpers for classification
def norm_comment(c): return re.sub(r'\s+', ' ', c).strip()
UPC_RE = re.compile(r'(?<!\d)(0?\d{12,13})(?!\d)')
PCT_RE = re.compile(r'(\d+(?:[.,]\d+)?)\s*%')

def parse_carve(c):
    t = norm_comment(c)
    low = t.lower()
    f = {'upcs': [], 'percents': [], 'participants': [], 'title': None, 'parse': 'ok'}
    body = re.sub(r'^"?вычет доли\s*', '', t, flags=re.I).rstrip('"').strip()
    body = body.split(' | ')[0]
    f['upcs'] = [u.lstrip('0') if u.startswith('0') and len(u) == 13 else u for u in UPC_RE.findall(body)]
    f['percents'] = [p.replace(',', '.') for p in PCT_RE.findall(body)]
    m = re.match(r'(?:Август 2026\. )?Снято с роялти и передано (.+?) по релизам (.+?),\s*([\d.]+)\.?$', body)
    if m:
        f.update(participants=[m.group(1)], title=m.group(2), note='moved by name, no UPC'); return f
    body = re.sub(r'^за май\s+', '', body)                         # "Вычет доли за май Mc RB за (...)"
    m = re.match(r'(?:за\s+)?(.+?)\s+за\s+(.+)$', body)           # "<participant> за <title> (UPC ...)"
    if m and re.match(r'(?i)(mc|mano|remixed|ural|dj )', m.group(1)) and ' - ' not in m.group(1):
        part = m.group(1); rest = m.group(2)
        f['participants'] = [p.strip() for p in re.split(r'\s+и\s+|\s*&\s*|\s*\+\s*', part) if p.strip()]
        f['title'] = re.split(r'\s*[-(]\s*\d{10,}|\s*\(\d{10,}|\s+\d{12,}', rest)[0].strip(' -(').strip()
        if not f['title']:
            f['title'] = re.sub(r'^.*?UPC\s*\)?\s*', '', rest).strip(' )"') or None
        return f
    m = re.match(r'(?:за\s+\S+\s+)?(?:за\s+)?((?:MC|Mc)\s+\S+)\s+за\s+(.+)$', body) if False else None
    m = re.match(r'(?:за\s+)?(.+?)\s+-\s+\S*\d{12,13}.*?\s+-\s+(.+)$', body)    # "<title> - <UPC> - ... - <pct|participant>"
    if m:
        f['title'] = m.group(1).strip()
        tail = body[body.index(m.group(2)):] if m.group(2) in body else m.group(2)
        # segments after the UPC, split by ' - '
        segs = [s.strip() for s in re.split(r'\s+-\s+', body)][2:]
        parts = []
        for s in segs:
            s2 = re.sub(r'\d+(?:[.,]\d+)?\s*%.*$', '', s).strip()
            if s2 and not re.match(r'(?i)^(isrc|\d)', s2) and not PCT_RE.fullmatch(s):
                parts.append(s2)
        names = []
        for p in parts:
            names += [x.strip() for x in re.split(r'\s*&\s*|\s*\+\s*', p) if x.strip()]
        f['participants'] = [n for n in names if re.match(r'(?i)(mc|mano|dj)', n)]
        return f
    if 'Sleeping City Funk' in body:
        f.update(participants=['MC Denny'], title='Sleeping City Funk (slowed & super slowed)', parse='manual',
                 note='comment: 5182.65 should have gone to the label, 3840.155 moved from the artist, 1342.50 is the difference; participant by title family (MC Denny 13%)'); return f
    f['parse'] = 'partial'
    f['title'] = body[:80]
    return f

SPECIAL_PART = {}

routes = []
def route_of(c):
    l = c.lower()
    if 'send to fl' in l: return 'fl'
    if 'send to customer' in l: return 'customer'
    if 'echo' in l and 'выплатили' in l: return 'echo8 account'
    if 'tipalti' in l or 'через' in l: return 'other (tipalti/через)'
    return None

KNOWN_PRICES = {  # buy-out prices written in context_data/contract_index/agent_special_cases.md (by filename nickname)
    'dj tuuv': ('6000', 'asset purchase DJ TUUV $6,000'),
    'habazane': ('6000', 'asset purchase Habazane $6,000'),
    'veryhxghmen': ('1500', 'asset purchase VERYHXGHMEN $1,500 (SEGREDO, 8.3% each)'),
    'qaraqshy': ('17500', 'asset purchase qaraqshy $17,500 (MONTAGEM SANTA FE 2)'),
}
doc_names = [spec(x['files'][0]['name']) for x in json.load(open(os.path.join(ROOT, 'context_data', 'contract_index', 'documents.json'))) if x['kind'] in ('asset_purchase', 'beat_purchase', 'caa', 'assignment', 'work_for_hire')]
def buyout_evidence(nick, amount):
    n = spec(nick)
    ev = {}
    if n in KNOWN_PRICES:
        ev['priceInDocs'] = KNOWN_PRICES[n][0]; ev['doc'] = KNOWN_PRICES[n][1]
        ev['priceMatchesRow'] = (D(KNOWN_PRICES[n][0]) == amount)
    ev['purchaseDocForNickname'] = any(n.replace(' ', '') in d.replace(' ', '') for d in doc_names if len(n) > 3)
    return ev

# ---------------------------------------------------------------- 2. classify
out = []
by_no = {r['rowNo']: r for r in typed}
def base(r):
    a = amt(r)
    return {
        'rowNo': r['rowNo'], 'comment': norm_comment(r['comment']), 'reportMonth': r['rep'].strftime('%Y-%m') if r['rep'] else None,
        'date': r['date'].isoformat(), 'nickname': r['nick'], 'type': r['type'], 'category': r['cat'],
        'amount': str(q2(a)), 'amountRaw': format(a.normalize(), 'f') if a != 0 else '0',
        'ignoreFlag': r['ignore'] == '1', 'side': 'expense' if r['type'] == 'Expense' else 'income',
        'nicknameStatus': nicknames[r['nick']]['status'], 'ownerId': nicknames[r['nick']]['ownerId'], 'artistId': nicknames[r['nick']]['artistId'],
    }

# pre-pass: equal-amount same-date pairs of Income/Other with Expense/Other (credit + cash)
inc_other = [r for r in typed if r['type'] == 'Income' and r['cat'] == 'Other']
def find_pair(r, cat_i, side_opposite):
    for x in typed:
        if x['type'] == side_opposite and x['cat'] == cat_i and x['nick'] == r['nick'] and x['date'] == r['date'] and amt(x) == amt(r) and amt(r) != 0:
            return x['rowNo']
    return None

carve_rows = []
for r in typed:
    e = base(r); c = r['comment']; lc = c.lower(); a = amt(r)
    e['load'] = None; e['why'] = ''
    rt = route_of(c)
    if rt: e['route'] = rt
    if 'ноу рекап' in lc: e['noRecap'] = True
    if r['type'] == 'Expense':
        if a == 0:
            e['load'] = 'not_loaded'; e['why'] = 'amount cell empty or zero: no cash, nothing to load'
        elif r['cat'] == 'Advertising':
            e['load'] = 'not_loaded'; e['why'] = 'Expense/Advertising: ads are M21 (later); known stage-5 difference'
        elif r['cat'] == 'Publishing':
            e['load'] = 'payout'; e['why'] = 'the single Expense/Publishing row: a payout on the nickname (plan 4.5)'
        elif r['cat'] == 'Advance':
            m, how = sch_match(r)
            scope = None; src = None
            if m: scope = m['scope']; src = 'Sch3B v7 (%s)' % how; e['sch3bStatus'] = m['status']
            elif 'паблишинг' in lc: scope = 'publishing'; src = 'comment (advance for publishing); not in Sch3B (recouped or outside it)'
            if scope == 'none':
                e['load'] = 'payout'; e['why'] = 'Sch3B v7 scope "none": non-recoupable, entered as a plain migration payout' + (' (comment: ' + norm_comment(c) + ')' if c else '')
            else:
                if scope is None: scope = 'any'; src = 'default: row is not in Sch3B v7 (older / fully recouped advances are not listed); recoup engine decides'
                e['load'] = 'advance'; e['scope'] = scope; e['scopeSource'] = src
                e['why'] = 'Expense/Advance entered as a recoupable payout on the earning pseudonym, scope %s' % scope
                if r['ignore'] == '1': e['why'] += '; IGNORE Reports=1 only keeps it out of the artist report balance (publishing-scope advances)'
        elif r['cat'] == 'Royalties':
            if r['rowNo'] == 12904:
                e['load'] = 'payout'; e['parts'] = [
                    {'load': 'payout', 'amount': '10774.41', 'why': 'accrued royalty paid at signing (settlement letter, M33); a payout against the retro participation'},
                    {'load': 'document_only', 'amount': str(q2(a - D('10774.41'))), 'why': 'USD 5,000 settlement fee of MC Denny (non-recoupable one-off; the three 1,666.66 deductions charge it to the artists)'}]
                e['why'] = 'one row, two meanings: 15,774.41 = 10,774.41 retro royalties + 5,000 fee (comment); split into parts'
            elif r['rowNo'] == 9126:
                e['load'] = 'payout'; e['overpayment'] = True; e['why'] = '"переплата": an ordinary cash row that created an overpayment (M27); loaded as a plain migration payout'
            elif r['rowNo'] == 15549:
                e['load'] = 'advance'; e['scope'] = 'any'; e['scopeSource'] = 'comment: "Переплата, которую заносим как аванс"'; e['overpayment'] = True
                e['why'] = 'overpayment the owner enters as a recoupable advance (as its comment says), scope any'
            elif r['rowNo'] == 10654:
                e['load'] = 'review'; e['why'] = 'Expense/Royalties row that says "вычет доли с релиза ...: the sum was accrued to the nickname, he has no share on the release" (not cash; a correction of a wrong accrual that belongs to the split fix, loading it would double count)'
            elif r['rowNo'] == 13686:
                e['load'] = 'review'; e['why'] = 'comment: "mistakenly accrued by Believe 400.24 for the original release ... (discussed in chat)": unclear whether it is cash paid or a clawback; needs the owner'
            elif 'доля duduzinho' in lc:
                e['load'] = 'review'; e['why'] = 'FUNK TONTO: comment names a 3% share of another participant (May-August 2026); unclear whether the row paid the nickname or carries the participant share; needs the owner'
            elif r['ignore'] == '1':
                e['load'] = 'review'; e['why'] = 'IGNORE Reports=1 on a payout row (its Income twin is also ignored): flag keeps both out of the report balance, so the cash and the accrual may cancel; decide as a pair'
            else:
                e['load'] = 'payout'; e['why'] = 'Expense/Royalties: migration payout (date = col C, period = report month)'
                if rt: e['why'] += '; route: ' + rt
                if e.get('noRecap'): e['why'] += '; "ноу рекап" kept as a note (stage-5 difference, M19/M44)'
                if 'в рублях' in lc or 'в долларах' in lc: e['why'] += '; comment: payment cancelled in USD and paid in RUB (M24 later)'
        elif r['cat'] == 'Other':
            if 'выкуп' in lc:
                e['load'] = 'document_only'; e['why'] = 'buy-out price paid to the seller (comment); document only, not a royalty payout (M9/M20/M47)'
                e['evidence'] = buyout_evidence(r['nick'], q2(a))
                if r['ignore'] == '1': e['why'] += '; IGNORE Reports=1: the price closes the pre-buy-out unpaid balance (M47)'
            elif 'бонус' in lc:
                e['load'] = 'document_only'; e['why'] = 'one-off bonus, "not deducted from royalties" (comment): document only (plan 4.5; M20)'
            elif r['rowNo'] in (12732, 13118):
                e['load'] = 'payout'; e['pairedRow'] = find_pair(r, 'Other', 'Income')
                e['requiresCredit'] = e['pairedRow']
                e['why'] = 'cash paid to the MC participant; the same-day Income/Other row of equal amount is the credit (ledger form of a carve credit). Load together with the carve for the pair, otherwise payable goes negative'
            elif r['nick'] == 'MC Denny':
                e['load'] = 'review'; e['pairedRow'] = find_pair(r, 'Other', 'Income')
                e['why'] = 'no comment; Income/Other 5,000 and Expense/Other 5,000 on the same day net to zero (a credit and a cash-out), before the settlement of 2026-02-27; basis unknown'
            else:
                e['load'] = 'review'; e['why'] = 'Expense/Other without a comment (not a buy-out, bonus or carve-credit): purpose unknown; ' + ('equal amount on another nickname on the same date (UdieNnx / HXVSAGE): possible transfer' if r['rowNo'] in (18108,) else 'small 2024 row')
        elif r['cat'] == 'Sample':
            if 'вычет доли' in lc:
                e['load'] = 'carve_pair'; e['role'] = 'artist_deduction'; e['carve'] = parse_carve(c)
                e['why'] = '"вычет доли": a participant share deducted from the artist (ledger form of a carve)'
                if r['rowNo'] == 6821:
                    e['parts'] = [{'load': 'carve_pair', 'amount': '19660.71', 'why': 'MC 7belo share (19660.708) of Analog Horror Funk'},
                                  {'load': 'deduction', 'amount': str(q2(a) - D('19660.71')), 'why': 'payment to the MC\'s representative and his lawyer (22,244.90 per comment), cash paid by the label and charged to the artist; basis document: needs the owner'}]
                    e['why'] += '; comment: 41905.62 = 19660.708 (share) + 22244.9 (payout to a representative + lawyer fee)'
                carve_rows.append(e)
            elif 'штраф' in lc:
                e['load'] = 'deduction'; e['basis'] = 'settlement fee of MC Denny USD 5,000 (settlement letter, M33/N10); 3 x 1,666.66 charged to the three artists'
                e['why'] = '"штраф за Sleeping City Funk": MC Denny\'s 5,000 fee charged to the artist; reduces the balance, no cash to the nickname'
            elif r['rowNo'] == 10387:
                e['load'] = 'carve_pair'; e['role'] = 'artist_deduction'; e['carveLike'] = True; e['carve'] = parse_carve('вычет доли ' + c)
                e['why'] = 'not worded "вычет доли" but "taken from royalty and passed to ural gaisin" (Holy War releases): the carve form; outside the 104 rows of the plan'
                carve_rows.append(e)
            elif r['rowNo'] == 20494:
                e['load'] = 'payout'; e['pairedRow'] = find_pair(r, 'Sample', 'Income'); e['requiresCredit'] = e['pairedRow']
                e['why'] = '"перерасчет по роялти за HOLY WAR": cash paid to the participant; the same-day Income/Sample 2,092.57 is the credit (sum of four Holy War carve rows). Load together with that carve'
            elif r['rowNo'] == 11936:
                e['load'] = 'review'
                e['why'] = 'USD 100,000 on LDRR 2026-03-13, no comment. Not the settlement lump (the settlement counterparty is another owner, signed 2026-02-27) and not a buy-out price (the only LDRR purchase agreement is USD 150,000, 2026-10-17; the USD 100,000 agreement is Lxzt). Possibly cash to the artist; needs the owner'
            elif a % 100 == 0 and r['rowNo'] not in ():
                e['load'] = 'payout'
                e['why'] = 'Expense/Sample without a comment, round cash sum: read as cash to the artist (stage-2 product review: "cash to artists, mostly round sums"); basis document not in the ledger'
                if r['rowNo'] in (13839, 10689): e['load'] = 'review'
            else:
                e['load'] = 'review'
                e['why'] = 'Expense/Sample without a comment, not a round sum: may be a manual carve / transfer / deduction rather than cash; basis unknown'
                if r['rowNo'] in (10689, 13839): e['why'] += '; same amount 6,081.66 on two nicknames on the same date (two co-artists): looks like an equal-parts deduction'
            if e['load'] == 'payout' and r['rowNo'] in (10689, 13839): e['load'] = 'review'
        else:
            e['load'] = 'review'; e['why'] = 'unexpected category'
    else:   # Income side
        if r['cat'] == 'Sample':
            e['load'] = 'carve_pair'; e['role'] = 'participant_credit'
            e['why'] = 'Income/Sample: the credit side of a carve (participant receives the share carved from the artists)'
            e['carve'] = {'participants': [r['nick']], 'upcs': UPC_RE.findall(c), 'note': norm_comment(c)}
        elif r['cat'] == 'Other' and r['rowNo'] in (12733, 13119):
            e['load'] = 'carve_pair'; e['role'] = 'participant_credit'; e['pairedRow'] = find_pair(r, 'Other', 'Expense')
            e['why'] = 'Income/Other credit to an MC participant, paid out the same day by an Expense/Other row of equal amount'
        elif r['cat'] == 'Other' and r['nick'] == 'MC Denny':
            e['load'] = 'review'; e['pairedRow'] = find_pair(r, 'Other', 'Expense'); e['why'] = 'see the Expense/Other twin: credit and cash-out of 5,000 on the same day, basis unknown'
        else:
            e['load'] = 'income_comparison'; e['why'] = 'Income row: kept for the stage-5 comparison only'
            if r['ignore'] == '1': e['why'] += '; IGNORE Reports=1 (M47: pre-buy-out debt closed by the price / seller share kept by the label)'
    out.append(e)

# amount of zero-amount rows from text cell
json.dump(nicknames, open(os.path.join(OUT, 'nicknames.json'), 'w'), ensure_ascii=False, indent=1)
json.dump(out, open(os.path.join(OUT, 'cash_rows.json'), 'w'), ensure_ascii=False, indent=1)

# ---------------------------------------------------------------- carve pairs (grouped)
groups = collections.OrderedDict()
for e in carve_rows:
    cv = e['carve']
    key = ('|'.join(sorted(cv['participants'])) or '?', '|'.join(cv['upcs']) or (cv.get('title') or '?'), e['reportMonth'])
    g = groups.setdefault(key, {'participants': cv['participants'], 'upcs': cv['upcs'], 'title': cv.get('title'), 'reportMonth': e['reportMonth'], 'percents': cv['percents'], 'rows': [], 'total': D(0)})
    amtv = D(e['amount']) if 'parts' not in e else D(e['parts'][0]['amount'])
    g['rows'].append({'rowNo': e['rowNo'], 'nickname': e['nickname'], 'amount': str(amtv), 'carveLike': e.get('carveLike', False)})
    g['total'] += amtv
pairs = []
for g in groups.values():
    g['total'] = str(g['total']); pairs.append(g)
json.dump(pairs, open(os.path.join(OUT, 'carve_pairs.json'), 'w'), ensure_ascii=False, indent=1)
json.dump([{k: (str(v) if isinstance(v, D) else v) for k, v in x.items()} for x in sch_rows], open(os.path.join(OUT, 'sch3b_check.json'), 'w'), ensure_ascii=False, indent=1)
print('rows', len(out), 'nick', len(nicknames), 'pairs', len(pairs))
