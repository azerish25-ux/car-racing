import { describe, expect, it } from 'vitest';
import { menuPreview } from '../src/rendering/menu-preview.ts';
import { DEFAULT_OPTIONS } from '../src/simulation/config.ts';
import { FLAG } from '../src/simulation/marshal.ts';
import {
  B,
  BIKE_BASE,
  F,
  H,
  W,
  WHEEL_BASE,
  WHEEL_STRIDE,
  carBase,
} from '../src/simulation/protocol.ts';
import { SURFACE, Track, trackPoint } from '../src/simulation/track.ts';
import { Simulation } from '../src/simulation/world.ts';
import { gpControlFeedback } from '../src/ui/gp-control-feedback.ts';
import { GPRidingCues } from '../src/ui/gp-riding-cues.ts';

const track = new Track(),
  o = carBase(0),
  b = o + BIKE_BASE,
  front = o + WHEEL_BASE,
  rear = front + 2 * WHEEL_STRIDE;

function riding(machine = 'gpr1') {
  const frame = menuPreview(track, track.circuit.corners[0].s - 80, machine),
    road = track.at(frame[o + F.S], trackPoint());
  frame[H.PHASE] = 2;
  frame[o + F.SPEED] = 40;
  frame[o + F.VX] = 40 * road.tx;
  frame[o + F.VZ] = 40 * road.tz;
  frame[o + F.THROTTLE] = 0.6;
  frame[o + F.BRAKE] = 0.25;
  frame[b + B.LEAN] = 0.4;
  frame[b + B.REAR_BRAKE] = 0.2;
  return frame;
}

