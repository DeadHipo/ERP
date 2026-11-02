#!/usr/bin/env python3 -I
"""Stage 4.x: perimeter exclusions (Duetti sale, withdrawn, derivatives outside authorisation, Echo8 repertoire)."""
import json, sys, collections
sys.path.insert(0, '/Users/nearlydeadhipo/Desktop/0to8/ERP/packages/backend/scripts/mvp')
from common import *
import duetti_schedule as D

S = [r for r in jl('Sch1B_Excluded_register.json')[2:] if r[0] and len(str(r[0])) == 12]
cov = {r[0]: r for r in jl('Coverage_by_recording.json')[2:] if r[0] and len(str(r[0])) == 12}
ids = loaded_ids(); ids_echo = loaded_ids('1055956')
tracks = {}
for t in tsv('tracks.tsv'): tracks.setdefault(t[1], t)
art = {a[0]: a[1] for a in tsv('artists.tsv')}
shares = collections.defaultdict(list)
for s in tsv('shares.tsv'): shares[s[0]].append((s[1], float(s[2])))
spl = collections.defaultdict(list)
for s in tsv('splits.tsv'): spl[s[1]].append((s[2], s[0]))
def last_rows(isrc):
    if isrc not in spl: return None
    vf, sid = sorted(spl[isrc])[-1]
    return {'validFrom': vf, 'rows': [{'pseudonym': art[a], 'percent': p} for a, p in shares.get(sid, []) if p > 0]}

def nets(isrcs, from_month=None):
    isrcs = list(isrcs); out = {}
    for i in range(0, len(isrcs), 400):
        part = isrcs[i:i + 400]
        w = " and reporting_month >= '%s'" % from_month if from_month else ''
        for x in ch("select isrc, toString(sum(net_revenue)) net, toString(min(reporting_month)) mn, toString(max(reporting_month)) mx from believe.rows where file_id in (%s) and isrc in (%s)%s group by isrc format JSONEachRow" % (q(ids), q(part), w)):
            out[x['isrc']] = x
    return out

# ---- Duetti
r3, a3, _ = D.parse('03.txt'); r4, a4, _ = D.parse('04.txt')
p03 = {x['isrc']: x for x in r3}
rel4 = {}
DU = [r for r in S if 'Duetti' in str(r[4])]
inst = {'P03': {'agreement': 'Duetti Master Purchase Agreement - DJ Ikeraus', 'effectiveDate': '2026-05-08', 'effectiveMonth': '2026-05-01', 'purchasePrice': 255000, 'pack': 'P03 (3.3 Duetti carve-out)', 'path': 'context_data/для_разработчика_37_документов_2026-11-02/3.3 Duetti carve-out/Duetti Master Purchase Agreement - DJ Ikeraus.pdf', 'scheduleIsrc': len(a3)},
        'P04': {'agreement': 'Duetti Master Purchase Agreement - Lxzt', 'effectiveDate': '2026-06-01', 'effectiveMonth': '2026-06-01', 'purchasePrice': 420000, 'pack': 'P04 (3.3 Duetti carve-out)', 'path': 'context_data/для_разработчика_37_документов_2026-11-02/3.3 Duetti carve-out/Duetti Master Purchase Agreement - Lxzt.pdf', 'scheduleIsrc': len(a4)}}
