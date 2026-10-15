import os
os.chdir('/home/user/Experiment-3/.claude/worktrees/agent-ac7432dc5f9d804f3')
p = 'src/simulation/vehicle-catalogue/small-road.ts'
s = open(p).read()
old = """    brakingMargin: 0.74,
    topSpeed: 38,
  },"""
assert s.count(old) == 1
s = s.replace(old, """    brakingMargin: 0.74,
    topSpeed: 38,
    // A kart on a car circuit: tighter preview, further from the kerbs.
    lineScale: 0.75,
    lookahead: [4, 0.32],
  },""")
old = """    brakingMargin: 0.74,
    topSpeed: 92,
  },"""
assert s.count(old) == 1
s = s.replace(old, """    brakingMargin: 0.74,
    topSpeed: 92,
    lineScale: 0.8,
  },""")
open(p, 'w').write(s)
