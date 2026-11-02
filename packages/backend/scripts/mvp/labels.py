#!/usr/bin/env python3 -I
"""Stage 4.1: label dictionary proposal from the loaded Believe files. Reads dumps made by the stage-4 prep (see README in data/mvp-load/annex)."""
import json, sys, re, unicodedata
from decimal import Decimal
SP = sys.argv[1]; OUT = sys.argv[2]
acc = {l.split('\t')[0]: l.split('\t')[1].strip() for l in open(SP + '/files.tsv')}
rows = [json.loads(l) for l in open(SP + '/labels_file.jsonl')]
S = {}
for r in rows:
    s = S.setdefault(r['label_name'], {'net': Decimal(0), 'mn': '9', 'mx': '0', 'acc': {}})
    n = Decimal(r['net']); a = acc[r['fid']]
    s['net'] += n
    s['mn'] = min(s['mn'], r['mn']); s['mx'] = max(s['mx'], r['mx'])
    x = s['acc'].setdefault(a, {'net': Decimal(0), 'mn': '9', 'mx': '0'})
    x['net'] += n; x['mn'] = min(x['mn'], r['mn']); x['mx'] = max(x['mx'], r['mx'])

def norm(s):
    s = unicodedata.normalize('NFKC', s).lower()
    s = re.sub(r'[/,]', ' ', s)
    return re.sub(r'\s+', ' ', s).strip()

# string -> (label, kind, ownLabel, note)
M = {
 '0to8': ('0to8', 'alias', '0to8', None),
 'Echo8': ('Echo8', 'alias', 'Echo8', None),
 'Ahh Music': ('0to8', 'alias', '0to8', 'owner decision 3: Ahh Music is the label itself, no deduction'),
 '0to8/Echo8': ('0to8', 'alias', '0to8', 'owner answer 1: the releases under this imprint are 0to8 releases'),
 '0to8 / Ahh Music': ('0to8', 'alias', '0to8', 'Ahh Music is 0to8 (decision 3)'),
 '0to8, Echo8': ('0to8', 'alias', '0to8', 'ASSUMPTION: same as 0to8/Echo8 (owner answer 1); 2 Annex ISRC, 1.64 net; confirm'),
 'NoGhost Records': ('NoGhost', 'sublabel', '0to8', None),
 'NoGhost Records / 0to8': ('NoGhost', 'sublabel', '0to8', 'mixed string, "0to8 / X" convention: the sublabel'),
 '0to8, NoGhost Records': ('NoGhost', 'sublabel', '0to8', 'mixed string: the sublabel'),
 '77 Records': ('77 Records', 'sublabel', '0to8', None),
 '0to8 / 77 Records': ('77 Records', 'sublabel', '0to8', 'mixed string, "0to8 / X" = X'),
 'R2R PRODUCTION': ('R2R PRODUCTION', 'sublabel', '0to8', None),
 '0to8 / Enarma records': ('Enarma records', 'sublabel', '0to8', 'mixed string, "0to8 / X" = X; imprint has no decided rule (Q12)'),
 '0to8 x ENARMA': ('Enarma records', 'sublabel', '0to8', 'ASSUMPTION: variant of "0to8 / Enarma records"; net 0.50'),
 '0to8 / VBR': ('VBR', 'sublabel', '0to8', 'mixed string, "0to8 / X" = X (Q12)'),
 '0to8 / PCR': ('PCR', 'sublabel', '0to8', 'mixed string, "0to8 / X" = X (Q12)'),
 '0to8 / Bear catalogues': ('Bear catalogues', 'sublabel', '0to8', 'mixed string, "0to8 / X" = X (Q12)'),
 '0to8/lost': ('lost', 'sublabel', '0to8', 'mixed string, "0to8 / X" = X (Q12); the name "lost" is as printed, the owner may map it elsewhere'),
 'odds': ('odds', 'sublabel', '0to8', 'listed by 09 as an unlisted imprint (Q12); may be a not-a-label string: owner to confirm (alias of 0to8 if so)'),
 'no job records': ('no job records', 'sublabel', '0to8', 'listed by 09 as an unlisted imprint (Q12); 1.41 net; owner to confirm'),
 'Hoboshrine': ('Hoboshrine', 'sublabel', '0to8', 'listed by 09 as an unlisted imprint (Q12); 5.97 net; owner to confirm'),
 'qaraqshy records': ('qaraqshy', 'sublabel', 'Echo8', 'Echo8 sublabel (Q12)'),
 'fate music': ('fate', 'sublabel', 'Echo8', 'Echo8 sublabel (Q12)'),
 'CATCORE': ('CATCORE', 'sublabel', 'Echo8', 'Echo8 sublabel (Q12)'),
 'SF Records': ('SF', 'sublabel', 'Echo8', 'Echo8 sublabel (Q12)'),
}
missing = [k for k in S if k not in M]
assert not missing, missing
# first month per sublabel over all its strings
first = {}
for k, v in S.items():
    lab = M[k][0]
    first[lab] = min(first.get(lab, '9'), v['mn'])
