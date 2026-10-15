import re
p = 'docs/production/GAME_DESIGN.md'
s = open(p).read()
m = re.search(r"<<<<<<< HEAD\n(.*?)=======\n(.*?)>>>>>>> claude/peaceful-einstein-dedc7t\n", s, re.S)
assert m and s.count('<<<<<<<') == 1
new = """say so); off-road is open (see below) and festival is coming (road machines exist and the Solvane
region runs as free roam, section 8.1, but the region is not yet registered as a career venue).
Circuit-car tiers: club, vintage and touring → grand touring → Formula ladder (entry, feeder, junior,
the three historic eras, top tier) → endurance prototypes (incl. the historic sports prototype) →
unlimited experimental; bike and festival tiers exist as data and fill when their classes are
registered. A registered class that no tier names joins an automatic open tier.

**Off-road (implemented, WP37–WP42).** Tiers motocross and supercross (MX-450, MX-250, SM-450) →
rallycross (RCX-6, RX-E) → rally and trophy trucks (RL-2, DX-8, BG-2, and the historic RL-7 and
GB-4). A terrain venue names the classes it admits and the formats it is built for, so a tier only
races where its machines are admitted and an event takes the venue's own format (gate motos at
Valley Ridge and Arena Nord, the joker heat at Kestrel, the timed stage at Pinewood). The recovery
meeting and the jump-landing licence run on the MX-250 loaner at Valley Ridge; the authored off-road
events (two Valley Ridge motos, the Arena Nord main, a supermoto race, the Kestrel heat, the
Pinewood stage) appear in their tiers.
"""
s = s[:m.start()] + new + s[m.end():]
open(p, 'w').write(s)
