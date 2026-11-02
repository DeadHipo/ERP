#!/usr/bin/env python3 -I
"""Stage 4.3: participations and split rewrites as API-ready records (read-only sources)."""
import json, re, sys, csv, collections, datetime
sys.path.insert(0, '/Users/nearlydeadhipo/Desktop/0to8/ERP/packages/backend/scripts/mvp')
from common import *

art = {a[0]: {'id': a[0], 'pseudonym': a[1], 'merged': a[4]} for a in tsv('artists.tsv')}
def root(i):
    n = 0
    while art[i]['merged'] and n < 20: i = art[i]['merged']; n += 1
    return i
by_norm = collections.defaultdict(set)
for a in art.values(): by_norm[nn(a['pseudonym'])].add(root(a['id']))
def aid(name):
    c = by_norm.get(nn(name), set())
    exact = {root(i) for i, a in art.items() if a['pseudonym'] == name}
    if len(c) > 1 and len(exact) == 1: c = exact
    return sorted(c)[0] if len(c) == 1 else None
def who(name):
    i = aid(name)
    return {'pseudonym': name, 'artistId': i, 'toCreate': i is None}
doctab = {d[0]: {'id': d[0], 'kind': d[1], 'title': d[2], 'ref': d[3]} for d in tsv('docs.tsv')}
shares = collections.defaultdict(list)
for s in tsv('shares.tsv'): shares[s[0]].append((root(s[1]), float(s[2]), None if s[3] == '\\N' else s[3]))
spl = collections.defaultdict(list)
for s in tsv('splits.tsv'):
    sid, isrc, vf, vt, doc, origin, note = (s + [''] * 7)[:7]
    spl[isrc].append({'id': sid, 'validFrom': vf, 'validTo': vt or None, 'documentId': doc or None, 'origin': origin, 'rows': shares.get(sid, [])})
for v in spl.values(): v.sort(key=lambda x: x['validFrom'])
tracks = {}
for t in tsv('tracks.tsv'): tracks.setdefault(t[1], t)
cov = {r[0]: r for r in jl('Coverage_by_recording.json')[2:] if r[0] and len(str(r[0])) == 12}
annex = [r for r in jl('Splits_by_ISRC.json')[2:] if r[0] and len(str(r[0])) == 12]
ids = loaded_ids()

def erp_now(isrc):
    """the ERP split in force at 2026-08-01 and its rows."""
    best = None
    for s in spl.get(isrc, []):
        if s['validFrom'] <= '2026-08-01' and (s['validTo'] is None or '2026-08-01' < s['validTo']): best = s
    if not best: return None
    d = doctab.get(best['documentId'] or '', {})
    return {'splitId': best['id'], 'validFrom': best['validFrom'], 'origin': best['origin'], 'document': d.get('title'), 'documentId': best['documentId'],
            'rows': [{'artistId': a, 'pseudonym': art[a]['pseudonym'], 'percent': p, 'rowDocumentId': rd, 'rowDocument': doctab.get(rd or '', {}).get('title')} for a, p, rd in best['rows'] if p > 0]}
def title_of(isrc):
    return (cov[isrc][4] if isrc in cov else None) or (tracks[isrc][3] if isrc in tracks else None)
def first_month(isrcs):
    r = ch("select isrc, toString(min(reporting_month)) mn, toString(sum(net_revenue)) net from believe.rows where file_id in (%s) and isrc in (%s) group by isrc format JSONEachRow" % (q(ids), q(isrcs)))
    return {x['isrc']: x for x in r}
def clean_isrc(s): return re.sub(r'[^A-Z0-9]', '', s.upper())
def add_years(iso, n):
    y, m, d = map(int, iso.split('-'))
    try: return datetime.date(y + n, m, d).isoformat()
    except ValueError: return datetime.date(y + n, m, 28).isoformat()

