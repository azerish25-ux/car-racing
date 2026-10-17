import * as T from 'three';
import { describe, expect, it } from 'vitest';
import { SOIL_SCAN } from '../src/rendering/ground/soil-splat.ts';
import { MX_SOIL_COLOURS } from '../src/rendering/offroad/mx-soil-detail.ts';
import {
  MX_SOIL_TRANSITION,
  mxSoilFootprint,
  sampleMxSoilTransition,
} from '../src/rendering/offroad/mx-soil-transition.ts';
import { TerrainView } from '../src/rendering/offroad/terrain-view.ts';
import { COURSE_CELL, SOIL_KINDS, type SoilKind } from '../src/simulation/offroad/course.ts';
import {
  TrackTerrainSurface,
  type CourseTerrain,
} from '../src/simulation/offroad/course-terrain.ts';
import { rigTrack } from '../src/simulation/offroad/jump-rig.ts';
import { Track } from '../src/simulation/track.ts';

const soilIndex = (kind: SoilKind) => SOIL_KINDS.indexOf(kind);

/** A deliberately non-integral lap, so the short final cell is exercised. */
function field(kind: SoilKind = 'loam', moisture = 64) {
  const length = 12.37,
    columns = 32,
    rows = Math.ceil(length / COURSE_CELL.along);
  return {
    track: { length },
    columns,
    rows,
    lateralMin: -4,
    soil: new Uint8Array(columns * rows).fill(soilIndex(kind)),
    baseMoisture: new Uint8Array(columns * rows).fill(moisture),
  } as CourseTerrain;
}

