import { it, expect } from 'vitest';
import { DEFAULT_SETTINGS, validateSettings } from '../src/storage/data.ts';
import { raceBriefing } from '../src/ui/race-briefing.ts';
import { vehicleWarning } from '../src/ui/race-day-hud.ts';
import { Simulation } from '../src/simulation/world.ts';
import { DEFAULT_OPTIONS } from '../src/simulation/config.ts';
import { F, H, W, WHEEL_BASE, carBase } from '../src/simulation/protocol.ts';
import { poseGridMechanic, gridMechanicMotion } from '../src/rendering/grid-mechanic-motion.ts';
import * as T from 'three';

it('defaults to race day, migrates old saves and validates Quick Start without coercing strings', () => {
  expect(DEFAULT_SETTINGS.quickStart).toBe(false);
  expect(validateSettings({ version: 1 }).quickStart).toBe(false);
  expect(validateSettings({ version: 6, quickStart: 'true' }).quickStart).toBe(false);
  expect(validateSettings({ ...DEFAULT_SETTINGS, quickStart: true }).quickStart).toBe(true);
});
it('briefs the real grid and fitted compound without altering its snapshot', () => {
  const sim = new Simulation({
    ...DEFAULT_OPTIONS,
    opponents: 3,
    grid: [1, 2, 0, 3],
    compound: 'hard',
  });
  const frame = sim.makeFrame(),
    before = frame.slice();
  const html = raceBriefing(sim.options, frame);
  expect(html).toContain('P3');
  expect(html).toContain('HARD');
  expect(html).toContain(frame[carBase(0) + F.FUEL].toFixed(1));
  expect(frame).toEqual(before);
  frame[H.TICK] = 1;
  expect(() => raceBriefing(sim.options, frame)).toThrow();
});
it('surfaces real puncture, aero, fuel and brake warnings independently of the open information page', () => {
  const frame = new Simulation(DEFAULT_OPTIONS).makeFrame(),
    o = carBase(0);
  expect(vehicleWarning(frame)).toBe('');
  frame[H.PHASE] = 2;
  frame[o + F.FUEL] = 1;
  expect(vehicleWarning(frame)).toContain('LOW FUEL');
  frame[o + F.FRONT_HEALTH] = 0.4;
  expect(vehicleWarning(frame)).toContain('AERO DAMAGE');
  frame[o + WHEEL_BASE + W.PUNCTURED] = 1;
  expect(vehicleWarning(frame)).toContain('PUNCTURE');
  frame[o + F.FINISH] = 1;
  expect(vehicleWarning(frame)).toBe('');
});
it('stages distinct actor timings and parks all actors, instead of hiding them on a timer', () => {
  const hub = new T.Vector3(-0.83, -0.2, 1.82);
  const a = poseGridMechanic(5, 0, hub, gridMechanicMotion(), 0);
  const b = poseGridMechanic(5, 1, hub, gridMechanicMotion(), 1);
  expect(a.position.distanceTo(b.position)).toBeGreaterThan(0.01);
  for (let car = 0; car < 12; car++)
    for (let wheel = 0; wheel < 4; wheel++) {
      const m = poseGridMechanic(38, wheel, hub, gridMechanicMotion(), car);
      expect(m.visible).toBe(true);
      expect(m.phase).toBe('clear');
      expect(m.yaw).toBeCloseTo(-Math.PI / 2);
      expect(m.position.x).toBeLessThan(hub.x - 3);
    }
});

it('routes a full grid around car envelopes and leaves parked bodies fixed in world space', async () => {
  const { WHEEL_POSITIONS } = await import('../src/simulation/vehicle.ts');
  const { GridPresentationView } = await import('../src/rendering/grid-presentation-view.ts');
  for (const circuit of ['aurel', 'vellamar'] as const) {
    const sim = new Simulation({ ...DEFAULT_OPTIONS, circuit, opponents: 11 });
    const frame = sim.makeFrame(),
      before = frame.slice();
    const roots = Array.from({ length: 12 }, (_, id) => {
      const o = carBase(id);
      return new T.Matrix4().compose(
        new T.Vector3().fromArray(frame, o),
        new T.Quaternion().fromArray(frame, o + F.QX),
        new T.Vector3(1, 1, 1),
      );
    });
    const inverses = roots.map((m) => m.clone().invert());
    for (let t = 17; t <= 38; t += 0.1)
      for (let id = 0; id < 12; id++)
        for (let wheel = 0; wheel < 4; wheel++) {
          const o = carBase(id),
            lateral = frame[o + F.LATERAL];
          const [x, , z] = WHEEL_POSITIONS[wheel];
          const m = poseGridMechanic(
            t,
            wheel,
            new T.Vector3(x, -0.2, z),
            gridMechanicMotion(),
            id,
            (Math.sign(lateral) || -1) * 9.5 - lateral,
          );
          const world = m.position.clone().applyMatrix4(roots[id]);
          for (let other = 0; other < 12; other++) {
            const local = world.clone().applyMatrix4(inverses[other]);
            expect(
              Math.abs(local.x) > 1.25 || Math.abs(local.z) > 3.5,
              `crew ${id}/${wheel} intersects car ${other} at ${t}`,
            ).toBe(true);
          }
          if (t > 36) expect(Math.abs(m.position.x + lateral)).toBeCloseTo(9.5, 5);
        }
    const view = new GridPresentationView();
    view.park(frame);
    // Every instanced batch, including the umbrella/engineer cast group.
    const batches: T.InstancedMesh[] = [];
    view.root.traverse((o) => {
      if (o instanceof T.InstancedMesh) batches.push(o);
    });
    const matrices = batches.map((m) => m.instanceMatrix.array.slice());
    const moved = frame.slice();
    moved[H.TIME] = 20;
    moved[carBase(0) + F.X] += 300;
    view.update(moved, new T.Vector3(), null);
    expect(batches.map((m) => m.instanceMatrix.array)).toEqual(matrices);
    expect(frame).toEqual(before);
    view.reset();
    expect(view.diagnostics().actors).toBe(0);
    view.dispose();
  }
});