DOC_NG = 'NoGhost Exclusive Sublabel Agreement (19/22.06.2026; to be re-signed under the half rule)'
DOC_OD2 = 'owner decision 2 of 2026-11-02 (no written contract)'
DOC_ASM = 'assumption: Q12 council decision (half of the label share, no document)'
labels = {}
def rules_for(lab):
    f = first[lab]
    if lab == 'NoGhost':
        return [
            {'percent': 50, 'from': '2026-02-01', 'to': '2026-06-01', 'basis': 'assumption', 'document': DOC_ASM + ' (before the agreement)'},
            {'percent': 50, 'from': '2026-06-01', 'to': None, 'basis': 'agreement', 'document': DOC_NG}]
    if lab in ('R2R PRODUCTION', '77 Records'):
        return [{'percent': 50, 'from': f, 'to': None, 'basis': 'owner_decision_2', 'document': DOC_OD2}]
    return [{'percent': 50, 'from': f, 'to': None, 'basis': 'assumption', 'document': DOC_ASM}]
strings = []
for k, v in sorted(S.items(), key=lambda kv: -kv[1]['net']):
    lab, kind, own, note = M[k]
    if kind == 'sublabel':
        rs = rules_for(lab)
        labels.setdefault(lab, {'name': lab, 'kind': 'sublabel', 'ownLabel': own, 'rules': rs,
                                'recipientPseudonym': lab + ' (owner of kind label; one pseudonym)'})
        main = rs[-1]
        rule = {'percent': main['percent'], 'from': main['from'], 'basis': main['basis']}
        extra = {'earlierRule': {'percent': 50, 'from': rs[0]['from'], 'to': rs[0]['to'], 'basis': rs[0]['basis']}} if lab == 'NoGhost' else {}
    else:
        labels.setdefault(lab, {'name': lab, 'kind': 'own', 'ownLabel': None, 'rules': []})
        rule = None; extra = {}
    e = {'string': k, 'norm': norm(k), 'net': str(v['net'].quantize(Decimal('0.01'))), 'firstMonth': v['mn'], 'lastMonth': v['mx'],
         'accounts': {a: {'net': str(x['net'].quantize(Decimal('0.01'))), 'firstMonth': x['mn'], 'lastMonth': x['mx']} for a, x in sorted(v['acc'].items())},
         'label': lab, 'kind': kind, 'ownLabel': own, 'rule': rule}
    e.update(extra)
    if note: e['note'] = note
    strings.append(e)
norms = [s['norm'] for s in strings]
by = {}
for s_ in strings: by.setdefault(s_['norm'], []).append(s_)
for n_, g in by.items():
    assert len({x['label'] for x in g}) == 1, n_
    if len(g) > 1:
        for x in g: x['normCollidesWith'] = [y['string'] for y in g if y is not x]
tot = sum(Decimal(s['net']) for s in strings)
out = {'source': 'ClickHouse believe.rows of the 47 loaded files joined to public.source_files (read-only), 2026-11-02',
       'totalNet': str(tot), 'stringCount': len(strings),
       'ownLabels': ['0to8', 'Echo8'],
       'labels': list(labels.values()), 'strings': strings}
json.dump(out, open(OUT, 'w'), ensure_ascii=False, indent=1)
print(len(strings), tot)
for s in strings: print(s['string'], '->', s['label'], s['kind'], s['ownLabel'], s['rule'])
