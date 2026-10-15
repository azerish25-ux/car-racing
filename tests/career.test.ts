import { describe, expect, it } from 'vitest';
import { newChampionship, type RoundResult } from '../src/core/championship.ts';
import { ContactMeter, IMPACT_FULL_SCALE_J } from '../src/career/contact.ts';
import { CareerController, type CareerHost } from '../src/career/controller.ts';
import { licenceCourse, LICENCE_PACE } from '../src/career/course.ts';
import {
  abandonChampionship,
  buyVehicle,
  careerSetup,
  CLEAN_CONTACT_J,
  deletePreset,
  presetEffects,
  racePayout,
  savePreset,
  selectPreset,
  setActive,
  settleLicence,
  settleRace,
  startChampionship,
  type RaceOutcome,
} from '../src/career/economy.ts';
import {
  championshipCalendar,
  CLASS_PRICES,
  disciplineEvents,
  disciplineTiers,
  licenceAvailability,
  loanerVehicle,
  purchaseReasons,
  recoveryEvent,
  vehiclePrice,
} from '../src/career/ladder.ts';
import {
  LicenceAttempt,
  LICENCE_TESTS,
  medalFor,
  rotate,
  sampleFrame,
  scoreSamples,
  type LicenceCourse,
  type LicenceSample,
} from '../src/career/licences.ts';
import {
  DISCIPLINE_IDS,
  disciplineStatus,
  disciplineVenues,
  liveRegistry,
  snapshotChannels,
  surveyedJumps,
  vehicleDiscipline,
  vehicleFamily,
  venueKind,
  type CareerRegistry,
  type CareerVehicle,
} from '../src/career/registry.ts';
import {
  CAREER_KEY,
  CAREER_NEWER_KEY,
  CAREER_UNREADABLE_KEY,
  CAREER_VERSION,
  careerFromLegacy,
  newCareer,
  STARTING_CREDITS,
  validateCareer,
  type CareerSave,
} from '../src/career/save.ts';
import { validateCareerContent } from '../src/career/validation.ts';
import { AUREL } from '../src/simulation/circuits.ts';
import { DEFAULT_OPTIONS, DEFAULT_SETUP } from '../src/simulation/config.ts';
import { eventSession } from '../src/simulation/events.ts';
import { CAR_STRIDE, F, H, HEADER, carBase } from '../src/simulation/protocol.ts';
import { Track } from '../src/simulation/track.ts';
import { VEHICLES } from '../src/simulation/vehicles.ts';
import { backupKey, recoverSave } from '../src/storage/data.ts';
import { newTeam, rewardIncome } from '../src/storage/team-career.ts';

const live = liveRegistry();
const sample = (over: Partial<LicenceSample>): LicenceSample => ({
  t: 0,
  s: 0,
  laps: 0,
  speed: 0,
  lateral: 0,
  brake: 0,
  lapValid: true,
  lastLapValid: true,
  lastLap: 0,
  sideslip: 0,
  pitch: 0,
  airborne: false,
  lean: null,
  ...over,
});
const course: LicenceCourse = {
  length: 4000,
  marker: 1000,
  gate: 880,
  gateSpeed: 30,
  corner: 2000,
  window: 45,
  paceSpeed: 15,
  lineAt: () => 1,
  landing: 3000,
  landingWindow: 20,
  landingPitch: 0,
  cornerName: 'TEST HOOK',
};
/** A braking run: through the gate at `gate` m/s, stopping at marker + error. */
function brakingRun(gateSpeed: number, stopError: number) {
  const out: LicenceSample[] = [];
  let t = 0;
  for (let s = 700; s < 880; s += 1) out.push(sample({ t: (t += 0.02), s, speed: gateSpeed }));
  const stop = 1000 + stopError;
  for (let s = 880; s < stop; s += 0.5)
    out.push(
      sample({
        t: (t += 0.02),
        s,
        speed: Math.max(1, gateSpeed * ((stop - s) / (stop - 880))),
        brake: 1,
      }),
    );
  out.push(sample({ t: t + 0.02, s: stop, speed: 0, brake: 1 }));
  return out;
}
const withVehicles = (
  extra: CareerVehicle[],
  over: Partial<CareerRegistry> = {},
): CareerRegistry => ({
  ...live,
  vehicles: [...live.vehicles, ...extra],
  ...over,
});
const progressed = (registry: CareerRegistry = live): CareerSave => {
  const save = newCareer();
  save.credits = 1e7;
  for (const d of DISCIPLINE_IDS) save.reputation[d] = 100;
  for (const id of Object.keys(LICENCE_TESTS) as (keyof typeof LICENCE_TESTS)[])
    save.licences[id] = { medal: 'gold', best: 0, attempts: 1 };
  save.owned = registry.vehicles.map((v) => ({ id: v.id, source: 'purchase' as const }));
  return save;
};
/** An in-memory SaveStore with the same backup-before-overwrite semantics. */
function storeHarness() {
  const data = new Map<string, unknown>();
  const toasts: string[] = [];
  const store: CareerHost['store'] = {
    async read(key) {
      return structuredClone(data.get(key));
    },
    async write(key, value) {
      data.set(key, structuredClone(value));
    },
    async writeWithBackup(key, value) {
      if (data.has(key)) data.set(backupKey(key), data.get(key));
      data.set(key, structuredClone(value));
    },
  };
  const host = { store, toast: (m: string) => toasts.push(m) } as unknown as CareerHost;
  return { data, toasts, host };
}
const outcome = (over: Partial<RaceOutcome> = {}): RaceOutcome => ({
  session: 's-1',
  position: 3,
  cars: 8,
  classified: true,
  demonstration: false,
  penalties: 0,
  contactEnergy: 0,
  gridSlot: 4,
  bestLap: 92.5,
  ...over,
});