recs = []; rewrites = []; unresolved = []
def rec(group, isrc, recipient, percent, base, funded, fromA, vf, vt, document, basis, notes=None, **extra):
    r = {'id': '%s:%s:%s' % (group, isrc or '-', nn(recipient['pseudonym']).replace(' ', '-')[:24] + ('' if not fromA else '<' + nn(fromA['pseudonym']).replace(' ', '-')[:12])),
         'group': group, 'isrc': isrc, 'title': title_of(isrc) if isrc else None, 'recipient': recipient, 'percent': percent, 'base': base,
         'fundedFrom': funded, 'fromArtist': fromA, 'fromArtistName': fromA['pseudonym'] if fromA else None, 'validFrom': vf, 'validTo': vt,
         'document': document, 'basis': basis}
    if notes: r['notes'] = notes
    if isrc:
        now = erp_now(isrc)
        r['erpSplitNow'] = now
        if now:
            row = [x for x in now['rows'] if recipient['artistId'] and x['artistId'] == recipient['artistId']]
            if row:
                r['recipientIsSplitRowNow'] = {'percent': row[0]['percent'], 'rule': 'a pseudonym is a row or a participation on an ISRC and date, never both (10 §1): remove the row in the same change, or enter the participation under a second pseudonym of the same owner'}
        r['erpTrack'] = isrc in tracks
    r.update(extra)
    recs.append(r)

# ---------- 1. Kenke / Eiden XII (net, top) 15
DOC_KENKE = {'title': 'Settlement and Derivative Authorization Agreement (Kenke), 2026-07-27, executed by both parties 2026-10-31', 'ref': 'PandaDoc FYKSA-VGM8W-APJGF-JWBPQ', 'path': 'context_data/PandaDoc_documents_0 (2)/Root/0to8 Derivative Remix Agreement Kenke.pdf'}
DOC_EIDEN = {'title': 'Derivative Authorization Agreement (Eiden XII), 2026-06-10, executed by both parties 2026-06-10', 'ref': 'Docusign B362C612-B8A2-8A1C-819B-F68DB3598163', 'path': None, 'pathNote': 'the agreement file is not in the folders (09 M4); the Annex Sch3A row and owner answer 5 are the only sources'}
da = [r for r in jl('Derivative_authorisations.json')[2:] if r[0] and len(str(r[0])) == 12]
auth = [r for r in da if r[1] == 'authorised']
fm = first_month([r[0] for r in auth])
for r in auth:
    kenke = 'Kenke' in r[4]
    rec('remixer_top', r[0], who('Kenke' if kenke else 'Eiden XII'), 15, 'net', 'top', None, fm[r[0]]['mn'], None, DOC_KENKE if kenke else DOC_EIDEN,
        'owner_decision_5',
        'retro: the agreement says it includes revenue earned before its date, so validFrom is the first month of receipts (%s); the remaining 85%% is split in the previous proportion (label 42.5 on 50/50)' % fm[r[0]]['mn'],
        agreementDate=r[6], annexReceipts=r[10], believeNet=fm[r[0]]['net'])

# ---------- 2. Sleeping City Funk
SCF = ['DGA062593862', 'DGA062593863', 'DGA062593864']
DOC_JET = {'title': 'JET MUSIC GROUP Sample License OT08, Sleeping City Funk (MC MAGRINHO), 16 February 2026', 'path': 'context_data/PandaDoc_documents_0 (2)/Root/JET MUSIC GROUP_Sample_License_OT08_Sleeping City Funk _MC_MAGRINHO_.pdf'}
DOC_DENNY = {'title': 'Master and Publishing Use Licence Confirmation Letter #090926 MC Denny (Sleeping City Funk)', 'path': 'context_data/для_разработчика_37_документов_2026-11-02/3.5 Not yet documented (featured vocalists, cleared by licence)/MASTER AND PUBLISHING USE LICENSE CONFIRMATION LETTER #090926MC Denny (Sleeping City Funk).pdf'}
fm = first_month(SCF)
amap = {}
for r in annex:
    if r[0] in SCF: amap.setdefault(r[0], r)
