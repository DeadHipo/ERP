import re, json, sys
ST = '/private/tmp/claude-501/-Users-nearlydeadhipo-Desktop-0to8-ERP/441975a6-0f8b-4dbd-b984-d2856fc5b0b0/scratchpad/stage1/txt/'
ISRC = r'[A-Z]{2}[A-Z0-9]{3}\d{7}'
def parse(fn):
    t = open(ST + fn).read()
    i = t.index('SCHEDULE 1\nSCHEDULE OF PURCHASED') if 'SCHEDULE 1\nSCHEDULE OF PURCHASED' in t else t.rindex('SCHEDULE 1')
    j = t.find('SCHEDULE 2', i)
    s = re.sub(r'\s+', ' ', t[i:j if j > 0 else None])
    rows = []
    for m in re.finditer(r'(\d+) (.+?) ((?:%s(?:, )?)+) (\d+/\d+/\d+) (\d+(?:\.\d+)?)%%' % ISRC, s):
        for x in re.findall(ISRC, m.group(3)):
            rows.append({'row': int(m.group(1)), 'title': m.group(2).strip('" '), 'isrc': x, 'releaseDate': m.group(4), 'incomeParticipationPercent': float(m.group(5))})
    allisrc = set(re.findall(ISRC, s))
    return rows, allisrc, s
if __name__ == '__main__':
    for fn in ('03.txt', '04.txt'):
        r, a, s = parse(fn)
        print(fn, len(r), len({x['isrc'] for x in r}), len(a), sorted(a - {x['isrc'] for x in r})[:10])
