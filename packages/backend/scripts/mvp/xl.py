import zipfile, re, sys
import xml.etree.ElementTree as ET
NS={'m':'http://schemas.openxmlformats.org/spreadsheetml/2006/main','r':'http://schemas.openxmlformats.org/officeDocument/2006/relationships'}
def col(ref):
    s=re.match(r'[A-Z]+',ref).group(0); n=0
    for c in s: n=n*26+ord(c)-64
    return n-1
def load(path):
    z=zipfile.ZipFile(path)
    ss=[]
    if 'xl/sharedStrings.xml' in z.namelist():
        for si in ET.fromstring(z.read('xl/sharedStrings.xml')).findall('m:si',NS):
            ss.append(''.join(t.text or '' for t in si.iter('{%s}t'%NS['m'])))
    wb=ET.fromstring(z.read('xl/workbook.xml'))
    rels={r.get('Id'):r.get('Target') for r in ET.fromstring(z.read('xl/_rels/workbook.xml.rels'))}
    out={}
    for s in wb.find('m:sheets',NS):
        t=rels[s.get('{%s}id'%NS['r'])]
        t=t.lstrip('/'); t=t if t.startswith('xl/') else 'xl/'+t
        out[s.get('name')]=(t,z,ss)
    return out
def rows(entry):
    t,z,ss=entry
    for ev,el in ET.iterparse(z.open(t)):
        if el.tag=='{%s}row'%NS['m']:
            r=[]
            for c in el.findall('m:c',NS):
                i=col(c.get('r')); 
                while len(r)<=i: r.append(None)
                v=c.find('m:v',NS); ty=c.get('t')
                if ty=='inlineStr': val=''.join(x.text or '' for x in c.iter('{%s}t'%NS['m']))
                elif v is None: val=None
                elif ty=='s': val=ss[int(v.text)]
                elif ty in('str','b','e'): val=v.text
                else:
                    try: val=float(v.text)
                    except: val=v.text
                r[i]=val
            yield r
            el.clear()

def rows_n(entry):
    """Like rows(), but yields (sheet row number, cells)."""
    t,z,ss=entry
    for ev,el in ET.iterparse(z.open(t)):
        if el.tag=='{%s}row'%NS['m']:
            rn=int(el.get('r')); r=[]
            for c in el.findall('m:c',NS):
                i=col(c.get('r'))
                while len(r)<=i: r.append(None)
                v=c.find('m:v',NS); ty=c.get('t')
                if ty=='inlineStr': val=''.join(x.text or '' for x in c.iter('{%s}t'%NS['m']))
                elif v is None: val=None
                elif ty=='s': val=ss[int(v.text)]
                elif ty in('str','b','e'): val=v.text
                else:
                    try: val=float(v.text)
                    except: val=v.text
                r[i]=val
            yield rn,r
            el.clear()
