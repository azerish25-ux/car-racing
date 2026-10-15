import {
  F,
  H,
  W,
  WHEEL_BASE,
  WHEEL_STRIDE,
  carBase,
  HEADER,
  CAR_STRIDE,
} from '../simulation/protocol.ts';
import { PHASE } from '../simulation/race.ts';
import type { StartSlot } from '../simulation/config.ts';

/** Additional observations in the existing presentation capture, not a second
 * simulation or a driving controller. Distances are metres and time is seconds.
 * A positive pool count is evidence of emitted spray, not pixel visibility. */
export const RACE_REVIEW_COLUMNS = [
  'race_phase',
  'speed',
  'opponents',
  'close_rival',
  'close_gap',
  'leader',
  'leader_gap',
  'in_pit',
  'pit_phase',
  'pit_clock',
  'pit_stops',
  'jack_height',
  'unloaded_wheels',
  'spray_particles',
  'crew_actors',
  'contact_water',
  'leader_contact_water',
] as const;
export interface RaceReviewFrame {
  racePhase: number;
  speed: number;
  opponents: number;
  closeRival: number;
  closeGap: number;
  leader: number;
  leaderGap: number;
  inPit: number;
  pitPhase: number;
  pitClock: number;
  pitStops: number;
  jackHeight: number;
  unloadedWheels: number;
  sprayParticles: number;
  crewActors: number;
  contactWater: number;
  leaderWater: number;
}
export function raceReviewFrame(): RaceReviewFrame {
  return {
    racePhase: 0,
    speed: 0,
    opponents: 0,
    closeRival: -1,
    closeGap: -1,
    leader: -1,
    leaderGap: -1,
    inPit: 0,
    pitPhase: 0,
    pitClock: 0,
    pitStops: 0,
    jackHeight: 0,
    unloadedWheels: 0,
    sprayParticles: 0,
    crewActors: 0,
    contactWater: 0,
    leaderWater: 0,
  };
}
/** Copy primitive observations from the frame actually presented, without
 * stats(), Vector3 allocations, another track query, or writes to the snapshot. */
