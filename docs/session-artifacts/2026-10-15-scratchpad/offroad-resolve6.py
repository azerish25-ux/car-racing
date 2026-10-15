import re
p = 'docs/production/CONTENT_PIPELINE.md'
s = open(p).read()
m = re.search(r"<<<<<<< HEAD\n(.*?)=======\n(.*?)>>>>>>> claude/peaceful-einstein-dedc7t\n", s, re.S)
assert m and s.count('<<<<<<<') == 1
theirs = m.group(2)
rep = {
    "| Rally | 3 | dirt expansion | 3 (RL-2, RL-7, GB-4; no dirt venue yet) |":
    "| Rally | 3 | dirt expansion | 3 (RL-2, RL-7, GB-4; RL-2 races the Pinewood special stage, the historic RL-7 and GB-4 run paved heats) |",
    "| Rallycross | 3 | dirt expansion | 2 (RCX-6, RX-E; no dirt venue yet) |":
    "| Rallycross | 3 | dirt expansion | 2 (RCX-6, RX-E; race the Kestrel joker heat) |",
    "| Motocross | 4 | dirt-bike expansion | 0 here (off-road programme) |":
    "| Motocross | 4 | dirt-bike expansion | 2 (MX-450, MX-250; integrated, procedural art) |",
    "| Supermoto | 3 | after bike/dirt gates | 0 here (off-road programme) |":
    "| Supermoto | 3 | after bike/dirt gates | 1 (SM-450; integrated, procedural art) |",
}
for a, b in rep.items():
    assert theirs.count(a) == 1, a
    theirs = theirs.replace(a, b)
s = s[:m.start()] + theirs + s[m.end():]
old = """Counts: 48 cars and 6 road
motorcycles are registered (54 machines; 43 against the destination families above)."""
assert s.count(old) == 1
s = s.replace(old, """Counts: 48 cars, 6 road
motorcycles and 3 off-road motorcycles are registered (57 machines; 46 against the destination
families above).""")
open(p, 'w').write(s)
