import * as T from 'three';
import { describe, expect, it, beforeAll, afterAll, vi } from 'vitest';
import { BikeMaterials, BikeModel, staticSag } from '../src/rendering/bike.ts';
import { BikeCockpit, bikeInstrumentReadout } from '../src/rendering/bike-cockpit.ts';
import { bikeSurfaceMaps } from '../src/rendering/bike-surface-detail.ts';
import { sampleProfile } from '../src/rendering/profile-sampling.ts';
import { batchBikeRigidMeshes } from '../src/rendering/bike-rigid-batch.ts';
import { VEHICLES } from '../src/simulation/vehicles.ts';
import { BikeVehicle } from '../src/simulation/bike-vehicle.ts';
import { DEFAULT_OPTIONS } from '../src/simulation/config.ts';
import { carBase, F } from '../src/simulation/protocol.ts';
import { Simulation } from '../src/simulation/world.ts';
import { weatherSurface, WeatherPresentation } from '../src/rendering/weather-presentation.ts';
import shell from '../src/rendering/assets/gp-bodywork.mesh.json';

const drawText = vi.fn();
beforeAll(() => {
  const ctx = new Proxy(
    {},
    {
      get: (_, key) =>
        key === 'measureText'
          ? () => ({ width: 10 })
          : key === 'fillText'
            ? drawText
            : () => undefined,
      set: () => true,
    },
  );
  vi.stubGlobal('document', {
    createElement: () => ({ width: 0, height: 0, getContext: () => ctx }),
  });
});
afterAll(() => vi.unstubAllGlobals());

