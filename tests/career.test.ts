import { describe, expect, it } from 'vitest';
import { newChampionship, type RoundResult } from '../src/core/championship.ts';
import { ContactMeter, IMPACT_FULL_SCALE_J } from '../src/career/contact.ts';
import { CareerController, type CareerHost } from '../src/career/controller.ts';
import { licenceCourse, LICENCE_PACE } from '../src/career/course.ts';
import {
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
  CLASS_PRICES,
  disciplineEvents,
  disciplineTiers,
  licenceAvailability,
  loanerVehicle,
  recoveryEvent,
  vehiclePrice,
} from '../src/career/ladder.ts';
import {
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
  liveRegistry,
  snapshotChannels,
  vehicleFamily,
  type CareerRegistry,
  type CareerVehicle,
} from '../src/career/registry.ts';
import {
  CAREER_KEY,
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
    const invalid = scoreSamples(LICENCE_TESTS.cornering, course, through(0.2, 20, false))!;
    expect(invalid.valid).toBe(false);
    expect(invalid.medal).toBeNull();
    // Below the pace gate the corner is not scored (the player goes again).
    expect(scoreSamples(LICENCE_TESTS.cornering, course, through(0, 10))).toBeNull();
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
    expect(scoreSamples(LICENCE_TESTS.wet, wetCourse, lap(3, false))?.valid).toBe(false);
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
    const jump = [
      sample({ t: 0, speed: 20 }),
      ...Array.from({ length: 30 }, (_, i) =>
        sample({ t: 0.02 * (i + 1), speed: 20, airborne: true }),
      ),
      sample({ t: 0.7, speed: 20, pitch: (2.5 * Math.PI) / 180 }),
    ];
    const landed = scoreSamples(LICENCE_TESTS.jump, course, jump)!;
    expect(landed.value).toBeCloseTo(2.5, 3);
    expect(landed.medal).toBe('gold');
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
    const bike: CareerVehicle = {
      id: 'test-sbk',
      name: 'TEST SUPERBIKE',
      classId: 'superbike',
      dynamicsKind: 'bike',
      setupKeys: ['brakeBias'],
      ai: { topSpeed: 80, lateralBase: 11 },
    };
    const noRules = withVehicles([bike]);
    const status = disciplineStatus(noRules, 'road-bikes');
    if (!live.rulesets.some((r) => r.allowedClasses.includes('superbike'))) {
      expect(status.state).toBe('coming');
      expect(status.reasons.join(' ')).toContain('No race ruleset admits superbike');
    }
    const rules = [
      ...live.rulesets,
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
    const open = withVehicles([bike], { rulesets: rules });
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
    if (!live.channels.includes('LEAN')) {
      expect(lean.status).toBe('coming');
      expect(lean.reasons.join(' ')).toContain('LEAN');
    }
    const leaning = licenceAvailability(
      { ...open, channels: [...open.channels, 'LEAN'] },
      newCareer(),
      'lean',
    );
    expect(leaning.status).toBe('open');
    expect(leaning.vehicle).toBe('test-sbk');
    expect(leaning.loaner).toBe(true);
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
    const gt: CareerVehicle = {
      id: 'test-gt',
      name: 'TEST GT',
      classId: 'gt',
      dynamicsKind: 'four-wheel',
      setupKeys: [],
    };
    const registry = withVehicles([gt]);
    const gtEvent = disciplineEvents(registry, progressed(registry), 'circuit-cars').find(
      (e) => e.tier === 'gt',
    )!;
    // A registered class without a race ruleset is coming, not merely locked.
    if (!registry.rulesets.some((r) => r.allowedClasses.includes('gt'))) {
      expect(gtEvent.status).toBe('coming');
      expect(gtEvent.reasons.join(' ')).toContain('No race ruleset admits gt');
    }
    expect(validateCareerContent(registry)).toEqual([]);
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
    const data = new Map<string, unknown>();
    const toasts: string[] = [];
    const store: CareerHost['store'] = {
      async readRecovered(key, validate) {
        return recoverSave(data.get(key), data.get(backupKey(key)), validate);
      },
      async writeWithBackup(key, value) {
        if (data.has(key)) data.set(backupKey(key), data.get(key));
        data.set(key, structuredClone(value));
      },
    };
    const host = { store, toast: (m: string) => toasts.push(m) } as unknown as CareerHost;
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
