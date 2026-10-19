import { describe, it, expect, vi } from 'vitest';
import * as T from 'three';
import {
  crosswalkHeading,
  roofAttachment,
} from '../src/rendering/open-world/charlottetown/geometry.ts';
import {
  polygonContains,
  polygonContact,
  type SurveyPoint,
} from '../src/simulation/open-world/survey.ts';
import { CityMaterials } from '../src/rendering/open-world/charlottetown/materials.ts';
import { cityLaunchRequested, cityLaunchDiscipline } from '../src/session/city-launch.ts';
import { CHARLOTTETOWN } from '../src/simulation/open-world/charlottetown/region.ts';

function triangles(points: readonly SurveyPoint[]) {
  return T.ShapeUtils.triangulateShape(
    points.map((p) => new T.Vector2(...p)),
    [],
  );
}
describe('Supported procedural architecture', () => {
  it('places a chimney inside an L-shaped building, not its empty courtyard', () => {
    const p: SurveyPoint[] = [
      [0, 0],
      [12, 0],
      [12, 3],
      [3, 3],
      [3, 12],
      [0, 12],
    ];
    const roof = ([x, z]: SurveyPoint) => 8 + x * 0.4 + z * 0.2;
    const a = roofAttachment(p, triangles(p), roof, 0.65, Math.PI / 5)!;
    expect(a).not.toBeNull();
    expect(polygonContains(p, a.x, a.z)).toBe(true);
    const boundary = polygonContact(p, a.x, a.z, { depth: 0, nx: 0, nz: 0 });
    expect(boundary.depth).toBeGreaterThan(0.65 / Math.SQRT2);
    const co = Math.cos(Math.PI / 5),
      si = Math.sin(Math.PI / 5);
    for (const u of [-0.325, 0.325])
      for (const v of [-0.325, 0.325]) {
        const q: SurveyPoint = [a.x + co * u - si * v, a.z + si * u + co * v];
        expect(polygonContains(p, ...q)).toBe(true);
        expect(a.bottom).toBeLessThan(roof(q));
        expect(a.top - roof(q)).toBeGreaterThanOrEqual(0.849999);
      }
  });
  it('omits decorations on narrow or invalid roofs rather than floating them', () => {
    const p: SurveyPoint[] = [
      [0, 0],
      [10, 0],
      [10, 0.5],
      [0, 0.5],
    ];
    expect(roofAttachment(p, triangles(p), () => 5, 0.65, 0)).toBeNull();
    expect(roofAttachment(p, triangles(p), () => 5, NaN, 0)).toBeNull();
    expect(roofAttachment([], [], () => 5, 0.65, 0)).toBeNull();
  });
  it('never bridges the concave boundary of any checked-in building', () => {
    let supported = 0;
    for (const building of CHARLOTTETOWN.survey!.buildings) {
      const p = building.footprint;
      const result = roofAttachment(p, triangles(p), () => building.height, 0.65, 1.2);
      if (!result) continue;
      supported++;
      expect(polygonContains(p, result.x, result.z)).toBe(true);
      expect(
        polygonContact(p, result.x, result.z, { depth: 0, nx: 0, nz: 0 }).depth,
      ).toBeGreaterThan(0.65 / Math.SQRT2);
    }
    expect(supported).toBeGreaterThan(750);
  });
});
describe('Crosswalk local axes', () => {
  it.each([0, 0.35, Math.PI / 2, Math.PI, 4.5, 6.1])(
    'keeps the long stripe parallel to a road at %s radians',
    (heading) => {
      const tx = Math.sin(heading),
        tz = Math.cos(heading),
        nx = tz,
        nz = -tx;
      const angle = crosswalkHeading(nx, nz);
      expect(Math.cos(angle) * nx + Math.sin(angle) * nz).toBeCloseTo(1, 10);
      // The local Z axis may point either way along the centreline.
      expect(Math.abs(-Math.sin(angle) * tx + Math.cos(angle) * tz)).toBeCloseTo(1, 10);
    },
  );
});
describe('Procedural parking materials', () => {
  it('uses generated linear height texels with complete disposal and wet response', () => {
    const city = new CityMaterials(),
      asphalt = city.materials.asphalt;
    expect(asphalt.map).toBeInstanceOf(T.DataTexture);
    expect(asphalt.map!.colorSpace).toBe(T.SRGBColorSpace);
    expect(asphalt.bumpMap!.colorSpace).toBe(T.NoColorSpace);
    const mapDispose = vi.spyOn(asphalt.map!, 'dispose');
    const bumpDispose = vi.spyOn(asphalt.bumpMap!, 'dispose');
    const pixels = (asphalt.map!.image as { data: Uint8Array }).data;
    expect(new Set(pixels.filter((_, i) => i % 4 === 0)).size).toBeGreaterThan(20);
    city.update(0, 0);
    const dry = asphalt.roughness;
    city.update(0, 1);
    expect(asphalt.roughness).toBeLessThan(dry);
    city.dispose();
    expect(mapDispose).toHaveBeenCalledOnce();
    expect(bumpDispose).toHaveBeenCalledOnce();
  });
});
describe('City-first entry routing', () => {
  it('leaves the original entry untouched unless the exact city is requested', () => {
    expect(cityLaunchRequested('')).toBe(false);
    expect(cityLaunchRequested('?map=solvane')).toBe(false);
    expect(cityLaunchRequested('?map=charlottetown')).toBe(true);
    expect(cityLaunchRequested('?map=charlottetown/../../main')).toBe(false);
  });
  it.each(['formula', 'motogp', 'horizon'] as const)('admits %s and only preselects it', (mode) => {
    expect(cityLaunchDiscipline(`?map=charlottetown&discipline=${mode}`)).toBe(mode);
  });
  it('rejects unknown modes instead of importing arbitrary entry paths', () => {
    expect(cityLaunchDiscipline('?discipline=../../main')).toBeNull();
    expect(cityLaunchDiscipline('?discipline=f1')).toBeNull();
  });
});