describe('MX construction-time soil boundary integration', () => {
  it('retains one-hot uniform interiors and source arrays exactly', () => {
    const terrain = field('sand', 183),
      before = terrain.soil.slice(),
      moisture = terrain.baseMoisture.slice();
    for (const s of [0, 0.13, 5.721, terrain.track.length - 0.08, terrain.track.length]) {
      const sample = sampleMxSoilTransition(terrain, 0, s);
      expect([...sample.weights]).toEqual(SOIL_KINDS.map((kind) => (kind === 'sand' ? 1 : 0)));
      expect(sample.moisture).toBeCloseTo(183 / 255, 14);
    }
    expect(terrain.soil).toEqual(before);
    expect(terrain.baseMoisture).toEqual(moisture);
  });

  it('matches exact longitudinal cell area and couples moisture to the same fraction', () => {
    const terrain = field('loam', 210);
    for (let row = 0; row < 12; row++) {
      terrain.soil.fill(soilIndex('sand'), row * terrain.columns, (row + 1) * terrain.columns);
      terrain.baseMoisture.fill(32, row * terrain.columns, (row + 1) * terrain.columns);
    }
    for (let s = 5; s <= 7; s += 0.037) {
      const centre = mxSoilFootprint(terrain.track.length, 0, s);
      const fraction = Math.max(0, Math.min(1, (6 - centre.s + 0.8) / 1.6));
      const sample = sampleMxSoilTransition(terrain, 0, s);
      expect(sample.weights[soilIndex('sand')]).toBeCloseTo(fraction, 12);
      expect(sample.weights[soilIndex('loam')]).toBeCloseTo(1 - fraction, 12);
      expect(sample.moisture).toBeCloseTo((32 * fraction + 210 * (1 - fraction)) / 255, 12);
    }
  });

  it('matches exact lateral overlap without replacing legal surface cells', () => {
    const terrain = field('mud', 211);
    for (let row = 0; row < terrain.rows; row++)
      for (let column = 0; column < 16; column++) {
        terrain.soil[row * terrain.columns + column] = soilIndex('loam');
        terrain.baseMoisture[row * terrain.columns + column] = 43;
      }
    const source = terrain.soil.slice();
    for (let lateral = -0.65; lateral <= 0.65; lateral += 0.013) {
      const centre = mxSoilFootprint(terrain.track.length, lateral, 4);
      const fraction = Math.max(0, Math.min(1, (0.38 - centre.lateral) / 0.76));
      const sample = sampleMxSoilTransition(terrain, lateral, 4);
      expect(sample.weights[soilIndex('loam')]).toBeCloseTo(fraction, 12);
      expect(sample.moisture).toBeCloseTo((43 * fraction + 211 * (1 - fraction)) / 255, 12);
    }
    expect(terrain.soil).toEqual(source);
  });

  it('wraps the short final lap cell by its real area and duplicates the seam exactly', () => {
    const terrain = field('loam', 20);
    terrain.soil.fill(soilIndex('mud'), 24 * terrain.columns);
    terrain.baseMoisture.fill(220, 24 * terrain.columns);
    const atStart = sampleMxSoilTransition(terrain, 0, 0);
    expect(atStart.weights[soilIndex('mud')]).toBeCloseTo(0.37 / 1.6, 12);
    expect(atStart.moisture).toBeCloseTo((220 * 0.37 + 20 * 1.23) / 1.6 / 255, 12);
    expect(sampleMxSoilTransition(terrain, 0, terrain.track.length)).toEqual(atStart);
    expect(sampleMxSoilTransition(terrain, 0, -terrain.track.length)).toEqual(atStart);
  });

  it('keeps the footprint bounded and changes continuously across physical cell edges', () => {
    const terrain = field('loam');
    terrain.soil.fill(soilIndex('sand'), 12 * terrain.columns);
    let previous = sampleMxSoilTransition(terrain, 0.31, 4.5).weights[soilIndex('sand')];
    for (let i = 1; i <= 3000; i++) {
      const s = 4.5 + i * 0.001;
      const centre = mxSoilFootprint(terrain.track.length, 0.31, s);
      expect(Math.abs(centre.s - s)).toBeLessThanOrEqual(MX_SOIL_TRANSITION.alongWarp + 1e-12);
      expect(Math.abs(centre.lateral - 0.31)).toBeLessThanOrEqual(
        MX_SOIL_TRANSITION.lateralWarp + 1e-12,
      );
      const fraction = sampleMxSoilTransition(terrain, 0.31, s).weights[soilIndex('sand')];
      expect(Math.abs(fraction - previous)).toBeLessThan(0.0011);
      previous = fraction;
    }
  });

  it.each(['valley-ridge-mx', 'arena-nord-sx'] as const)(
    '%s uses the same area weights in color, scan layers and displayed base moisture',
    (id) => {
      const track = rigTrack(id),
        terrain = (Track.offroadOf(track) as TrackTerrainSurface).terrain;
      const source = terrain.soil.slice(),
        moisture = terrain.baseMoisture.slice(),
        hash = terrain.hash();
      const view = new TerrainView(track);
      let blends = 0;
      for (const [chunk, child] of view.group.children.entries()) {
        const geometry = (child as T.Mesh).geometry;
        const coord = geometry.getAttribute('mxCourse'),
          colors = geometry.getAttribute('color');
        const layers = geometry.getAttribute('apexSoilLayers'),
          state = geometry.getAttribute('apexSoilState');
        const positions = geometry.getAttribute('position');
        for (let i = 0; i < coord.count; i += 13) {
          const s = Math.min(
            track.length,
            chunk * 96 + Math.floor(i / (terrain.renderColumns + 1)),
          );
          const sample = sampleMxSoilTransition(terrain, coord.getX(i), s);
          const expected = new T.Color().setRGB(0, 0, 0),
            expectedLayers = [0, 0, 0, 0];
          for (const [kindIndex, kind] of SOIL_KINDS.entries()) {
            const color = new T.Color(MX_SOIL_COLOURS[kind]),
              weight = sample.weights[kindIndex];
            expected.r += color.r * weight;
            expected.g += color.g * weight;
            expected.b += color.b * weight;
            const slot = Math.max(0, view.soilSlots.indexOf(SOIL_SCAN[kind]));
            if (slot < view.soilSlots.length - 1) expectedLayers[slot] += weight;
          }
          expect(colors.getX(i)).toBeCloseTo(expected.r, 5);
          expect(colors.getY(i)).toBeCloseTo(expected.g, 5);
          expect(colors.getZ(i)).toBeCloseTo(expected.b, 5);
          for (let component = 0; component < 4; component++)
            expect(layers.getComponent(i, component)).toBeCloseTo(expectedLayers[component], 5);
          expect(state.getX(i)).toBeCloseTo(sample.moisture, 5);
          expect(positions.getY(i)).toBeCloseTo(
            terrain.baseHeight(coord.getY(i), coord.getX(i)),
            4,
          );
          if ([...sample.weights].filter((weight) => weight > 0.01).length > 1) blends++;
        }
      }
      expect(blends).toBeGreaterThan(20);
      expect(terrain.soil).toEqual(source);
      expect(terrain.baseMoisture).toEqual(moisture);
      expect(terrain.hash()).toBe(hash);
      for (let i = 1; i < view.group.children.length; i++) {
        const before = (view.group.children[i - 1] as T.Mesh).geometry;
        const after = (view.group.children[i] as T.Mesh).geometry;
        const width = terrain.renderColumns + 1;
        for (const name of ['color', 'apexSoilLayers', 'apexSoilState']) {
          const a = before.getAttribute(name),
            b = after.getAttribute(name);
          expect(a.array.slice((a.count - width) * a.itemSize)).toEqual(
            b.array.slice(0, width * b.itemSize),
          );
        }
      }
      view.dispose();
    },
  );
});
