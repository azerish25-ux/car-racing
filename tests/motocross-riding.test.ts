import { describe, expect, it } from 'vitest';
import { controls, DEFAULT_SETUP, type Assist } from '../src/simulation/config.ts';
import { jumpHoldSpeed } from '../src/simulation/offroad/ai.ts';
import { MX_250, MX_450 } from '../src/simulation/offroad/dirt-bikes.ts';
import { DirtBikeVehicle } from '../src/simulation/offroad/dirt-bike-vehicle.ts';
import { rideLine, rigTrack } from '../src/simulation/offroad/jump-rig.ts';
import {
  assessMotocrossLanding,
  LANDING_RULES,
} from '../src/simulation/offroad/riding-feedback.ts';
import { writeOffroadBlock } from '../src/simulation/offroad/session.ts';
import { offroadCourse } from '../src/simulation/offroad/venues.ts';
import { O, OFFROAD_STRIDE } from '../src/simulation/protocol.ts';

const DT = 1 / 240;

/** Reach a real surveyed takeoff using production controls/terrain, then
 * hand the already airborne bike to the player. No internal flight state
 * is fabricated and no private solver method is called. */
function launch(assist: Assist = 'raw', keepAI = false, definition = MX_450) {
  const track = rigTrack('valley-ridge-mx'),
    jump = offroadCourse(track.circuit)!.jumps.find((j) => j.name === 'RIDGE TABLE')!,
    speed = jumpHoldSpeed(jump),
    bike = new DirtBikeVehicle(0, 'medium', DEFAULT_SETUP, assist, definition);
  bike.place(track, jump.start - 12);
  bike.dynamics.speed = speed;
  for (let g = 1; g < definition.spec.gearRatios.length - 1; g++) {
    bike.gear = g;
    const rpm =
      ((speed / definition.spec.wheelRadius) *
        definition.spec.gearRatios[g + 1] *
        definition.spec.finalDrive *
        30) /
      Math.PI;
    if (rpm < definition.spec.shiftRPM * 0.85) break;
  }
  bike.aiControlled(1e6);
  for (let i = 0; i < 6 / DT; i++) {
    if (!bike.airborne) {
      const face = bike.s >= jump.start - 1 && bike.s <= jump.takeoff + 1;
      rideLine(bike, track, face ? Math.max(speed, bike.dynamics.speed) : speed);
    }
    bike.step(DT, track);
    if (bike.airborne && bike.s >= jump.start - 1 && bike.s <= jump.takeoff + 3) {
      if (!keepAI) bike.aiControlled(0);
      Object.assign(bike.input, controls());
      return { bike, track };
    }
  }
  throw new Error('Production RIDGE TABLE run did not reach its takeoff');
}

function fly(run: ReturnType<typeof launch>, seconds: number) {
  for (let i = 0; i < Math.round(seconds / DT); i++) run.bike.step(DT, run.track);
  return run.bike;
}