export function readRaceReviewFrame(
  frame: Float32Array,
  follow: number,
  sprayParticles: number,
  crewActors: number,
  out: RaceReviewFrame,
) {
  const b = carBase(follow),
    count = frame[H.CARS],
    length = frame[H.LENGTH];
  if (
    !Number.isInteger(count) ||
    count < 1 ||
    count > 12 ||
    !Number.isInteger(follow) ||
    follow < 0 ||
    follow >= count ||
    frame.length !== HEADER + count * CAR_STRIDE ||
    !Number.isFinite(length) ||
    length <= 0
  )
    throw new Error('Invalid racing review snapshot');
  out.racePhase = frame[H.PHASE];
  out.speed = frame[b + F.SPEED];
  out.inPit = frame[b + F.IN_PIT];
  out.pitPhase = frame[b + F.PIT_PHASE];
  out.pitClock = frame[b + F.PIT_CLOCK];
  out.pitStops = frame[b + F.PIT_STOPS];
  out.jackHeight = frame[b + F.JACK_HEIGHT];
  out.unloadedWheels = 0;
  out.contactWater = out.leaderWater = 0;
  for (let w = 0; w < 4; w++) {
    const o = b + WHEEL_BASE + w * WHEEL_STRIDE;
    if (frame[o + W.LOAD] < 50) out.unloadedWheels++;
    if (frame[o + W.LOAD] > 20) out.contactWater += Math.max(0, frame[o + W.WATER]) / 4;
  }
  out.sprayParticles = sprayParticles;
  out.crewActors = crewActors;
  out.opponents = 0;
  out.closeRival = out.leader = out.closeGap = out.leaderGap = -1;
  const x = frame[b + F.QX],
    y = frame[b + F.QY],
    z = frame[b + F.QZ],
    w = frame[b + F.QW];
  const fx = 2 * (x * z + w * y),
    fz = 1 - 2 * (x * x + y * y),
    horizontal = Math.hypot(fx, fz);
  const playerEligible =
    !out.inPit &&
    !frame[b + F.RETIRED] &&
    !frame[b + F.FINISH] &&
    out.speed > 5 &&
    horizontal > 0.5;
  for (let id = 0; id < count; id++) {
    if (id === follow) continue;
    const o = carBase(id);
    if (frame[o + F.RETIRED] || frame[o + F.FINISH]) continue;
    out.opponents++;
    if (!playerEligible || frame[o + F.IN_PIT] || frame[o + F.SPEED] <= 5) continue;
    const dx = frame[o + F.X] - frame[b + F.X],
      dy = frame[o + F.Y] - frame[b + F.Y],
      dz = frame[o + F.Z] - frame[b + F.Z];
    if (Math.abs(dy) > 2.5) continue; // Do not count a car on the bridge above us.
    const qx = frame[o + F.QX],
      qy = frame[o + F.QY],
      qz = frame[o + F.QZ],
      qw = frame[o + F.QW],
      rx = 2 * (qx * qz + qw * qy),
      rz = 1 - 2 * (qx * qx + qy * qy),
      rh = Math.hypot(rx, rz);
    if (rh <= 0.5 || (fx * rx + fz * rz) / (horizontal * rh) < 0.65) continue;
    // Euclidean proximity alone can confuse adjacent hairpins or separate levels.
    let ds = frame[o + F.S] - frame[b + F.S];
    if (ds > length / 2) ds -= length;
    if (ds < -length / 2) ds += length;
    const gap = Math.hypot(dx, dy, dz),
      ahead = (dx * fx + dz * fz) / horizontal,
      lateral = Math.abs(dx * fz - dz * fx) / horizontal;
    if (gap <= 18 && Math.abs(ds) <= 22 && (out.closeGap < 0 || gap < out.closeGap)) {
      out.closeRival = id;
      out.closeGap = gap;
    }
    if (
      ahead >= 3 &&
      ahead <= 35 &&
      ds > 0 &&
      ds <= 40 &&
      lateral <= 3.5 &&
      (out.leaderGap < 0 || gap < out.leaderGap)
    ) {
      out.leader = id;
      out.leaderGap = gap;
      out.leaderWater = 0;
      for (let w = 0; w < 4; w++) {
        const p = o + WHEEL_BASE + w * WHEEL_STRIDE;
        if (frame[p + W.LOAD] > 20) out.leaderWater += Math.max(0, frame[p + W.WATER]) / 4;
      }
    }
  }
}
export function raceReviewValues(f: RaceReviewFrame): number[] {
  return [
    f.racePhase,
    f.speed,
    f.opponents,
    f.closeRival,
    f.closeGap,
    f.leader,
    f.leaderGap,
    f.inPit,
    f.pitPhase,
    f.pitClock,
    f.pitStops,
    f.jackHeight,
    f.unloadedWheels,
    f.sprayParticles,
    f.crewActors,
    f.contactWater,
    f.leaderWater,
  ];
}
export function restoreRaceReviewFrame(row: readonly number[], out: RaceReviewFrame) {
  if (row.length !== RACE_REVIEW_COLUMNS.length || row.some((v) => !Number.isFinite(v)))
    throw new Error('Invalid racing observation row');
  [
    out.racePhase,
    out.speed,
    out.opponents,
    out.closeRival,
    out.closeGap,
    out.leader,
    out.leaderGap,
    out.inPit,
    out.pitPhase,
    out.pitClock,
    out.pitStops,
    out.jackHeight,
    out.unloadedWheels,
    out.sprayParticles,
    out.crewActors,
    out.contactWater,
    out.leaderWater,
  ] = row;
}
export function validRaceReviewFrame(f: RaceReviewFrame, followedCar: number) {
  if (
    ![
      f.racePhase,
      f.opponents,
      f.closeRival,
      f.leader,
      f.inPit,
      f.pitPhase,
      f.pitStops,
      f.unloadedWheels,
      f.sprayParticles,
      f.crewActors,
    ].every(Number.isInteger)
  )
    return false;
  if (
    f.racePhase < 0 ||
    f.racePhase > 3 ||
    f.opponents < 0 ||
    f.opponents > 11 ||
    f.inPit < 0 ||
    f.inPit > 1 ||
    f.pitPhase < 0 ||
    f.pitPhase > 6 ||
    f.pitClock < 0 ||
    f.pitStops < 0 ||
    f.speed < 0 ||
    f.jackHeight < 0 ||
    f.unloadedWheels < 0 ||
    f.unloadedWheels > 4 ||
    f.sprayParticles < 0 ||
    f.sprayParticles > 1200 ||
    f.crewActors < 0 ||
    f.crewActors > 15 ||
    f.contactWater < 0 ||
    f.leaderWater < 0
  )
    return false;
  for (const [id, gap, max] of [
    [f.closeRival, f.closeGap, 18],
    [f.leader, f.leaderGap, 36],
  ])
    if (
      id < -1 ||
      id > 11 ||
      id === followedCar ||
      (id === -1
        ? gap !== -1
        : gap < 0 || gap > max || f.opponents === 0 || f.inPit !== 0 || f.speed <= 5)
    )
      return false;
  return true;
}
export const isRacingWorkload = (workload: string) =>
  ['grid-start', 'close-racing', 'wet-following', 'pit-service'].includes(workload);
