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
    ("import { angleDifference, approach, clamp, G } from '../../core/math.ts';",
     "import { approach, clamp, G, Vec3 } from '../../core/math.ts';"),
    ("""  private readonly located = { lateral: 0, distance: 0 };
  private readonly other = { lateral: 0, distance: 0 };
  private readonly front = { lateral: 0, distance: 0 };""",
     """  private readonly delta = new Vec3();
  private readonly local = new Vec3();
  private readonly located = { lateral: 0, distance: 0 };
  private readonly other = { lateral: 0, distance: 0 };"""),
    ("""    // Stanley path tracking from the front axle in the direction of motion
    // (heading error + cross-track term + curvature feed-forward): unlike a
    // long-lookahead pursuit it damps the weave a car develops when it
    // crabs on loose or wet ground.
    const fl = Math.hypot(c.forward.x, c.forward.z) || 1,
      fx = c.forward.x / fl,
      fz = c.forward.z / fl,
      half = c.spec.wheelbase / 2;
    const df = path.locate(c.body.position.x + fx * half, c.body.position.z + fz * half, this.d + half, 30, this.front);
    path.at(df, this.target);
    const reach = Math.max(0.5, this.target.halfWidth - 1.3);
    // A finished car pulls over to the right-hand verge (negative lateral).
    const offset = finished
      ? -reach
      : clamp(path.lineAt(df) * (this.laneOffset ? 0 : 1) + this.laneOffset + this.tactical, -reach, reach);
    const crossTrack = this.front.lateral - offset;
    path.at(df + clamp(c.speed * 0.1, 0, 5), this.target);
    const vel = c.body.velocity,
      moving = Math.hypot(vel.x, vel.z) > 4,
      heading = moving ? Math.atan2(vel.x, vel.z) : Math.atan2(fx, fz),
      headingError = angleDifference(heading, Math.atan2(this.target.tx, this.target.tz));
    const laneCurvature = this.laneOffset ? this.target.curvature : path.lineCurvatureAt(df);
    // Lateral and curvature are positive to the left (Track convention);
    // heading angles grow toward the car's left; positive steer turns left.
    const steer =
        -headingError - Math.atan2(1.8 * crossTrack, c.speed + 3) + Math.atan(c.spec.wheelbase * laneCurvature),
      speedSteer = c.assist === 'sport' ? 1 / (1 + c.speed * 0.018) : 1;
    command.steer = clamp(steer / (c.spec.maxSteer * speedSteer), -1, 1);""",
     """    // Pure pursuit of a point on the race line (or lane) ahead. Lateral
    // offsets are positive to the left of travel (Track convention), the
    // car's local +X is its left, and positive steer turns left.
    const lookahead = clamp(6 + c.speed * 0.5, 8, 48);
    path.at(this.d + lookahead, this.target);
    const reach = Math.max(0.5, this.target.halfWidth - 1.3);
    // A finished car pulls over to the right-hand verge (negative lateral).
    const offset = finished
      ? -reach
      : clamp(path.lineAt(this.d + lookahead) * (this.laneOffset ? 0 : 1) + this.laneOffset + this.tactical, -reach, reach);
    this.delta.set(
      this.target.x + this.target.nx * offset - c.body.position.x,
      0,
      this.target.z + this.target.nz * offset - c.body.position.z,
    );
    c.body.orientation.inverseRotate(this.delta, this.local);
    const purePursuit = Math.atan2(
        2 * c.spec.wheelbase * this.local.x,
        Math.max(10, this.local.x * this.local.x + this.local.z * this.local.z),
      ),
      speedSteer = c.assist === 'sport' ? 1 / (1 + c.speed * 0.018) : 1;
    command.steer = clamp(purePursuit / (c.spec.maxSteer * speedSteer), -1, 1);"""),
    ("""    const off = Math.abs(crossTrack);""", """    const off = Math.abs(this.lateral - offset);"""),
])
print('ok')
