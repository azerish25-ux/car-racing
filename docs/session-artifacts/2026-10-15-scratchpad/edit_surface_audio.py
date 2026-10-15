p = '/home/user/Experiment-3/.claude/worktrees/wf_466ee687-d89-1/src/audio/surface-audio.ts'
s = open(p).read()


def rep(a, b):
    global s
    assert s.count(a) == 1, a[:80]
    s = s.replace(a, b)


rep("""import { F, H, W, WHEEL_BASE, WHEEL_STRIDE, carBase } from '../simulation/protocol.ts';
import { SURFACE } from '../simulation/track.ts';
import { clamp, Random, TAU } from '../core/math.ts';""", """import {
  F,
  H,
  O,
  OFFROAD_BASE,
  W,
  WHEEL_BASE,
  WHEEL_STRIDE,
  carBase,
} from '../simulation/protocol.ts';
import { MATERIAL } from '../simulation/surface-material.ts';
import { SURFACE } from '../simulation/track.ts';
import { clamp, Random, TAU } from '../core/math.ts';
import { landingDuration, landingThump } from './airborne-audio.ts';""")
rep("""export interface ContactMix {
  asphalt: number;
  grass: number;
  gravel: number;
  kerb: number;""", """export interface ContactMix {
  asphalt: number;
  grass: number;
  gravel: number;
  /** Loose ground (terrain venues, open-world tracks): packed dirt, mud (wet
   * dirt counts toward it with the recorded soil moisture), sand and snow
   * (ice a glassy trace of it). Wheel slip on loose ground throws soil
   * instead of squealing, so it feeds these layers, not `scrub`. */
  dirt: number;
  mud: number;
  sand: number;
  snow: number;
  kerb: number;""")
rep("""  out.asphalt = out.grass = out.gravel = out.kerb = out.scrub = out.spray = out.flat = 0;""",
    """  out.asphalt = out.grass = out.gravel = out.kerb = out.scrub = out.spray = out.flat = 0;
  out.dirt = out.mud = out.sand = out.snow = 0;
  // Wet dirt sounds like mud: the share follows the soil moisture under the machine.
  const wet = smoothShare(frame[o + OFFROAD_BASE + O.MOISTURE]);""")
rep("""    if (surface === SURFACE.KERB) out.kerb += roll * 0.1;
    const power = Math.max(0, frame[p + W.SLIP_POWER]);
    slipPower += power;
    if (frame[p + W.SLIP] < -0.5) lockPower += power;
    if (frame[p + W.SLIP] > 0.3) spinPower += power;""", """    if (surface === SURFACE.KERB) out.kerb += roll * 0.1;
    const power = Math.max(0, frame[p + W.SLIP_POWER]);
    if (surface >= MATERIAL.DIRT && surface <= MATERIAL.GRAVEL_ROAD) {
      // Loose ground: rolling and slip both throw soil (no tyre squeal).
      const thrown = roll + clamp(power / 300000, 0, 0.5);
      if (surface === MATERIAL.DIRT) {
        out.dirt += thrown * 0.19 * (1 - wet);
        out.mud += thrown * 0.17 * wet;
      } else if (surface === MATERIAL.MUD) out.mud += thrown * 0.17;
      else if (surface === MATERIAL.SAND) out.sand += thrown * 0.2;
      else if (surface === MATERIAL.SNOW) out.snow += thrown * 0.12;
      else if (surface === MATERIAL.ICE) out.snow += thrown * 0.04;
      else out.gravel += thrown * 0.18;
    } else {
      slipPower += power;
      if (frame[p + W.SLIP] < -0.5) lockPower += power;
      if (frame[p + W.SLIP] > 0.3) spinPower += power;
    }""")
rep("""  out.spray = clamp(out.spray, 0, 0.22);""", """  out.spray = clamp(out.spray, 0, 0.22);
  for (const key of ['dirt', 'mud', 'sand', 'snow', 'gravel'] as const)
    out[key] = clamp(out[key], 0, 0.3);""")
rep("""export const newContactMix = (): ContactMix => ({
  asphalt: 0,
  grass: 0,
  gravel: 0,""", """/** 0 dry .. 1 wet soil, from the recorded moisture (0..1, 0.45 starts to tell). */
function smoothShare(moisture: number) {
  const t = clamp(((Number.isFinite(moisture) ? moisture : 0) - 0.45) / 0.4, 0, 1);
  return t * t * (3 - 2 * t);
}
export const newContactMix = (): ContactMix => ({
  asphalt: 0,
  grass: 0,
  gravel: 0,
  dirt: 0,
  mud: 0,
  sand: 0,
  snow: 0,""")
