import os
os.chdir('/home/user/Experiment-3/.claude/worktrees/agent-ac7432dc5f9d804f3')


def rep(p, old, new, count=1):
    s = open(p).read()
    assert s.count(old) == count, (p, old, s.count(old))
    s = s.replace(old, new)
    open(p, 'w').write(s)


e = 'src/simulation/events.ts'
rep(e, """import { VEHICLES, type VehicleClass } from './vehicles.ts';
""", """import { VEHICLES, type VehicleClass } from './vehicles.ts';
import { ALL_CLASSES, CATALOGUE_EVENTS, CATALOGUE_RULESETS } from './catalogue-events.ts';
""")
rep(e, """  drs: boolean;
  assists: readonly Assist[];
}""", """  drs: boolean;
  assists: readonly Assist[];
  /** Every entrant must share one class (the catalogue's default grids). */
  singleClass?: boolean;
  /** 'per-class': classes share the road but are classified within class. */
  classScoring?: 'overall' | 'per-class';
}""")
for rid in ["'open-exhibition'", "'open-practice'", "qualifying", "'time-trial'"]:
    pass
rep(e, """    sessions: Object.freeze(['race', 'practice'] as const),
    allowedClasses: Object.freeze(['formula', 'touring'] as const),
    drs: false,
  }),""", """    sessions: Object.freeze(['race', 'practice'] as const),
    allowedClasses: ALL_CLASSES,
    drs: false,
  }),""")
rep(e, """    sessions: Object.freeze(['practice'] as const),
    allowedClasses: Object.freeze(['formula', 'touring'] as const),""", """    sessions: Object.freeze(['practice'] as const),
    allowedClasses: ALL_CLASSES,""")
rep(e, """    sessions: Object.freeze(['qualifying'] as const),
    allowedClasses: Object.freeze(['formula', 'touring'] as const),""", """    sessions: Object.freeze(['qualifying'] as const),
    allowedClasses: ALL_CLASSES,""")
rep(e, """    sessions: Object.freeze(['time-trial'] as const),
    allowedClasses: Object.freeze(['formula', 'touring'] as const),""", """    sessions: Object.freeze(['time-trial'] as const),
    allowedClasses: ALL_CLASSES,""")
rep(e, """    service: Object.freeze({ pitStops: true }),
  }),
});
/** The ruleset each legacy mode always implied. */""", """    service: Object.freeze({ pitStops: true }),
  }),
  ...CATALOGUE_RULESETS,
});
/** The ruleset each legacy mode always implied. */""")
rep(e, """  if (!options.vehicles && !rules.allowedClasses.includes('formula'))""", """  if (rules.singleClass && new Set(vehicles.map((id) => VEHICLES[id]?.classId)).size > 1)
    errors.push(`${rules.name} runs single-class grids`);
  if (!options.vehicles && !rules.allowedClasses.includes('formula'))""")
rep(e, """    vehicles: 'apx01',
    compound: 'medium' as const,
    seed: 5202,
  }),
]);""", """    vehicles: 'apx01',
    compound: 'medium' as const,
    seed: 5202,
  }),
  ...CATALOGUE_EVENTS,
]);
/** Finishing position of every car within its own class (1-based), for
 * per-class classification; `order` is the overall classification (car ids). */
export function classPositions(order: readonly number[], vehicles: readonly string[]) {
  const seen = new Map<string, number>(),
    out = new Array<number>(vehicles.length).fill(0);
  for (const car of order) {
    const cls = VEHICLES[vehicles[car]]?.classId ?? 'formula';
    const position = (seen.get(cls) ?? 0) + 1;
    seen.set(cls, position);
    out[car] = position;
  }
  return out;
}""")
