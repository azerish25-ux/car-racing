import json
d = '/tmp/claude-0/-home-user-Experiment-3/c20c3567-05b6-5daa-8126-ea386a6ddfeb/scratchpad/'
ours = json.load(open(d + 'offroad-vc-ours.json'))
theirs = json.load(open(d + 'offroad-vc-theirs.json'))
cur = json.load(open('docs/vehicle-calibration.json'))
print('top keys', list(cur.keys()))
def machines(r):
    for k, v in r.items():
        if isinstance(v, dict) and all(isinstance(x, dict) for x in v.values()) and len(v) > 5:
            return k, v
    return None, r
kc, mc = machines(cur)
_, mo = machines(ours)
_, mt = machines(theirs)
print('section', kc, len(mc), len(mo), len(mt))
for k, v in mc.items():
    src = 'theirs' if k in mt else ('ours' if k in mo else 'NEW')
    ref = mt.get(k) if k in mt else mo.get(k)
    same = ref == v
    if not same:
        diffs = [f for f in set(v) | set(ref or {}) if (ref or {}).get(f) != v.get(f)]
        print('DIFF', k, src, diffs[:6])
missing = [k for k in set(mo) | set(mt) if k not in mc]
print('missing', missing)
others = [k for k in cur if k != kc and cur[k] != theirs.get(k)]
print('other top-level diffs vs theirs', others)
