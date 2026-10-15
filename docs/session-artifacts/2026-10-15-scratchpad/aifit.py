"""Copy measured AI envelope fits from docs/vehicle-calibration.json into the
catalogue sheets of the given ids (lateral/braking base and aero terms, top
speed). Aero terms stay 0 for a machine without downforce."""
import json
import re
import sys

ids = sys.argv[1].split(',')
report = json.load(open('docs/vehicle-calibration.json'))['vehicles']
files = [
    'src/simulation/vehicle-catalogue/single-seaters.ts',
    'src/simulation/vehicle-catalogue/prototypes.ts',
    'src/simulation/vehicle-catalogue/gt-layouts.ts',
    'src/simulation/vehicle-catalogue/touring-club-2.ts',
    'src/simulation/vehicle-catalogue/dirt-2.ts',
    'src/simulation/vehicle-catalogue/experimental.ts',
    'src/simulation/vehicle-catalogue/road-festival.ts',
]
texts = {f: open(f).read() for f in files}
for vid in ids:
    entry = report[vid]
    lat = entry['lateralEnvelopeFit']
    brk = entry['brakingEnvelopeFit']
    top = [c for c in entry['comparison'] if c['metric'] == 'topSpeed'][0]['measured']
    cla = entry['aero']['clA']
    aero = cla > 0.05
    vals = {
        'lateralBase': f"{lat['base']:.2f}",
        'lateralAero': f"{lat['aero']:.5f}".rstrip('0') if aero else '0',
        'brakingBase': f"{brk['base']:.2f}",
        'brakingAero': f"{brk['aero']:.5f}".rstrip('0') if aero else '0',
        'topSpeed': str(round(top / 3.6)),
    }
    for k in ('lateralAero', 'brakingAero'):
        if vals[k].endswith('.'):
            vals[k] = vals[k][:-1]
    done = False
    for f, t in texts.items():
        i = t.find(f"  id: '{vid}',\n")
        if i < 0:
            continue
        j = t.index('  ai: {', i)
        k = t.index('\n  },', j)
        block = t[j:k]
        for key, v in vals.items():
            block, n = re.subn(rf"(\n    {key}: )[-0-9.e]+,", rf"\g<1>{v},", block)
            assert n == 1, (vid, key)
        texts[f] = t[:j] + block + t[k:]
        done = True
        print(vid, vals)
    assert done, vid
for f, t in texts.items():
    open(f, 'w').write(t)
