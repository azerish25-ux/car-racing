p='src/simulation/world.ts'
s=open(p).read()
old="    this.offroad?.beforePhysics(dt);"
assert old in s
s=s.replace(old,"    this.offroad?.beforePhysics(dt, this.autoPlayer);")
open(p,'w').write(s)

p='src/simulation/offroad/session.ts'
s=open(p).read()
def rep(old,new):
    global s
    assert s.count(old)==1, old[:60]
    s=s.replace(old,new,1)
rep("""  /** Before the physics substeps: hold machines at the gate, the start
   * control and the queue (inputs only; the player may still jump). */
  beforePhysics(dt: number) {
    void dt;""","""  /** Before the physics substeps: hold machines at the gate, the start
   * control and the queue (inputs only; the player may still jump unless
   * the AI drives for them, `autoPlayer`). */
  beforePhysics(dt: number, autoPlayer = false) {
    void dt;
    const ai = (id: number) => id > 0 || autoPlayer;""")
rep("""        if (held && id > 0) {""","""        if (held && ai(id)) {""")
rep("""          if (id > 0 || !atLine || c.input.throttle === 0) {""","""          if (ai(id) || !atLine || c.input.throttle === 0) {""")
open(p,'w').write(s)

p='src/simulation/offroad/jump-rig.ts'
s=open(p).read()
old="""  let flew = false,
    takeoffSpeed = 0;
  for (let t = 0; t < 6; t += dt) {
    const before = bike.airborne;
    const onFace = bike.s >= j.start - 1 && bike.s <= j.takeoff + 1;
    if (!bike.airborne) rideLine(bike, track, onFace ? Math.max(lip, bike.dynamics.speed) : lip);
    bike.step(dt, track);
    if (!before && bike.airborne && !flew) {
      flew = true;
      takeoffSpeed = bike.lastTakeoff;
    }
    if (flew && before && !bike.airborne) break;
    if (!bike.riding) break;
  }
  for (let t = 0; t < 0.4 && bike.riding; t += dt) {
    rideLine(bike, track, lip);
    bike.step(dt, track);
  }
  const landing = bike.lastLanding;"""
new="""  let flew = false,
    takeoffSpeed = 0;
  for (let t = 0; t < 6; t += dt) {
    const before = bike.airborne;
    const onFace = bike.s >= j.start - 1 && bike.s <= j.takeoff + 1;
    if (!bike.airborne) rideLine(bike, track, onFace ? Math.max(lip, bike.dynamics.speed) : lip);
    bike.step(dt, track);
    if (!before && bike.airborne && !flew) {
      flew = true;
      takeoffSpeed = bike.lastTakeoff;
    }
    if (flew && before && !bike.airborne) break;
    if (!bike.riding) break;
  }
  // The record of this flight's touchdown (settled over the next steps; a
  // later hop on the run-out writes a record of its own).
  const landing = flew ? bike.lastLanding : null;
  for (let t = 0; t < 0.4 && bike.riding; t += dt) {
    rideLine(bike, track, lip);
    bike.step(dt, track);
  }"""
assert old in s; s=s.replace(old,new)
open(p,'w').write(s)
