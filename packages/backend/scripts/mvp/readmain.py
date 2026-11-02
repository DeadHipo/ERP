"""Read the INCOME/EXPENSE ledger of 0to8 Main.xlsx (read-only) into plain dicts."""
import sys, os, datetime, re
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import xl
MAIN='/Users/nearlydeadhipo/Desktop/0to8/ERP/context_data/0to8 Main.xlsx'
def d(v):
    if v in (None,''): return None
    if isinstance(v,float): return datetime.date(1899,12,30)+datetime.timedelta(days=int(v))
    if isinstance(v,str):
        m=re.fullmatch(r'(\d\d)\.(\d\d)\.(\d{4})',v.strip())
        if m: return datetime.date(int(m[3]),int(m[2]),int(m[1]))
        m=re.fullmatch(r'(\d{4})-(\d\d)-(\d\d)',v.strip())
        if m: return datetime.date(int(m[1]),int(m[2]),int(m[3]))
    return v
def ledger():
    w=xl.load(MAIN)
    for rn,r in xl.rows_n(w['INCOME  EXPENSE']):
        if rn==1: continue
        r=r+[None]*(15-len(r))
        yield dict(rowNo=rn,comment=(r[0] or ''),rep=d(r[1]),date=d(r[2]),nick=(r[3] or ''),type=(r[4] or ''),cat=(r[5] or ''),amount=r[6],ignore=r[14])
