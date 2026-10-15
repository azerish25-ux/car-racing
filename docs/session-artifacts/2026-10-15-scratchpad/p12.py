import sys
root = sys.argv[1]
def patch(path, pairs):
    s = open(path).read()
    for a, b in pairs:
        assert a in s, (path, a[:90])
        s = s.replace(a, b)
    open(path, 'w').write(s)

patch(root + '/src/simulation/ai.ts', [
("""  private tactical = 0;
  private desiredOffset = 0;""", """  private tactical = 0;
  /** The first update starts the lateral target at the car's own position. */
  private placed = false;
  private desiredOffset = 0;"""),
("""    const lineHere = lineAt(c.s);
    const corridor = pit || preparingPit;""", """    const lineHere = lineAt(c.s);
    const corridor = pit || preparingPit;
    // A car leaves its grid slot (or a rejoin point) on its own line and
    // merges toward the racing line at the finite lateral rate below, rather
    // than aiming across the track from standstill with full lock.
    if (!this.placed) {
      this.placed = true;
      this.tactical = c.lateral - lineHere;
      this.desiredOffset = c.lateral;
    }"""),
])
patch(root + '/src/simulation/vehicle.ts', [
("""    for (let i = 0; i < 4; i++) {
      const t = this.tires[i],
        travel = hub.travel[i],
        rest = this.restScratch[i];
      t.compression = Math.max(0, travel);
      t.deflection = hub.contact[i] ? Math.max(0, hub.compression[i] - travel) : 0;
      t.length = hub.contact[i]
        ? rest - travel
        : Math.min(rest + 0.05, Math.max(0.06, this.lengthScratch[i]));
      this.hubs[i].copy(this.origins[i]).addScaled(this.up, -t.length);
      this.normalLoads[i] = hub.tyreForce[i];
    }""", """    for (let i = 0; i < 4; i++) {
      const t = this.tires[i],
        length = this.lengthScratch[i],
        rest = this.restScratch[i];
      // Geometric wheel travel as before (suspension plus tyre deflection);
      // the hub's own travel is hub.travel and the deflection t.deflection.
      t.length = Math.min(rest + 0.05, Math.max(0.06, length));
      t.compression = Number.isFinite(length) ? Math.max(0, rest - length) : 0;
      t.deflection = hub.contact[i] ? Math.max(0, hub.compression[i] - hub.travel[i]) : 0;
      this.hubs[i].copy(this.origins[i]).addScaled(this.up, -t.length);
      this.normalLoads[i] = hub.tyreForce[i];
    }"""),
])
patch(root + '/src/simulation/tire.ts', [
("""  /** Suspension travel (m, + bump) and suspension length (m). */
  compression: number;
  length: number;""", """  /** Geometric wheel travel (m, + bump: suspension and tyre deflection) and
   * the wheel-centre distance below its chassis station (m). */
  compression: number;
  length: number;"""),
])
print('ok')