for isrc in SCF:
    ar = amap[isrc]
    now = erp_now(isrc)
    credit_order = [x.strip() for x in str(ar[2]).split(',')]
    artists3 = [x for x in credit_order if x in ('DJ Raulipues', 'DJ FANGZ', 'TrongKien')]
    pct = [16.666666, 16.666667, 16.666667]
    # Annex printed rows named, the duplicate Fangz row named
    printed = [x.strip() for x in str(ar[5]).split(';')]
    dup = [x for x in printed if x.startswith('Fangz ')]
    vf = fm[isrc]['mn']
    rewrites.append({'group': 'sleeping_city_funk', 'isrc': isrc, 'title': ar[1], 'validFrom': vf,
        'basis': 'owner_decision_4 (label share 50, not diluted by MC and co-authors); Annex Sch3A row 9',
        'annexRowsPrinted': printed, 'annexLabelShare': ar[7], 'annexPeriod': ar[8],
        'duplicateRowToRemove': ('Annex prints both "DJ FANGZ 16.6%%" and "%s" for the one artist credited as DJ FANGZ; the duplicate is the second one ("%s"), it is what makes the label 45.8 instead of 50' % (dup[0], dup[0])) if (dup and any(x.startswith('DJ FANGZ') for x in printed)) else ('no duplicate row on this version (Annex prints "%s" for the artist, no "DJ FANGZ" row; label 50.1)' % (dup[0] if dup else '-')),
        'artistIdsByPseudonym': {'DJ FANGZ': aid('DJ FANGZ'), 'Fangz': aid('Fangz')},
        'erpRowsNow': now['rows'] if now else None, 'erpSplitNow': {k: now[k] for k in ('splitId', 'validFrom', 'origin', 'document')} if now else None,
        'artistRowsAfter': [{'pseudonym': n, 'artistId': aid(n), 'percent': p} for n, p in zip(['DJ Raulipues', 'DJ FANGZ', 'TrongKien'], pct)],
        'rowsLeavingTheSplit': [{'pseudonym': n, 'artistId': aid(n)} for n in ('MC MAGRINHO', 'Mc Denny')],
        'percentOrderNote': '16.666666 goes to the first credited artist (DJ Raulipues), 16.666667 to the other two; sum 50.000000; after the 26 pp pool carve each artist keeps 8 (label 50)'})
    for n, doc, who_ in (('MC MAGRINHO', DOC_JET, 'jet'), ('Mc Denny', DOC_DENNY, 'denny')):
        rec('sleeping_city_funk_mc', isrc, who(n), 13, 'net', 'artist_pool', None, vf, None, doc, 'owner_decision_4 + Annex Sch3A row 9',
            'the MC row leaves the split in the same change (ERP holds it as a split row of net today); artists keep 8 each, label 50', mcRowInSplitNow=bool(now and any(x['pseudonym'] == n for x in now['rows'])))

# ---------- 3. Settlement 15 (net, label_share) from 2026-02
R = json.load(open(SP + '/v7_Sch3AРоялти.json'))[2:]
sett = collections.OrderedDict()
for r in R:
    if str(r[0]).startswith('LAS CANCIONES') and str(r[5]) == '15.0' and str(r[14]).startswith('2026-02'):
        sett[r[2]] = r
allsett = {r[2] for r in R if str(r[0]).startswith('LAS CANCIONES')}
DOC_SET = {'title': 'Confidential settlement and mutual release, 27 February 2026 (the file name carries the counterparty legal name, not reproduced)', 'path': 'context_data/для_разработчика_37_документов_2026-11-02/3.11 Disputes/<settlement, 27.02.2026>.pdf', 'pack': 'P14 / 3.11 Disputes'}
for isrc in sett:
    rec('settlement_15', isrc, who('LAS CANCIONES DE ALFREDO LARIN'), 15, 'net', 'label_share', None, '2026-02-01', None, DOC_SET, 'owner_decision_6 + contract',
        'from 2026-02-01 (owner decision 6: 15%% from 2026-02-27, floored to the month start by M52); before that the share was settled by the lump (USD 100,000) which is a document only; the label pays from its share (on 50/50: participant 15, artists 50, label 35)',
        v7Period=sett[isrc][14], inV7Registry=True)
