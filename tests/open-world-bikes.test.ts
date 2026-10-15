import * as T from 'three';
import { describe, expect, it, vi } from 'vitest';
import { FestivalRiders } from '../src/rendering/festival-riders.ts';
import { BikeVehicle } from '../src/simulation/bike-vehicle.ts';
import { BIKE_STATES } from '../src/simulation/bike.ts';
import { controls } from '../src/simulation/config.ts';
import { DirtBikeVehicle } from '../src/simulation/offroad/dirt-bike-vehicle.ts';
import { festivalAdmits, festivalVehicles } from '../src/simulation/open-world/festival-machines.ts';
import { OpenWorldSimulation } from '../src/simulation/open-world/session.ts';
import { B, BIKE_BASE, carBase, F } from '../src/simulation/protocol.ts';
import { VEHICLES } from '../src/simulation/vehicles.ts';

/** Road motorcycles in the festival: the bike adapter (lean-intent rider
 * aids, crash and remount) on the open-world surface. */
describe('festival motorcycles', () => {
  it('admits road motorcycles and the supermoto, never karts or knobby motocross machines', () => {
    const ids = festivalVehicles().map((v) => v.id);
    for (const id of ['sbk1000', 'ss600', 'gpr1', 'cr750', 'nr900', 'sm450']) expect(ids, id).toContain(id);
    for (const id of ['mx450', 'mx250']) expect(ids, id).not.toContain(id);
    expect(festivalVehicles().some((v) => v.classId === 'kart')).toBe(false);
    expect(festivalAdmits(VEHICLES.sk125)).toBe(false);
    // Cars first: every motorcycle comes after every car.
    const list = festivalVehicles(),
      firstBike = list.findIndex((v) => v.dynamicsKind === 'bike');
    expect(list.slice(firstBike).every((v) => v.dynamicsKind === 'bike')).toBe(true);
    expect(() => new OpenWorldSimulation({ vehicle: 'tc1' }).command({ type: 'vehicle', id: 'mx450' })).toThrow(
      /cannot run in the festival/,
    );
  });
  it('rides a road bike in free roam: placed upright, held until the rider acts, lean in the frame', () => {
    const sim = new OpenWorldSimulation({ vehicle: 'sbk1000', tileBudget: 24 });
    const bike = sim.player as BikeVehicle;
    expect(bike).toBeInstanceOf(BikeVehicle);
    expect(bike.riding).toBe(true);
    const start = { x: bike.body.position.x, z: bike.body.position.z };
    // Held on the brakes after placement.
    for (let i = 0; i < 240; i++) sim.step(1 / 120);
    expect(Math.hypot(bike.body.position.x - start.x, bike.body.position.z - start.z)).toBeLessThan(0.5);
    // Throttle on, then a gentle lean: it rides off on the road surface.
    sim.setInput({ ...controls(), throttle: 0.55 });
    for (let i = 0; i < 120 * 4; i++) sim.step(1 / 120);
    expect(bike.riding).toBe(true);
    expect(bike.speed).toBeGreaterThan(8);
    expect(sim.status().road.onRoad).toBe(true);
    sim.setInput({ ...controls(), throttle: 0.3, steer: 0.3 });
    for (let i = 0; i < 60; i++) sim.step(1 / 120);
    const frame = sim.makeFrame(),
      o = carBase(0);
    expect(frame[o + F.SPEED]).toBeCloseTo(bike.speed, 3);
    expect(frame[o + BIKE_BASE + B.LEAN]).toBeCloseTo(bike.dynamics.lean, 5);
    expect(frame[o + BIKE_BASE + B.STATE]).toBe(BIKE_STATES.indexOf('riding'));
    // Reset puts a fresh bike on the road, riding.
    sim.command({ type: 'reset' });
    expect(sim.player).toBeInstanceOf(BikeVehicle);
    expect((sim.player as BikeVehicle).riding).toBe(true);
    expect(sim.status().road.onRoad).toBe(true);
  });
  it('drives a bike on the autopilot for a minute of streets and roads without a fall', () => {
    const sim = new OpenWorldSimulation({ vehicle: 'nr900', tileBudget: 24 });
    sim.command({ type: 'autopilot', value: true });
    let falls = 0,
      riding = true,
      distance = 0,
      last = { x: sim.player.body.position.x, z: sim.player.body.position.z };
    for (let i = 0; i < 120 * 60; i++) {
      sim.step(1 / 120);
      if (!sim.autopilot && i % 600 === 0) sim.command({ type: 'autopilot', value: true });
      const bike = sim.player as BikeVehicle,
        p = bike.body.position;
      distance += Math.hypot(p.x - last.x, p.z - last.z);
      last = { x: p.x, z: p.z };
      if (riding && !bike.riding) falls++;
      riding = bike.riding;
    }
    expect(falls).toBe(0);
    expect(distance).toBeGreaterThan(500);
    expect(sim.player.up.y).toBeGreaterThan(0.6);
  });
  it('switches to the supermoto (off-road bike adapter on the region ground) and races bikes against bikes', () => {
    const sim = new OpenWorldSimulation({ vehicle: 'tc1', tileBudget: 24 });
    sim.command({ type: 'vehicle', id: 'sm450' });
    expect(sim.player).toBeInstanceOf(DirtBikeVehicle);
    sim.setInput({ ...controls(), throttle: 0.5 });
    for (let i = 0; i < 120 * 3; i++) sim.step(1 / 120);
    expect((sim.player as BikeVehicle).riding).toBe(true);
    expect(sim.player.speed).toBeGreaterThan(5);
    sim.command({ type: 'start', event: 'valley-sprint' });
    expect(sim.cars.length).toBeGreaterThan(1);
    expect(sim.cars.every((c) => c instanceof BikeVehicle)).toBe(true);
  });
  it('disposes every motorcycle it built when the festival session ends (the renderer outlives it)', () => {
    // Canvas textures (paint, carbon, plates) are stubbed: what is measured
    // is that each geometry, material and texture built is released.
    const ctx = new Proxy(
      {},
      {
        get: (_, key) =>
          key === 'createLinearGradient' || key === 'createRadialGradient'
            ? () => ({ addColorStop: () => undefined })
            : key === 'measureText'
              ? () => ({ width: 10 })
              : () => undefined,
        set: () => true,
      },
    );
    vi.stubGlobal('document', { createElement: () => ({ width: 0, height: 0, getContext: () => ctx }) });
    try {
      const sim = new OpenWorldSimulation({ vehicle: 'sbk1000', tileBudget: 24 });
      sim.step(1 / 120);
      const frame = sim.makeFrame();
      const riders = new FestivalRiders(),
        scene = new T.Scene(),
        camera = new T.PerspectiveCamera(60, 16 / 9, 0.1, 5000);
      scene.add(riders.root);
      riders.update(frame, frame, 1, camera, 'high');
      type Disposable = T.BufferGeometry | T.Material | T.Texture;
      const owned = new Set<Disposable>();
      riders.root.traverse((o) => {
        if (!(o instanceof T.Mesh)) return;
        owned.add(o.geometry);
        for (const m of [o.material].flat()) {
          owned.add(m);
          for (const value of Object.values(m)) if (value instanceof T.Texture) owned.add(value);
        }
      });
      expect(owned.size).toBeGreaterThan(20);
      const released = new Set<unknown>();
      for (const item of owned)
        (item as T.EventDispatcher<{ dispose: object }>).addEventListener('dispose', () => released.add(item));
      riders.dispose();
      expect(released.size).toBe(owned.size);
      expect(riders.root.parent).toBeNull();
      expect(riders.root.children).toHaveLength(0);
      // A later frame (none arrives once disposed, but it must be harmless).
      riders.update(frame, frame, 1, camera, 'high');
      riders.dispose();
    } finally {
      vi.unstubAllGlobals();
    }
  });
});
