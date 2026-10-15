import re
ROOT = '/home/user/Experiment-3/.claude/worktrees/wf_50bf1819-515-1/'
def patch(path, pairs):
    p = ROOT + path
    s = open(p).read()
    for old, new in pairs:
        if old not in s:
            raise SystemExit(f'missing in {path}: {old[:90]!r}')
        s = s.replace(old, new)
    open(p, 'w').write(s)

# Lateral convention: positive = LEFT of travel (Track's normal (tz, -tx)).
patch('src/simulation/open-world/route-driver.ts', [
    ("""    const steer =
        headingError + Math.atan2(1.8 * crossTrack, c.speed + 3) - Math.atan(c.spec.wheelbase * laneCurvature),""",
     """    // Lateral and curvature are positive to the left (Track convention);
    // heading angles grow toward the car's left; positive steer turns left.
    const steer =
        -headingError - Math.atan2(1.8 * crossTrack, c.speed + 3) + Math.atan(c.spec.wheelbase * laneCurvature),"""),
    ("""    const offset = finished
      ? reach
      : clamp(""", """    // A finished car pulls over to the right-hand verge (negative lateral).
    const offset = finished
      ? -reach
      : clamp("""),
    ("""    // A finished car eases off and pulls to the right-hand verge.
""", """    // A finished car eases off.
"""),
    ("""    /** Constant lane offset preference (traffic keeps right). */""",
     """    /** Constant lane offset (m, positive left; right-hand traffic is negative). */"""),
])
patch('src/simulation/open-world/session.ts', [
    ("""        // Keep to the right-hand lane of the chosen direction.
        lane = clamp(forward * Math.min(keep, e.spec.halfWidth * 0.5) || clamp(lateral, -keep, keep), -keep, keep);""",
     """        // Keep to the right-hand lane of the chosen direction (lateral is
        // positive to the left of the edge's forward direction).
        lane = clamp(-forward * Math.min(keep, e.spec.halfWidth * 0.5) || clamp(lateral, -keep, keep), -keep, keep);"""),
])
patch('src/simulation/open-world/route-path.ts', [
    ("""  /** Unit direction of travel and its right-hand normal. */""",
     """  /** Unit direction of travel and its left-hand normal (Track convention). */"""),
    ("""  /** Signed curvature in the travel direction (positive: right turn). */""",
     """  /** Signed curvature in the travel direction (positive: left turn). */"""),
    ("""  /** Race line: lateral offset (m, right positive) and its curvature. */""",
     """  /** Race line: lateral offset (m, positive left) and its curvature. */"""),
])
patch('src/simulation/open-world/road-network.ts', [
    ("""  /** Guardrail on the left (negative lateral) / right (positive lateral). */
  BARRIER_LEFT: 2,
  BARRIER_RIGHT: 4,""", """  /** Guardrail on the negative-lateral side (right of travel) / positive
   * side (left of travel; Track's lateral is positive to the left). */
  BARRIER_LEFT: 2,
  BARRIER_RIGHT: 4,"""),
    ("""  /** Nearest centreline point (layer-aware like Track.nearest) and the
   * signed lateral offset (positive right of travel). */""",
     """  /** Nearest centreline point (layer-aware like Track.nearest) and the
   * signed lateral offset (Track convention: positive to the left). */"""),
    ("""    // Signed curvature (positive: right turn) over ±2 samples, then smoothed.""",
     """    // Signed curvature (Track convention, positive: left turn) over ±2 samples, then smoothed."""),
])
patch('src/rendering/open-world/markers.ts', [
    ("""        // The camera at the trap line, on the verge.
        event.path.at(event.path.finishDistance, p);
        const lateral = p.halfWidth + 3;""",
     """        // The camera at the trap line, on the right-hand verge.
        event.path.at(event.path.finishDistance, p);
        const lateral = -(p.halfWidth + 3);"""),
])
print('ok')