describe('licence scoring from measured values', () => {
  it('maps metric values to medals at the published thresholds', () => {
    const braking = LICENCE_TESTS.braking;
    expect(medalFor(braking, 1.5)).toBe('gold');
    expect(medalFor(braking, 1.51)).toBe('silver');
    expect(medalFor(braking, 4)).toBe('silver');
    expect(medalFor(braking, 8)).toBe('bronze');
    expect(medalFor(braking, 8.01)).toBeNull();
    expect(medalFor(braking, Number.NaN)).toBeNull();
    // Higher is better for the lean overlap.
    const lean = LICENCE_TESTS.lean;
    expect(medalFor(lean, 50)).toBe('gold');
    expect(medalFor(lean, 34.9)).toBe('bronze');
    expect(medalFor(lean, 19)).toBeNull();
    for (const test of Object.values(LICENCE_TESTS)) {
      const { gold, silver, bronze } = test.thresholds;
      if (test.metric.better === 'lower') expect(gold < silver && silver < bronze).toBe(true);
      else expect(gold > silver && silver > bronze).toBe(true);
    }
  });
  it('scores the braking marker by stopping distance error, not position', () => {
    expect(scoreSamples(LICENCE_TESTS.braking, course, brakingRun(32, 1))?.medal).toBe('gold');
    expect(scoreSamples(LICENCE_TESTS.braking, course, brakingRun(32, -3))?.medal).toBe('silver');
    const bronze = scoreSamples(LICENCE_TESTS.braking, course, brakingRun(32, 7))!;
    expect(bronze.medal).toBe('bronze');
    expect(bronze.value).toBeCloseTo(7, 5);
    expect(bronze.detail).toContain('past');
    expect(scoreSamples(LICENCE_TESTS.braking, course, brakingRun(32, -12))?.medal).toBeNull();
    // Too slow through the gate: the attempt is not armed, nothing is scored.
    expect(scoreSamples(LICENCE_TESTS.braking, course, brakingRun(20, 0))).toBeNull();
  });
  it('scores the corner by mean distance from the racing line at pace', () => {
    const through = (offset: number, speed: number, valid = true) =>
      Array.from({ length: 120 }, (_, i) =>
        sample({ t: i * 0.02, s: 1950 + i, speed, lateral: 1 + offset, lapValid: valid }),
      );
    const gold = scoreSamples(LICENCE_TESTS.cornering, course, through(0.5, 20))!;
    expect(gold.value).toBeCloseTo(0.5, 5);
    expect(gold.medal).toBe('gold');
    expect(scoreSamples(LICENCE_TESTS.cornering, course, through(-2, 20))?.medal).toBe('bronze');
    // A lap already invalid when the corner starts is not this corner's
    // fault: nothing is scored and the next lap is another try.
    const early = new LicenceAttempt(LICENCE_TESTS.cornering, course);
    for (const x of through(0.2, 20, false)) expect(early.observe(x)).toBeNull();
    expect(early.message).toContain('ALREADY INVALID');
    // A breach inside the corner voids the attempt.
    const breach = through(0.2, 20).map((x) => ({ ...x, lapValid: x.s < 2000 }));
    const invalid = scoreSamples(LICENCE_TESTS.cornering, course, breach)!;
    expect(invalid.valid).toBe(false);
    expect(invalid.medal).toBeNull();
    expect(invalid.detail).toContain('in the corner');
    // Below the pace gate the corner is not scored (the player goes again).
    expect(scoreSamples(LICENCE_TESTS.cornering, course, through(0, 10))).toBeNull();
  });
  it('does not void the corner for a track-limits breach earlier on the lap', () => {
    // Lap 1: a breach at turn 2 (s = 600) leaves the lap flag false until the
    // line; the marked corner (s = 2000) is driven perfectly. Lap 2 is clean.
    const lap = (laps: number, from: number, to: number, valid: (s: number) => boolean) =>
      Array.from({ length: to - from }, (_, i) =>
        sample({
          t: laps * 200 + i / 30,
          s: from + i,
          laps,
          speed: 30,
          lateral: 1.1,
          lapValid: valid(from + i),
        }),
      );
    const attempt = new LicenceAttempt(LICENCE_TESTS.cornering, course);
    for (const x of lap(0, 500, 4000, (s) => s < 600)) expect(attempt.observe(x)).toBeNull();
    expect(attempt.complete).toBe(false);
    expect(attempt.message).toContain('NEXT LAP');
    let outcome = null;
    for (const x of lap(1, 0, 2200, () => true)) outcome ??= attempt.observe(x);
    expect(outcome).toMatchObject({ valid: true, medal: 'gold' });
    expect(outcome!.value).toBeCloseTo(0.1, 5);
  });
  it('scores a wet flying lap by its peak slide angle', () => {
    const lap = (peakDeg: number, valid = true) => {
      const out = [sample({ t: 0, laps: 0, speed: 30 }), sample({ t: 1, laps: 1, speed: 30 })];
      for (let i = 0; i < 100; i++)
        out.push(
          sample({
            t: 2 + i,
            laps: 1,
            speed: 30,
            sideslip: i === 50 ? (peakDeg * Math.PI) / 180 : 0.01,
          }),
        );
      out.push(sample({ t: 103, laps: 2, speed: 30, lastLap: 102, lastLapValid: valid }));
      return out;
    };
    const wetCourse = { ...course, length: 4000, paceSpeed: 25 };
    const silver = scoreSamples(LICENCE_TESTS.wet, wetCourse, lap(5))!;
    expect(silver.value).toBeCloseTo(5, 3);
    expect(silver.medal).toBe('silver');
    expect(scoreSamples(LICENCE_TESTS.wet, wetCourse, lap(3))?.medal).toBe('gold');
    // An invalid lap is not measured, like a slow one: the next lap counts.
    const invalidLap = lap(3, false);
    const attempt = new LicenceAttempt(LICENCE_TESTS.wet, wetCourse);
    for (const x of invalidLap) expect(attempt.observe(x)).toBeNull();
    expect(attempt.message).toContain('INVALID');
    let retry = null;
    for (let i = 0; i < 100 && !retry; i++)
      retry = attempt.observe(sample({ t: 104 + i, laps: 2, speed: 30, sideslip: 0.02 }));
    retry ??= attempt.observe(
      sample({ t: 205, laps: 3, speed: 30, lastLap: 101, lastLapValid: true }),
    );
    expect(retry).toMatchObject({ valid: true, medal: 'gold' });
    // 4000 m in 102 s is 39 m/s; a 50 m/s pace gate rejects the lap without scoring.
    expect(scoreSamples(LICENCE_TESTS.wet, { ...wetCourse, paceSpeed: 50 }, lap(3))).toBeNull();
  });
  it('scores trail braking (bikes) and jump landings (off-road) from their channels', () => {
    const entry = Array.from({ length: 90 }, (_, i) => {
      const d = -45 + i;
      return sample({
        t: i * 0.02,
        s: 2000 + d,
        speed: 25,
        lean: Math.min(0.8, Math.max(0, (d + 45) / 30)),
        brake: d < 0 ? 0.4 : 0,
      });
    });
    entry.push(sample({ t: 2, s: 2050, speed: 25, lean: 0.2 }));
    const lean = scoreSamples(LICENCE_TESTS.lean, course, entry)!;
    expect(lean.valid).toBe(true);
    expect(lean.value!).toBeGreaterThan(50);
    expect(lean.medal).toBe('gold');
    const flight = (t0: number, s: number, pitchDeg: number) => [
      sample({ t: t0, s: s - 20, speed: 20 }),
      ...Array.from({ length: 30 }, (_, i) =>
        sample({ t: t0 + 0.02 * (i + 1), s: s - 19 + i * 0.6, speed: 20, airborne: true }),
      ),
      sample({ t: t0 + 0.7, s, speed: 20, pitch: (pitchDeg * Math.PI) / 180 }),
    ];
    const landed = scoreSamples(LICENCE_TESTS.jump, course, flight(0, 3000, 2.5))!;
    expect(landed.value).toBeCloseTo(2.5, 3);
    expect(landed.medal).toBe('gold');
  });
  it('scores the jump landing against the surveyed slope, only in its landing zone', () => {
    const slope = (-12 * Math.PI) / 180;
    const downhill = { ...course, landingPitch: slope };
    const flight = (t0: number, s: number, pitch: number) => [
      sample({ t: t0, s: s - 20, speed: 20 }),
      ...Array.from({ length: 30 }, (_, i) =>
        sample({ t: t0 + 0.02 * (i + 1), s: s - 19 + i * 0.6, speed: 20, airborne: true }),
      ),
      sample({ t: t0 + 0.7, s, speed: 20, pitch }),
    ];
    // A crest hop at s = 500 lands flat: it is not the jump and is not scored.
    const attempt = new LicenceAttempt(LICENCE_TESTS.jump, downhill);
    for (const x of flight(0, 500, 0)) expect(attempt.observe(x)).toBeNull();
    expect(attempt.message).toContain('NOT THE MARKED JUMP');
    // Parallel to a 12° downslope is a perfect landing, not a 12° error.
    let outcome = null;
    for (const x of flight(5, 3005, slope)) outcome ??= attempt.observe(x);
    expect(outcome).toMatchObject({ valid: true, medal: 'gold' });
    expect(outcome!.value).toBeCloseTo(0, 6);
    expect(scoreSamples(LICENCE_TESTS.jump, downhill, flight(0, 3000, 0))!.value).toBeCloseTo(
      12,
      4,
    );
    // Without a surveyed jump nothing is scored.
    const none = { ...course, landing: Number.NaN, landingPitch: Number.NaN };
    expect(scoreSamples(LICENCE_TESTS.jump, none, flight(0, 3000, 0))).toBeNull();
  });
  it('reads the jump geometry a venue declares and opens the jump test only with a survey', () => {
    const declared = surveyedJumps({
      jumps: [
        { s: 400 }, // a marker without geometry
        { takeoff: 980, landing: 1030, landingPitch: -0.2, name: 'THE TABLE' },
        { takeoff: 10, landing: 40, landingPitch: 2 }, // implausible slope
      ],
    });
    expect(declared).toEqual([
      { name: 'THE TABLE', takeoff: 980, landing: 1030, landingLength: 40, landingPitch: -0.2 },
    ]);
    const track = new Track('clear', false, undefined, {
      ...AUREL,
      jumps: [{ takeoff: 980, landing: 1030, landingLength: 30, landingPitch: -0.2 }],
    } as typeof AUREL);
    const c = licenceCourse(LICENCE_TESTS.jump, track, live.vehicles[0]);
    expect(c).toMatchObject({ landing: 1030, landingWindow: 15, landingPitch: -0.2 });
    // A dirt venue with unsurveyed jumps keeps the test coming, and says why.
    const dirt = (jumps: unknown[]) => ({
      ...live.venues[0],
      id: 'test-dirt',
      surface: 'dirt',
      jumps,
    });
    const rx: CareerVehicle = {
      id: 'test-rx',
      name: 'TEST RX',
      classId: 'rallycross',
      dynamicsKind: 'four-wheel',
      setupKeys: [],
    };
    // Paved circuits only, plus the test venue (the live terrain venues are surveyed).
    const paved = live.venues.filter((v) => venueKind(v) !== 'dirt');
    const bare = withVehicles([rx], { venues: [...paved, dirt([{ s: 400 }])] });
    expect(venueKind(bare.venues.at(-1)!)).toBe('dirt');
    const coming = licenceAvailability(bare, newCareer(), 'jump');
    expect(coming.status).toBe('coming');
    expect(coming.reasons.join(' ')).toContain('surveyed jump');
    const surveyed = withVehicles([rx], {
      venues: [...paved, dirt([{ takeoff: 980, landing: 1030, landingPitch: -0.2 }])],
    });
    expect(licenceAvailability(surveyed, newCareer(), 'jump').venue).toBe('test-dirt');
  });
  it('reads speed, sideslip and pitch from a real snapshot layout', () => {
    const frame = new Float32Array(HEADER + CAR_STRIDE);
    const o = carBase(0);
    frame[H.TIME] = 12;
    frame[o + F.QW] = 1;
    frame[o + F.VZ] = 30;
    frame[o + F.VX] = 30 * Math.tan((6 * Math.PI) / 180);
    frame[o + F.SPEED] = 30;
    const s = sampleFrame(frame);
    expect(s.t).toBe(12);
    expect((s.sideslip * 180) / Math.PI).toBeCloseTo(6, 3);
    expect(s.pitch).toBeCloseTo(0, 6);
    expect(s.airborne).toBe(true); // no wheel load in a zero frame
    // Nose-up rotation about +X (driver's left) raises the forward vector.
    const half = (-5 * Math.PI) / 360;
    const up = rotate([Math.sin(half), 0, 0, Math.cos(half)], [0, 0, 1]);
    expect((Math.asin(up[1]) * 180) / Math.PI).toBeCloseTo(5, 4);
  });
  it('places the braking marker on the venue’s longest straight and paces by machine', () => {
    const track = new Track('clear', false, undefined, AUREL);
    const tc1 = live.vehicles.find((v) => v.id === 'tc1')!;
    const c = licenceCourse(LICENCE_TESTS.braking, track, tc1);
    const point = track.at(c.marker, {} as never);
    expect(Math.abs(point.curvature)).toBeLessThan(1 / 400);
    expect(Math.abs(track.at(c.gate, {} as never).curvature)).toBeLessThan(1 / 400);
    expect(c.gateSpeed).toBeCloseTo(VEHICLES.tc1.ai.topSpeed * LICENCE_PACE.gate, 6);
    expect(AUREL.corners.some((corner) => corner.name === c.cornerName)).toBe(true);
    const wet = licenceCourse(LICENCE_TESTS.wet, track, tc1);
    expect(wet.paceSpeed).toBeCloseTo(VEHICLES.tc1.ai.topSpeed * LICENCE_PACE.wetLap, 6);
  });
});

