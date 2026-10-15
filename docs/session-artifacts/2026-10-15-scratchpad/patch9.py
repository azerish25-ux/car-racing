ROOT = '/home/user/Experiment-3/.claude/worktrees/wf_50bf1819-515-1/'
def patch(path, pairs):
    p = ROOT + path
    s = open(p).read()
    for old, new in pairs:
        if old not in s:
            raise SystemExit(f'missing in {path}: {old[:90]!r}')
        s = s.replace(old, new)
    open(p, 'w').write(s)

patch('src/simulation/open-world/route-driver.ts', [
    ("""/** Why the driver is doing what it does (HUD/debug, tests). */""",
     """/** Speed (m/s) above which the driver will not commit on a loose road: a
 * narrow crowned gravel lane leaves no margin for the slide a car develops
 * there at rally pace, so the AI keeps a reserve the player may spend. */
export const LOOSE_ROAD_SPEED = 41;

/** Why the driver is doing what it does (HUD/debug, tests). */"""),
    ("""      const crest = -path.verticalCurvatureAt(at),
        crestSpeed = crest > 1e-4 ? Math.sqrt((0.55 * G) / crest) : Infinity;
      this.corners[i] = Math.min(envelopeCornerSpeed(k, laneGrip, aero, env) * this.skill, crestSpeed);""",
     """      const crest = -path.verticalCurvatureAt(at),
        crestSpeed = crest > 1e-4 ? Math.sqrt((0.55 * G) / crest) : Infinity,
        loose = path.network.edges[path.edge[path.index(at)]].spec.surface !== 'asphalt';
      this.corners[i] = Math.min(
        envelopeCornerSpeed(k, laneGrip, aero, env) * this.skill,
        crestSpeed,
        loose ? LOOSE_ROAD_SPEED * this.skill : Infinity,
      );"""),
])
print('ok')
