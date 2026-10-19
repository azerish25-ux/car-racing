import { describe, expect, it, vi } from 'vitest';
import * as T from 'three';
import {
  buildingAppearance,
  FrontageIndex,
  mappedColour,
  windowBays,
} from '../src/rendering/open-world/charlottetown/architecture.ts';
import { BuildingLabels } from '../src/rendering/open-world/charlottetown/labels.ts';
import { CityBatch } from '../src/rendering/open-world/charlottetown/batch.ts';
import { CityMaterials } from '../src/rendering/open-world/charlottetown/materials.ts';
import {
  mansardHeight,
  subdivideRoof,
} from '../src/rendering/open-world/charlottetown/geometry.ts';
import { CHARLOTTETOWN } from '../src/simulation/open-world/charlottetown/region.ts';
import {
  polygonContains,
  polygonContact,
  type SurveyBuilding,
  type SurveyPoint,
} from '../src/simulation/open-world/survey.ts';
const buildings = CHARLOTTETOWN.survey!.buildings;
const building = (id: string) => buildings.find((b) => b.id === id)!;
const square: SurveyPoint[] = [
  [0, 0],
  [10, 0],
  [10, 10],
  [0, 10],
];
const triangles = (p: readonly SurveyPoint[]) =>
  T.ShapeUtils.triangulateShape(
    p.map((q) => new T.Vector2(...q)),
    [],
  );