describe('career payments are itemised and paid once per session', () => {
  const event = {
    key: 'circuit-cars.club.inv.aurel',
    kind: 'invitational' as const,
    discipline: 'circuit-cars' as const,
    name: 'TEST INVITATIONAL',
    stakes: 0.5,
    objectives: [
      { id: 'top' as const, label: 'Finish on the podium', amount: 2500, value: 3 },
      { id: 'gain' as const, label: 'Gain two places', amount: 1500, value: 2 },
    ],
  };
  it('reuses rewardIncome for completion and adds clean, improvement and objective lines', () => {
    const p = racePayout(event, outcome());
    const base = rewardIncome({ position: 3, cars: 8, penalties: 0 });
    expect(p.lines.slice(0, 3).map((l) => l.amount)).toEqual(base.lines.map((l) => l.amount * 0.5));
    expect(p.lines.find((l) => l.label.startsWith('Low contact'))!.amount).toBe(750);
    expect(p.lines.find((l) => l.label.startsWith('First start'))!.amount).toBe(0);
    expect(p.lines.find((l) => l.label.includes('podium'))!.amount).toBe(1250);
    expect(p.lines.find((l) => l.label.includes('Gain'))!.amount).toBe(750);
    expect(p.total).toBe(p.lines.reduce((s, l) => s + l.amount, 0));
    const rough = racePayout(
      event,
      outcome({ contactEnergy: CLEAN_CONTACT_J + 1, position: 6, penalties: 5 }),
    );
    expect(rough.lines.find((l) => l.label.startsWith('Contact'))!.amount).toBe(0);
    expect(rough.lines.find((l) => l.label.includes('podium'))!.label).toContain('not met');
    expect(rough.reputation).toBeLessThan(p.reputation);
  });
  it('pays a session exactly once and records improvement on the next', () => {
    const start = newCareer();
    const first = settleRace(start, event, outcome());
    expect(first.payout.paid).toBe(true);
    expect(first.save.credits).toBe(STARTING_CREDITS + first.payout.total);
    expect(first.save.reputation['circuit-cars']).toBe(first.payout.reputation);
    const again = settleRace(first.save, event, outcome());
    expect(again.save).toBe(first.save);
    expect(again.payout.paid).toBe(false);
    expect(again.payout.reason).toContain('already been paid');
    const better = settleRace(
      first.save,
      event,
      outcome({ session: 's-2', position: 1, bestLap: 91 }),
    );
    expect(better.payout.lines.find((l) => l.label.startsWith('Improved'))!.amount).toBe(1200);
    expect(better.payout.lines.find((l) => l.label.startsWith('Personal best lap'))!.amount).toBe(
      400,
    );
    expect(better.save.results[event.key]).toEqual({ bestPosition: 1, bestLap: 91, starts: 2 });
    expect(start.credits).toBe(STARTING_CREDITS); // pure
  });
  it('pays nothing for AI-driven or unclassified sessions, but still marks them settled', () => {
    for (const o of [outcome({ demonstration: true }), outcome({ classified: false })]) {
      const settled = settleRace(newCareer(), event, o);
      expect(settled.payout.paid).toBe(false);
      expect(settled.save.credits).toBe(STARTING_CREDITS);
      expect(settled.save.paidSessions).toContain(o.session);
    }
  });
  it('pays licence medals once per level and records attempts', () => {
    const bronze = {
      test: 'braking' as const,
      value: 6,
      medal: 'bronze' as const,
      valid: true,
      detail: '',
    };
    const a = settleLicence(newCareer(), bronze, 'l-1', false);
    expect(a.payout.total).toBe(3000);
    expect(a.save.licences.braking).toEqual({ medal: 'bronze', best: 6, attempts: 1 });
    expect(settleLicence(a.save, bronze, 'l-1', false).save).toBe(a.save);
    const gold = settleLicence(a.save, { ...bronze, value: 1.2, medal: 'gold' }, 'l-2', false);
    expect(gold.payout.lines.map((l) => l.amount)).toEqual([500, 3000, 4000]);
    expect(gold.save.licences.braking!.medal).toBe('gold');
    // A worse attempt keeps the best and the medal and pays nothing.
    const worse = settleLicence(gold.save, bronze, 'l-3', false);
    expect(worse.payout.total).toBe(0);
    expect(worse.save.licences.braking).toEqual({ medal: 'gold', best: 1.2, attempts: 3 });
    const ai = settleLicence(newCareer(), { ...bronze, medal: 'gold', value: 1 }, 'l-4', true);
    expect(ai.save.licences.braking!.medal).toBeNull();
    expect(ai.payout.reason).toContain('AI driver');
  });
  it('scores a championship with the existing points and awards the title once', () => {
    const key = 'circuit-cars.club.championship';
    const rounds = [
      { circuit: 'aurel' as const, weather: 'clear' as const, laps: 3 },
      { circuit: 'vellamar' as const, weather: 'clear' as const, laps: 3 },
    ];
    let save = startChampionship(newCareer(), key, 'tc1', rounds, 4);
    expect(save.championships[key].season).toEqual(newChampionship(4, rounds));
    const champ = { ...event, key, kind: 'championship' as const };
    const round = (session: string): RoundResult => ({
      order: [0, 1, 2, 3],
      retired: [],
      grid: [0, 1, 2, 3],
      demonstration: false,
      session,
    });
    save = settleRace(
      save,
      champ,
      outcome({ session: 'r1', position: 1, cars: 4, round: round('r1') }),
      'apx01',
    ).save;
    expect(save.championships[key].season.results).toHaveLength(1);
    const last = settleRace(
      save,
      champ,
      outcome({ session: 'r2', position: 1, cars: 4, round: round('r2') }),
      'apx01',
    );
    expect(last.payout.lines.at(-1)).toEqual({ label: 'Championship won', amount: 10000 });
    expect(last.payout.awarded).toBe('apx01');
    expect(last.save.owned).toContainEqual({ id: 'apx01', source: 'award' });
    expect(
      settleRace(last.save, champ, outcome({ session: 'r2', cars: 4, round: round('r2') })).save,
    ).toBe(last.save);
  });
  it('never awards a title for a season with AI-driven rounds', () => {
    const key = 'circuit-cars.club.championship';
    const rounds = (['aurel', 'vellamar', 'aurel', 'vellamar'] as const).map((circuit) => ({
      circuit,
      weather: 'clear' as const,
      laps: 3,
    }));
    const champ = { ...event, key, kind: 'championship' as const };
    let save = startChampionship(newCareer(), key, 'tc1', rounds, 4);
    const before = save.reputation['circuit-cars'];
    // Rounds 1-3 driven by the AI driver: P1 each time, nothing paid.
    for (const session of ['r1', 'r2', 'r3']) {
      const settled = settleRace(
        save,
        champ,
        outcome({
          session,
          position: 1,
          cars: 4,
          demonstration: true,
          round: {
            order: [0, 1, 2, 3],
            retired: [],
            grid: [0, 1, 2, 3],
            demonstration: true,
            session,
          },
        }),
        'apx01',
      );
      expect(settled.payout.total).toBe(0);
      save = settled.save;
    }
    // Round 4 is the player's own: paid as a race, but the season is not theirs.
    const own = outcome({
      session: 'r4',
      position: 1,
      cars: 4,
      round: {
        order: [0, 1, 2, 3],
        retired: [],
        grid: [0, 1, 2, 3],
        demonstration: false,
        session: 'r4',
      },
    });
    const asRace = racePayout(champ, own, save.results[key]);
    const last = settleRace(save, champ, own, 'apx01');
    expect(last.save.championships[key].season.results).toHaveLength(4);
    expect(last.payout.lines.map((l) => l.label)).not.toContain('Championship won');
    expect(last.payout.lines.at(-1)).toMatchObject({ amount: 0 });
    expect(last.payout.lines.at(-1)!.label).toContain('rounds 1, 2, 3');
    expect(last.payout.awarded).toBeNull();
    expect(last.save.owned.some((o) => o.id === 'apx01')).toBe(false);
    // Exactly the race payment: no title bonus, no title reputation.
    expect(last.payout.total).toBe(asRace.total);
    expect(last.payout.reputation).toBe(asRace.reputation);
    expect(last.save.reputation['circuit-cars'] - before).toBe(asRace.reputation);
    expect(last.save.credits - save.credits).toBe(asRace.total);
  });
  it('never replaces a season with rounds recorded; abandoning is explicit', () => {
    const key = 'circuit-cars.club.championship';
    const rounds = [
      { circuit: 'aurel' as const, weather: 'clear' as const, laps: 3 },
      { circuit: 'vellamar' as const, weather: 'rain' as const, laps: 3 },
    ];
    const empty = startChampionship(newCareer(), key, 'tc1', rounds, 4);
    // Nothing raced yet: the season may change machine.
    expect(startChampionship(empty, key, 'tc2', rounds, 4).championships[key].vehicle).toBe('tc2');
    const champ = { ...event, key, kind: 'championship' as const };
    const raced = settleRace(
      empty,
      champ,
      outcome({
        session: 'r1',
        cars: 4,
        round: {
          order: [1, 0, 2, 3],
          retired: [],
          grid: [0, 1, 2, 3],
          demonstration: false,
          session: 'r1',
        },
      }),
    ).save;
    expect(startChampionship(raced, key, 'tc1', rounds, 4)).toBe(raced);
    expect(() => startChampionship(raced, key, 'tc2', rounds, 4)).toThrow('abandon');
    const abandoned = abandonChampionship(raced, key);
    expect(abandoned.championships[key]).toBeUndefined();
    expect(abandoned.ledger.at(-1)!.label).toContain('1 of 2 rounds');
    expect(abandoned.credits).toBe(raced.credits);
    expect(startChampionship(abandoned, key, 'tc2', rounds, 4).championships[key].vehicle).toBe(
      'tc2',
    );
  });
});

