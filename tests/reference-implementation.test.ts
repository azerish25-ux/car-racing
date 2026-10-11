import * as T from 'three';
import { describe, expect, it } from 'vitest';
import {
  DrivingGuide,
  GuideRoute,
  GUIDE_MARKERS,
  guideCue,
} from '../src/rendering/driving-guide.ts';
import { GridPreparationView, gridPreparation } from '../src/rendering/grid-preparation.ts';
import { PhotoStage, ScenePresentationScope } from '../src/rendering/photo-stage.ts';
import { VenueLighting } from '../src/rendering/venue-lighting.ts';
import { validatePhoto } from '../src/rendering/photo-camera.ts';
import { DEFAULT_OPTIONS } from '../src/simulation/config.ts';
import { Track, trackPoint } from '../src/simulation/track.ts';
import { Simulation } from '../src/simulation/world.ts';
import { F, H, W, WHEEL_BASE, WHEEL_STRIDE, carBase } from '../src/simulation/protocol.ts';
import { FLAG } from '../src/simulation/marshal.ts';
import { WHEEL_POSITIONS } from '../src/simulation/vehicle.ts';
import { REFERENCES } from '../src/ui/reference-catalogue.ts';
import { referenceRoute } from '../src/ui/reference-routes.ts';
import { referenceReview } from '../src/ui/reference-review.ts';
const track = new Track();
function frame() {
  return new Simulation({ ...DEFAULT_OPTIONS, mode: 'practice', opponents: 0 }).makeFrame();
}
function dispose(root: T.Object3D) {
  root.traverse((object) => {
    if (object instanceof T.Mesh) {
      object.geometry.dispose();
      for (const material of Array.isArray(object.material) ? object.material : [object.material])
        material.dispose();
    }
    if (object instanceof T.InstancedMesh) object.dispose();
  });
}
describe('reference road guidance is bounded, physical-road-derived and read-only', () => {
  it('enforces a cyclic braking envelope including the start/finish seam', () => {
    const route = new GuideRoute(track);
    expect(route.speeds.length).toBe(Math.ceil(track.length / 4));
    for (let i = 0; i < route.speeds.length; i++) {
      expect(route.speeds[i]).toBeGreaterThan(0);
      expect(route.speeds[i]).toBeLessThanOrEqual(78);
      expect(route.speeds[i] ** 2).toBeLessThanOrEqual(
        route.speeds[(i + 1) % route.speeds.length] ** 2 + 14 * route.step + 0.001,
      );
    }
    expect(route.index(track.length)).toBe(0);
    expect(route.index(-1)).toBe(route.speeds.length - 1);
  });
  it('reduces advice in standing water and never exceeds a caution limit', () => {
    const route = new GuideRoute(track);
    for (let station = 0; station < track.length; station += 37) {
      expect(route.speed(station, 1)).toBeLessThan(route.speed(station, 0));
      expect(route.speed(station, 2, 12)).toBeLessThanOrEqual(12);
    }
    expect(route.speed(NaN, 0)).toBe(0);
    expect(route.speed(0, Infinity)).toBe(0);
    expect(guideCue(30, 20)).toBe('brake');
    expect(guideCue(20, 20)).toBe('lift');
    expect(guideCue(10, 20)).toBe('accelerate');
    expect(guideCue(0, 20, true)).toBe('caution');
  });
  it('renders at most 64 repeatable road-aligned chevrons without modifying the frame or track', () => {
    const guide = new DrivingGuide(track),
      data = frame(),
      original = data.slice();
    const before = {
      water: track.water.slice(),
      rubber: track.rubber.slice(),
      marbles: track.marbles.slice(),
    };
    guide.mode = 'full';
    guide.update(data);
    expect(guide.mesh.count).toBe(GUIDE_MARKERS);
    const matrix = new T.Matrix4(),
      location = new T.Vector3();
    const first = guide.route.index(data[carBase(0) + F.S]) + 2;
    for (let i = 0; i < guide.mesh.count; i++) {
      guide.mesh.getMatrixAt(i, matrix);
      expect(matrix.elements.every(Number.isFinite)).toBe(true);
      location.setFromMatrixPosition(matrix);
      const expected = track.at(
        ((first + i) % guide.route.speeds.length) * guide.route.step,
        trackPoint(),
      );
      expect(location.x).toBeCloseTo(expected.x, 3);
      expect(location.y).toBeCloseTo(expected.y + 0.045, 3);
      expect(location.z).toBeCloseTo(expected.z, 3);
      const up = new T.Vector3(0, 1, 0).transformDirection(matrix);
      const normal = new T.Vector3(
        -expected.tx * expected.gradient - expected.nx * expected.bank,
        1,
        -expected.tz * expected.gradient - expected.nz * expected.bank,
      ).normalize();
      expect(up.dot(normal)).toBeGreaterThan(0.999999);
    }
    const matrices = guide.mesh.instanceMatrix.array.slice();
    guide.update(data);
    expect(guide.mesh.instanceMatrix.array).toEqual(matrices);
    expect(data).toEqual(original);
    expect(track.water).toEqual(before.water);
    expect(track.rubber).toEqual(before.rubber);
    expect(track.marbles).toEqual(before.marbles);
    dispose(guide.mesh);
  });
  it.each([
    'off',
    'pit',
    'retired',
    'finished',
    'grid',
    'wrong-way',
    'off-track',
    'hidden',
    'malformed',
  ] as const)('suppresses stale guidance for %s', (reason) => {
    const guide = new DrivingGuide(track),
      data = frame(),
      o = carBase(0);
    guide.mode = 'full';
    guide.update(data);
    expect(guide.mesh.count).toBeGreaterThan(0);
    if (reason === 'off') guide.mode = 'off';
    if (reason === 'pit') data[o + F.IN_PIT] = 1;
    if (reason === 'retired') data[o + F.RETIRED] = 1;
    if (reason === 'finished') data[o + F.FINISH] = 120;
    if (reason === 'grid') data[H.PHASE] = 0;
    if (reason === 'off-track') data[o + F.LATERAL] = 500;
    if (reason === 'malformed') data[o + F.S] = NaN;
    if (reason === 'wrong-way') {
      const p = track.at(data[o + F.S], trackPoint());
      data[o + F.SPEED] = 20;
      data[o + F.VX] = -20 * p.tx;
      data[o + F.VZ] = -20 * p.tz;
    }
    guide.update(data, reason !== 'hidden');
    expect(guide.mesh.count).toBe(0);
    expect(guide.targetSpeed).toBe(0);
    dispose(guide.mesh);
  });
  it('retains a non-colour cue while applying colour-accessible colours and yellow limits', () => {
    const guide = new DrivingGuide(track),
      data = frame(),
      o = carBase(0);
    guide.mode = 'full';
    guide.update(data, true, false);
    const matrix = guide.mesh.instanceMatrix.array.slice(),
      regular = guide.mesh.instanceColor!.array.slice();
    guide.update(data, true, true);
    expect(guide.mesh.instanceMatrix.array).toEqual(matrix);
    expect(guide.mesh.instanceColor!.array).not.toEqual(regular);
    data[o + F.LOCAL_FLAG] = FLAG.YELLOW;
    data[o + F.CAUTION_SPEED] = 11;
    guide.update(data);
    expect(guide.cue).toBe('caution');
    expect(guide.targetSpeed).toBeLessThanOrEqual(11);
    dispose(guide.mesh);
  });
});
describe('reference 047 grid preparation', () => {
  it.each([
    [0, true, true],
    [0.01, true, false],
    [0.84, true, false],
    [0.85, false, false],
    [1.8, false, false],
  ] as const)('clears blankets and crew at race time %s', (time, blankets, crew) => {
    expect(gridPreparation(time, 1, 0)).toMatchObject({ blankets, crew });
  });
  it.each([
    [0, 2, 0],
    [0, 3, 0],
    [0, 0, 1],
    [NaN, 0, 0],
    [-1, 0, 0],
  ])('never shows staff on a moving/green/invalid grid %s %s %s', (time, phase, speed) => {
    expect(gridPreparation(time, phase, speed)).toEqual({
      blankets: false,
      crew: false,
      withdrawal: 1,
    });
  });
  it('puts four blankets on actual suspension hubs, not suspension origins, without moving the car', () => {
    const sim = new Simulation({ ...DEFAULT_OPTIONS, opponents: 0 }),
      data = sim.makeFrame(),
      copy = data.slice();
    const view = new GridPreparationView(),
      camera = new T.Vector3().fromArray(data, carBase(0));
    view.update(data, camera);
    expect(view.diagnostics()).toEqual({ blankets: 4, staff: 2 });
    const car = new T.Object3D();
    car.position.fromArray(data, carBase(0));
    car.quaternion.fromArray(data, carBase(0) + F.QX);
    car.updateMatrixWorld();
    const matrix = new T.Matrix4(),
      hub = new T.Vector3();
    WHEEL_POSITIONS.forEach(([x, y, z], i) => {
      view.blankets.getMatrixAt(i, matrix);
      hub.setFromMatrixPosition(matrix);
      const expected = car.localToWorld(
        new T.Vector3(
          x,
          y - (data[carBase(0) + WHEEL_BASE + i * WHEEL_STRIDE + W.LENGTH] || 0.25),
          z,
        ),
      );
      expect(hub.distanceTo(expected)).toBeLessThan(0.0002);
    });
    expect(data).toEqual(copy);
    data[H.PHASE] = 2;
    view.update(data, camera);
    expect(view.diagnostics()).toEqual({ blankets: 0, staff: 0 });
    data[H.PHASE] = 0;
    view.update(data, camera.clone().addScalar(1000));
    expect(view.blankets.count).toBe(0);
    view.update(data, camera, false);
    expect(view.diagnostics()).toEqual({ blankets: 0, staff: 0 });
    dispose(view.root);
  });
});
describe('native showroom and original night venue', () => {
  it('validates the backdrop enum independently from numerical camera settings', () => {
    expect(validatePhoto({ backdrop: 'studio' }).backdrop).toBe('studio');
    expect(validatePhoto({ backdrop: '<img>' }).backdrop).toBe('circuit');
  });
  it('levels the showroom at road height without moving or rolling the subject', () => {
    const stage = new PhotoStage(),
      car = new T.Object3D();
    car.position.set(13, 7, 21);
    car.rotation.set(0.2, 0.5, 0.3, 'YXZ');
    const before = car.quaternion.clone();
    stage.position(car, 6.4);
    expect(stage.root.position.toArray()).toEqual([13, 6.4, 21]);
    expect(stage.root.rotation.x).toBe(0);
    expect(stage.root.rotation.z).toBe(0);
    expect(car.quaternion.toArray()).toEqual(before.toArray());
    expect(car.position.toArray()).toEqual([13, 7, 21]);
    expect(stage.root.children.some((object) => object instanceof T.PointLight)).toBe(true);
    dispose(stage.root);
  });
  it('restores visibility, original fog identity/colour and background after a throwing render', () => {
    const scene = new T.Scene(),
      scope = new ScenePresentationScope(scene);
    const original = new T.Color(0x346781),
      fog = new T.FogExp2(0x456712, 0.004);
    scene.background = original;
    scene.fog = fog;
    const visible = new T.Object3D(),
      hidden = new T.Object3D();
    hidden.visible = false;
    try {
      scope.begin(new T.Color(0), false, new T.Color(0xff0000));
      scope.visibilityFor(visible, false);
      scope.visibilityFor(hidden, true);
      scope.visibilityFor(hidden, false); // nested hide must not overwrite initial visibility
      expect(scene.fog?.color.getHex()).toBe(0xff0000);
      expect(() => scope.begin(original, true)).toThrow();
      throw new Error('simulated render error');
    } catch {
      /* restoration belongs to finally, including failure */
    } finally {
      scope.restore();
    }
    expect(scene.background).toBe(original);
    expect(scene.fog).toBe(fog);
    expect(fog.color.getHex()).toBe(0x456712);
    expect(fog.density).toBe(0.004);
    expect(visible.visible).toBe(true);
    expect(hidden.visible).toBe(false);
    scope.restore();
    expect(visible.visible).toBe(true);
    scope.begin(original, true);
    expect(scene.fog).toBeNull();
    scope.restore();
    expect(scene.fog).toBe(fog);
  });
  it('bounds night lighting to four unshadowed sources, uses original geometry and clears in daylight', () => {
    const venue = new VenueLighting(track);
    expect(venue.lamps.count).toBe(Math.ceil(track.length / 90));
    venue.update(true, new T.Vector3(0, 0, 0));
    expect(venue.diagnostics().nearbyLights).toBe(4);
    expect(
      venue.lights.every(
        (light) => !light.castShadow && light.position.toArray().every(Number.isFinite),
      ),
    ).toBe(true);
    venue.update(false, new T.Vector3(500, 5, 700));
    expect(venue.diagnostics().nearbyLights).toBe(0);
    const landmark = venue.root.children.find((object) =>
      object.name.includes('LED venue landmark'),
    );
    expect(landmark).toBeInstanceOf(T.Mesh);
    dispose(venue.root);
  });
});
describe('one individually reachable feature per applicable reference', () => {
  it('routes all 84 non-excluded entries and leaves all 16 unrelated images unimplemented', () => {
    const routes = REFERENCES.map(referenceRoute);
    expect(routes.filter(Boolean)).toHaveLength(84);
    expect(REFERENCES.filter((_, i) => !routes[i]).map((entry) => entry.id)).toEqual(
      Array.from({ length: 16 }, (_, i) => i + 50),
    );
    for (const route of routes)
      if (route) {
        expect(route.label.length).toBeGreaterThan(8);
        expect(route.instruction.length).toBeGreaterThan(50);
      }
    const html = referenceReview();
    for (const entry of REFERENCES)
      if (entry.status !== 'excluded')
        expect(html).toContain(`data-action="reference:${entry.id}"`);
    expect(html.match(/data-action="reference:/g)).toHaveLength(84);
    expect(html).not.toContain('<img');
  });
  it('uses meaningful presets/workspaces instead of routing every image to the same scene', () => {
    expect(referenceRoute(REFERENCES[4])?.photo?.backdrop).toBe('studio');
    expect(referenceRoute(REFERENCES[11])?.hub).toBe('engineering');
    expect(referenceRoute(REFERENCES[14])?.hub).toBe('finance');
    expect(referenceRoute(REFERENCES[36])?.destination).toBe('academy');
    expect(referenceRoute(REFERENCES[47])?.destination).toBe('settings');
    expect(referenceRoute(REFERENCES[78])?.night).toBe(true);
  });
});