describe('motocross player air control', () => {
  it('a normal brake tap lowers the nose and slows the front wheel without bending the trajectory', () => {
    const coast = launch(),
      brake = launch();
    brake.bike.input.brake = 1;
    const a = fly(coast, 0.24),
      b = fly(brake, 0.24);
    expect(a.airborne && b.airborne).toBe(true);
    expect(b.frontSpin).toBeLessThan(a.frontSpin * 0.35);
    expect(b.pitch).toBeLessThan(a.pitch - 0.025);
    expect(b.dynamics.x).toBeCloseTo(a.dynamics.x, 8);
    expect(b.dynamics.z).toBeCloseTo(a.dynamics.z, 8);
    expect(b.frontSpin).toBeGreaterThanOrEqual(0);
  });

  it('left/right air input banks the chassis, then release levels it without sideways air steering', () => {
    const left = launch(),
      right = launch();
    left.bike.input.steer = 1;
    right.bike.input.steer = -1;
    fly(left, 0.28);
    fly(right, 0.28);
    expect(left.bike.airborne && right.bike.airborne).toBe(true);
    expect(left.bike.dynamics.lean).toBeGreaterThan(0.16);
    expect(right.bike.dynamics.lean).toBeLessThan(-0.16);
    expect(left.bike.dynamics.x).toBeCloseTo(right.bike.dynamics.x, 8);
    expect(left.bike.dynamics.z).toBeCloseTo(right.bike.dynamics.z, 8);
    const banked = Math.abs(left.bike.dynamics.lean);
    left.bike.input.steer = 0;
    fly(left, 0.36);
    expect(left.bike.airborne).toBe(true);
    expect(Math.abs(left.bike.dynamics.lean)).toBeLessThan(banked * 0.65);
  });

  it('Sport settles a held air lean toward touchdown while Raw preserves player banking authority', () => {
    const sport = launch('sport'),
      raw = launch('raw');
    sport.bike.input.steer = raw.bike.input.steer = 1;
    fly(sport, 0.65);
    fly(raw, 0.65);
    expect(Math.abs(sport.bike.dynamics.lean)).toBeLessThan(Math.abs(raw.bike.dynamics.lean));
    for (const run of [sport, raw]) {
      expect(Math.abs(run.bike.dynamics.lean)).toBeLessThanOrEqual(MX_450.bike!.maxLean);
      expect(Number.isFinite(run.bike.pitchRate)).toBe(true);
    }
  });

  it('keeps the existing AI flight solution independent of the unused front pedal', () => {
    const normal = launch('sport', true),
      brake = launch('sport', true);
    brake.bike.input.brake = 1;
    fly(normal, 0.35);
    fly(brake, 0.35);
    expect(brake.bike.pitch).toBe(normal.bike.pitch);
    expect(brake.bike.cgY).toBe(normal.bike.cgY);
    expect(brake.bike.dynamics.lean).toBe(normal.bike.dynamics.lean);
    expect(brake.bike.frontSpin).toBe(normal.bike.frontSpin);
  });

  it.each([MX_450, MX_250])(
    '$id keeps air-pitch brake corrections out of the next grounded substep',
    (definition) => {
      const { bike, track } = launch('sport', true, definition),
        requested = { ...controls(), throttle: 0.35 };
      Object.assign(bike.input, requested);
      let largestAirBrake = 0,
        largestInputChange = 0;
      // A real surveyed takeoff and landing, with no AI update in between:
      // the planner's ground command must survive the flight controller.
      for (let i = 0; i < 4 / DT && bike.airborne; i++) {
        bike.step(DT, track);
        largestAirBrake = Math.max(largestAirBrake, bike.rearBrake);
        largestInputChange = Math.max(
          largestInputChange,
          Math.abs(bike.input.throttle - requested.throttle),
          Math.abs(bike.input.clutch - requested.clutch),
        );
      }
      expect(bike.airborne).toBe(false);
      expect(bike.lastLanding!.airTime).toBeGreaterThan(0.2);
      expect(largestAirBrake).toBeGreaterThan(0.2);
      expect(largestInputChange).toBe(0);
      // The production simulation has two substeps per AI update. The
      // second must not turn the last air correction into a tyre lock.
      bike.step(DT, track);
      expect(bike.airborne).toBe(false);
      expect(bike.rearBrake).toBe(0);
      expect(bike.dynamics.rearBrakeForce).toBe(0);
      expect(bike.input).toEqual(requested);
      expect(bike.dynamics.crashes).toBe(0);
    },
  );

  it('publishes the new landing on the touchdown edge and refines that record during settlement', () => {
    const run = launch('sport', true);
    while (run.bike.airborne && run.bike.airTime < 4) run.bike.step(DT, run.track);
    const record = run.bike.lastLanding;
    expect(record).not.toBeNull();
    expect(record!.time).toBe(run.bike.clock);
    expect(record!.airTime).toBeGreaterThan(0.2);
    const block = new Float32Array(OFFROAD_STRIDE);
    writeOffroadBlock(block, 0, run.bike, null);
    expect(block[O.AIRBORNE]).toBe(0);
    expect(block[O.LANDING_PITCH]).toBeCloseTo(record!.pitchError, 6);
    expect(block[O.LANDING_SPEED]).toBeCloseTo(record!.normalSpeed, 6);
    fly(run, LANDING_RULES.settleSeconds);
    expect(run.bike.lastLanding).toBe(record);
    expect(['clean', 'bottomed']).toContain(record!.outcome);
  });

  it('is repeatable and keeps spinning wheels and chassis state bounded under alternating air inputs', () => {
    const run = () => {
      const r = launch('raw');
      for (let i = 0; i < 160; i++) {
        r.bike.input.steer = i % 40 < 20 ? 1 : -1;
        r.bike.input.brake = i % 50 < 20 ? 1 : 0;
        r.bike.input.throttle = i % 50 >= 35 ? 1 : 0;
        r.bike.input.clutch = i % 70 < 8 ? 1 : 0;
        r.bike.step(DT, r.track);
        expect(r.bike.frontSpin).toBeGreaterThanOrEqual(0);
        expect(r.bike.rearSpin).toBeGreaterThanOrEqual(0);
        expect(Math.abs(r.bike.pitch)).toBeLessThanOrEqual(1.2);
        expect(Number.isFinite(r.bike.cgY + r.bike.pitchRate + r.bike.dynamics.lean)).toBe(true);
      }
      return [r.bike.cgY, r.bike.pitch, r.bike.dynamics.lean, r.bike.frontSpin, r.bike.rearSpin];
    };
    expect(run()).toEqual(run());
  });
});

describe('motocross landing messages', () => {
  it('celebrates slope-matched touchdown and warns about bottoming using the normalized snapshot value', () => {
    expect(assessMotocrossLanding(0.12, 2.1, 0, false).kind).toBe('clean');
    expect(assessMotocrossLanding(0.1, 2.1, 0.7, false).kind).toBe('hard');
    expect(assessMotocrossLanding(0.1, 7.2, 0, false).kind).toBe('hard');
  });

  it('reports an actual crash rather than inferring one from a single pose or invalid telemetry', () => {
    expect(assessMotocrossLanding(0, 0, 0, true).kind).toBe('crash');
    expect(assessMotocrossLanding(-0.9, 2.5, 0, false).kind).toBe('nose-low');
    expect(assessMotocrossLanding(NaN, 0, 0, false).kind).not.toBe('clean');
    expect(assessMotocrossLanding(0.7, 2.5, 0, false).cue).toContain('brake');
  });
});