describe('unlocks and availability are derived from the registries', () => {
  it('opens circuit cars and states what the other disciplines are missing', () => {
    expect(disciplineStatus(live, 'circuit-cars').state).toBe('open');
    const bikes = disciplineStatus(live, 'road-bikes');
    if (!live.vehicles.some((v) => vehicleFamily(v) === 'bike')) {
      expect(bikes.state).toBe('coming');
      expect(bikes.reasons).toContain('No two-wheel road machine is registered yet.');
    }
    if (
      !live.venues.some((v) => /dirt|gravel|terrain/.test(String(v.surface ?? v.catalogue?.group)))
    )
      expect(disciplineStatus(live, 'off-road').reasons.join(' ')).toContain(
        'dirt or mixed-surface venue',
      );
    expect(disciplineStatus(live, 'festival').state).toBe('coming');
  });
  it('opens the bike career when a bike and a ruleset for it are registered', () => {
    // A registry without bikes or bike-safety assessments (whatever the live
    // content has), so the test shows the unlock itself rather than today's
    // catalogue.
    const twoWheel = new Set(
      live.vehicles.filter((v) => vehicleFamily(v) === 'bike').map((v) => v.classId),
    );
    const noBikes: CareerRegistry = {
      ...live,
      venues: live.venues.map((v) => ({
        ...v,
        bikeSafe: undefined,
        catalogue: v.catalogue && { ...v.catalogue, bikeSafe: undefined },
      })),
      vehicles: live.vehicles.filter((v) => vehicleFamily(v) !== 'bike'),
      rulesets: live.rulesets.map((r) => ({
        ...r,
        allowedClasses: r.allowedClasses.filter((c) => !twoWheel.has(c) && c !== 'superbike'),
      })),
      channels: live.channels.filter((c) => c !== 'LEAN'),
    };
    expect(disciplineStatus(noBikes, 'road-bikes').reasons).toContain(
      'No two-wheel road machine is registered yet.',
    );
    const bike: CareerVehicle = {
      id: 'test-sbk',
      name: 'TEST SUPERBIKE',
      classId: 'superbike',
      dynamicsKind: 'bike',
      setupKeys: ['brakeBias'],
      ai: { topSpeed: 80, lateralBase: 11 },
    };
    const noRules = { ...noBikes, vehicles: [...noBikes.vehicles, bike] };
    const status = disciplineStatus(noRules, 'road-bikes');
    expect(status.state).toBe('coming');
    expect(status.reasons.join(' ')).toContain('No race ruleset admits superbike');
    const rules = [
      ...noRules.rulesets,
      {
        id: 'test-bike-sprint',
        name: 'TEST BIKE SPRINT',
        sessions: ['race'],
        allowedClasses: ['superbike'],
        tires: { allowed: ['medium'] },
        classification: 'laps',
        points: [25],
      },
    ];
    const open: CareerRegistry = { ...noRules, rulesets: rules };
    const bikes = disciplineStatus(open, 'road-bikes');
    expect(bikes.state).toBe('open');
    expect(bikes.caveat).toContain('bike safety');
    // A venue flagged bike-safe restricts bike events to flagged venues.
    const flagged = { ...open, venues: open.venues.map((v, i) => ({ ...v, bikeSafe: i === 1 })) };
    expect(disciplineStatus(flagged, 'road-bikes').venues.map((v) => v.id)).toEqual([
      open.venues[1].id,
    ]);
    // The lean licence needs a lean channel in the snapshot.
    const lean = licenceAvailability(open, newCareer(), 'lean');
    expect(lean.status).toBe('coming');
    expect(lean.reasons.join(' ')).toContain('LEAN');
    const leaning = licenceAvailability(
      { ...open, channels: [...open.channels, 'LEAN'] },
      newCareer(),
      'lean',
    );
    expect(leaning.status).toBe('open');
    expect(leaning.vehicle).toBe(loanerVehicle(open, 'road-bikes')!.id);
    expect(leaning.vehicle).toBe('test-sbk');
    expect(leaning.loaner).toBe(true);
    // No practice ruleset admits the bike, so the solo test runs under its race rules.
    expect(leaning.definition!.ruleset).toBe('test-bike-sprint');
    // Its superbike tier now lists the machine; events wait for the licence.
    const events = disciplineEvents(open, newCareer(), 'road-bikes');
    expect(events.find((e) => e.kind === 'recovery')!.status).toBe('open');
    const invitational = events.find((e) => e.tier === 'superbike' && e.kind === 'invitational')!;
    expect(invitational.status).toBe('locked');
    expect(invitational.reasons.join(' ')).toContain('Lean and trail braking licence');
  });
  it('places new classes in their tier, or in an open tier when no tier names them', () => {
    const gt: CareerVehicle = {
      id: 'test-gt',
      name: 'TEST GT',
      classId: 'gt',
      dynamicsKind: 'four-wheel',
      setupKeys: [],
    };
    const odd: CareerVehicle = {
      id: 'test-odd',
      name: 'TEST ODD',
      classId: 'hill-climb',
      dynamicsKind: 'four-wheel',
      setupKeys: [],
    };
    const registry = withVehicles([gt, odd]);
    const tiers = disciplineTiers(registry, 'circuit-cars');
    expect(tiers.map((t) => t.id)).toContain('circuit-cars-open');
    expect(tiers.find((t) => t.id === 'circuit-cars-open')!.classes).toEqual(['hill-climb']);
    expect(vehiclePrice(registry, gt)).toBe(CLASS_PRICES.gt);
    expect(vehiclePrice(registry, odd)).toBe(30000 * tiers.length);
    expect(vehiclePrice(live, live.vehicles.find((v) => v.id === 'tc1')!)).toBe(
      CLASS_PRICES.touring,
    );
  });
  it('unlocks invitationals by licence, reputation and ownership', () => {
    const fresh = disciplineEvents(live, newCareer(), 'circuit-cars');
    const club = fresh.find((e) => e.key === 'circuit-cars.club.inv.aurel')!;
    expect(club.status).toBe('locked');
    expect(club.reasons.join(' ')).toContain('Braking marker licence (bronze)');
    expect(club.reasons.join(' ')).toContain('owned');
    let save = newCareer();
    save = buyVehicle(save, live, 'tc1');
    expect(save.active['circuit-cars']).toBe('tc1');
    save.licences.braking = { medal: 'bronze', best: 7, attempts: 1 };
    const open = disciplineEvents(live, save, 'circuit-cars').find((e) => e.key === club.key)!;
    expect(open.status).toBe('open');
    expect(open.definition!.vehicles[0]).toBe('tc1');
    const formula = disciplineEvents(live, save, 'circuit-cars').find((e) => e.tier === 'formula')!;
    expect(formula.status).toBe('locked');
    expect(formula.reasons.join(' ')).toMatch(/reputation/);
    // Championships need more reputation than invitationals.
    const champ = disciplineEvents(live, save, 'circuit-cars').find(
      (e) => e.key === 'circuit-cars.club.championship',
    )!;
    expect(champ.status).toBe('locked');
    expect(champ.reasons.join(' ')).toContain('championship');
  });
  it('builds every open event and licence into a loadable session', () => {
    const save = progressed();
    let count = 0;
    for (const d of DISCIPLINE_IDS)
      for (const e of disciplineEvents(live, save, d)) {
        if (e.status !== 'open') continue;
        const options = eventSession(e.definition!, { ...DEFAULT_OPTIONS });
        expect(options.vehicles![0]).toBe(e.vehicle);
        count++;
      }
    expect(count).toBeGreaterThanOrEqual(5);
    for (const id of ['braking', 'cornering', 'wet'] as const) {
      const a = licenceAvailability(live, save, id);
      expect(a.status).toBe('open');
      const options = eventSession(a.definition!, { ...DEFAULT_OPTIONS });
      expect(options.opponents).toBe(0);
      expect(options.weather).toBe(LICENCE_TESTS[id].weather === 'rain' ? 'rain' : 'clear');
      if (id === 'wet') expect(options.compound).toBe('wet');
    }
  });
  it('validates the career content built from the live registries', () => {
    expect(validateCareerContent()).toEqual([]);
    // A registered class without a race ruleset is coming, not merely locked,
    // and coming content is not loaded.
    const odd: CareerVehicle = {
      id: 'test-hillclimb',
      name: 'TEST HILL CLIMB',
      classId: 'test-hill-climb',
      dynamicsKind: 'four-wheel',
      setupKeys: [],
    };
    const unraced = withVehicles([odd]);
    const oddEvents = disciplineEvents(unraced, progressed(unraced), 'circuit-cars').filter(
      (e) => e.tier === 'circuit-cars-open',
    );
    expect(oddEvents.length).toBeGreaterThan(0);
    for (const e of oddEvents) {
      expect(e.status).toBe('coming');
      expect(e.reasons.join(' ')).toContain('No race ruleset admits test-hill-climb');
    }
    expect(validateCareerContent(unraced)).toEqual([]);
    // A raceable class opens its events, and every one is loaded: the
    // production loader cannot load a machine the simulation does not have,
    // which is what validate:content must catch.
    const gt: CareerVehicle = {
      id: 'test-gt',
      name: 'TEST GT',
      classId: 'gt',
      dynamicsKind: 'four-wheel',
      setupKeys: [],
    };
    const synthetic = withVehicles([gt]);
    const errors = validateCareerContent(synthetic);
    expect(errors.length).toBeGreaterThan(0);
    expect(errors.every((e) => e.includes('unknown vehicle test-gt'))).toBe(true);
    // With a loader for the synthetic registry, the same content is valid.
    const loaded: string[] = [];
    expect(validateCareerContent(synthetic, (d) => void loaded.push(d.id))).toEqual([]);
    expect(loaded.length).toBeGreaterThan(0);
  });
  it('builds the championship card from the round raced next, with its calendar', () => {
    const save = progressed();
    const events = disciplineEvents(live, save, 'circuit-cars');
    const tiers = disciplineTiers(live, 'circuit-cars');
    const venues = disciplineVenues(live, 'circuit-cars');
    for (const [i, t] of tiers.entries()) {
      const champ = events.find((e) => e.key === `circuit-cars.${t.id}.championship`)!;
      if (champ.status !== 'open') continue;
      const calendar = championshipCalendar(venues, i, t);
      expect(champ.calendar).toEqual(calendar);
      expect(champ.round).toBe(0);
      expect(champ.definition).toMatchObject({
        circuit: calendar[0].circuit,
        weather: calendar[0].weather,
        laps: calendar[0].laps,
      });
    }
    // A season in progress: the card shows its next round, not round 1.
    const key = 'circuit-cars.gt.championship';
    const gt = events.find((e) => e.key === key)!;
    let run = startChampionship(save, key, gt.vehicle!, gt.calendar, 8);
    for (const session of ['g1', 'g2', 'g3'])
      run = settleRace(
        run,
        { ...gt, name: gt.name },
        outcome({
          session,
          round: {
            order: [0, 1, 2, 3, 4, 5, 6, 7],
            retired: [],
            grid: [0, 1, 2, 3, 4, 5, 6, 7],
            demonstration: false,
            session,
          },
        }),
      ).save;
    const next = disciplineEvents(live, run, 'circuit-cars').find((e) => e.key === key)!;
    expect(next.round).toBe(3);
    expect(next.definition).toMatchObject({
      circuit: gt.calendar[3].circuit,
      weather: gt.calendar[3].weather,
    });
    expect(next.definition!.name).toContain('ROUND 4');
  });
  it('keeps a season in the machine it started in when the active machine changes', () => {
    let save = progressed();
    save.owned = [
      { id: 'tc1', source: 'purchase' },
      { id: 'tc2', source: 'purchase' },
    ];
    save.active = { 'circuit-cars': 'tc1' };
    const key = 'circuit-cars.club.championship';
    const club = disciplineEvents(live, save, 'circuit-cars').find((e) => e.key === key)!;
    expect(club.vehicle).toBe('tc1');
    save = startChampionship(save, key, 'tc1', club.calendar, 8);
    save = settleRace(
      save,
      { ...club },
      outcome({
        session: 'c1',
        round: {
          order: [0, 1, 2, 3, 4, 5, 6, 7],
          retired: [],
          grid: [0, 1, 2, 3, 4, 5, 6, 7],
          demonstration: false,
          session: 'c1',
        },
      }),
    ).save;
    save = setActive(save, live, 'circuit-cars', 'tc2');
    const events = disciplineEvents(live, save, 'circuit-cars');
    const season = events.find((e) => e.key === key)!;
    expect(season.status).toBe('open');
    expect(season.vehicle).toBe('tc1');
    expect(season.definition!.vehicles[0]).toBe('tc1');
    expect(season.round).toBe(1);
    // Invitationals follow the new active machine.
    expect(events.find((e) => e.tier === 'club' && e.kind === 'invitational')!.vehicle).toBe('tc2');
    // If the season's machine is gone, the season is locked and says how to end it.
    const gone = { ...save, owned: save.owned.filter((o) => o.id !== 'tc1') };
    const locked = disciplineEvents(live, gone, 'circuit-cars').find((e) => e.key === key)!;
    expect(locked.status).toBe('locked');
    expect(locked.reasons.join(' ')).toContain('abandon the season');
  });
  it('publishes car channels and the derived ones the licences read', () => {
    const channels = snapshotChannels();
    for (const c of ['S', 'SPEED', 'LATERAL', 'SIDESLIP', 'PITCH', 'AIRBORNE'])
      expect(channels).toContain(c);
    expect(snapshotChannels({ F: { QX: 3, VX: 7 }, B: { LEAN: 0 }, BIKE_BASE: 257 })).toContain(
      'LEAN',
    );
  });
});

