p = 'docs/production/CONTENT_PIPELINE.md'
s = open(p).read()
pairs = [
    ("""authored source assets, damage variants, recorded audio or sign-off). Counts: 48 cars, 6 road
motorcycles and 3 off-road motorcycles are registered (57 machines; 46 against the destination
families above). Eleven
open-world machines sit outside""",
     """authored source assets, damage variants, recorded audio or sign-off). Counts: 48 cars, 6 road
motorcycles and 3 off-road motorcycles are registered (57 machines; 46 against the destination
families above). Eleven open-world machines sit outside"""),
    ("| Rallycross | 3 | dirt expansion | 2 (RCX-6, RX-E; race the Kestrel joker heat) |",
     "| Rallycross | 3 | dirt expansion | 2 (RCX-6, RX-E; the class races the Kestrel joker heat) |"),
    ("| Rally | 3 | dirt expansion | 3 (RL-2, RL-7, GB-4; RL-2 races the Pinewood special stage, the historic RL-7 and GB-4 run paved heats) |",
     "| Rally | 3 | dirt expansion | 3 (RL-2, RL-7, GB-4; RL-2 races the Pinewood special stage, the historic RL-7 and GB-4 their own paved heats) |"),
]
for a, b in pairs:
    assert s.count(a) == 1, a[:60]
    s = s.replace(a, b)
open(p, 'w').write(s)
