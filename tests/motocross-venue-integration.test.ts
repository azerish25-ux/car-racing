import * as T from 'three';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { CircuitScene } from '../src/rendering/circuit.ts';
import { buildVenueLighting } from '../src/rendering/venue-lighting.ts';
import { LIGHT_POOL_HOOK, lightPoolUniforms } from '../src/rendering/studio/light-pools.ts';
import { studioHookKeys } from '../src/rendering/studio/shader-hooks.ts';
import {
  buildMotocrossBoundary,
  isMotocrossVenue,
  MX_BOUNDARY,
} from '../src/rendering/offroad/mx-boundary.ts';
import { rigTrack } from '../src/simulation/offroad/jump-rig.ts';
import { Track, trackPoint } from '../src/simulation/track.ts';

function asphaltMeshes(root: T.Object3D) {
  const meshes: T.Mesh[] = [];
  root.traverse((object) => {
    if (!(object instanceof T.Mesh)) return;
    const materials = Array.isArray(object.material) ? object.material : [object.material];
    if (materials.some((material) => studioHookKeys(material).includes('scanned-asphalt-v1')))
      meshes.push(object);
  });
  return meshes;
}

function visibleMeshes(root: T.Object3D) {
  const meshes: T.Mesh[] = [];
  root.traverseVisible((object) => {
    if (object instanceof T.Mesh) meshes.push(object);
  });
  return meshes;
}

function disposeScene(scene: CircuitScene, ...extra: T.Object3D[]) {
  const geometries = new Set<T.BufferGeometry>();
  const materials = scene.disposalMaterials();
  for (const root of [scene.group, ...extra]) {
    root.traverse((object) => {
      if (!(object instanceof T.Mesh) && !(object instanceof T.Points)) return;
      geometries.add(object.geometry);
      for (const material of Array.isArray(object.material) ? object.material : [object.material])
        materials.add(material);
    });
    root.clear();
  }
  for (const geometry of geometries) geometry.dispose();
  for (const material of materials) material.dispose();
}

class Canvas {
  width = 300;
  height = 150;
  getContext() {
    const noop = () => {};
    return new Proxy(
      {
        canvas: this,
        measureText: () => ({ width: 40 }),
        createLinearGradient: () => ({ addColorStop: noop }),
        createRadialGradient: () => ({ addColorStop: noop }),
        createPattern: () => ({ setTransform: noop }),
        createImageData: (w: number, h: number) => ({ data: new Uint8ClampedArray(w * h * 4) }),
        getImageData: (_x: number, _y: number, w: number, h: number) => ({
          data: new Uint8ClampedArray(w * h * 4),
        }),
      },
      { get: (target, key) => Reflect.get(target, key) ?? noop },
    );
  }
}