describe('a broke driver can always recover', () => {
  it('keeps the club meeting open with a loaned machine and no credits', () => {
    const broke = { ...newCareer(), credits: 0 };
    const recovery = recoveryEvent(live, broke, 'circuit-cars')!;
    expect(recovery).not.toBeNull();
    expect(recovery.loaner).toBe(true);
    expect(recovery.vehicle).toBe(loanerVehicle(live, 'circuit-cars')!.id);
    expect(recovery.stakes).toBeLessThan(0.5);
    const options = eventSession(recovery.definition!, { ...DEFAULT_OPTIONS });
    expect(options.opponents + 1).toBe(4);
    expect(() => buyVehicle(broke, live, 'tc1')).toThrow('club meeting');
    // Every other event waits for a machine, and paying out lifts the credits.
    const paid = settleRace(
      broke,
      { ...recovery, name: recovery.name },
      outcome({ cars: 4, position: 2, gridSlot: 2 }),
    );
    expect(paid.save.credits).toBeGreaterThan(0);
    expect(paid.payout.reputation).toBeLessThanOrEqual(1);
  });
  it('names the missing content instead of offering a recovery event that cannot run', () => {
    const recovery = disciplineEvents(live, newCareer(), 'festival').find(
      (e) => e.kind === 'recovery',
    )!;
    if (disciplineStatus(live, 'festival').state === 'coming') {
      expect(recovery.status).toBe('coming');
      expect(recovery.reasons.length).toBeGreaterThan(0);
      expect(recoveryEvent(live, newCareer(), 'festival')).toBeNull();
    }
  });
});

