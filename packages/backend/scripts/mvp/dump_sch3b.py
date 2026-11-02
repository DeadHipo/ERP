"""Dump the 'Sch3B Авансы' sheet of registry v7 (read-only) as list of dicts via stdout JSON."""
import sys, os, json
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import xl
V7='/Users/nearlydeadhipo/Desktop/0to8/ERP/context_data/contract_index/реестры_каталога_2026-08_v7.xlsx'
w=xl.load(V7)
name=[n for n in w if n.startswith('Sch3B')][0]
rs=list(xl.rows(w[name]))
json.dump({'sheet':name,'rows':rs},sys.stdout,ensure_ascii=False)