describe('GP control feedback reads the actual two tyre contacts', () => {
  it('distinguishes front and rear wet kerbs using local water, ignoring duplicated tyres', () => {
    const frame = riding();
    frame[front + WHEEL_STRIDE + W.SURFACE] = SURFACE.GRASS;
    frame[rear + WHEEL_STRIDE + W.PUNCTURED] = 1;
    expect(gpControlFeedback(frame)).toBeNull();
    frame[front + W.SURFACE] = SURFACE.KERB;
    expect(gpControlFeedback(frame)).toBeNull();
    frame[front + W.WATER] = 0.2;
    expect(gpControlFeedback(frame)).toMatchObject({
      action: 'FRONT ON WET KERB',
      detail: 'Ease braking · keep inputs smooth',
    });
    frame[front + W.SURFACE] = SURFACE.ASPHALT;
    frame[rear + W.SURFACE] = SURFACE.KERB;
    frame[rear + W.WATER] = 0.2;
    expect(gpControlFeedback(frame)).toMatchObject({
      action: 'REAR ON WET KERB',
      detail: 'Pick up bike · add power gently',
    });
    frame[rear + W.WATER] = 0;
    expect(gpControlFeedback(frame)).toBeNull();
    frame[rear + W.SURFACE] = SURFACE.PAINT;
    frame[rear + W.WATER] = 0.1;
    expect(gpControlFeedback(frame)?.action).toBe('REAR ON WET PAINT');
  });

  it('gives axle-specific edge recovery without inventing a slip reading', () => {
    const frame = riding();
    // These channels are NOT physical slip estimates for the reduced bike.
    frame[front + W.ANGLE] = 0.5;
    frame[rear + W.SLIP] = 0.3;
    expect(gpControlFeedback(frame)).toBeNull();
    frame[front + W.SURFACE] = SURFACE.GRASS;
    expect(gpControlFeedback(frame)).toMatchObject({
      action: 'FRONT ON GRASS',
      detail: 'Ease braking · steer gently',
    });
    frame[front + W.SURFACE] = SURFACE.ASPHALT;
    frame[rear + W.SURFACE] = SURFACE.GRAVEL;
    expect(gpControlFeedback(frame)).toMatchObject({
      action: 'REAR ON GRAVEL',
      detail: 'Ease power · rejoin smoothly',
    });
  });

  it('requires actual load transfer and the right input before warning of wheel lift', () => {
    const frame = riding();
    frame[b + B.PITCH] = 0.15;
    expect(gpControlFeedback(frame)).toBeNull();
    frame[b + B.FRONT_LOAD] = 30;
    expect(gpControlFeedback(frame)?.action).toBe('FRONT LIFT');
    frame[o + F.THROTTLE] = 0;
    expect(gpControlFeedback(frame)).toBeNull();
    frame[b + B.FRONT_LOAD] = 1600;
    frame[b + B.REAR_LOAD] = 30;
    expect(gpControlFeedback(frame)?.action).toBe('LIGHT REAR');
    frame[o + F.BRAKE] = 0;
    expect(gpControlFeedback(frame)).toBeNull();
    frame[o + F.BRAKE] = 0.5;
    frame[o + F.SPEED] = 2;
    expect(gpControlFeedback(frame)).toBeNull();
  });

  it('uses the actual brake fade curve and resets on a cooler presented frame', () => {
    const cool = riding(),
      hot = cool.slice();
    hot[front + W.DISC_TEMP] = 1050;
    expect(gpControlFeedback(cool)).toBeNull();
    expect(gpControlFeedback(hot)?.action).toBe('FRONT BRAKE HOT');
    hot[o + F.BRAKE] = 0;
    expect(gpControlFeedback(hot)).toBeNull();
    hot[rear + W.DISC_TEMP] = 1050;
    expect(gpControlFeedback(hot)?.action).toBe('REAR BRAKE HOT');
    expect(gpControlFeedback(cool)).toBeNull();
    hot[front + W.PUNCTURED] = 1;
    expect(gpControlFeedback(hot)?.action).toBe('FRONT PUNCTURE');
  });

  it('explains strong corner-exit intervention without describing it as traction alone', () => {
    const frame = riding();
    frame[b + B.INTERVENTION] = 0.5;
    expect(gpControlFeedback(frame)).toMatchObject({
      action: 'POWER LIMITED',
      detail: 'TC/WC active · roll on smoothly',
    });
    frame[b + B.LEAN] = 0.1;
    expect(gpControlFeedback(frame)).toBeNull();
  });

  it('leaves marshal instructions authoritative and restores corner advice after a rewind', () => {
    const cues = new GPRidingCues(),
      clear = riding(),
      wet = clear.slice(),
      original = clear.slice();
    const before = cues.read(clear, track);
    wet[front + W.SURFACE] = SURFACE.KERB;
    wet[front + W.WATER] = 0.2;
    expect(cues.read(wet, track)).toMatchObject({ action: 'FRONT ON WET KERB', tow: 0 });
    for (const flag of [FLAG.YELLOW, FLAG.DOUBLE_YELLOW, FLAG.BLUE]) {
      wet[o + F.LOCAL_FLAG] = flag;
      expect(cues.read(wet, track)?.action).toBe(flag === FLAG.BLUE ? 'BLUE FLAG' : 'CAUTION');
    }
    expect(cues.read(clear, track)).toEqual(before);
    expect(clear).toEqual(original);
  });

  it('retains recovery advice off route without stale corner directions or tow', () => {
    const cues = new GPRidingCues(),
      clear = riding(),
      offTrack = clear.slice(),
      road = track.at(clear[o + F.S], trackPoint()),
      before = cues.read(clear, track);
    offTrack[o + F.LATERAL] = road.width + 0.5;
    expect(cues.read(offTrack, track)).toBeNull();
    offTrack[front + W.SURFACE] = SURFACE.GRASS;
    expect(cues.read(offTrack, track)).toMatchObject({
      corner: 'BIKE CONTROL',
      direction: 'none',
      distance: '',
      action: 'FRONT ON GRASS',
      detail: 'Ease braking · steer gently',
      tow: 0,
    });
    // A recovering rider can move across or against the route direction.
    offTrack[o + F.VX] = -16 * road.tx;
    offTrack[o + F.VZ] = -16 * road.tz;
    offTrack[front + W.SURFACE] = SURFACE.ASPHALT;
    offTrack[rear + W.SURFACE] = SURFACE.GRAVEL;
    expect(cues.read(offTrack, track)).toMatchObject({
      direction: 'none',
      action: 'REAR ON GRAVEL',
      tow: 0,
    });
    offTrack[o + F.LOCAL_FLAG] = FLAG.YELLOW;
    expect(cues.read(offTrack, track)?.action).toBe('CAUTION');
    expect(cues.read(clear, track)).toEqual(before);
  });

  it('suppresses stale, invalid, non-GP and non-riding feedback', () => {
    expect(gpControlFeedback(new Float32Array())).toBeNull();
    for (const id of ['sbk1000', 'ss600', 'nr900', 'apx01', 'mx450']) {
      const frame = riding(id);
      frame[front + W.PUNCTURED] = 1;
      expect(gpControlFeedback(frame)).toBeNull();
    }
    const frame = riding();
    frame[rear + W.SURFACE] = SURFACE.GRAVEL;
    for (const index of [b + B.STATE, o + F.IN_PIT, o + F.FINISH, o + F.RETIRED]) {
      frame[index] = 1;
      expect(gpControlFeedback(frame)).toBeNull();
      frame[index] = 0;
    }
    for (const invalid of [NaN, Infinity, -Infinity, -1]) {
      frame[b + B.FRONT_LOAD] = invalid;
      expect(gpControlFeedback(frame)).toBeNull();
    }
    frame[H.PHASE] = 1;
    expect(gpControlFeedback(frame)).toBeNull();
  });

  it('reads a real simulation snapshot and reports a heated front brake only while braking', () => {
    const sim = new Simulation({
      ...DEFAULT_OPTIONS,
      mode: 'practice',
      opponents: 0,
      vehicles: ['gpr1'],
      circuit: 'poggio-alto',
      weather: 'clear',
    });
    sim.autoPlayer = true;
    for (let i = 0; i < 8 * 240; i++) sim.step(1 / 240);
    const bike = sim.cars[0];
    expect(bike.speed).toBeGreaterThan(15);
    sim.autoPlayer = false;
    // Explicit thermal initial condition; the real adapter cools the discs,
    // applies fade and publishes the resulting wheel state on the next step.
    bike.tires[0].discTemp = bike.tires[1].discTemp = 1050;
    sim.setInput({ ...bike.input, throttle: 0, brake: 0.2, steer: 0 });
    sim.step(1 / 240);
    const frame = sim.makeFrame();
    sim.writeFrame(frame);
    expect(frame[front + W.DISC_TEMP]).toBeGreaterThan(1000);
    expect(gpControlFeedback(frame)?.action).toBe('FRONT BRAKE HOT');
    sim.setInput({ ...bike.input, throttle: 0, brake: 0, steer: 0 });
    for (let i = 0; i < 60; i++) sim.step(1 / 240);
    sim.writeFrame(frame);
    expect(gpControlFeedback(frame)?.action).not.toBe('FRONT BRAKE HOT');
  });
});