// These gable halves are valid triangles expressed as collapsed quads. The
// old batch chose BOTH windings from just the first half, even if it had no area.
import { CityBatch } from '../src/rendering/open-world/charlottetown/batch.ts';
import { SurveyCity } from '../src/rendering/open-world/charlottetown/city.ts';
import { openWorld } from '../src/simulation/open-world/world.ts';

type Vertex = readonly [number, number, number];
function faceDefects(geometry: T.BufferGeometry) {
  const p = geometry.getAttribute('position'),
    n = geometry.getAttribute('normal');
  let inward = 0,
    collapsed = 0;
  const a = new T.Vector3(),
    b = new T.Vector3(),
    c = new T.Vector3(),
    normal = new T.Vector3();
  for (let i = 0; i < geometry.index!.count; i += 3) {
    const index = geometry.index!.getX(i);
    a.fromBufferAttribute(p, index);
    b.fromBufferAttribute(p, geometry.index!.getX(i + 1)).sub(a);
    c.fromBufferAttribute(p, geometry.index!.getX(i + 2)).sub(a);
    b.cross(c);
    normal.fromBufferAttribute(n, index);
    if (b.lengthSq() <= 1e-12) collapsed++;
    else if (b.dot(normal) <= 0) inward++;
  }
  return { inward, collapsed };
}