settlement_extra = {'isrcCount': len(sett), 'isrcInAnyV7Row': len(allsett), 'isrcOnlyBeforeFeb2026': sorted(allsett - set(sett)),
    'source': 'registry v7 sheet "Sch3A Роялти" rows of the recipient with rate 15 and period starting 2026-02 (the Annex Sch3A row 3 lists no ISRC; v7 Sch3A "Участия вне сплита" says 30 recordings)',
    'lump': 'USD 100,000 is the consideration for past uses: a document only, no money row (M33, 11 plan 4.5)'}
rows_now = {isrc: erp_now(isrc) for isrc in sett}
settlement_extra['isrcWithRecipientAsSplitRowNow'] = sorted(i for i, n in rows_now.items() if n and any(x['pseudonym'] == 'LAS CANCIONES DE ALFREDO LARIN' for x in n['rows']))

# ---------- 4. Maximum Madness (3y from release), Matra (5y from agreement), XENO XID
T = json.load(open(SP + '/part_texts.json'))
# catalogue export: UPC -> release date
cat = {}
with open(ROOT + '/context_data/20261102_my_catalog_export.csv', encoding='utf-8-sig') as f:
    for row in csv.DictReader(f, delimiter=';'):
        upc = re.sub(r'\D', '', row['UPC']); d = row['Release date / Hour / Time zone'][:10]
        if upc and (upc not in cat or d < cat[upc]): cat[upc] = d
PAT = re.compile(r'([A-Z]{2}-[A-Z0-9]{3}-\d\d-\d{5}) (\d\d)/(\d\d)/(\d{4}) (\d+(?:[.,]\d+)?)%')
def sched_rows(txt):
    rows = []; last = 0
    for m in PAT.finditer(txt):
        title = re.sub(r'Document Ref: \S+ Page \d+ of \d+', '', txt[last:m.start()]).strip()
        rows.append({'title': title[-90:], 'isrc': clean_isrc(m.group(1)), 'releaseDate': '%s-%s-%s' % (m.group(4), m.group(2), m.group(3)), 'percent': float(m.group(5).replace(',', '.'))})
        last = m.end()
    return rows
# Maximum Madness
mm_txt = [v for k, v in T.items() if 'Maximum Madness' in k][0]
i0 = mm_txt.find('Schedule A –')
mm_rows = sched_rows(mm_txt[i0:])
mm_isrcs = sorted({r['isrc'] for r in mm_rows})
DOC_MM = {'title': 'A&R Royalty Participation Agreement #200625 Maximum Madness, 20 June 2025 (completed 2026-07-09)', 'ref': 'WBPHR-EG7EC-8QU4W-6J7HR', 'path': 'context_data/PandaDoc_documents_0 (2)/Root/A&R Royalty Participation Agreement_#200625Maximum Madness.pdf'}
mm_seen = {}
for r in mm_rows: mm_seen.setdefault(r['isrc'], r)
for isrc, r in sorted(mm_seen.items()):
    upc = (cov[isrc][6] if isrc in cov else (tracks[isrc][2] if isrc in tracks else None))
    catd = cat.get(re.sub(r'\D', '', str(upc))) if upc else None
    vt = add_years(r['releaseDate'], 3)
    rec('maximum_madness', isrc, who('maximum_madness' if aid('maximum_madness') else 'Maximum Madness'), r['percent'], 'bucket', 'label_share', None, month_of(r['releaseDate']), month_of(vt), DOC_MM, 'contract',
        '3 years from the commercial release date in Schedule A (%s .. %s), floored to month starts (the release month is the participant\'s, the expiry month is the label\'s, M52)' % (r['releaseDate'], vt),
        scheduleReleaseDate=r['releaseDate'], catalogueReleaseDate=catd, releaseDateMatchesCatalogue=(catd == r['releaseDate'] if catd else None), upc=upc, inAnnexPerimeter=isrc in cov)
