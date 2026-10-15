import json, sys, collections
p = json.load(open(sys.argv[1]))
nodes = {n['id']: n for n in p['nodes']}
self_time = collections.Counter()
dt = p['timeDeltas']
samples = p['samples']
for i, s in enumerate(samples):
    n = nodes[s]
    cf = n['callFrame']
    key = f"{cf['functionName'] or '(anon)'} {cf['url'].split('/')[-1]}:{cf['lineNumber']}"
    self_time[key] += dt[i] if i < len(dt) else 0
total = sum(self_time.values())
for k, v in self_time.most_common(int(sys.argv[2]) if len(sys.argv) > 2 else 30):
    print(f"{100*v/total:5.1f}%  {k}")
