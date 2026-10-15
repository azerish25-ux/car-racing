import { mod } from '../core/math.ts';
import { F, H, W, WHEEL_BASE, WHEEL_STRIDE, carBase } from '../simulation/protocol.ts';
import * as protocol from '../simulation/protocol.ts';
import type { DisciplineId } from './registry.ts';

/** Licence tests (GAME_DESIGN §3): one skill each, scored by a measured
 * quantity from the session snapshot, never by finishing position. A test
 * names the snapshot channels it needs; when a channel is not published
 * (lean before the motorcycle slice) the test is shown as coming. */
export const MEDALS = ['bronze', 'silver', 'gold'] as const;
export type Medal = (typeof MEDALS)[number];
export const LICENCE_IDS = ['braking', 'cornering', 'wet', 'lean', 'jump'] as const;
export type LicenceId = (typeof LICENCE_IDS)[number];
export interface LicenceTest {
  id: LicenceId;
  discipline: DisciplineId;
  name: string;
  skill: string;
  /** What the player does, in one instruction. */
  brief: string;
  metric: { label: string; unit: string; better: 'lower' | 'higher'; digits: number };
  /** Medal limits in metric units: lower-is-better limits are maxima. */
  thresholds: Readonly<Record<Medal, number>>;
  channels: readonly string[];
  weather: 'clear' | 'rain';
  /** Venue features the test needs beyond the discipline's venues. */
  needs?: 'jump';
}
export const LICENCE_TESTS: Readonly<Record<LicenceId, LicenceTest>> = Object.freeze({
  braking: {
    id: 'braking',
    discipline: 'circuit-cars',
    name: 'Braking marker',
    skill: 'Braking',
    brief:
      'Pass the gate board above the gate speed, then brake and stop with the car on the marker.',
    metric: { label: 'Distance from marker', unit: 'm', better: 'lower', digits: 1 },
    thresholds: { gold: 1.5, silver: 4, bronze: 8 },
    channels: ['S', 'SPEED', 'BRAKE'],
    weather: 'clear',
  },
  cornering: {
    id: 'cornering',
    discipline: 'circuit-cars',
    name: 'Cornering line',
    skill: 'Cornering',
    brief:
      'Drive the marked corner on the racing line at pace. The average distance from the line is scored.',
    metric: { label: 'Average line deviation', unit: 'm', better: 'lower', digits: 2 },
    thresholds: { gold: 0.75, silver: 1.5, bronze: 2.5 },
    channels: ['S', 'LATERAL', 'SPEED', 'LAP_VALID'],
    weather: 'clear',
  },
  wet: {
    id: 'wet',
    discipline: 'circuit-cars',
    name: 'Wet control',
    skill: 'Wet weather',
    brief:
      'Complete one valid flying lap in heavy rain at the pace gate. The largest body slide angle is scored.',
    metric: { label: 'Peak slide angle', unit: '°', better: 'lower', digits: 1 },
    thresholds: { gold: 4, silver: 7, bronze: 11 },
    channels: ['S', 'LAPS', 'SPEED', 'SIDESLIP', 'LAST_LAP_VALID'],
    weather: 'rain',
  },
  lean: {
    id: 'lean',
    discipline: 'road-bikes',
    name: 'Lean and trail braking',
    skill: 'Trail braking',
    brief:
      'Carry the brake into the marked corner while the bike leans in. The share of corner entry spent braking while leaned is scored.',
    metric: { label: 'Trail-braking overlap', unit: '%', better: 'higher', digits: 0 },
    thresholds: { gold: 50, silver: 35, bronze: 20 },
    channels: ['S', 'SPEED', 'BRAKE', 'LEAN'],
    weather: 'clear',
  },
  jump: {
    id: 'jump',
    discipline: 'off-road',
    name: 'Jump landing',
    skill: 'Jump landing',
    brief:
      'Clear the jump and land with the chassis parallel to the landing slope. The pitch error at touchdown is scored.',
    metric: { label: 'Landing pitch error', unit: '°', better: 'lower', digits: 1 },
    thresholds: { gold: 3, silver: 6, bronze: 10 },
    channels: ['PITCH', 'AIRBORNE', 'SPEED'],
    weather: 'clear',
    needs: 'jump',
  },
});
export const MEDAL_RANK: Readonly<Record<Medal, number>> = Object.freeze({
  bronze: 1,
  silver: 2,
  gold: 3,
});
export function medalAtLeast(medal: Medal | null | undefined, required: Medal) {
  return !!medal && MEDAL_RANK[medal] >= MEDAL_RANK[required];
}
/** The medal a measured value earns; null outside the bronze limit. */
export function medalFor(test: LicenceTest, value: number): Medal | null {
  if (!Number.isFinite(value)) return null;
  const meets = (limit: number) =>
    test.metric.better === 'lower' ? value <= limit : value >= limit;
  for (const medal of [...MEDALS].reverse()) if (meets(test.thresholds[medal])) return medal;
  return null;
}
export function formatMetric(test: LicenceTest, value: number | null) {
  return value === null || !Number.isFinite(value)
    ? '—'
    : `${value.toFixed(test.metric.digits)} ${test.metric.unit}`
        .replace(' %', '%')
        .replace(' °', '°');
}