describe('One-sided city mesh integrity', () => {
  it.each([false, true])(
    'keeps both gable halves visible with reversed winding = %s',
    (reverse) => {
      const left: Vertex = [-4, 3, 0],
        middle: Vertex = [0, 3, 0];
      const right: Vertex = [4, 3, 0],
        top: Vertex = [0, 6, 0];
      const batch = new CityBatch();
      const n: Vertex = reverse ? [0, 0, -1] : [0, 0, 1];
      batch.quad(left, middle, top, left, n, 0xffffff);
      batch.quad(middle, right, right, top, n, 0xffffff);
      const g = batch.geometry();
      expect(faceDefects(g)).toEqual({ inward: 0, collapsed: 0 });
      expect(g.index!.count).toBe(6);
      const material = new T.MeshBasicMaterial({ side: T.FrontSide });
      const mesh = new T.Mesh(g, material);
      // Not fixed by making materials double-sided: real exterior rays hit both halves.
      for (const x of [-2, 2]) {
        const ray = new T.Raycaster(
          new T.Vector3(x, 3.5, reverse ? -2 : 2),
          new T.Vector3(0, 0, reverse ? 1 : -1),
        );
        expect(ray.intersectObject(mesh)).toHaveLength(1);
      }
      g.dispose();
      material.dispose();
    },
  );
  it('uses three vertices per triangle with correctly aligned attributes', () => {
    const b = new CityBatch();
    b.tri([0, 0, 0], [1, 0, 0], [0, 0, 1], [0, 1, 0], 0xffffff);
    const g = b.geometry();
    for (const name of ['position', 'normal', 'uv', 'color'])
      expect(g.getAttribute(name).count).toBe(3);
    expect(faceDefects(g)).toEqual({ inward: 0, collapsed: 0 });
    g.dispose();
  });
  it('omits collapsed faces including triangles lost to float32 world-coordinate precision', () => {
    const b = new CityBatch();
    b.quad([0, 0, 0], [1, 0, 0], [1, 0, 0], [0, 0, 0], [0, 1, 0], 0xffffff);
    b.tri([1000, 0, 1000], [1000 + 1e-7, 0, 1000], [1000, 0, 1001], [0, 1, 0], 0xffffff);
    b.tri([0, 0, 0], [NaN, 0, 0], [0, 0, 1], [0, 1, 0], 0xffffff);
    expect(b.ix).toHaveLength(0);
    expect(b.p).toHaveLength(0);
  });
  it('has no inward or zero-area triangles anywhere in the 836-building scene', () => {
    const city = new SurveyCity(openWorld(CHARLOTTETOWN));
    let inward = 0,
      collapsed = 0;
    city.root.traverse((o) => {
      if (!(o instanceof T.Mesh)) return;
      const defects = faceDefects(o.geometry);
      inward += defects.inward;
      collapsed += defects.collapsed;
    });
    city.dispose();
    expect({ inward, collapsed }).toEqual({ inward: 0, collapsed: 0 });
  });
});

import { crosswalkPanels } from '../src/rendering/open-world/charlottetown/geometry.ts';
import { trackPoint } from '../src/simulation/track.ts';
describe('Grounded crossing paint', () => {
  it('follows both sides of road camber and emits no vertical box walls', () => {
    const network = openWorld(CHARLOTTETOWN).network;
    // Choose an interior, straight section, away from street-junction overlaps.
    const edge = network.edges.find((e) => e.length > 100 && e.road.name === 'Queen Street')!;
    const station = network.s[edge.first + 5];
    const panels = crosswalkPanels(network, station);
    expect(panels.length).toBeGreaterThan(5);
    const batch = new CityBatch(),
      probe = trackPoint();
    let minY = Infinity,
      maxY = -Infinity;
    for (const panel of panels) {
      batch.quad(...panel, [0, 1, 0], 0xffffff);
      for (const [x, y, z] of panel) {
        network.nearest(x, z, probe);
        const lateral = (x - probe.x) * probe.nx + (z - probe.z) * probe.nz;
        const ground = network.surfaceHeight(probe, lateral, edge.spec.halfWidth, edge.spec.crown);
        expect(y - ground).toBeCloseTo(0.008, 3);
        minY = Math.min(minY, y);
        maxY = Math.max(maxY, y);
      }
    }
    // A flat stripe would silently lose the road crown.
    expect(maxY - minY).toBeGreaterThan(0.03);
    const geometry = batch.geometry();
    expect(faceDefects(geometry)).toEqual({ inward: 0, collapsed: 0 });
    expect(geometry.index!.count).toBe(panels.length * 6);
    geometry.dispose();
  });
  it('clamps paint at edge boundaries instead of sampling an unrelated street', () => {
    const network = openWorld(CHARLOTTETOWN).network,
      pose = trackPoint();
    const edge = network.edges.find((e) => e.road.name === 'Maloney Drive')!;
    network.at(edge.offset, pose);
    for (const panel of crosswalkPanels(network, edge.offset))
      for (const [x, y, z] of panel) {
        expect([x, y, z].every(Number.isFinite)).toBe(true);
        expect((x - pose.x) * pose.tx + (z - pose.z) * pose.tz).toBeGreaterThanOrEqual(-0.02);
      }
    expect(crosswalkPanels(network, NaN)).toEqual([]);
    expect(crosswalkPanels(network, Infinity)).toEqual([]);
  });
});
