import os
os.chdir('/home/user/Experiment-3/.claude/worktrees/agent-ac7432dc5f9d804f3')
p = 'scripts/vehicle-calibration.ts'
s = open(p).read()
old = """  ...(CATALOGUE_BANDS as Record<string, Record<string, Band>>),"""
new = """  ...Object.fromEntries(Object.entries(CATALOGUE_BANDS).map(([id, bands]) => [id, { ...bands }])),"""
assert old in s
s = s.replace(old, new)
open(p, 'w').write(s)


def setlink(fname, vid, val):
    p = 'src/simulation/vehicle-catalogue/' + fname
    s = open(p).read()
    i = s.index("id: '%s'" % vid)
    j = s.index('linkCentreHeight:', i)
    k = s.index(',', j)
    s = s[:j] + 'linkCentreHeight: %s' % val + s[k:]
    open(p, 'w').write(s)


for f, v, x in [('formula.ts', 'jf2', '0.22'), ('endurance.ts', 'hy9', '0.22'), ('endurance.ts', 'pr2', '0.22'),
                ('gt.ts', 'gt8f', '0.24'), ('gt.ts', 'gt10m', '0.23'), ('gt.ts', 'gs4', '0.25'),
                ('touring-club.ts', 'tc2', '0.25'), ('touring-club.ts', 'cr1', '0.2'),
                ('dirt.ts', 'rl2', '0.28'), ('dirt.ts', 'rcx6', '0.27'), ('dirt.ts', 'dx8', '0.45'),
                ('small-road.ts', 'eh3', '0.22'), ('small-road.ts', 'sc7', '0.22')]:
    setlink(f, v, x)
p = 'src/simulation/vehicle-catalogue/small-road.ts'
s = open(p).read()
old = """    idleTorque: 6,
    clutchCapacity: 45,
  },"""
new = """    idleTorque: 6,
    clutchCapacity: 45,
    engageRPM: 9500,
  },"""
assert old in s
s = s.replace(old, new)
open(p, 'w').write(s)
