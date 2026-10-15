"""Write measured calibration fits into the catalogue sheets' AI envelopes."""
import json
import os
import re

os.chdir('/home/user/Experiment-3/.claude/worktrees/agent-ac7432dc5f9d804f3')
report = json.load(open('docs/vehicle-calibration.json'))['vehicles']
files = ['formula.ts', 'endurance.ts', 'gt.ts', 'touring-club.ts', 'dirt.ts', 'small-road.ts']
for f in files:
    p = 'src/simulation/vehicle-catalogue/' + f
    s = open(p).read()
    for vid, v in report.items():
        key = "id: '%s'" % vid
        if key not in s:
            continue
        i = s.index(key)
        j = s.index('  ai: {', i)
        k = s.index('  },', j) + 4
        block = s[j:k]
        downforce = (v['aero']['clA'] or 0) > 0.05
        lat, brk = v['lateralEnvelopeFit'], v['brakingEnvelopeFit']
        top = next(c for c in v['comparison'] if c['metric'] == 'topSpeed')['measured'] / 3.6

        def put(block, name, value):
            return re.sub(r'(%s: )[^,\n]+,' % name, r'\g<1>%s,' % value, block, count=1)

        block = put(block, 'lateralBase', '%.2f' % lat['base'])
        block = put(block, 'lateralAero', ('%.5f' % lat['aero']) if downforce else '0')
        block = put(block, 'brakingBase', '%.2f' % brk['base'])
        block = put(block, 'brakingAero', ('%.5f' % brk['aero']) if downforce else '0')
        block = put(block, 'topSpeed', '%d' % round(top))
        s = s[:j] + block + s[k:]
    open(p, 'w').write(s)
