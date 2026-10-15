p='src/simulation/offroad/ai.ts'
s=open(p).read()
start=s.index("  /** Jump speed control: hold the speed whose flight lands on the landing")
end=s.index("const previewPoint = trackPoint();")
new='''  /** Speed reachable from `v` over `run` metres on loose ground: the
   * engine's power at the tyre (less drag) and ~0.4 g of traction, capped. */
  private reach(v: number, run: number, cap: number) {
    const c = this.rider,
      spec = c.definition.spec,
      mass = c.dynamics.mass,
      power = 0.82 * spec.motorPowerW;
    let speed = Math.max(1, v);
    for (let x = 0; x < run && speed < cap; x += 1) {
      const a = Math.min(0.4 * G, power / (mass * speed)) - (c.dynamics.p.drag * speed * speed) / mass;
      speed = Math.sqrt(Math.max(1, speed * speed + 2 * a));
    }
    return Math.min(speed, cap);
  }
  /** Jump speed control: hold the speed whose flight lands on the landing
   * zone; when the run-up cannot reach it, roll the feature. The choice is
   * locked where the braking distance to the rolling speed runs out (a late
   * change of mind arrives at the lip at neither speed), and nobody brakes on
   * a face (it noses down). */
  protected override limitSpeed(desired: number, track: Track, race: RaceDirector) {
    const course = offroadCourse(track.circuit),
      c = this.rider;
    if (!course || c.airborne) return desired;
    const next = course.nextJump(c.s - 3);
    if (!next) return desired;
    const j = next.jump,
      run = mod(j.takeoff - c.s, track.length);
    if (run > 160 || run > track.length / 2) {
      this.plan = null;
      return desired;
    }
    const hold = jumpHoldSpeed(j) + 0.1,
      faceLength = j.takeoff - j.start,
      toFace = run - faceLength,
      onFace = toFace < 0.5;
    // Under a yellow flag nobody jumps: roll it (decided again every step
    // before the lock). Otherwise clear the gap only when the run-up and
    // every other limit (traffic, the corner before) leave the hold speed.
    const yellow = race.control.flags[c.id] === FLAG.YELLOW || race.control.flags[c.id] === FLAG.DOUBLE_YELLOW;
    const brakeToRoll = (c.speed * c.speed - ROLL_SPEED * ROLL_SPEED) / (2 * 0.45 * G) + 4;
    const locked = this.plan?.jump === j && this.plan.locked;
    if (!locked) {
      const reachable = this.reach(c.speed, Math.max(0, toFace - 1), desired + 0.5);
      const clear = !yellow && reachable >= hold - (j.forgiving ? 0.8 : 0.25);
      if (!this.plan || this.plan.jump !== j) {
        if (clear) this.decisions.clears++;
        else this.decisions.rolls++;
      }
      this.plan = { jump: j, clear, locked: onFace || toFace < brakeToRoll };
    }
    const lip = this.plan!.clear ? hold : ROLL_SPEED;
    // On the face: hold, and above it only coast.
    if (onFace) return Math.min(desired, Math.max(lip, c.speed - 0.2));
    // Brake to the lip speed before the face with a dirt envelope (~0.45 g).
    return Math.min(desired, Math.sqrt(lip * lip + 2 * 0.45 * G * Math.max(0, toFace - 1)));
  }
}
'''
s=s[:start]+new+s[end:]
s=s.replace("private plan: { jump: JumpSurvey; clear: boolean } | null = null;","private plan: { jump: JumpSurvey; clear: boolean; locked: boolean } | null = null;")
open(p,'w').write(s)

p='src/simulation/offroad/dirt-bike-vehicle.ts'
s=open(p).read()
old="""    const chassis = this.pitch + this.riderBody * 0.06;
    const wanted = (this.landingTarget - chassis) / Math.max(0.12, this.landingIn) - this.pitchRate;"""
new="""    // Riders land rear wheel first: aim a little nose-up of the slope.
    const chassis = this.pitch + this.riderBody * 0.06,
      target = this.landingTarget + LANDING_NOSE_UP;
    const wanted = (target - chassis) / Math.max(0.12, this.landingIn) - this.pitchRate;"""
assert old in s
s=s.replace(old,new)
old="""/** Where the last flight ended"""
new="""/** Nose-up margin (rad) the pitch aid aims for over the landing slope. */
const LANDING_NOSE_UP = 0.1;
/** Where the last flight ended"""
assert old in s
s=s.replace(old,new,1)
open(p,'w').write(s)
