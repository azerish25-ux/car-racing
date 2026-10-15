ROOT = '/home/user/Experiment-3/.claude/worktrees/wf_50bf1819-515-1/'
def patch(path, pairs):
    p = ROOT + path
    s = open(p).read()
    for old, new in pairs:
        if old not in s:
            raise SystemExit(f'missing in {path}: {old[:90]!r}')
        s = s.replace(old, new, 1)
    open(p, 'w').write(s)

patch('docs/production/STATUS_REGISTER.md', [
    ("""| Directed route graph, checkpoints, branches | prototype | `src/simulation/route-graph.ts`, `tests/route-graph.test.ts` | Drive a session from a RouteGraph venue | Track/tools lead |""",
     """| Directed route graph, checkpoints, branches | integrated (festival events) | `src/simulation/route-graph.ts`, `tests/route-graph.test.ts`; festival event progress via `RouteProgress` (`src/simulation/open-world/route-path.ts`, `tests/open-world.test.ts`) | Drive a circuit or stage session from a RouteGraph venue | Track/tools lead |
| Festival open world (Solvane Coast: 8.19 km region, 70.9 km road network, free roam, 13 discovered events) | integrated | `src/simulation/open-world/`, `src/rendering/open-world/`, `src/session/free-roam.ts`, `tests/open-world*.test.ts`, `npm run test:open-world` → `docs/open-world.json`, [OPEN_WORLD.md](OPEN_WORLD.md) | Reference-hardware capture of streaming and frame time at each preset; human free-roam and event sessions; traffic; career consumption of `FestivalResult` | Open-world lead + rendering lead |"""),
    ("""| Freestyle/drift scoring | prototype | `src/core/scoring.ts` | A playable challenge | Gameplay lead |""",
     """| Freestyle/drift scoring | integrated (festival drift zones) | `src/core/scoring.ts`, `DriftMeter` in `src/simulation/open-world/festival-events.ts`, `tests/open-world-session.test.ts` | Player tuning of thresholds; freestyle (bike/air) scoring | Gameplay lead |"""),
    ("""| WP11 | integrated / prototype | Track layer gate integrated; RouteGraph prototype. |""",
     """| WP11 | integrated | Track layer gate integrated; RouteGraph/RouteProgress drive festival event progress (gates at the very end of an edge were missed when the next sample was already on the successor: fixed, regression in `route-graph.test.ts`). No circuit venue is built from a RouteGraph yet. |"""),
    ("""| WP48 | prototype | Explainable scoring. |""",
     """| WP48 | integrated (partial) | Explainable scoring drives festival drift zones; freestyle disciplines open. |"""),
])
print('ok')
