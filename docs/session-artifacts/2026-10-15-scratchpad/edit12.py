p='src/simulation/offroad/ai.ts'
s=open(p).read()
start=s.index("  /** Jump speed control: hold the speed whose flight lands on the landing\n   * zone; when the run-up cannot reach it, roll the feature. The choice is")
end=s.index("const previewPoint = trackPoint();")
new='''  /** Jump speed control: hold the speed whose flight lands on the landing
   * zone; when the run-up cannot reach it, roll the feature. The choice is
   * locked where the braking distance to the rolling speed runs out (a late
   * change of mind arrives at the lip at neither speed; traffic then waits
   * until the landing), and nobody brakes on a face (it noses down). A rider
   * on the ground inside a gap (rolled, or remounted after a fall) rolls on
   * over the landing mound. */
  protected override limitSpeed(desired: number, track: Track, race: RaceDirector) {
    const course = offroadCourse(track.circuit),
      c = this.rider,
      L = track.length;
    if (!course || c.airborne) return desired;
    const inside = course.jumpAt(c.s);
    if (inside && mod(c.s - inside.takeoff, L) < inside.end - inside.takeoff + 1 && mod(c.s - inside.start, L) > inside.takeoff - inside.start + 0.5) {
      this.plan = null;
      return inside.forgiving ? desired : Math.min(desired, ROLL_SPEED + 1.5);
    }
    const next = inside ? { jump: inside } : course.nextJump(c.s);
    if (!next) return desired;
    const j = next.jump,
      run = mod(j.takeoff - c.s + 1, L) - 1;
    if (run > 160 || run > L / 2) {
      this.plan = null;
      return desired;
    }
    const hold = jumpHoldSpeed(j),
      faceLength = j.takeoff - j.start,
      toFace = run - faceLength,
      onFace = toFace < 0.5;
    // Under a yellow flag nobody jumps: roll it. Otherwise clear the gap
    // only when the run-up and every other limit leave the hold speed.
    const flag = race.control.flags[c.id],
      yellow = flag === FLAG.YELLOW || flag === FLAG.DOUBLE_YELLOW;
    const brakeToRoll = (c.speed * c.speed - ROLL_SPEED * ROLL_SPEED) / (2 * 0.45 * G) + 4;
    const same = this.plan?.jump === j;
    if (!same || !this.plan!.locked || (yellow && this.plan!.clear && toFace > brakeToRoll - 2)) {
      const reachable = this.reach(c.speed, Math.max(0, toFace - 1), c.definition.ai.topSpeed);
      const clear = !yellow && reachable >= hold - (j.forgiving ? 0.8 : 0.25);
      if (!same) {
        if (clear) this.decisions.clears++;
        else this.decisions.rolls++;
      }
      this.plan = { jump: j, clear, locked: onFace || toFace < brakeToRoll };
    }
    const plan = this.plan!;
    if (!plan.clear) {
      if (onFace) return Math.min(desired, Math.max(ROLL_SPEED, Math.min(c.speed, ROLL_SPEED + 1)));
      return Math.min(desired, Math.sqrt(ROLL_SPEED * ROLL_SPEED + 2 * 0.45 * G * Math.max(0, toFace - 1)));
    }
    // Committed: the lip speed is the target (traffic waits for the landing).
    if (plan.locked) return onFace ? Math.max(hold, c.speed) : hold;
    return Math.min(desired, Math.sqrt(hold * hold + 2 * 0.45 * G * Math.max(0, toFace - 1)));
  }
}
'''
s=s[:start]+new+s[end:]
open(p,'w').write(s)