/** One measured instant of the player's machine. */
export interface LicenceSample {
  t: number;
  s: number;
  laps: number;
  speed: number;
  lateral: number;
  brake: number;
  lapValid: boolean;
  lastLapValid: boolean;
  lastLap: number;
  /** Body sideslip angle (rad): velocity direction relative to the nose. */
  sideslip: number;
  /** Chassis pitch (rad, nose up +). */
  pitch: number;
  airborne: boolean;
  /** Bike lean (rad); null without a two-wheel block. */
  lean: number | null;
}
/** Rotate a body vector by the snapshot quaternion. */
export function rotate(q: readonly number[], v: readonly [number, number, number]) {
  const [x, y, z, w] = q,
    [vx, vy, vz] = v;
  // v' = v + w t + u × t, t = 2 u × v (unit quaternion, u = vector part).
  const tx = 2 * (y * vz - z * vy),
    ty = 2 * (z * vx - x * vz),
    tz = 2 * (x * vy - y * vx);
  return [
    vx + w * tx + (y * tz - z * ty),
    vy + w * ty + (z * tx - x * tz),
    vz + w * tz + (x * ty - y * tx),
  ] as const;
}
/** Two-wheel lean channel, when the protocol publishes one (B.LEAN in a
 * per-entrant tail at BIKE_BASE). */
function leanOffset(module: Record<string, unknown> = protocol) {
  const b = module.B as Record<string, number> | undefined;
  return b && typeof module.BIKE_BASE === 'number' && typeof b.LEAN === 'number'
    ? module.BIKE_BASE + b.LEAN
    : null;
}
const LEAN = leanOffset();
/** Read the measured sample for `car` from a snapshot. */
export function sampleFrame(frame: Float32Array, car = 0): LicenceSample {
  const o = carBase(car),
    q = [frame[o + F.QX], frame[o + F.QY], frame[o + F.QZ], frame[o + F.QW]];
  const forward = rotate(q, [0, 0, 1]),
    left = rotate(q, [1, 0, 0]);
  const vx = frame[o + F.VX],
    vy = frame[o + F.VY],
    vz = frame[o + F.VZ];
  const along = vx * forward[0] + vy * forward[1] + vz * forward[2],
    across = vx * left[0] + vy * left[1] + vz * left[2];
  let airborne = true;
  for (let w = 0; w < 4; w++)
    if (frame[o + WHEEL_BASE + w * WHEEL_STRIDE + W.LOAD] > 60) airborne = false;
  return {
    t: frame[H.TIME],
    s: frame[o + F.S],
    laps: frame[o + F.LAPS],
    speed: frame[o + F.SPEED],
    lateral: frame[o + F.LATERAL],
    brake: frame[o + F.BRAKE],
    lapValid: frame[o + F.LAP_VALID] > 0,
    lastLapValid: frame[o + F.LAST_LAP_VALID] > 0,
    lastLap: frame[o + F.LAST_LAP],
    sideslip: Math.hypot(along, across) > 1 ? Math.atan2(across, Math.abs(along)) : 0,
    pitch: Math.asin(Math.max(-1, Math.min(1, forward[1]))),
    airborne,
    lean: LEAN === null ? null : frame[o + LEAN],
  };
}

/** Where on the venue a test is measured, computed from the track by the
 * caller (`licenceCourse` in course.ts) so this module stays pure. */
export interface LicenceCourse {
  length: number;
  /** Braking: marker and gate lap distances, gate speed (m/s). */
  marker: number;
  gate: number;
  gateSpeed: number;
  /** Cornering/lean: measured window centre and half-length (m). */
  corner: number;
  window: number;
  /** Minimum average speed through the window or lap (m/s). */
  paceSpeed: number;
  /** Racing-line lateral offset at lap distance s. */
  lineAt(s: number): number;
  /** Jump test: centre (lap distance, m) and half-length of the surveyed
   * landing zone, and its slope (rad, nose-up +). NaN when the venue has no
   * surveyed jump, and then nothing is scored. */
  landing: number;
  landingWindow: number;
  landingPitch: number;
  cornerName: string;
}
export interface LicenceOutcome {
  test: LicenceId;
  /** Measured value in metric units, or null when no valid attempt. */
  value: number | null;
  medal: Medal | null;
  valid: boolean;
  /** Plain-language account of the measurement. */
  detail: string;
}
/** Signed distance (m) from `from` to `s` along the lap, in (-L/2, L/2]. */
export const lapDelta = (s: number, from: number, length: number) =>
  mod(s - from + length / 2, length) - length / 2;