describe('full motocross venue construction', () => {
  beforeAll(() => {
    vi.stubGlobal('document', { createElement: () => new Canvas() });
    vi.stubGlobal('HTMLCanvasElement', Canvas);
  });
  afterAll(() => vi.unstubAllGlobals());

  it.each(['valley-ridge-mx', 'arena-nord-sx'] as const)(
    '%s has low marked boundaries without road furniture across its dirt lanes',
    (id) => {
      const track = rigTrack(id),
        scene = new CircuitScene(track);
      // The full renderer also mounts these owners outside CircuitScene.
      // Its shared construction path must be part of the venue contract.
      const { venueLighting, lightPools } = buildVenueLighting(track);
      const names: string[] = [];
      scene.group.traverse((object) => names.push(object.name));
      expect(scene.offroad?.terrain).not.toBeNull();
      expect(scene.offroad?.gate).not.toBeNull();
      expect(scene.offroad?.dressing?.stats.jumpMarkers).toBeGreaterThan(8);
      const boundary = scene.venueKit!.root.getObjectByName('MX physical boundary padding')!;
      expect(boundary.userData.boundaryPads).toBeGreaterThan(60);
      if (id === 'arena-nord-sx')
        expect(boundary.userData.rejectedLaneFootprints).toBeGreaterThan(0);
      expect(names).not.toContain('Venue kit catch fence');
      expect(names).not.toContain('Catch-fence posts');
      expect(names).not.toContain('Venue kit floodlight towers');
      expect(names).not.toContain('Venue kit braking boards');
      expect(names.some((name) => name.startsWith('Venue kit paddock'))).toBe(false);
      expect(scene.startLamps).toHaveLength(0);
      // The former unguarded mechanics-area ribbon was scanned asphalt even
      // though the main track ribbon was already correctly suppressed.
      expect(asphaltMeshes(scene.surfaces)).toHaveLength(0);
      const paintedPitEdges: T.Object3D[] = [];
      scene.surfaces.traverse((object) => {
        const width = object.userData.strip?.width;
        if (width > 0.1 && width < 0.14) paintedPitEdges.push(object);
      });
      expect(paintedPitEdges).toHaveLength(0);
      expect(studioHookKeys(scene.offroad!.terrain!.material)).toContain(LIGHT_POOL_HOOK);
      const anchor = new T.Vector3(),
        p = trackPoint();
      for (const s of [0, track.length / 3, (track.length * 2) / 3]) {
        track.at(s, p);
        anchor.set(p.x, p.y + 0.6, p.z);
        venueLighting.update(true, anchor);
        lightPools.update('night');
        expect(visibleMeshes(venueLighting.hardware)).toHaveLength(0);
        expect(visibleMeshes(lightPools.root)).toHaveLength(0);
        const activeLights: T.PointLight[] = [];
        venueLighting.root.traverseVisible((object) => {
          if (object instanceof T.PointLight) activeLights.push(object);
        });
        expect(activeLights).toHaveLength(4);
        expect(activeLights.some((light) => light.intensity > 0)).toBe(true);
        expect(activeLights.every((light) => Number.isFinite(light.intensity))).toBe(true);
        expect(venueLighting.diagnostics().visibleMasts).toBe(0);
        expect(lightPoolUniforms.lightPoolStrength.value).toBe(1);
        expect(lightPoolUniforms.lightPoolKeyShare.value).toBe(0.3);
      }
      const night = venueLighting.lights.map((light) => light.intensity);
      venueLighting.update(false, anchor);
      lightPools.update('day');
      expect(venueLighting.lights.every((light) => light.intensity === 0)).toBe(true);
      venueLighting.update(true, anchor);
      lightPools.update('night');
      expect(venueLighting.lights.map((light) => light.intensity)).toEqual(night);
      expect(visibleMeshes(venueLighting.hardware)).toHaveLength(0);
      expect(visibleMeshes(lightPools.root)).toHaveLength(0);
      const matrix = new T.Matrix4();
      for (const object of boundary.children) {
        expect(object).toBeInstanceOf(T.InstancedMesh);
        const mesh = object as T.InstancedMesh;
        mesh.geometry.computeBoundingBox();
        expect(mesh.geometry.boundingBox!.getSize(new T.Vector3()).y).toBeCloseTo(
          MX_BOUNDARY.height,
          5,
        );
        for (let i = 0; i < mesh.count; i++) {
          mesh.getMatrixAt(i, matrix);
          expect(matrix.elements.every(Number.isFinite)).toBe(true);
        }
      }
      // Updating a real frame remains safe after the Formula lamp gantry is
      // removed: the off-road drop gate and race-control signals still run.
      expect(() => scene.update(new Float32Array(32))).not.toThrow();
      lightPools.update('day');
      disposeScene(scene, venueLighting.root, lightPools.root);
    },
    120000,
  );

  it('keeps the motocross construction branch away from road circuits', () => {
    const road = new Track();
    expect(isMotocrossVenue(road)).toBe(false);
    expect(() => buildMotocrossBoundary(road)).toThrow(/MX or SX/);
  });

  it('retains actual paved pit ribbons and both road lighting hardware systems on Aurel', () => {
    const track = new Track(),
      scene = new CircuitScene(track),
      { venueLighting, lightPools } = buildVenueLighting(track);
    const pit = asphaltMeshes(scene.surfaces).filter((mesh) => {
      const materials = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
      return materials.some((material) => material.name === 'Paved circuit pit asphalt');
    });
    expect(pit.length).toBeGreaterThan(0);
    const position = track.at(400, trackPoint());
    venueLighting.update(true, new T.Vector3(position.x, position.y + 0.6, position.z));
    lightPools.update('night');
    expect(visibleMeshes(venueLighting.hardware)).toHaveLength(2);
    expect(visibleMeshes(lightPools.root)).toHaveLength(2);
    expect(venueLighting.diagnostics().visibleMasts).toBe(venueLighting.sites.length);
    expect(lightPools.sites.length).toBeGreaterThan(120);
    expect(venueLighting.lights.some((light) => light.visible && light.intensity > 0)).toBe(true);
    lightPools.update('day');
    disposeScene(scene, venueLighting.root, lightPools.root);
  }, 120000);
});
