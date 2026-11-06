"""Which stores and directories the stage-4/5 Python extractors read: the process environment first, then the repo
`.env`, then the defaults (PostgreSQL `erp`, output `data/mvp-load`). Stdlib only, `python3 -I` compatible.

  DB_DATABASE, DB_USERNAME                       PostgreSQL database and user (psql inside the container below)
  ERP_PG_CONTAINER                               the PostgreSQL container, environment only (royalty-erp-postgres-1)
  CLICKHOUSE_HOST, CLICKHOUSE_HTTP_PORT,
  CLICKHOUSE_DATABASE, CLICKHOUSE_USERNAME,
  CLICKHOUSE_PASSWORD                            ClickHouse over HTTP
  MVP_LOAD_DIR                                   the data/mvp-load directory (relative paths are from the repo root)

Every access here is read-only (SELECT); nothing is written to a store.
"""
import os, json, base64, subprocess, urllib.request

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.abspath(os.path.join(HERE, '..', '..', '..', '..'))
DEFAULTS = {'DB_DATABASE': 'erp', 'DB_USERNAME': 'erp', 'CLICKHOUSE_HOST': 'localhost', 'CLICKHOUSE_HTTP_PORT': '8123',
            'MVP_LOAD_DIR': 'data/mvp-load'}
_dotenv = None


def dotenv():
    global _dotenv
    if _dotenv is None:
        path = os.path.join(ROOT, '.env')
        _dotenv = {}
        if os.path.exists(path):
            for l in open(path, encoding='utf-8'):
                l = l.strip()
                if '=' in l and not l.startswith('#'):
                    k, v = l.split('=', 1)
                    _dotenv[k.strip()] = v.strip().strip('"').strip("'")
    return _dotenv


def setting(name):
    """The environment, then the repo .env, then the default; a missing setting without a default is an error."""
    v = os.environ.get(name) or dotenv().get(name) or DEFAULTS.get(name)
    if not v: raise SystemExit('%s is not set (environment or repo .env)' % name)
    return v


def mvp_load_dir(*parts):
    return os.path.join(ROOT, setting('MVP_LOAD_DIR'), *parts)


def psql(sql):
    """Read-only SELECT through psql in the PostgreSQL container; rows as lists of strings."""
    container = os.environ.get('ERP_PG_CONTAINER') or 'royalty-erp-postgres-1'
    out = subprocess.run(['docker', 'exec', container, 'psql', '-U', setting('DB_USERNAME'),
                          '-d', setting('DB_DATABASE'), '-At', '-F', '\t', '-c', sql],
                         capture_output=True, text=True, check=True).stdout
    return [l.split('\t') for l in out.splitlines()]


def ch(sql, timeout=600):
    """Read-only ClickHouse query over HTTP; the caller appends FORMAT JSONEachRow. Rows as dicts."""
    req = urllib.request.Request('http://%s:%s/?database=%s' % (setting('CLICKHOUSE_HOST'), setting('CLICKHOUSE_HTTP_PORT'),
                                                                setting('CLICKHOUSE_DATABASE')), data=sql.encode())
    cred = '%s:%s' % (setting('CLICKHOUSE_USERNAME'), setting('CLICKHOUSE_PASSWORD'))
    req.add_header('Authorization', 'Basic ' + base64.b64encode(cred.encode()).decode())
    out = urllib.request.urlopen(req, timeout=timeout).read().decode()
    return [json.loads(l) for l in out.splitlines() if l.strip()]