# Matra
DOC_MATRA = lambda f: {'title': 'Promotion & Royalty Participation Agreement Matra, 15 May 2026 + %s' % f.replace('.pdf', ''), 'path': 'context_data/PandaDoc_documents_0 (2)/Root/' + f, 'mainAgreement': '_Social Media Royalty Participation Agreement_Matra (4).pdf', 'schedulesSigned': '2026-07-09'}
matra = {}
conf = []
for fn in ('Social Media Royalty Participation Agreement_Schedule А_Matra!.pdf', 'Social Media Royalty Participation Agreement_Schedule A2_Matra!.pdf', 'Social Media Royalty Participation Agreement_Schedule А_3_Matra!.pdf'):
    for r in sched_rows(T[fn]):
        if r['isrc'] in matra and abs(matra[r['isrc']]['percent'] - r['percent']) > 1e-9: conf.append((r['isrc'], matra[r['isrc']]['percent'], r['percent'], fn))
        matra[r['isrc']] = dict(r, file=fn)
matra_eff = '2026-05-15'
for isrc, r in sorted(matra.items()):
    rec('matra', isrc, who('Matra!'), r['percent'], 'bucket', 'label_share', None, month_of(matra_eff), month_of(add_years(matra_eff, 5)), DOC_MATRA(r['file']), 'contract',
        '5 years from the agreement (Effective Date 2026-05-15 .. 2031-05-15) floored to month starts; recordings released before the Effective Date are in the schedule too, the participation starts at the Effective Date month; USD 5,000 advance recoupable from this participation only (Sch3B scope any on the pseudonym), USD 300 per release is an operation',
        scheduleReleaseDate=r['releaseDate'], inAnnexPerimeter=isrc in cov)
# XENO XID: schedule absent
xeno_cands = sorted({r[0] for r in annex if 'XENO XID' in str(r[2])})
unresolved.append({'group': 'xeno_xid', 'recipient': who('XENO XID'), 'percent': None, 'base': 'bucket', 'fundedFrom': 'label_share',
    'validFrom': '2026-06-01', 'validTo': '2031-06-01', 'document': {'title': 'Promotion & Royalty Participation Agreement #030626 XENO XID, 03 June 2026 (completed 2026-07-09)', 'ref': 'W9XXY-TSXMK-NFEYW-EVWDL', 'path': 'context_data/PandaDoc_documents_0 (2)/Root/Social Media Royalty Participation Agreement_#030626XENO XID_.pdf'},
    'basis': 'contract',
    'reason': 'Schedule A (the ISRC list and "the royalty participation rate set forth in Schedule A") is not in the 3-page PDF and no other file holds it; v7 registry has no participation row for it. Window is 5 years from the Effective Date 2026-06-03 (floored). USD 12,500 advance, recoupable (Sch3B).',
    'annexIsrcCreditingXenoXid': len(xeno_cands), 'needs': 'the owner sends Schedule A (ISRC, rate)'})

# ---------- 5. era (bucket, artist_share)
DOC_ERA = {'title': 'Exclusive Master Purchase Agreement #021026 era (1 beat, outright buyout; consideration = 10% of the Artist\'s Share of net receipts of the track "Оружие"), effective 2026-10-02', 'ref': 'YCA2W-HRQAP-OPJVG-AEKP7', 'path': 'context_data/PandaDoc_documents_0 (2)/Root/Exclusive Master Purchase Agreement #021026era.pdf'}
ERA_ISRC = 'FRX872651632'
now = erp_now(ERA_ISRC)
annex_era = [r for r in annex if r[0] == ERA_ISRC][0]
for n in ('RMW', '@тундра'):
    rec('era', ERA_ISRC, who('@era'), 10, 'bucket', 'artist_share', who(n), '2026-10-01', None, DOC_ERA, 'contract',
        '10% of each credited artist\'s amount on this one release (the agreement says 10% of "the Artist\'s Share"; two artist rows, so one participation per row, 10% of each = 10% of the artists\' total); not remixes or re-releases; the track has no loaded Believe lines yet (released 2026-10-07)',
        annexRowsPrinted=annex_era[5], annexLabelShare=annex_era[7], releaseDateCatalogue='2026-10-07')