describe('100-reference GP presentation', () => {
  it('ships finite authored metre geometry, complete normals/UVs and valid triangles at both LODs', () => {
    expect(shell.unit).toBe('metre');
    expect(shell.forward).toBe('+Z');
    expect(shell.up).toBe('+Y');
    const counts = [];
    for (const level of [shell.high, shell.mid]) {
      let triangles = 0;
      expect(level.length).toBeLessThanOrEqual(8);
      for (const part of level) {
        const vertices = part.position.length / 3;
        expect(part.normal.length).toBe(vertices * 3);
        expect(part.uv.length).toBe(vertices * 2);
        expect(part.index.length % 3).toBe(0);
        expect([...part.position, ...part.normal, ...part.uv].every(Number.isFinite)).toBe(true);
        expect(part.index.every((i) => Number.isInteger(i) && i >= 0 && i < vertices)).toBe(true);
        for (let i = 0; i < vertices; i++) {
          expect(Math.abs(part.position[i * 3])).toBeLessThan(0.36);
          expect(part.position[i * 3 + 1]).toBeGreaterThan(-0.5);
          expect(part.position[i * 3 + 1]).toBeLessThan(0.5);
          const n = Math.hypot(...part.normal.slice(i * 3, i * 3 + 3));
          expect(n).toBeGreaterThan(0.98);
          expect(n).toBeLessThan(1.02);
        }
        triangles += part.index.length / 3;
      }
      counts.push(triangles);
    }
    expect(counts[0]).toBeLessThan(24000);
    expect(counts[1]).toBeLessThan(counts[0] * 0.3);
  });
  it('keeps interpolation inside each measured profile interval', () => {
    const xs = [0, 0.1, 0.4, 0.43, 1],
      ys = [0.02, 0.2, 0.24, 0.08, 0.01];
    for (let i = 0; i < xs.length - 1; i++)
      for (let j = 0; j <= 50; j++) {
        const result = sampleProfile(xs, ys, T.MathUtils.lerp(xs[i], xs[i + 1], j / 50));
        expect(result).toBeGreaterThanOrEqual(Math.min(ys[i], ys[i + 1]) - 1e-9);
        expect(result).toBeLessThanOrEqual(Math.max(ys[i], ys[i + 1]) + 1e-9);
      }
  });
  it('uses simulation SI speed and displayed gear numbers, including neutral and invalid readings', () => {
    expect(bikeInstrumentReadout({ speed: 25, gear: 4, rpm: 12765 }, 16000)).toEqual({
      speed: 90,
      gear: '4',
      rpm: 12800,
      fill: 12765 / 16000,
    });
    expect(bikeInstrumentReadout({ gear: 1 }, 16000).gear).toBe('1');
    expect(bikeInstrumentReadout({ gear: 0 }, 16000).gear).toBe('N');
    expect(bikeInstrumentReadout({ gear: -1 }, 16000).gear).toBe('R');
    expect(bikeInstrumentReadout({}, 16000).gear).toBe('N');
    const value = bikeInstrumentReadout({ speed: NaN, rpm: Infinity }, 0);
    expect(value.speed).toBe(0);
    expect(value.fill).toBe(0);
  });
  it('draws every actual GP session gear from BikeVehicle shifts and the published snapshot', () => {
    const sim = new Simulation({
      ...DEFAULT_OPTIONS,
      mode: 'practice',
      opponents: 0,
      vehicles: ['gpr1'],
    });
    const bike = sim.cars[0];
    expect(bike).toBeInstanceOf(BikeVehicle);
    bike.autoShift = false;
    sim.autoPlayer = false;
    const frame = sim.makeFrame(),
      o = carBase(0),
      cockpit = new BikeCockpit(bike.spec.limiterRPM);
    try {
      // Exercise the real sequential gearbox. Never manufacture a gear field
      // or copy the instrument helper's assumption into a synthetic frame.
      for (let expectedGear = 1; expectedGear <= 6; expectedGear++) {
        if (expectedGear > 1) bike.shift(1);
        for (let step = 0; step < 24; step++) sim.step(1 / 120);
        sim.writeFrame(frame);
        expect(bike.gear).toBe(expectedGear);
        expect(frame[o + F.GEAR]).toBe(expectedGear);
        const values = {
          speed: frame[o + F.SPEED],
          gear: frame[o + F.GEAR],
          rpm: frame[o + F.RPM],
        };
        expect(bikeInstrumentReadout(values, bike.spec.limiterRPM).gear).toBe(String(expectedGear));
        drawText.mockClear();
        cockpit.update(values);
        expect(drawText.mock.calls.some(([text]) => text === String(expectedGear))).toBe(true);
      }
    } finally {
      cockpit.root.traverse((object) => {
        if (object instanceof T.Mesh) object.geometry.dispose();
      });
      cockpit.dispose();
    }
  });
  it('does not upload the same instrument texture on an unchanged held replay frame', () => {
    const cockpit = new BikeCockpit(16000);
    const display = cockpit.root.children.find(
      (o) => o instanceof T.Mesh && o.material instanceof T.MeshBasicMaterial,
    ) as T.Mesh<T.BufferGeometry, T.MeshBasicMaterial>;
    const map = display.material.map!;
    expect(map.userData.dynamic).toBe(true);
    cockpit.update({ speed: 30, rpm: 11000, gear: 3 });
    const changed = map.version;
    cockpit.update({ speed: 30, rpm: 11000, gear: 3 });
    expect(map.version).toBe(changed);
    cockpit.update({ speed: 35, rpm: 11000, gear: 3 });
    expect(map.version).toBeGreaterThan(changed);
    cockpit.root.traverse((o) => {
      if (o instanceof T.Mesh) o.geometry.dispose();
    });
    cockpit.dispose();
  });
  it('builds deterministic filtered linear microtextures rather than random-frame grain', () => {
    for (const kind of ['rubber', 'leather', 'seat', 'brushed'] as const) {
      const a = bikeSurfaceMaps(kind, 32),
        b = bikeSurfaceMaps(kind, 32);
      for (const key of ['normalMap', 'roughnessMap'] as const) {
        expect(a[key].userData.surfaceDetail).toBe(true);
        expect(a[key].colorSpace).toBe(T.NoColorSpace);
        expect(a[key].generateMipmaps).toBe(true);
        expect(a[key].image.data).toEqual(b[key].image.data);
        a[key].dispose();
        b[key].dispose();
      }
    }
    expect(() => bikeSurfaceMaps('rubber', 31)).toThrow();
  });
  it('batches static detail without capturing a wheel articulation or changing shadows', () => {
    const parent = new T.Group(),
      wheel = new T.Group(),
      mat = new T.MeshStandardMaterial();
    parent.add(wheel);
    for (let i = 0; i < 8; i++) {
      const m = new T.Mesh(new T.BoxGeometry(1, 1, 1), mat);
      m.position.x = i;
      m.castShadow = false;
      parent.add(m);
    }
    const before = new T.Box3().setFromObject(parent);
    batchBikeRigidMeshes(parent);
    const after = new T.Box3().setFromObject(parent);
    expect(before.equals(after)).toBe(true);
    expect(wheel.parent).toBe(parent);
    let count = 0;
    parent.traverse((o) => {
      if (o instanceof T.Mesh) {
        count++;
        expect(o.castShadow).toBe(false);
        o.geometry.dispose();
      }
    });
    expect(count).toBe(1);
    mat.dispose();
  });
  it('connects the bike and rider to existing reversible weather without losing carbon shader hooks', () => {
    const m = new BikeMaterials(0),
      model = new BikeModel(VEHICLES.gpr1, 0, 'high', m, true);
    expect(weatherSurface(m.paint)).toBe('paint');
    expect(weatherSurface(m.rubber)).toBe('rubber');
    expect(weatherSurface(m.seat)).toBe('leather');
    expect(weatherSurface(m.aluminium)).toBe('metal');
    const previous = m.carbon.onBeforeCompile,
      weather = new WeatherPresentation();
    weather.install(model.root);
    expect(m.carbon.onBeforeCompile).not.toBe(previous);
    const installed = m.carbon.onBeforeCompile;
    weather.install(model.root);
    expect(m.carbon.onBeforeCompile).toBe(installed);
    model.dispose();
    m.dispose();
  });
  it('keeps all three GP LODs posed and finite during lean, steer, braking and wheel service', () => {
    const definition = VEHICLES.gpr1,
      materials = new BikeMaterials(0),
      sag = staticSag(definition);
    const counts = [];
    for (const detail of ['high', 'mid', 'far'] as const) {
      const model = new BikeModel(definition, 0, detail, materials, detail === 'high');
      let count = 0;
      model.root.traverse((o) => {
        if (o instanceof T.Mesh)
          count += (o.geometry.index?.count ?? o.geometry.getAttribute('position').count) / 3;
      });
      counts.push(count);
      for (const lean of [-1.0, 0, 1.0]) {
        model.pose({
          fork: sag.fork + 0.02,
          shock: sag.shock,
          steer: -0.15,
          frontRotation: 4,
          rearRotation: 5,
          chassisLean: lean,
          riderOffset: lean * 0.2,
          tuck: 0.6,
          brake: 0.8,
          rearBrake: 0.1,
          discTemp: 550,
          compoundColour: 0xffffee,
          riding: true,
          speed: 40,
          rpm: 12000,
          gear: 4,
          rearWheelOut: 0.15,
          frontWheelDrop: 0.05,
        });
        model.root.updateMatrixWorld(true);
        model.root.traverse((o) =>
          expect(o.matrixWorld.elements.every(Number.isFinite)).toBe(true),
        );
      }
      model.dispose();
    }
    expect(counts[0]).toBeLessThan(110000);
    expect(counts[0]).toBeGreaterThan(counts[1]);
    expect(counts[1]).toBeGreaterThan(counts[2]);
    materials.dispose();
  });
});