/** Paddock START slot (the session menu's START option) a racing workload is
 * recorded from; absent keeps pole. The event is a property of the
 * deterministic session that slot produces, so the hosted review
 * (e2e/29-populated-race-review.spec.ts) and its headless regression
 * (tests/wet-review-start.test.ts) read the same slot. A wet-following
 * session must also follow a wet car after the launch: hosted software
 * rendering has exceeded the one-second continuity gate near the launch
 * (docs/PHASE_27H6_PUBLICATION.md), so following that exists only there is
 * not reliably observable. */
export const REVIEW_START_SLOTS: Readonly<Partial<Record<string, StartSlot>>> = Object.freeze({
  'close-racing': 'midfield',
  'wet-following': 'back',
});

/** Qualifies events from adjacent, advancing simulation observations. Holding a
 * snapshot, changing the label, or waiting thirty wall-clock seconds is not an
 * event. Gaps >1s break duration runs rather than inventing unseen behaviour. */
export class RaceReviewEvents {
  private lastTime = NaN;
  private last: RaceReviewFrame = raceReviewFrame();
  private lastRain = 0;
  private lastWater = 0;
  private closeRun = 0;
  private wetRun = 0;
  private launchRun = 0;
  private gridArmed = false;
  private pitInitialStops = -1;
  private pitEntryArmed = false;
  private pitRemoval = false;
  private lastPhase = -1;
  gridLaunched = false;
  closeSeconds = 0;
  wetFollowingSeconds = 0;
  pitStage: 'unseen' | 'entry' | 'service' | 'released' | 'exit' = 'unseen';
  observe(time: number, rain: number, water: number, f: RaceReviewFrame) {
    if (time === this.lastTime) return;
    const dt = time - this.lastTime,
      adjacent = dt > 0 && dt <= 1;
    if (!adjacent) this.closeRun = this.wetRun = this.launchRun = 0;
    const racing = f.racePhase === PHASE.RACING && this.last.racePhase === PHASE.RACING;
    if (adjacent && racing && f.closeRival >= 0 && f.closeRival === this.last.closeRival)
      this.closeRun += dt;
    else this.closeRun = 0;
    if (
      adjacent &&
      racing &&
      f.leader >= 0 &&
      f.leader === this.last.leader &&
      rain > 0 &&
      this.lastRain > 0 &&
      water > 0 &&
      this.lastWater > 0 &&
      f.contactWater > 0.04 &&
      this.last.contactWater > 0.04 &&
      f.leaderWater > 0.04 &&
      this.last.leaderWater > 0.04 &&
      f.sprayParticles > 0 &&
      this.last.sprayParticles > 0
    )
      this.wetRun += dt;
    else this.wetRun = 0;
    this.closeSeconds = Math.max(this.closeSeconds, this.closeRun);
    this.wetFollowingSeconds = Math.max(this.wetFollowingSeconds, this.wetRun);
    if (f.racePhase === PHASE.LIGHTS && f.opponents >= 2) this.gridArmed = true;
    if (
      this.gridArmed &&
      adjacent &&
      racing &&
      f.opponents >= 2 &&
      this.last.opponents >= 2 &&
      !f.inPit &&
      !this.last.inPit &&
      f.speed > 5 &&
      this.last.speed > 5
    )
      this.launchRun += dt;
    else this.launchRun = 0;
    if (this.launchRun >= 3) this.gridLaunched = true;
    if (!f.inPit && f.pitPhase === 0) this.pitEntryArmed = true;
    if (this.pitStage === 'unseen' && this.pitEntryArmed && f.inPit && f.pitPhase === 1) {
      this.pitStage = 'entry';
      this.pitInitialStops = f.pitStops;
      this.pitRemoval = false;
    }
    if (
      this.pitStage === 'entry' &&
      f.inPit &&
      f.pitPhase === 3 &&
      f.pitStops === this.pitInitialStops &&
      f.speed < 0.35 &&
      f.jackHeight > 0.1 &&
      f.unloadedWheels === 4 &&
      f.crewActors >= 15
    )
      this.pitRemoval = true;
    if (
      this.pitStage === 'entry' &&
      this.pitRemoval &&
      f.inPit &&
      f.pitPhase === 4 &&
      f.pitStops === this.pitInitialStops &&
      f.speed < 0.35 &&
      f.jackHeight > 0.1 &&
      f.unloadedWheels === 4 &&
      f.crewActors >= 15
    )
      this.pitStage = 'service';
    if (
      this.pitStage === 'service' &&
      f.inPit &&
      f.pitPhase === 6 &&
      f.pitStops === this.pitInitialStops + 1
    )
      this.pitStage = 'released';
    if (
      this.pitStage === 'released' &&
      !f.inPit &&
      f.pitPhase === 0 &&
      f.speed > 5 &&
      f.pitStops === this.pitInitialStops + 1
    )
      this.pitStage = 'exit';
    // A release/exit from a different stop must not repair a missing service.
    if (
      this.pitStage !== 'unseen' &&
      this.pitStage !== 'exit' &&
      (f.pitStops > this.pitInitialStops + 1 ||
        (this.lastPhase > 1 && f.pitPhase === 1) ||
        (f.pitPhase === 0 && this.pitStage !== 'released'))
    ) {
      this.pitStage = 'unseen';
      this.pitInitialStops = -1;
      this.pitEntryArmed = false;
      this.pitRemoval = false;
    }
    this.lastPhase = f.pitPhase;
    this.lastTime = time;
    this.lastRain = rain;
    this.lastWater = water;
    Object.assign(this.last, f);
  }
  qualified(workload: string) {
    switch (workload) {
      case 'grid-start':
        return this.gridLaunched;
      case 'close-racing':
        return this.closeSeconds >= 5;
      case 'wet-following':
        return this.wetFollowingSeconds >= 3;
      case 'pit-service':
        return this.pitStage === 'exit';
      default:
        return true;
    }
  }
  summary(workload: string) {
    return {
      qualified: this.qualified(workload),
      gridLaunched: this.gridLaunched,
      closeSeconds: this.closeSeconds,
      wetFollowingSeconds: this.wetFollowingSeconds,
      pitStage: this.pitStage,
      visualAccepted: false,
      boundary:
        'Presented-state events; leader-attributed spray is not proof of visible spray or human driving.',
    };
  }
}