# ---------- 6. floor titles Trilalero and MALAME: scaled rows
def scaled(rows):
    tot = sum(p for _, p in rows)
    out = [round(p * 50 / tot + 1e-12, 6) for _, p in rows]
    diff = round(50 - sum(out), 6)
    out[-1] = round(out[-1] + diff, 6)
    return out
floor = collections.OrderedDict()
for r in annex:
    t = nn(r[1])
    key = 'trilalero' if 'trilalero tramalima funk' in t else ('malame' if 'funk do malame amarelo' in t else None)
    if not key: continue
    if str(r[5]) in ('None', 'no split line on this code'): continue
    rows = [(m.group(1).strip(), float(m.group(2))) for m in (re.fullmatch(r'(.+?) ([\d.]+)%', x.strip()) for x in str(r[5]).split(';')) if m]
    if not rows: continue
    new = scaled(rows)
    now = erp_now(r[0])
    floor.setdefault((r[0], r[8]), None)
    rewrites.append({'group': 'floor_' + key, 'isrc': r[0], 'title': r[1], 'validFrom': parse_period(r[8])[0],
        'basis': 'owner_decision_4 (label 50, participants reduced proportionally)', 'annexPeriod': r[8], 'annexLabelShare': r[7],
        'sourceRowsPrinted': [{'pseudonym': n, 'percent': p, 'artistId': aid(n)} for n, p in rows], 'sumPrinted': round(sum(p for _, p in rows), 6),
        'rowsAfter': [{'pseudonym': n, 'artistId': aid(n), 'percent': p2} for (n, _), p2 in zip(rows, new)], 'sumAfter': round(sum(new), 6),
        'sourceRowsNamed': 'registry rows "%s" (Annex "Splits by ISRC", Source "%s")' % (r[5], r[9]),
        'erpRowsNow': now['rows'] if now else None, 'erpSplitNow': {k: now[k] for k in ('splitId', 'validFrom', 'origin', 'document', 'documentId')} if now else None,
        'changed': any(abs(a - b) > 1e-9 for a, b in zip(new, [p for _, p in rows])), 'keepOriginalDocument': True})
out = {'generated': '2026-11-02',
 'notes': ['Percents are stored with 6 decimals; validFrom/validTo are month starts (valid_to exclusive, M52).',
           'recipient.toCreate true means the pseudonym does not exist in owners.artists yet (an owner of the right kind and the pseudonym must be created first).',
           'fromArtist is only for fundedFrom=artist_share. recipientIsSplitRowNow marks the M43 conflict.',
           'Privacy: stage names only; the legal names printed in the agreements and in Annex Sch3A are not reproduced.'],
 'participations': recs, 'splitRewrites': rewrites, 'unresolved': unresolved,
 'settlement': settlement_extra,
 'scheduleConflicts': [{'isrc': a, 'was': b, 'now': c, 'file': d} for a, b, c, d in conf],
 'counts': dict(collections.Counter(r['group'] for r in recs)), 'rewriteCounts': dict(collections.Counter(r['group'] for r in rewrites)),
 'coOwnership': 'not extracted: "co-ownership routed through #1" (6 agreements, 09 M14) was not in the task list; no ISRC in the royalty clause'}
json.dump(out, open(OUT + '/participations.json', 'w'), ensure_ascii=False, indent=1)
print(out['counts'], out['rewriteCounts'], settlement_extra['isrcCount'], settlement_extra['isrcInAnyV7Row'], len(conf))
print('MM',len(mm_seen),'matra',len(matra),'toCreate',sorted({r['recipient']['pseudonym'] for r in recs if r['recipient']['toCreate']}))
print('conflicts split row', sum(1 for r in recs if r.get('recipientIsSplitRowNow')), collections.Counter(r['group'] for r in recs if r.get('recipientIsSplitRowNow')))
