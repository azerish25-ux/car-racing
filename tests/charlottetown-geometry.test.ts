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