describe('Mapped architecture, not random tag overrides', () => {
  it.each([
    ['osm-way-233428237', 'siding', 0x01a9db, 'mansard'],
    ['osm-way-233428236', 'siding', 0x5e610b, 'flat'],
    ['osm-way-158556719', 'concrete', 0xa99b7f, 'flat'],
    ['osm-way-233428233', 'brick', 0xb43104, 'flat'],
    ['osm-way-451348247', 'siding', 0xc08874, 'gabled'],
  ])('honours the literal cladding, colour and roof of %s', (id, material, tint, roof) => {
    expect(buildingAppearance(building(String(id)))).toMatchObject({
      material,
      tint,
      roof,
      mappedAppearance: true,
    });
  });
  it('keeps unknown colour text out of CSS/Three and supports documented literal forms', () => {
    const warning = vi.spyOn(console, 'warn');
    expect(mappedColour('#abc', 0)).toBe(0xaabbcc);
    expect(mappedColour('C08874', 0)).toBe(0xc08874);
    expect(mappedColour('dark slate grey', 0)).toBe(0x2f4f4f);
    for (const text of ['url(https://example.invalid)', 'red;blue', '#notrgb', '', undefined])
      expect(mappedColour(text, 0x123456)).toBe(0x123456);
    expect(warning).not.toHaveBeenCalled();
    warning.mockRestore();
  });
  it('uses a documented commercial gable and does not put domestic windows on garages', () => {
    expect(buildingAppearance(building('osm-way-250308051'))).toMatchObject({
      roof: 'gabled',
      shopfront: true,
    });
    expect(buildingAppearance(building('osm-way-251217749'))).toMatchObject({
      roof: 'gabled',
      accessory: true,
    });
  });
  it('faces entrances toward the address street with either polygon winding', () => {
    const index = new FrontageIndex([
      {
        name: 'Queen Street',
        points: [
          [-20, -20],
          [30, -20],
        ],
      },
      {
        name: 'Kent Street',
        points: [
          [11, -20],
          [11, 30],
        ],
      },
    ]);
    expect(index.face(square, ' queen   street ')).toBe(0);
    expect(index.face(square, 'Kent Street')).toBe(1);
    const reversed = [...square].reverse();
    const face = index.face(reversed, 'Queen Street');
    expect(reversed[face][1]).toBe(0);
    expect(reversed[(face + 1) % 4][1]).toBe(0);
    expect(new FrontageIndex([]).face(square)).toBe(-1);
    expect(index.face([])).toBe(-1);
  });
  it('keeps every ground-floor window clear of the central doorway', () => {
    for (const length of [3, 5, 8, 12, 27, 45])
      for (const width of [1.05, 1.4, 1.8, 2.8])
        for (const broad of [false, true]) {
          const bays = windowBays(length, width, broad);
          for (const b of bays) {
            expect(Math.abs((b.u - 0.5) * length)).toBeGreaterThanOrEqual(
              (b.width + width) / 2 + 0.14999,
            );
            expect(b.u * length - b.width / 2).toBeGreaterThan(0);
            expect(b.u * length + b.width / 2).toBeLessThan(length);
          }
        }
    expect(windowBays(NaN, 1)).toEqual([]);
    expect(windowBays(1, 1)).toEqual([]);
    expect(windowBays(5, 0)).toHaveLength(1);
  });
});
describe('Bounded source-lettering atlas', () => {
  it('uses source strings exactly and assigns repeatable indices independent of import order', () => {
    const first = new BuildingLabels(buildings),
      reversed = new BuildingLabels([...buildings].reverse());
    expect([...first.entries]).toEqual([...reversed.entries]);
    expect(first.entries.size).toBe(160);
    expect(first.rows).toBe(32);
    expect(first.entries.get('osm-way-28344710')?.text).toBe('Charlottetown Centre');
    for (const b of buildings) {
      const label = first.entries.get(b.id);
      if (label) expect(label.text).toBe(b.tags.name?.trim() || b.tags['addr:housenumber']?.trim());
    }
  });
  it('bounds the atlas to 256 entries, including excessively large imported datasets', () => {
    const many: SurveyBuilding[] = Array.from({ length: 400 }, (_, i) => ({
      ...buildings[0],
      id: `building-${i}`,
      tags: { name: `Mapped ${i}` },
    }));
    const labels = new BuildingLabels(many);
    expect(labels.entries.size).toBe(256);
    expect(labels.rows).toBe(32);
  });
  it('keeps padded UVs inside an arbitrary non-square atlas cell', () => {
    const batch = new CityBatch();
    batch.quad([0, 0, 0], [1, 0, 0], [1, 1, 0], [0, 1, 0], [0, 0, 1], 0xffffff, 1, 1, 159, [8, 32]);
    for (let i = 0; i < batch.uv.length; i += 2) {
      expect(batch.uv[i]).toBeGreaterThan(7 / 8);
      expect(batch.uv[i]).toBeLessThan(1);
      expect(batch.uv[i + 1]).toBeGreaterThan(12 / 32);
      expect(batch.uv[i + 1]).toBeLessThan(13 / 32);
    }
  });
  it('disposes the generated atlas once and uses interior texels for night emission', () => {
    const palette = new CityMaterials(new BuildingLabels(buildings));
    const texture = palette.materials.label.map!;
    const dispose = vi.spyOn(texture, 'dispose');
    expect(texture.colorSpace).toBe(T.SRGBColorSpace);
    expect(palette.materials.litGlass.emissiveMap).toBe(palette.materials.litGlass.map);
    palette.dispose();
    expect(dispose).toHaveBeenCalledOnce();
  });
});
describe('Footprint-preserving mansard roofs', () => {
  it('keeps all original eaves level and creates a raised inset plateau', () => {
    const height = mansardHeight(square, 10, 2.8, 2);
    expect(height([0, 0])).toBe(10);
    expect(height([5, 0])).toBe(10);
    expect(height([5, 1])).toBeCloseTo(11.4);
    expect(height([5, 5])).toBeCloseTo(12.8);
  });
  it('never bridges a concave court; uniform subdivision preserves area and stays bounded', () => {
    const p: SurveyPoint[] = [
      [0, 0],
      [12, 0],
      [12, 3],
      [3, 3],
      [3, 12],
      [0, 12],
    ];
    const source = triangles(p),
      parts = subdivideRoof(p, source, 1.5);
    let area = 0;
    for (const [a, b, c] of parts) {
      const x = (a[0] + b[0] + c[0]) / 3,
        z = (a[1] + b[1] + c[1]) / 3;
      expect(polygonContains(p, x, z)).toBe(true);
      area += Math.abs((b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0])) / 2;
    }
    expect(area).toBeCloseTo(63, 8);
    expect(parts.length).toBeLessThanOrEqual(source.length * 256);
  });
  it('all tagged city mansard samples stay on their original polygon and have finite heights', () => {
    const mansards = buildings.filter((b) => b.tags['roof:shape'] === 'mansard');
    expect(mansards).toHaveLength(2);
    for (const b of mansards) {
      const parts = subdivideRoof(b.footprint, triangles(b.footprint));
      const height = mansardHeight(b.footprint, b.height, 2.8, 2.6);
      for (const tri of parts)
        for (const p of tri) {
          expect(Number.isFinite(height(p))).toBe(true);
          const boundary = polygonContact(b.footprint, ...p, { depth: 0, nx: 0, nz: 0 });
          expect(polygonContains(b.footprint, ...p) || boundary.depth < 1e-7).toBe(true);
        }
    }
    expect(() => subdivideRoof(square, [[0, 1, 99]])).toThrow('Invalid roof triangulation');
    expect(() => subdivideRoof(square, triangles(square), 0)).toThrow('Invalid roof edge size');
  });
});
