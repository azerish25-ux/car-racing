D = '/tmp/claude-0/-home-user-Experiment-3/c20c3567-05b6-5daa-8126-ea386a6ddfeb/scratchpad/'
head = open(D + 'growth-head.md').read().replace('(22\nnew events', '(23\nnew events')
assert '(23\nnew events' in head
table = open(D + 'table.md').read()
mid = open(D + 'growth-mid.md').read()
briefs = open(D + 'briefs.md').read()
tail = open(D + 'growth-tail.md').read()
section = head + table + mid + briefs + tail

p = 'docs/production/CONTENT_PIPELINE.md'
s = open(p).read()
marker = """Known limits as GP-R1.

### 1.4 Destination catalogue (§10.1, 48 models)"""
assert s.count(marker) == 1
s = s.replace(marker, "Known limits as GP-R1.\n" + section + "\n### 1.4 Destination catalogue (§10.1, 48 models)")

old_table_start = s.index('| Family | Models | Delivery | Present |')
old_table_end = s.index('### 1.5 Customization')
new_14 = """| Family | Models | Delivery | Present |
|---|---:|---|---|
| Formula | 3 | car launch | 5 (APX-01, FX-26; feeder ladder JF-2, FR-3, FE-4) |
| GT | 4 | car launch | 6 (GT3: GT-8F, GT-10M, GT-6R, GT-6S; GT4: GS-4, GS-6M) |
| Touring | 3 | car launch | 3 (TC-1 front, TC-2 rear, TC-3 all-wheel drive) |
| Lightweight club | 2 | car launch | 3 (CR-1, HH-2; vintage VC-62) |
| Endurance prototype | 3 | circuit expansion | 4 (HY-9, HY-11, PR-2, PR-3) |
| Historic | 3 | circuit expansion | 4 (HF-67, HF-76, HF-86, SP-71) |
| Rally | 3 | dirt expansion | 3 (RL-2, RL-7, GB-4; no dirt venue yet) |
| Rallycross | 3 | dirt expansion | 2 (RCX-6, RX-E; no dirt venue yet) |
| Off-road truck/buggy | 3 | dirt expansion | 2 (DX-8, BG-2; limited suspension travel) |
| Kart | 2 | small-vehicle slice | 2 (SK-125, DK-100) |
| Road sport motorcycle | 3 | bike expansion | 3 (SBK-1000, SS-600, CR-750; procedural art) |
| Prototype GP-style motorcycle | 3 | bike expansion | 2 (GP-R1, GP-R2; procedural art) |
| Motocross | 4 | dirt-bike expansion | 0 here (off-road programme) |
| Supermoto | 3 | after bike/dirt gates | 0 here (off-road programme) |
| Flat-track | 2 | after bike/dirt gates | 0 |
| Experimental | 4 | extreme expansion | 4 (XF-2 fan car, XE-1 electric time attack, XH-3 hydrogen concept, XT-1 track hypercar) |

"Present" means integrated (definition, calibration inside its bands at both timesteps, AI
envelope, procedural exterior with its own body sheet, explicit sound family, menu entry, class
ruleset and event where the class races); none of these meets the §1.1 definition of done (no
authored source assets, damage variants, recorded audio or sign-off). Counts: 48 cars and 6 road
motorcycles are registered (54 machines; 43 against the destination families above). Eleven
open-world machines sit outside the 48-model destination list: EH-3, SC-7, RH-3 hot hatch, RS-5
sports sedan, RM-8 muscle coupe, RG-63 classic grand tourer, RP-6 pickup, RR-4 rally-bred road
car, LX-12 luxury GT, RD-2 roadster and the NR-900 naked roadster bike (classes `road` and
`road-bike`: practice, qualifying and time trial, no circuit race).

"""
s = s[:old_table_start] + new_14 + s[old_table_end:]
open(p, 'w').write(s)
print('ok')