describe('garage ownership, active machines and setup presets', () => {
  it('stores only the parameters a machine exposes and explains the change', () => {
    let save = buyVehicle(newCareer(), live, 'tc1');
    const tc1 = live.vehicles.find((v) => v.id === 'tc1')!;
    const setup = { ...DEFAULT_SETUP, frontWing: 1, rearARB: 30000, brakeBias: 0.6 };
    save = savePreset(save, tc1, setup, 'Wet');
    const preset = save.presets.tc1[0];
    expect(Object.keys(preset.values).sort()).toEqual([...tc1.setupKeys].sort());
    expect(preset.values).not.toHaveProperty('frontWing');
    expect(save.selected.tc1).toBe(0);
    const applied = careerSetup(save, tc1)!;
    expect(applied.rearARB).toBe(30000);
    expect(applied.frontWing).toBe(DEFAULT_SETUP.frontWing);
    const effects = presetEffects(tc1, preset.values);
    expect(effects.join(' ')).toContain('Rear anti-roll bar up');
    expect(effects.join(' ')).toContain('oversteer');
    expect(effects.join(' ')).not.toContain('Front wing');
    save = selectPreset(save, 'tc1', -1);
    expect(careerSetup(save, tc1)).toBeNull();
    save = deletePreset(save, 'tc1', 0);
    expect(save.presets.tc1).toBeUndefined();
    expect(() => setActive(save, live, 'road-bikes', 'tc1')).toThrow('does not race');
    expect(() => buyVehicle(save, live, 'tc1')).toThrow('already own');
  });
  it('does not sell a machine that cannot race in this build', () => {
    // Off-road with no dirt venue (the circuits only), and a circuit class no
    // ruleset admits: both are listed but cannot be bought.
    const rx: CareerVehicle = {
      id: 'test-rx',
      name: 'TEST RX',
      classId: 'rallycross',
      dynamicsKind: 'four-wheel',
      setupKeys: [],
    };
    const odd: CareerVehicle = {
      id: 'test-hillclimb',
      name: 'TEST HILL CLIMB',
      classId: 'test-hill-climb',
      dynamicsKind: 'four-wheel',
      setupKeys: [],
    };
    const registry = withVehicles([rx, odd], {
      venues: live.venues.filter((v) => venueKind(v) === 'circuit'),
    });
    const rich = { ...newCareer(), credits: 1e6 };
    expect(disciplineStatus(registry, 'off-road').state).toBe('coming');
    expect(purchaseReasons(registry, rx).join(' ')).toContain('dirt or mixed-surface venue');
    expect(() => buyVehicle(rich, registry, 'test-rx')).toThrow('cannot race');
    expect(purchaseReasons(registry, odd)).toEqual(['No race ruleset admits test-hill-climb yet.']);
    expect(() => buyVehicle(rich, registry, 'test-hillclimb')).toThrow('cannot race');
    // Every machine of the live catalogue that can be bought can race.
    for (const v of live.vehicles)
      if (!purchaseReasons(live, v).length)
        expect(disciplineStatus(live, vehicleDiscipline(v)).state).toBe('open');
    expect(buyVehicle(rich, registry, 'tc1').owned).toEqual([{ id: 'tc1', source: 'purchase' }]);
  });
});

