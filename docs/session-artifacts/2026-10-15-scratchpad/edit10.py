p='src/simulation/offroad/venues.ts'
s=open(p).read()
old="""p.jump({ name: 'BARN DOUBLE', kind: 'double', at: at(4, 14),"""
new="""p.jump({ name: 'BARN DOUBLE', kind: 'double', at: at(4, 22),"""
assert old in s; s=s.replace(old,new)
old="""p.rollers({ at: at(4, 50), count: 3, spacing: 7, height: 0.7 });"""
new="""p.rollers({ at: at(4, 60), count: 2, spacing: 7, height: 0.6 });"""
assert old in s; s=s.replace(old,new)
open(p,'w').write(s)

p='src/simulation/offroad/ai.ts'
s=open(p).read()
old="""    const lip = this.plan!.clear ? hold : ROLL_SPEED;
    // On the face: hold, and above it only coast.
    if (onFace) return Math.min(desired, Math.max(lip, c.speed));"""
new="""    const lip = this.plan!.clear ? hold : ROLL_SPEED;
    // Rolling a gap jump: down into the gap and over the landing mound at
    // the rolling speed (a burst up the mound's back launches the bike).
    if (!this.plan!.clear && !onFace && mod(c.s - j.takeoff, track.length) < j.end - j.takeoff + 1)
      return Math.min(desired, ROLL_SPEED + 1.5);
    // On the face: hold, and above it only coast.
    if (onFace) return Math.min(desired, Math.max(lip, c.speed));"""
assert old in s; s=s.replace(old,new)
open(p,'w').write(s)

p='scratch-trace.ts'
s=open(p).read()
s=s.replace("""  if (b.s > from && b.s < to && i % 3 === 0) {""","""  if (b.s > from && b.s < to && i % 3 === 0 && sim.race.laps[0].completed === lapPrint) {""")
s=s.replace("""  if (b.dynamics.crashes > 0) {
    console.log('CRASH', JSON.stringify(b.crashCauses));
    break;
  }""","""  if (b.dynamics.crashes > crashes) {
    crashes = b.dynamics.crashes;
    console.log('CRASH', JSON.stringify(b.crashCauses.at(-1)), 'lap', sim.race.laps[0].completed);
  }
  if (sim.race.laps[0].completed > lapPrint) break;""")
s=s.replace("""const b = sim.cars[0] as DirtBikeVehicle;""","""const b = sim.cars[0] as DirtBikeVehicle;
const lapPrint = Number(process.argv[6] ?? 0);
let crashes = 0;""")
open(p,'w').write(s)
