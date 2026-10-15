p='src/simulation/offroad/dirt-bike-vehicle.ts'
s=open(p).read()
old="""    if (r.outcome === 'clean') {
      if (r.pitchError < -a.noseDownLimit && r.normalSpeed > 1.5) {
        r.outcome = 'crash-front';
        d.fall('highside');
      } else if (r.pitchError > a.noseUpLimit) {
        r.outcome = 'crash-rear';
        d.fall('lowside');
      }
    }"""
new="""    // A hop of a few hundredths of a second is a bump, not a landing: only
    // real flights are judged on pitch (and only with a real impact).
    if (r.outcome === 'clean' && r.airTime > 0.12) {
      if (r.pitchError < -a.noseDownLimit && r.normalSpeed > 1.5) {
        r.outcome = 'crash-front';
        d.fall('highside');
      } else if (r.pitchError > a.noseUpLimit && r.normalSpeed > 2) {
        r.outcome = 'crash-rear';
        d.fall('lowside');
      }
    }"""
assert old in s
s=s.replace(old,new)
open(p,'w').write(s)

p='src/simulation/offroad/ai.ts'
s=open(p).read()
old="""    const hold = jumpHoldSpeed(j);
    if (!this.plan || this.plan.jump !== j) {
      // Can the run-up reach the hold speed? (dirt traction ~0.4 g)
      const reachable = Math.sqrt(c.speed * c.speed + 2 * 0.4 * G * Math.max(0, run - 4));
      const clear = j.forgiving || reachable >= hold - 0.3;
      this.plan = { jump: j, clear };
      if (clear) this.decisions.clears++;
      else this.decisions.rolls++;
    }"""
new="""    const hold = jumpHoldSpeed(j);
    // Under a yellow flag nobody jumps: roll it. Otherwise clear the gap
    // only when the run-up (dirt traction ~0.4 g) and every other limit
    // (traffic, the corner before) leave the hold speed.
    const yellow = race.control.flags[c.id] === FLAG.YELLOW || race.control.flags[c.id] === FLAG.DOUBLE_YELLOW;
    const reachable = Math.min(desired + 0.5, Math.sqrt(c.speed * c.speed + 2 * 0.4 * G * Math.max(0, run - 4)));
    const onFaceNow = mod(c.s - j.start, track.length) < j.takeoff - j.start + 0.5;
    if (!this.plan || this.plan.jump !== j || !onFaceNow) {
      const clear = !yellow && (j.forgiving || reachable >= hold - 0.3);
      if (!this.plan || this.plan.jump !== j) {
        if (clear) this.decisions.clears++;
        else this.decisions.rolls++;
      }
      this.plan = { jump: j, clear };
    }"""
assert old in s
s=s.replace(old,new)
s=s.replace("""  protected override limitSpeed(desired: number, track: Track, race: RaceDirector) {
    void race;
    const course = offroadCourse(track.circuit),
      c = this.rider;
    if (!course || c.airborne) return desired;
    const next = course.nextJump(c.s - 3);""","""  protected override limitSpeed(desired: number, track: Track, race: RaceDirector) {
    const course = offroadCourse(track.circuit),
      c = this.rider;
    if (!course || c.airborne) return desired;
    const next = course.nextJump(c.s - 3);""")
s=s.replace("""import type { RaceDirector } from '../race.ts';""","""import { FLAG } from '../marshal.ts';
import type { RaceDirector } from '../race.ts';""")
open(p,'w').write(s)
