ROOT = '/home/user/Experiment-3/.claude/worktrees/wf_50bf1819-515-1/'
def patch(path, pairs):
    p = ROOT + path
    s = open(p).read()
    for old, new in pairs:
        if old not in s:
            raise SystemExit(f'missing in {path}: {old[:80]}')
        s = s.replace(old, new)
    open(p, 'w').write(s)

patch('src/simulation/open-world/route-path.ts', [
    ("""  routeSpec(id: string, gateSpacing = 400): RouteSpec {
    const edges: RouteEdgeSpec[] = [],
      checkpoints: Checkpoint[] = [];
    const legs = this.legs.length;""", """  routeSpec(id: string, gateSpacing = 400): RouteSpec {
    const edges: RouteEdgeSpec[] = [],
      checkpoints: Checkpoint[] = [];
    const legs = this.legs.length,
      finish = this.finishDistance;
    let finishGate: Checkpoint | null = null;"""),
    ("""        while (travelled >= nextGate && nextGate < this.length - gateSpacing * 0.5) {
          checkpoints.push({ edge: `${k}`, s: arc3 });
          nextGate += gateSpacing;
        }""", """        while (travelled >= nextGate && nextGate < finish - gateSpacing * 0.5) {
          checkpoints.push({ edge: `${k}`, s: arc3 });
          nextGate += gateSpacing;
        }
        if (!this.closed && !finishGate && travelled >= finish) finishGate = { edge: `${k}`, s: arc3 };"""),
    ("""    // Finish gate just before the end of the last leg.
    const last = edges[legs - 1].points;
    let arc = 0;
    for (let i = 1; i < last.length; i++)
      arc += Math.hypot(last[i].x - last[i - 1].x, last[i].y - last[i - 1].y, last[i].z - last[i - 1].z);
    checkpoints.push({ edge: `${legs - 1}`, s: Math.max(0, arc - 1) });""", """    // Finish: a circuit's line is the start; a point-to-point finish leaves
    // run-out before the end of the route.
    if (!finishGate) {
      const last = edges[legs - 1].points;
      let arc = 0;
      for (let i = 1; i < last.length; i++)
        arc += Math.hypot(last[i].x - last[i - 1].x, last[i].y - last[i - 1].y, last[i].z - last[i - 1].z);
      finishGate = { edge: `${legs - 1}`, s: Math.max(0, arc - 1) };
    }
    checkpoints.push(finishGate);"""),
    ("""  /** Widest road half-width on the route (RouteProgress tolerance). */""", """  /** Distance of the finish line: the start of a circuit's lap, or short of
   * a point-to-point route's end so cars can stop beyond it. */
  get finishDistance() {
    return this.closed ? this.length : this.length - Math.min(60, this.length * 0.2);
  }
  /** Widest road half-width on the route (RouteProgress tolerance). */"""),
])
patch('src/simulation/open-world/route-driver.ts', [
    ("""    // The end of a point-to-point route: roll to a stop past the line.
    const remaining = path.closed ? Infinity : path.length - this.d;
    if (finished || remaining < 1) desired = Math.min(desired, finished ? 0 : 8);
    else if (remaining < 200) desired = Math.min(desired, Math.sqrt(64 + 2 * 6 * remaining));""", """    // The end of a point-to-point route: brake to a stop before its end.
    const remaining = path.closed ? Infinity : path.length - 6 - this.d;
    if (remaining < 1) desired = 0;
    else if (remaining < 260) desired = Math.min(desired, Math.sqrt(2 * 5 * remaining));
    // A finished car eases off and pulls to the right-hand verge.
    if (finished) desired = Math.min(desired, Math.max(0, c.speed - 4), 16);"""),
    ("""    const reach = Math.max(0.5, this.target.halfWidth - 1.3);
    const offset = clamp(path.lineAt(this.d + lookahead) * (this.laneOffset ? 0 : 1) + this.laneOffset + this.tactical, -reach, reach);""", """    const reach = Math.max(0.5, this.target.halfWidth - 1.3);
    const offset = finished
      ? reach
      : clamp(path.lineAt(this.d + lookahead) * (this.laneOffset ? 0 : 1) + this.laneOffset + this.tactical, -reach, reach);"""),
])
patch('src/simulation/open-world/session.ts', [
    ("""    // Physics: two substeps, car contacts, rails and static colliders.
    const track = this.asTrack;
    for (let sub = 0; sub < 2; sub++) {
      for (const c of this.cars) c.step(dt * 0.5, track);
      this.collisions.solve(this.cars, track);
      for (const c of this.cars) this.collideStatic(c);
    }""", """    // Physics: two substeps, car contacts, rails and static colliders.
    // Finished rivals are out of the race: no car contact with them.
    const track = this.asTrack,
      contact = run ? this.cars.filter((c, i) => i === 0 || run.participants[i]?.finishTime === null) : this.cars;
    for (let sub = 0; sub < 2; sub++) {
      for (const c of this.cars) c.step(dt * 0.5, track);
      this.collisions.solve(contact, track);
      for (const c of this.cars) this.collideStatic(c);
    }"""),
    ("""        if (!driver) return;
        driver.update(dt, this.cars, hold, p.finishTime !== null || this.mode === 'finished');""", """        if (!driver) return;
        driver.update(dt, traffic, hold, p.finishTime !== null || this.mode === 'finished');"""),
    ("""    if (run) {
      const hold = this.mode === 'countdown';""", """    if (run) {
      const hold = this.mode === 'countdown',
        traffic = this.cars.filter((_, i) => i === 0 || run.participants[i]?.finishTime === null);"""),
    ("""        this.autopilotDriver.update(dt, this.cars, false, run.participants[0].finishTime !== null);""", """        this.autopilotDriver.update(dt, traffic, false, run.participants[0].finishTime !== null);"""),
])
print('ok')
