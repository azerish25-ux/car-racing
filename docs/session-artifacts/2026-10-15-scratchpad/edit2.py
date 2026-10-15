p='src/simulation/offroad/ai.ts'
s=open(p).read()
start=s.index("/** Calibrated ratio of the speed")
end=s.index("/** Off-road rider AI (WP40)")
s=s[:start]+'''/** Take-off speed the sprung chassis adds to the speed held up the face
 * (m/s): the springs rebound off the lip and the flight starts slightly
 * behind the point-mass lip. Measured per feature kind on the production
 * terrain by scripts/offroad-calibration.ts (the AI's lip speeds there must
 * land on every surveyed landing face). */
export const TAKEOFF_GAIN: Readonly<Record<JumpSurvey['kind'], number>> = Object.freeze({
  tabletop: 0.45,
  'step-up': 0.45,
  crest: 0.3,
  kicker: 1.0,
  double: 0.95,
  triple: 1.6,
});
/** Lip speed (m/s) a rider rolls a feature at: below it the bike stays on the ground. */
export const ROLL_SPEED = 2.5;
/** The speed to hold up the face of `j` so the flight lands on its landing
 * zone (tabletops a little short: the deck is the safe side). */
export function jumpHoldSpeed(j: JumpSurvey) {
  const aim = j.landing - (j.forgiving ? 0.15 * j.landingLength : 0),
    v = takeoffSpeed(aim - j.takeoff, j.lipHeight - j.landingHeight, j.lipAngle);
  return Number.isFinite(v) ? Math.max(ROLL_SPEED, v - TAKEOFF_GAIN[j.kind]) : 12;
}
'''+s[end:]
old=s[s.index("  /** Jump speed control: never faster"):s.index("const previewPoint = trackPoint();")]
new='''  /** Jump speed control: hold the speed whose flight lands on the landing
   * zone; when the run-up cannot reach it, take a forgiving feature as fast
   * as possible and roll a gap jump. No braking on a face (it noses down). */
  protected override limitSpeed(desired: number, track: Track, race: RaceDirector) {
    void race;
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
    const hold = jumpHoldSpeed(j);
    if (!this.plan || this.plan.jump !== j) {
      // Can the run-up reach the hold speed? (dirt traction ~0.4 g)
      const reachable = Math.sqrt(c.speed * c.speed + 2 * 0.4 * G * Math.max(0, run - 4));
      const clear = j.forgiving || reachable >= hold - 0.3;
      this.plan = { jump: j, clear };
      if (clear) this.decisions.clears++;
      else this.decisions.rolls++;
    }
    const lip = this.plan.clear ? hold : ROLL_SPEED;
    const onFace = mod(c.s - j.start, track.length) < j.takeoff - j.start + 0.5;
    // On the face: hold, and above it only coast.
    if (onFace) return Math.min(desired, Math.max(lip, c.speed - 0.2));
    // Brake to the lip speed before the face with a dirt envelope (~0.45 g).
    const toFace = Math.max(0, mod(j.start - c.s, track.length) - 1);
    return Math.min(desired, Math.sqrt(lip * lip + 2 * 0.45 * G * toFace));
  }
}
'''
s=s.replace(old,new)
open(p,'w').write(s)
