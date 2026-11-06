"""Shared helpers of the stage-4 annex extractors (exclusions.py, participations.py, splits_diff.py, echo8.py).
ClickHouse is read through stores.py: the environment first, then the repo .env (CLICKHOUSE_DATABASE / _HOST /
_HTTP_PORT / _USERNAME / _PASSWORD); OUT is <MVP_LOAD_DIR>/annex (default data/mvp-load/annex). Read-only on the stores.
"""
import json, re, unicodedata, datetime, os, sys
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import stores
SP = '/private/tmp/claude-501/-Users-nearlydeadhipo-Desktop-0to8-ERP/441975a6-0f8b-4dbd-b984-d2856fc5b0b0/scratchpad/s4'
ROOT = stores.ROOT
OUT = stores.mvp_load_dir('annex')

def nn(s):
    s = unicodedata.normalize('NFKC', str(s)).lower()
    return re.sub(r'[\W_]+', ' ', s).strip()

def jl(name):
    return json.load(open(SP + '/' + name))

def tsv(name):
    return [l.rstrip('\n').split('\t') for l in open(SP + '/' + name)]

def month_of(d):  # 'YYYY-MM-DD' -> 'YYYY-MM-01'
    return d[:7] + '-01'

def parse_date(s):
    """-> (iso effective date, note). Handles YYYY-MM-DD, dd.mm.yyyy, 'dd.mm.yyyy, effective dd.mm.yyyy'."""
    s = str(s).strip()
    m = re.search(r'effective (\d\d)\.(\d\d)\.(\d{4})', s)
    if m:
        return '%s-%s-%s' % (m.group(3), m.group(2), m.group(1)), 'signed ' + s.split(',')[0]
    m = re.fullmatch(r'(\d{4})-(\d\d)-(\d\d)', s)
    if m: return s, None
    m = re.fullmatch(r'(\d\d)\.(\d\d)\.(\d{4})', s)
    if m: return '%s-%s-%s' % (m.group(3), m.group(2), m.group(1)), None
    return None, 'unparsed: ' + s

def parse_period(p):
    p = str(p or '').strip()
    if p.startswith('from first release'):
        return None, None, 'first_release'
    m = re.fullmatch(r'(\d{4}-\d\d)(?:\s*[—–-]+\s*(\d{4}-\d\d)?)?', p)
    if not m: return None, None, 'unparsed'
    a, b = m.group(1), m.group(2)
    if '—' not in p and '–' not in p: b = a
    return a + '-01', (b + '-01' if b else None), 'ok'

def seller_name(seller, instrument=''):
    """Stage name or neutral label: legal names never leave the source."""
    t = str(seller)
    if 'Smetkov' in t: return 'seller own entity (legal name withheld)'
    if 'Hanford' in t: return 'hanfeezy'
    if 'Balla' in t: return 'seller of instrument %s (legal name withheld)' % instrument
    if 'p/k/a' in t: return t.split('p/k/a')[1].split(',')[0].strip()
    if 'Veleslavov' in t: return 'seller of instrument %s (legal name withheld)' % instrument
    return t

def vested(v):
    return re.sub(r'^\w+ \u2192 FZ', 'person \u2192 FZ', str(v))

def ch(sql):
    """ClickHouse read-only over HTTP (the stores of the environment, then of the repo .env)."""
    return stores.ch(sql, timeout=300)

def loaded_ids(account=None):
    return [l.split('\t')[0] for l in open(SP + '/files.tsv') if account is None or l.split('\t')[1].strip() == account]

def q(l):
    return ','.join("'%s'" % x for x in l)