net_all = nets([r[0] for r in DU])
dl = []
for r in DU:
    i = r[0]
    if i in a3: pk, how = 'P03', 'Schedule 1 of the agreement'
    elif i in a4: pk, how = 'P04', 'Schedule 1 of the agreement'
    else:
        txt = (str(r[1]) + ' ' + str(r[2])).lower()
        if 'lxzt' in txt: pk, how = 'P04', 'derivative of a sold master, assigned by artist/title (Lxzt)'
        elif 'ikeraus' in txt: pk, how = 'P03', 'derivative of a sold master, assigned by artist/title (DJ Ikeraus)'
        else: pk, how = None, 'unassigned'
    em = inst[pk]['effectiveMonth'] if pk else None
    e = {'isrc': i, 'title': r[1], 'artists': r[2], 'instrument': pk, 'assignedBy': how, 'saleEffectiveDate': inst[pk]['effectiveDate'] if pk else None,
         'saleEffectiveMonth': em, 'category': r[5], 'source': r[6], 'removedFromAnnex20261102': 'decision of 2 November 2026' in str(r[6]),
         'incomeParticipationBackPercent': p03[i]['incomeParticipationPercent'] if i in p03 else None,
         'believeNetAllMonths': net_all.get(i, {}).get('net'), 'believeFirstMonth': net_all.get(i, {}).get('mn'), 'believeLastMonth': net_all.get(i, {}).get('mx'),
         'erpTrack': i in tracks, 'erpLastSplit': last_rows(i)}
    dl.append(e)
net_after = {}
for pk in ('P03', 'P04'):
    sel = [e['isrc'] for e in dl if e['instrument'] == pk]
    net_after.update(nets(sel, inst[pk]['effectiveMonth']))
from decimal import Decimal
for e in dl:
    e['believeNetFromSaleMonth'] = net_after.get(e['isrc'], {}).get('net')
tot = {pk: str(sum(Decimal(e['believeNetFromSaleMonth'] or 0) for e in dl if e['instrument'] == pk)) for pk in ('P03', 'P04')}
duetti = {'instruments': inst, 'count': len(dl), 'byInstrument': dict(collections.Counter(e['instrument'] for e in dl)), 'byAssignment': dict(collections.Counter(e['assignedBy'] for e in dl)),
          'removedFromAnnex20261102': sum(1 for e in dl if e['removedFromAnnex20261102']),
          'participationBackNote': 'P03 Schedule 1 carries a per-ISRC income participation back to the seller (0%% on %d rows, 35%% on %d, 50%% on %d); P04 Schedule 1 carries none in its ISRC table (see its Schedule 2); the participation back is a later income source, not a split row' % (sum(1 for x in r3 if x['incomeParticipationPercent'] == 0), sum(1 for x in r3 if x['incomeParticipationPercent'] == 35), sum(1 for x in r3 if x['incomeParticipationPercent'] == 50)),
          'believeNetFromSaleMonth': tot, 'rule': '09 M28: from saleEffectiveMonth the split of each sold ISRC becomes 100% to the buyer pseudonym (document = the sale); the Believe lines continue until the delivery agreement ends (~2026-11-02)', 'isrc': dl}

# ---- withdrawn / other
wd = []
for r in S:
    if r[4] in ('withdrawn recordings', 'other expressly excluded recordings'):
        wd.append({'isrc': r[0], 'title': r[1], 'artists': r[2], 'imprint': r[3], 'category': r[4], 'reason': r[5], 'source': r[6], 'erpTrack': r[0] in tracks, 'erpLastSplit': last_rows(r[0])})
nw = nets([w['isrc'] for w in wd])
for w in wd: w['believeNet'] = nw.get(w['isrc'], {}).get('net')

# ---- derivatives outside the authorisation
da = [r for r in jl('Derivative_authorisations.json')[2:] if r[0] and len(str(r[0])) == 12 and r[1] != 'authorised']
nd = nets([r[0] for r in da])
dv = []
for r in da:
    rem = 'Kenke' if 'Kenke' in r[4] else 'Eiden XII'
    dv.append({'isrc': r[0], 'title': r[2], 'upc': r[3], 'remixer': rem, 'agreementDate': r[6], 'annexReceipts': r[10], 'believeNet': nd.get(r[0], {}).get('net'),
               'erpTrack': r[0] in tracks,
               'trackNote': 'Derivative outside the %s authorisation (clause 5.1: altered-speed versions and videos are excluded); no remixer share is paid on this recording; money follows the ordinary split' % rem})
