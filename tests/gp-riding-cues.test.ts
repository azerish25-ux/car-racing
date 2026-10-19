import { describe, expect, it } from 'vitest';
import { MotorcycleRoadPreview } from '../src/rendering/motorcycle-camera.ts';
import { menuPreview } from '../src/rendering/menu-preview.ts';
import { bikeSlipstreamDragScale } from '../src/simulation/bike-slipstream.ts';
import { circuitDefinition } from '../src/simulation/circuits.ts';
import { FLAG } from '../src/simulation/marshal.ts';
import { B, BIKE_BASE, F, H, carBase } from '../src/simulation/protocol.ts';
import { Track, trackPoint } from '../src/simulation/track.ts';
import { VEHICLES } from '../src/simulation/vehicles.ts';
import { GPRidingCues, gpTowFraction } from '../src/ui/gp-riding-cues.ts';

const track = new Track('clear', false, undefined, circuitDefinition('poggio-alto'));
const o = carBase(0),
  b = o + BIKE_BASE;

function riding(station: number, speed = 45, tow = 0, slide = 0) {
  const frame = menuPreview(track, station, 'gpr1');
  const road = track.at(station, trackPoint());
  frame[H.PHASE] = 2;
  frame[o + F.SPEED] = Math.hypot(speed, slide);
  frame[o + F.VX] = speed * road.tx + slide * road.tz;
  frame[o + F.VZ] = speed * road.tz - slide * road.tx;
  frame[b + B.TUCK] = 0.8;
  const spec = VEHICLES.gpr1.bike!;
  frame[o + F.DRAG] = spec.drag * speed ** 2 * bikeSlipstreamDragScale(0.8, spec.tuckDrag, tow);
  return frame;
}

describe('GP riding cues use actual road and recorded powertrain data', () => {
  it('distinguishes the applied tow from dirty air and lateral slide', () => {
    const frame = riding(0, 55, 0.7, 8);
    frame[o + F.WAKE] = 0.04;
    expect(gpTowFraction(frame)).toBeCloseTo(0.7, 4);
    frame[o + F.WAKE] = 1;
    expect(gpTowFraction(frame)).toBeCloseTo(0.7, 4);
    expect(gpTowFraction(riding(0, 55, 0, 8))).toBeCloseTo(0, 4);
    expect(gpTowFraction(riding(0, 5, 0.7))).toBe(0);
  });

  it('names the upcoming apex, recognizes trail braking, and clears an exit on rewind', () => {
    const cues = new GPRidingCues(),
      corner = track.circuit.corners[0];
    const entry = riding(corner.s - 80);
    entry[o + F.BRAKE] = 0.4;
    entry[b + B.LEAN] = 0.3;
    const before = entry.slice(),
      readout = cues.read(entry, track)!;
    expect(readout.corner).toContain(corner.name);
    expect(readout.distance).toBe('80 M TO APEX');
    expect(readout.action).toBe('TRAIL BRAKING');
    expect(readout.direction).toBe(
      track.at(corner.s, trackPoint()).curvature < 0 ? 'right' : 'left',
    );
    const exit = cues.read(riding(corner.s + 12), track)!;
    expect(exit.action).toBe('CORNER EXIT');
    expect(exit.distance).toBe('EXIT');
    expect(cues.read(entry, track)).toEqual(readout);
    expect(entry).toEqual(before);
  });

  it('uses wrapped apex distances at the start line', () => {
    const wrapped = new Track('clear', false, undefined, {
      ...track.circuit,
      corners: [{ s: 20, name: 'SEAM' }],
    });
    const frame = riding(wrapped.length - 30);
    const readout = new GPRidingCues().read(frame, wrapped)!;
    expect(readout.corner).toBe('T1 · SEAM');
    expect(readout.distance).toBe('50 M TO APEX');
  });

  it('puts caution ahead of passing advice and suppresses racing advice in non-riding states', () => {
    const cues = new GPRidingCues(),
      frame = riding(0, 60, 0.8);
    expect(cues.read(frame, track)?.action).toBe('SLIPSTREAM');
    frame[H.SC_PHASE] = 1;
    expect(cues.read(frame, track)).toMatchObject({ action: 'CAUTION', tow: 0 });
    frame[H.SC_PHASE] = 0;
    for (const flag of [FLAG.YELLOW, FLAG.DOUBLE_YELLOW]) {
      frame[o + F.LOCAL_FLAG] = flag;
      expect(cues.read(frame, track)).toMatchObject({ action: 'CAUTION', tow: 0 });
    }
    frame[o + F.LOCAL_FLAG] = FLAG.BLUE;
    expect(cues.read(frame, track)).toMatchObject({
      action: 'BLUE FLAG',
      detail: 'Let the faster rider through',
      tow: 0,
    });
    frame[H.SC_PHASE] = 1;
    expect(cues.read(frame, track)).toMatchObject({ action: 'CAUTION', tow: 0 });
    frame[H.SC_PHASE] = 0;
    frame[o + F.LOCAL_FLAG] = FLAG.GREEN;
    for (const field of [o + F.IN_PIT, o + F.RETIRED, o + F.FINISH, b + B.STATE]) {
      frame[field] = 1;
      expect(cues.read(frame, track)).toBeNull();
      frame[field] = 0;
    }
    frame[o + F.LATERAL] = 40;
    expect(cues.read(frame, track)).toBeNull();
    frame[o + F.LATERAL] = 0;
    frame[o + F.VZ] *= -1;
    frame[o + F.VX] *= -1;
    expect(cues.read(frame, track)).toBeNull();
    expect(cues.read(new Float32Array(), track)).toBeNull();
    expect(cues.read(menuPreview(track, 0, 'sbk1000'), track)).toBeNull();
  });
});

describe('GP road-aware chase', () => {
  it('previews a real approaching bend, holds on replay, and does not anticipate backwards/off-track', () => {
    const preview = new MotorcycleRoadPreview();
    const s = track.circuit.corners[0].s - 35;
    const road = track.at(s, trackPoint()),
      heading = Math.atan2(road.tx, road.tz);
    const view = { ...preview.read(track, s, 0, 45, heading)! };
    expect(Math.abs(view.yaw)).toBeGreaterThan(0.01);
    expect(Math.abs(view.yaw)).toBeLessThanOrEqual(0.14);
    preview.read(track, s + 70, 0, 45, heading);
    expect(preview.read(track, s, 0, 45, heading)).toEqual(view);
    expect(preview.read(track, s, 0, 45, heading + Math.PI)).toBeNull();
    expect(preview.read(track, s, 30, 45, heading)).toBeNull();
    expect(preview.read(track, NaN, 0, 45, heading)).toBeNull();
    expect(preview.read(track, s, 0, 45, heading, true)?.yaw).toBe(0);
  });

  it('uses the road grade on crests, independent of suspension pitch', () => {
    const preview = new MotorcycleRoadPreview();
    let greatestPitch = 0;
    for (let s = 0; s < track.length; s += 25) {
      const road = track.at(s, trackPoint());
      const result = preview.read(track, s, 0, 60, Math.atan2(road.tx, road.tz))!;
      expect(Number.isFinite(result.pitch)).toBe(true);
      expect(Math.abs(result.pitch)).toBeLessThanOrEqual(0.24);
      greatestPitch = Math.max(greatestPitch, Math.abs(result.pitch));
    }
    expect(greatestPitch).toBeGreaterThan(0.02);
  });
});