describe('career save versioning, migration and recovery', () => {
  it('seeds a new career from existing team, championship and setup saves', () => {
    const team = { ...newTeam(), reputation: 30, paidSessions: ['team-race'] };
    const season = newChampionship(4, [
      { circuit: 'aurel', weather: 'clear', laps: 3 },
      { circuit: 'vellamar', weather: 'clear', laps: 3 },
    ]);
    season.results.push({
      order: [1, 0, 2, 3],
      retired: [],
      grid: [0, 1, 2, 3],
      demonstration: false,
      session: 'champ-1',
    });
    const career = careerFromLegacy({
      team,
      championship: season,
      setup: { ...DEFAULT_SETUP, rearARB: 30000 },
      vehicles: live.vehicles,
    });
    expect(career.reputation['circuit-cars']).toBe(18 + 2);
    expect(career.paidSessions).toEqual(['team-race', 'champ-1']);
    expect(career.migratedFrom).toEqual(['team:v1', 'championship:v1', 'settings.setup']);
    expect(career.presets.tc1[0].values.rearARB).toBe(30000);
    expect(career.presets.tc1[0].values).not.toHaveProperty('frontWing');
    expect(career.credits).toBe(STARTING_CREDITS);
    // The legacy objects are not changed.
    expect(team.reputation).toBe(30);
    expect(season.results).toHaveLength(1);
    // Fresh installs start clean.
    expect(careerFromLegacy({}).migratedFrom).toEqual([]);
  });
  it('validates a stored career into bounded fields and round-trips', () => {
    let save = buyVehicle(newCareer(), live, 'tc1');
    save = settleRace(
      save,
      {
        key: 'k',
        kind: 'invitational',
        discipline: 'circuit-cars',
        name: 'K',
        stakes: 1,
        objectives: [],
      },
      outcome(),
    ).save;
    expect(validateCareer(JSON.parse(JSON.stringify(save)))).toEqual(save);
    const hostile = validateCareer({
      version: CAREER_VERSION,
      credits: -500,
      reputation: { 'circuit-cars': 900, festival: 'x' },
      licences: { braking: { medal: 'platinum', best: 'NaN', attempts: -3 } },
      owned: [{ id: 'tc1' }, { id: 'tc1' }, { id: 'bad:id' }, 7],
      active: { 'circuit-cars': 'apx01' },
      presets: { tc1: [{ name: 'x'.repeat(99), values: { rearARB: 1e9, 'evil key': 1 } }] },
      paidSessions: [1, 's'],
    });
    expect(hostile.credits).toBe(0);
    expect(hostile.reputation['circuit-cars']).toBe(100);
    expect(hostile.reputation.festival).toBe(0);
    expect(hostile.licences.braking).toEqual({ medal: null, best: null, attempts: 0 });
    expect(hostile.owned).toEqual([{ id: 'tc1', source: 'purchase' }]);
    expect(hostile.active).toEqual({}); // not owned
    expect(hostile.presets.tc1[0].name).toHaveLength(40);
    expect(Object.keys(hostile.presets.tc1[0].values)).toEqual(['rearARB']);
    expect(hostile.paidSessions).toEqual(['s']);
  });
  it('rejects unusable or newer saves so recovery falls back to the backup', () => {
    const backup = buyVehicle(newCareer(), live, 'tc1');
    expect(() => validateCareer('{corrupt')).toThrow();
    expect(() => validateCareer({ credits: 5 })).toThrow('version');
    expect(() => validateCareer({ version: CAREER_VERSION + 1 })).toThrow('newer');
    const recovered = recoverSave({ version: 99 }, backup, validateCareer);
    expect(recovered.recovered).toBe(true);
    expect(recovered.value!.owned).toEqual(backup.owned);
    expect(recovered.reason).toContain('newer');
    const lost = recoverSave('garbage', 'garbage', validateCareer);
    expect(lost.value).toBeNull();
  });
  it('loads through the store: recovers from the backup, else seeds from legacy saves', async () => {
    const { data, toasts, host } = storeHarness();
    const career = new CareerController(host, live);
    await career.load({ team: { ...newTeam(), reputation: 20 } });
    expect(career.save.reputation['circuit-cars']).toBe(8);
    expect(data.has(CAREER_KEY)).toBe(false); // seeded lazily, nothing written yet
    await career.transact((s) => buyVehicle(s, live, 'tc1'));
    await career.transact((s) => ({ ...s, credits: s.credits + 1 }));
    expect(data.get(backupKey(CAREER_KEY))).toMatchObject({ owned: [{ id: 'tc1' }] });
    // Corrupt the primary: the next load restores the backup and says so.
    data.set(CAREER_KEY, {
      version: 1,
      owned: 'nope',
      credits: 'NaN',
      reputation: null,
      licences: 5,
    });
    data.set(CAREER_KEY, '{"truncated');
    const reloaded = new CareerController(host, live);
    await reloaded.load({});
    expect(reloaded.save.owned).toEqual([{ id: 'tc1', source: 'purchase' }]);
    expect(toasts.at(-1)).toContain('restored the previous copy');
    // Both copies unusable: a new career, and the player is told.
    data.set(backupKey(CAREER_KEY), 17);
    const fresh = new CareerController(host, live);
    await fresh.load({});
    expect(fresh.save.owned).toEqual([]);
    expect(toasts.at(-1)).toContain('new career starts');
    // The unreadable copy is kept aside before the first overwrite and
    // survives the backup rotation of later writes.
    await fresh.transact((s) => ({ ...s, credits: s.credits + 1 }));
    await fresh.transact((s) => ({ ...s, credits: s.credits + 1 }));
    expect(data.get(CAREER_UNREADABLE_KEY)).toBe('{"truncated');
    expect(data.get(CAREER_KEY)).toMatchObject({ credits: STARTING_CREDITS + 2 });
  });
  it('never overwrites a career saved by a newer build', async () => {
    const { data, toasts, host } = storeHarness();
    const newer = { version: CAREER_VERSION + 1, credits: 987654, revision: 9 };
    const newerBackup = { version: CAREER_VERSION + 1, credits: 900000, revision: 8 };
    data.set(CAREER_KEY, newer);
    data.set(backupKey(CAREER_KEY), newerBackup);
    const career = new CareerController(host, live);
    await career.load({});
    expect(career.saving).toBe(false);
    expect(toasts.at(-1)).toContain('newer build');
    // Play goes on for the session; storage keeps both newer copies.
    await career.transact((s) => buyVehicle(s, live, 'tc1'));
    await career.transact((s) => ({ ...s, credits: s.credits + 5 }));
    expect(career.save.owned).toEqual([{ id: 'tc1', source: 'purchase' }]);
    expect(data.get(CAREER_KEY)).toEqual(newer);
    expect(data.get(backupKey(CAREER_KEY))).toEqual(newerBackup);
    // The player may choose to save here: the newer career is kept aside first.
    await career.replaceStored();
    expect(career.saving).toBe(true);
    expect(data.get(CAREER_NEWER_KEY)).toEqual(newer);
    await career.transact((s) => ({ ...s, credits: s.credits + 1 }));
    expect(data.get(CAREER_KEY)).toMatchObject({ version: CAREER_VERSION, owned: [{ id: 'tc1' }] });
    expect(data.get(CAREER_NEWER_KEY)).toEqual(newer);
    // A newer primary over a readable older backup: shown, still not written.
    data.clear();
    const older = buyVehicle(newCareer(), live, 'tc1');
    data.set(CAREER_KEY, newer);
    data.set(backupKey(CAREER_KEY), older);
    const mixed = new CareerController(host, live);
    await mixed.load({});
    expect(mixed.saving).toBe(false);
    expect(mixed.save.owned).toEqual(older.owned);
    await mixed.transact((s) => ({ ...s, credits: 1 }));
    await mixed.transact((s) => ({ ...s, credits: 2 }));
    expect(data.get(CAREER_KEY)).toEqual(newer);
  });
  it('plays without saving when storage cannot be read, leaving it untouched', async () => {
    const { data, toasts, host } = storeHarness();
    const stored = buyVehicle(newCareer(), live, 'tc1');
    data.set(CAREER_KEY, stored);
    const failing = {
      ...host,
      store: {
        ...host.store,
        read: async () => {
          throw new Error('blocked');
        },
      },
    };
    const career = new CareerController(failing, live);
    await career.load({});
    expect(career.saving).toBe(false);
    expect(toasts.at(-1)).toContain('nothing is saved');
    await career.transact((s) => ({ ...s, credits: 3 }));
    expect(career.save.credits).toBe(3);
    expect(data.get(CAREER_KEY)).toEqual(stored);
  });
  it('applies a change to what another tab saved, so neither tab loses progress', async () => {
    const { data, toasts, host } = storeHarness();
    const a = new CareerController(host, live),
      b = new CareerController(host, live);
    await a.load({});
    await b.load({});
    // Tab A buys a car; tab B, still on its copy, then earns a licence medal.
    await a.transact((s) => buyVehicle(s, live, 'tc1'));
    const medal = {
      test: 'braking' as const,
      value: 1,
      medal: 'gold' as const,
      valid: true,
      detail: '',
    };
    await b.transact((s) => settleLicence(s, medal, 'tab-b', false).save);
    expect(toasts.at(-1)).toContain('another tab');
    const stored = validateCareer(data.get(CAREER_KEY));
    expect(stored.owned).toEqual([{ id: 'tc1', source: 'purchase' }]);
    expect(stored.licences.braking!.medal).toBe('gold');
    expect(stored.credits).toBe(STARTING_CREDITS - 30000 + 10000);
    // Tab A's next change keeps tab B's medal.
    await a.transact((s) => ({ ...s, credits: s.credits + 1 }));
    const after = validateCareer(data.get(CAREER_KEY));
    expect(after.licences.braking!.medal).toBe('gold');
    expect(after.owned).toEqual([{ id: 'tc1', source: 'purchase' }]);
    expect(after.revision).toBe(3);
    // A purchase already made in the other tab is refused, not repeated.
    await expect(b.transact((s) => buyVehicle(s, live, 'tc1'))).rejects.toThrow('already own');
  });
});

describe('contact energy from the impact channel', () => {
  it('accumulates new impacts above the decaying peak, not the decay itself', () => {
    const meter = new ContactMeter();
    const frame = new Float32Array(HEADER + CAR_STRIDE);
    const at = (time: number, impact: number) => {
      frame[H.TIME] = time;
      frame[carBase(0) + F.IMPACT] = impact;
      meter.observe(frame);
    };
    at(0, 0);
    at(0.1, 0.2); // 6 kJ blow
    at(0.2, 0.0); // decayed
    at(0.3, 0.0);
    at(0.4, 0.05); // 1.5 kJ
    expect(meter.energy).toBeCloseTo(0.25 * IMPACT_FULL_SCALE_J, 0);
    at(0.45, 0.0); // decays 0.1 in 0.05 s: no new contact
    expect(meter.energy).toBeCloseTo(0.25 * IMPACT_FULL_SCALE_J, 0);
    at(0.2, 0.5); // rewind: new baseline, no invented contact
    expect(meter.energy).toBeCloseTo(0.25 * IMPACT_FULL_SCALE_J, 0);
  });
});
