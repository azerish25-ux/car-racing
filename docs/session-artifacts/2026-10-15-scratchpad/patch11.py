ROOT = '/home/user/Experiment-3/.claude/worktrees/wf_50bf1819-515-1/'
def patch(path, pairs):
    p = ROOT + path
    s = open(p).read()
    for old, new in pairs:
        if old not in s:
            raise SystemExit(f'missing in {path}: {old[:90]!r}')
        s = s.replace(old, new, 1)
    open(p, 'w').write(s)

patch('docs/production/GAME_DESIGN.md', [
    ("""## 9. Presentation""",
     """### 8.1 Festival region: implemented vs designed

Implemented (state **integrated**, details in [OPEN_WORLD.md](OPEN_WORLD.md)): the fictional
Solvane Coast region (8.19 km square; coast, Varda mountain, Ashvale valley, Port Ilse town,
Kestrel airfield, forests) with a 70.9 km road network of highways, country roads, mountain
switchbacks, town streets, dirt tracks and a runway. SESSION → *Festival · open world* starts free
roam in any four-wheel registry machine. Physics reads the real surface everywhere through the
`OpenWorldTrack` adapter (soft boundaries, no laps); reset puts the car back on the nearest road.
Thirteen events are discovered by driving near their markers and start in place after a card:
road race, circuits built from road routes, sprints, speed traps, speed zones, drift zones scored
by `scoring.ts`, and a showcase against the fastest registry machine. Rivals follow the route with
the circuit AI's envelope; legal progress is `RouteProgress`, so shortcuts earn nothing. Each event
emits a typed `FestivalResult` for the career hook.

Designed, not implemented: ambient traffic, festival career and reputation (results are emitted,
not consumed), motorcycles and off-road machines in the region, seasons, player houses, barn
finds, online free roam, photo challenges, destructible scenery.

## 9. Presentation"""),
])
print('ok')
