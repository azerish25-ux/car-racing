import { mod } from '../../core/math.ts';
import { COURSE_CELL, SOIL_KINDS } from '../../simulation/offroad/course.ts';
import type { CourseTerrain } from '../../simulation/offroad/course-terrain.ts';

/** Metres, measured in the authored course frame. Construction only: no
 * noise, blending or resampling is applied to the simulation's cells. */
export const MX_SOIL_TRANSITION = Object.freeze({
  alongRadius: 0.8,
  lateralRadius: 0.38,
  alongWarp: 0.45,
  lateralWarp: 0.2,
});

export interface MxSoilSample {
  /** Area fractions, in SOIL_KINDS order. The same fractions shade every channel. */
  weights: Float64Array;
  /** Area-weighted base moisture; session weather is still added by the soil shader. */
  moisture: number;
}

export function mxSoilSample(): MxSoilSample {
  return { weights: new Float64Array(SOIL_KINDS.length), moisture: 0 };
}

/** Bounded, lap-periodic displacement of the presentation footprint. Integer
 * harmonics make the duplicated start/end render rows agree exactly. */
export function mxSoilFootprint(length: number, lateral: number, s: number) {
  const phase = (mod(s, length) / length) * Math.PI * 2;
  const harmonic = (metres: number) => Math.max(1, Math.round(length / metres));
  return {
    lateral:
      lateral +
      MX_SOIL_TRANSITION.lateralWarp *
        (0.6 * Math.sin(phase * harmonic(11) + lateral * 0.41) +
          0.4 * Math.sin(phase * harmonic(29) - lateral * 0.91)),
    s:
      mod(s, length) +
      MX_SOIL_TRANSITION.alongWarp *
        (0.62 * Math.sin(phase * harmonic(13) + lateral * 1.7) +
          0.38 * Math.sin(phase * harmonic(37) - lateral * 0.73)),
  };
}

/** Integrate the exact overlap of a small rectangular footprint with the
 * authoritative 0.25 x 0.5 m cells. Fixed point-sample grids would stair-step
 * when their probes cross cell edges. Area integration remains continuous.
 *
 * The final lap cell can be shorter than 0.5 m; wrapping uses track.length,
 * not rows * cellSize. A caller can reuse `out` for every constructed vertex.
 * Uniform interiors remain exactly one-hot. Outside the course band reads
 * turf, as the surrounding terrain does. Nothing is written to CourseTerrain.
 */
export function sampleMxSoilTransition(
  terrain: CourseTerrain,
  lateral: number,
  s: number,
  out = mxSoilSample(),
) {
  const { weights } = out;
  weights.fill(0);
  out.moisture = 0;
  const length = terrain.track.length;
  const centre = mxSoilFootprint(length, lateral, s);
  const x0 = centre.lateral - MX_SOIL_TRANSITION.lateralRadius;
  const x1 = centre.lateral + MX_SOIL_TRANSITION.lateralRadius;
  const firstColumn = Math.floor((x0 - terrain.lateralMin) / COURSE_CELL.lateral);
  const lastColumn = Math.ceil((x1 - terrain.lateralMin) / COURSE_CELL.lateral) - 1;
  const turf = SOIL_KINDS.indexOf('turf');
  let along = centre.s - MX_SOIL_TRANSITION.alongRadius;
  let remaining = 2 * MX_SOIL_TRANSITION.alongRadius;
  let area = 0;
  while (remaining > 1e-10) {
    const start = mod(along, length);
    const span = Math.min(remaining, length - start);
    const end = start + span;
    const firstRow = Math.floor(start / COURSE_CELL.along);
    const lastRow = Math.min(terrain.rows - 1, Math.ceil(end / COURSE_CELL.along) - 1);
    for (let row = firstRow; row <= lastRow; row++) {
      const dz =
        Math.min(end, (row + 1) * COURSE_CELL.along, length) -
        Math.max(start, row * COURSE_CELL.along);
      if (dz <= 0) continue;
      for (let column = firstColumn; column <= lastColumn; column++) {
        const left = terrain.lateralMin + column * COURSE_CELL.lateral;
        const dx = Math.min(x1, left + COURSE_CELL.lateral) - Math.max(x0, left);
        if (dx <= 0) continue;
        const overlap = dx * dz;
        const cell = row * terrain.columns + column;
        const inside = column >= 0 && column < terrain.columns;
        weights[inside ? terrain.soil[cell] : turf] += overlap;
        out.moisture += inside ? overlap * (terrain.baseMoisture[cell] / 255) : 0;
        area += overlap;
      }
    }
    remaining -= span;
    along += span;
  }
  for (let i = 0; i < weights.length; i++) weights[i] /= area;
  out.moisture /= area;
  return out;
}