const STOP_SPEED = 0.5;
/** Incremental measurement of one attempt. `observe` returns the outcome
 * once, when the attempt is complete; until then `status` is a HUD line. */
export class LicenceAttempt {
  private armed = false;
  private sum = 0;
  private count = 0;
  private speedSum = 0;
  private peak = 0;
  private invalid = '';
  private startLap = -1;
  private startTime = 0;
  private airTime = 0;
  private lastT = NaN;
  private wasAirborne = false;
  private overlap = 0;
  private entry = 0;
  private maxLean = 0;
  private done: LicenceOutcome | null = null;
  message = '';
  constructor(
    readonly test: LicenceTest,
    readonly course: LicenceCourse,
  ) {
    this.message = this.idleMessage();
  }
  private idleMessage() {
    const c = this.course;
    switch (this.test.id) {
      case 'braking':
        return `PASS THE GATE ABOVE ${Math.round(c.gateSpeed * 3.6)} KM/H · STOP ON THE MARKER`;
      case 'cornering':
        return `${c.cornerName}: FOLLOW THE RACING LINE ABOVE ${Math.round(c.paceSpeed * 3.6)} KM/H`;
      case 'wet':
        return `CROSS THE LINE TO START A FLYING LAP · AVERAGE ABOVE ${Math.round(c.paceSpeed * 3.6)} KM/H`;
      case 'lean':
        return `${c.cornerName}: TRAIL THE BRAKE INTO THE LEAN`;
      case 'jump':
        return 'CLEAR THE JUMP · MATCH THE LANDING SLOPE';
    }
  }
  get complete() {
    return this.done !== null;
  }
  private finish(value: number | null, detail: string, valid = value !== null) {
    this.done = {
      test: this.test.id,
      value,
      medal: valid && value !== null ? medalFor(this.test, value) : null,
      valid,
      detail,
    };
    this.message = 'ATTEMPT MEASURED';
    return this.done;
  }
  observe(sample: LicenceSample): LicenceOutcome | null {
    if (this.done) return null;
    const c = this.course,
      dt = Number.isFinite(this.lastT) ? Math.max(0, sample.t - this.lastT) : 0;
    this.lastT = sample.t;
    switch (this.test.id) {
      case 'braking': {
        const d = lapDelta(sample.s, c.marker, c.length),
          gate = lapDelta(c.gate, c.marker, c.length);
        if (!this.armed) {
          if (Math.abs(d - gate) < 6 && sample.speed > 3) {
            if (sample.speed >= c.gateSpeed) {
              this.armed = true;
              this.message = 'BRAKE · STOP ON THE MARKER';
            } else
              this.message = `GATE AT ${Math.round(sample.speed * 3.6)} KM/H · NEEDS ${Math.round(c.gateSpeed * 3.6)} · GO AGAIN NEXT LAP`;
          }
          return null;
        }
        if (d > 60) {
          this.armed = false;
          this.message = 'OVERSHOT · TRY AGAIN NEXT LAP';
          return null;
        }
        if (sample.speed < STOP_SPEED)
          return this.finish(
            Math.abs(d),
            `Stopped ${Math.abs(d).toFixed(1)} m ${d >= 0 ? 'past' : 'short of'} the marker after a ${Math.round(c.gateSpeed * 3.6)} km/h gate.`,
          );
        return null;
      }
      case 'cornering':
      case 'lean': {
        const d = lapDelta(sample.s, c.corner, c.length);
        const inside = d >= -c.window && d <= c.window;
        if (!this.armed) {
          // Arm only on a forward entry at the window's start, on a lap that
          // is still valid: the lap flag stays false after a breach anywhere
          // earlier on the lap, which says nothing about this corner.
          if (inside && d < -c.window + 15 && sample.speed > 3) {
            if (this.test.id === 'cornering' && !sample.lapValid) {
              this.message = 'LAP ALREADY INVALID · TRY THE CORNER AGAIN NEXT LAP';
              return null;
            }
            this.armed = true;
            this.sum = this.count = this.speedSum = this.overlap = this.entry = this.maxLean = 0;
            this.invalid = '';
            this.message = this.test.id === 'lean' ? 'LEAN · TRAIL THE BRAKE' : 'ON THE LINE';
          }
          return null;
        }
        if (inside) {
          this.count++;
          this.speedSum += sample.speed;
          if (this.test.id === 'cornering') {
            this.sum += Math.abs(sample.lateral - c.lineAt(sample.s));
            // Armed on a valid lap, so a false flag here is a breach in the corner.
            if (!sample.lapValid) this.invalid = 'Track limits exceeded in the corner.';
          } else {
            const lean = Math.abs(sample.lean ?? 0);
            this.maxLean = Math.max(this.maxLean, lean);
            if (d <= 0) {
              this.entry++;
              if (sample.brake > 0.08 && lean > 0.17) this.overlap++;
            }
          }
          return null;
        }
        if (d > c.window && d < c.window + 40) {
          const pace = this.count ? this.speedSum / this.count : 0;
          if (pace < c.paceSpeed) {
            this.armed = false;
            this.message = `${Math.round(pace * 3.6)} KM/H AVERAGE · NEEDS ${Math.round(c.paceSpeed * 3.6)} · GO AGAIN NEXT LAP`;
            return null;
          }
          if (this.test.id === 'cornering') {
            if (this.invalid) return this.finish(null, this.invalid, false);
            const mean = this.sum / Math.max(1, this.count);
            return this.finish(
              mean,
              `Averaged ${mean.toFixed(2)} m from the racing line through ${c.cornerName} at ${Math.round(pace * 3.6)} km/h.`,
            );
          }
          if (this.maxLean < 0.5)
            return this.finish(
              null,
              'The bike never leaned past 29°; drive the corner at pace.',
              false,
            );
          const share = (100 * this.overlap) / Math.max(1, this.entry);
          return this.finish(
            share,
            `Braked while leaned for ${share.toFixed(0)}% of the corner entry, peak lean ${Math.round((this.maxLean * 180) / Math.PI)}°.`,
          );
        }
        // Left the window backwards, or jumped past it (pit or reset).
        this.armed = false;
        this.message = this.idleMessage();
        return null;
      }
      case 'wet': {
        if (this.startLap < 0) {
          this.startLap = sample.laps;
          return null;
        }
        if (!this.armed) {
          if (sample.laps > this.startLap) {
            this.armed = true;
            this.startLap = sample.laps;
            this.startTime = sample.t;
            this.peak = 0;
            this.message = 'FLYING LAP · KEEP IT STRAIGHT';
          }
          return null;
        }
        if (sample.speed > 12) this.peak = Math.max(this.peak, Math.abs(sample.sideslip));
        if (sample.laps > this.startLap) {
          const time = sample.lastLap > 0 ? sample.lastLap : sample.t - this.startTime,
            pace = c.length / Math.max(1e-3, time),
            degrees = (this.peak * 180) / Math.PI;
          // An invalid or slow lap is not measured; the next lap is another try.
          if (!sample.lastLapValid || pace < c.paceSpeed) {
            this.startLap = sample.laps;
            this.startTime = sample.t;
            this.peak = 0;
            this.message = !sample.lastLapValid
              ? 'LAP INVALID (TRACK LIMITS) · GO AGAIN'
              : `LAP AVERAGED ${Math.round(pace * 3.6)} KM/H · NEEDS ${Math.round(c.paceSpeed * 3.6)} · GO AGAIN`;
            return null;
          }
          return this.finish(
            degrees,
            `Peak slide angle ${degrees.toFixed(1)}° on a valid wet lap averaging ${Math.round(pace * 3.6)} km/h.`,
          );
        }
        return null;
      }
      case 'jump': {
        if (!Number.isFinite(c.landing + c.landingPitch)) {
          this.message = 'NO SURVEYED JUMP AT THIS VENUE';
          return null;
        }
        if (sample.airborne) {
          this.airTime += dt;
          this.wasAirborne = true;
          return null;
        }
        const landed = this.wasAirborne && this.airTime >= 0.25,
          air = this.airTime;
        this.wasAirborne = false;
        this.airTime = 0;
        if (!landed) return null;
        // Only a touchdown in the surveyed landing zone is the jump; a crest
        // or kerb hop elsewhere on the lap is not scored.
        if (Math.abs(lapDelta(sample.s, c.landing, c.length)) > c.landingWindow) {
          this.message = 'THAT WAS NOT THE MARKED JUMP · CLEAR THE JUMP';
          return null;
        }
        const error = (Math.abs(sample.pitch - c.landingPitch) * 180) / Math.PI;
        return this.finish(
          error,
          `Landed after ${air.toFixed(2)} s in the air, ${error.toFixed(1)}° from the ${Math.round(Math.abs((c.landingPitch * 180) / Math.PI))}° landing slope.`,
        );
      }
    }
  }
}
/** Score a recorded sequence (tests, replays): the same measurement. */
export function scoreSamples(
  test: LicenceTest,
  course: LicenceCourse,
  samples: Iterable<LicenceSample>,
): LicenceOutcome | null {
  const attempt = new LicenceAttempt(test, course);
  for (const sample of samples) {
    const outcome = attempt.observe(sample);
    if (outcome) return outcome;
  }
  return null;
}