rep("""  private layers = {} as Record<
    | 'asphalt'
    | 'grass'
    | 'gravel'
    | 'kerb'""", """  private layers = {} as Record<
    | 'asphalt'
    | 'grass'
    | 'gravel'
    | 'dirt'
    | 'mud'
    | 'sand'
    | 'snow'
    | 'land'
    | 'clack'
    | 'kerb'""")
rep("""  private kerbEnvelope = 0;
  private disposed = false;""", """  private kerbEnvelope = 0;
  /** Flight state of the last snapshot, the vertical speed while airborne,
   * the last recorded landing speed and bottoming level (touchdown cues). */
  private wasAirborne = false;
  private airVy = 0;
  private lastLandingSpeed = 0;
  private lastBottom = 0;
  /** Touchdowns heard and the last one's impact speed (diagnostics). */
  landings = 0;
  lastLanding = 0;
  private disposed = false;""")
rep("""      ['gravel', 'bandpass', 2400, 0.7],""", """      ['gravel', 'bandpass', 2400, 0.7],
      // Loose ground: a dry mid crunch, a low wet slap, a high granular hiss
      // and a muffled creak; touchdown thump and bump-stop clack below.
      ['dirt', 'bandpass', 900, 0.6],
      ['mud', 'lowpass', 330, 1.1],
      ['sand', 'bandpass', 3600, 0.5],
      ['snow', 'bandpass', 1500, 1],
      ['land', 'lowpass', 110, 0.7],
      ['clack', 'bandpass', 420, 1.4],""")
rep("""    for (const key of ['asphalt', 'grass', 'gravel', 'scrub', 'spray', 'rain', 'bottom'] as const)""",
    """    for (const key of [
      'asphalt',
      'grass',
      'gravel',
      'dirt',
      'mud',
      'sand',
      'snow',
      'scrub',
      'spray',
      'rain',
      'bottom',
    ] as const)""")
rep("""    if (continuity && gear !== this.lastGear) this.pulse('shift', 0.13, time, 0.055);
    this.lastImpact = impact;""", """    if (continuity && gear !== this.lastGear) this.pulse('shift', 0.13, time, 0.055);
    // Touchdown: the suspension thump scales with the normal impact speed
    // (the recorded landing speed of a dirt bike, else the vertical speed
    // the machine fell at); a bump-stop hit adds its own clack.
    const k = o + OFFROAD_BASE,
      airborne = frame[k + O.AIRBORNE] > 0.5,
      landingSpeed = frame[k + O.LANDING_SPEED],
      bottom = frame[k + O.BOTTOM];
    if (continuity && this.wasAirborne && !airborne) {
      const recorded = landingSpeed !== this.lastLandingSpeed ? landingSpeed : 0,
        hit = Math.max(recorded, -this.airVy);
      this.lastLanding = hit;
      this.landings++;
      const level = landingThump(hit);
      if (level > 0) this.pulse('land', level, time, landingDuration(hit));
    }
    if (airborne) this.airVy = Number.isFinite(frame[o + F.VY]) ? frame[o + F.VY] : 0;
    if (continuity && bottom > this.lastBottom + 0.05)
      this.pulse('clack', clamp(bottom, 0, 1) * 0.45, time, 0.09);
    this.wasAirborne = airborne;
    this.lastLandingSpeed = landingSpeed;
    this.lastBottom = bottom;
    this.lastImpact = impact;""")
rep("""    this.lastLoad.fill(0);
    this.kerbEnvelope = 0;
    for (const name of ['impact', 'shift'] as const) {""", """    this.lastLoad.fill(0);
    this.kerbEnvelope = 0;
    this.wasAirborne = false;
    this.airVy = this.lastLandingSpeed = this.lastBottom = 0;
    for (const name of ['impact', 'shift', 'land', 'clack'] as const) {""")
rep("""  private pulse(name: 'impact' | 'shift', level: number, time: number, duration: number) {""",
    """  private pulse(
    name: 'impact' | 'shift' | 'land' | 'clack',
    level: number,
    time: number,
    duration: number,
  ) {""")
open(p, 'w').write(s)
print('ok')
