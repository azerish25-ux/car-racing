p = 'docs/production/CONTENT_PIPELINE.md'
s = open(p).read()
a = "| Rally | 3 | dirt expansion | 3 (RL-2, RL-7, GB-4; RL-2 races the Pinewood special stage, the historic RL-7 and GB-4 their own paved heats) |"
b = "| Rally | 3 | dirt expansion | 3 (RL-2, RL-7, GB-4; the classes race the Pinewood special stage, the historic RL-7 and GB-4 also their own paved heats) |"
assert s.count(a) == 1
s = s.replace(a, b)
open(p, 'w').write(s)
