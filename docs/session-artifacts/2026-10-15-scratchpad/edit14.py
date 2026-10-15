p='src/simulation/offroad/venues.ts'
s=open(p).read()
old="""    p.rollers({ at: at(4, 60), count: 2, spacing: 7, height: 0.6 });\n"""
assert old in s; s=s.replace(old,"")
open(p,'w').write(s)

p='src/simulation/offroad/ai.ts'
s=open(p).read()
old="""    this.rutBias = approach(this.rutBias, this.biasTarget, dt * 1.2);
    super.update(dt, track, cars, race);
    this.governJump(track);
  }"""
new="""    this.rutBias = approach(this.rutBias, this.biasTarget, dt * 1.2);
    super.update(dt, track, cars, race);
    this.governJump(track);
    this.unstick(dt, track, race);
  }
  private stuck = 0;
  /** Marshal assistance: a bike pinned against a tyre wall or beached on a
   * berm's back (riding, but going nowhere) is pushed back onto the track. */
  private unstick(dt: number, track: Track, race: RaceDirector) {
    const c = this.rider;
    if (race.phase === PHASE.RACING && race.raceTime > 5 && c.riding && !c.airborne && c.speed < 0.5 && c.aiTarget > 4)
      this.stuck += dt;
    else this.stuck = 0;
    if (this.stuck < STUCK_SECONDS) return;
    this.stuck = 0;
    const w = track.at(c.s, previewPoint).width - 1;
    c.place(track, c.s, clamp(c.lateral, -w, w));
    this.decisions.pushes++;
  }"""
assert old in s; s=s.replace(old,new)
s=s.replace("readonly decisions = { clears: 0, rolls: 0 };","readonly decisions = { clears: 0, rolls: 0, pushes: 0 };")
s=s.replace("import type { RaceDirector } from '../race.ts';","import { PHASE, type RaceDirector } from '../race.ts';")
old="""/** Lip speed (m/s) a rider rolls a feature at"""
new="""/** Seconds a riding bike may sit still before the marshals push it out. */
const STUCK_SECONDS = 4;
/** Lip speed (m/s) a rider rolls a feature at"""
assert old in s; s=s.replace(old,new)
open(p,'w').write(s)