dvt = str(sum(Decimal(d['believeNet'] or 0) for d in dv))

# ---- Echo8 repertoire (for the stage-5 comparison filter)
ec = [r for r in S if r[4] == 'identified Echo8 repertoire']
eis = {r[0] for r in ec}
echo_list = [{'isrc': r[0], 'imprint': r[3], 'reason': r[5]} for r in ec]
acc = ch("select isrc, toString(sum(net_revenue)) net from believe.rows where file_id in (%s) group by isrc format JSONEachRow" % q(ids_echo))
acc_isrc = {x['isrc'] for x in acc if x['isrc']}
not_in = sorted(i for i in acc_isrc if i not in eis and i not in cov)
echo = {'count': len(echo_list), 'byImprint': dict(collections.Counter(e['imprint'] for e in echo_list)), 'isrc': echo_list,
        'echo8AccountIsrcDistinct': len(acc_isrc), 'echo8AccountIsrcNotInSch1BNotInPerimeter': len(not_in),
        'echo8AccountIsrcNotInSch1BNotInPerimeterNet': str(sum(Decimal(x['net']) for x in acc if x['isrc'] in set(not_in))),
        'echo8AccountIsrcInOurPerimeter': len([i for i in acc_isrc if i in cov]),
        'note': 'the filter for the stage-5 comparison with the Annex: drop these ISRC (and Duetti and withdrawn) from the ERP side before comparing to the 10,228 perimeter; the Echo8-account ISRC not in Sch1B and not in the perimeter are listed by count so the comparison can report them as "outside both"'}
fam = ch("select isrc, toString(sum(net_revenue)) net from believe.rows where file_id in (%s) and label_name in ('Echo8','qaraqshy records','fate music','CATCORE','SF Records') and isrc != '' group by isrc format JSONEachRow" % q(ids))
echo['believeEchoFamilyIsrc'] = {'definition': 'distinct ISRC with at least one Believe line whose label_name is Echo8, qaraqshy records, fate music, CATCORE or SF Records, in either account (loaded files)',
    'count': len(fam), 'net': str(sum(Decimal(x['net']) for x in fam)), 'inSch1B': sum(1 for x in fam if x['isrc'] in eis), 'notInSch1B': sum(1 for x in fam if x['isrc'] not in eis),
    'inOurPerimeter': sum(1 for x in fam if x['isrc'] in cov), 'isrc': [{'isrc': x['isrc'], 'net': x['net'], 'inSch1B': x['isrc'] in eis, 'inOurPerimeter': x['isrc'] in cov} for x in fam]}
echo['believeEchoFamilyIsrc']['notInSch1BNet'] = str(sum(Decimal(x['net']) for x in fam if x['isrc'] not in eis))
out = {'generated': '2026-11-02', 'duetti': duetti, 'withdrawn': wd, 'derivativeOutsideAuthorisation': {'count': len(dv), 'believeNetTotal': dvt, 'isrc': dv},
       'echo8Repertoire': echo, 'other': {'sch1bCategories': dict(collections.Counter(r[4] for r in S))}}
json.dump(out, open(OUT + '/exclusions.json', 'w'), ensure_ascii=False, indent=1)
print(echo['believeEchoFamilyIsrc']['count'],echo['believeEchoFamilyIsrc']['inSch1B'],echo['believeEchoFamilyIsrc']['inOurPerimeter'],echo['believeEchoFamilyIsrc']['notInSch1BNet'],echo['echo8AccountIsrcNotInSch1BNotInPerimeterNet']); print(duetti['count'], duetti['byInstrument'], duetti['byAssignment'], duetti['removedFromAnnex20261102'], tot, len(wd), len(dv), dvt, echo['count'], echo['echo8AccountIsrcDistinct'], echo['echo8AccountIsrcNotInSch1BNotInPerimeter'], echo['echo8AccountIsrcInOurPerimeter'])
