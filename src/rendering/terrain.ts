import type { Track } from '../simulation/track.ts';
import { terrainHeight, valueNoise, ridgedNoise } from './terrain-profile.ts';
import { TrackDistanceField } from './track-field.ts';
import { catalogueTerrain } from './venue-kit/terrain.ts';

/** Ground height model for one circuit's venue. `seaLevel` is null for inland
 * venues. Terrain is visual ground only; physics uses the contact ribbon. */
export interface Terrain {
  readonly kind: 'valley' | 'coast';
  readonly seaLevel: number | null;
  height(x: number, z: number): number;
  /** Coastline z at a given x (coast venues only). */
  coastZ?(x: number): number;
}

const AUREL_TERRAIN: Terrain = Object.freeze({
  kind: 'valley',
  seaLevel: null,
  height: terrainHeight,
});

/** Vellamar shoreline: the sea lies south of this line. */
export function vellamarCoastZ(x: number) {
  return -478 + 55 * Math.sin(x * 0.0021 + 0.4) + 28 * Math.sin(x * 0.0063 + 1.3);
}
/** Undisturbed coastal-mountain landform (no circuit influence). */
export function vellamarNatural(x: number, z: number) {
  const coast = vellamarCoastZ(x);
  const inland = z - coast;
  if (inland < 0) {
    // Short beach, then a shelving seabed; the promontory rises from the sea.
    const hx = x + 875,
      hz = z + 505;
    const rock = 16 * Math.exp(-(hx * hx + hz * hz) / (2 * 70 * 70));
    return Math.max(-38, -0.6 + inland * 0.07 - inland * inland * 0.00002) + rock;
  }
  const shore = Math.min(1, inland / 60);
  const slope = 1.2 + inland * 0.028;
  const hills = 26 * (valueNoise(x * 0.004 + 5.3, z * 0.004 - 1.1) - 0.35) * Math.min(1, inland / 250);
  const t = Math.min(1, Math.max(0, (inland - 420) / 1300));
  const rise = t * t * (3 - 2 * t);
  const range = rise * (70 + 390 * ridgedNoise(x * 0.00125 + 3.7, z * 0.00125 + 9.2));
  // Rocky promontory beyond Turn 1 that carries the lighthouse.
  const hx = x + 875,
    hz = z + 505;
  const headland = 16 * Math.exp(-(hx * hx + hz * hz) / (2 * 70 * 70));
  return shore * (slope + Math.max(-10, hills)) + range + headland;
}

const cache = new WeakMap<Track, Terrain>();
/** Terrain for a track's circuit, cached per Track instance. */
export function terrainFor(track: Track): Terrain {
  const known = cache.get(track);
  if (known) return known;
  let terrain: Terrain = AUREL_TERRAIN;
  // Catalogue venues (WP30): the venue kit's data-driven landform.
  if (track.circuit.catalogue) terrain = catalogueTerrain(track);
  else if (track.circuit.id === 'vellamar') {
    const field = new TrackDistanceField(track);
    const sample = { distance: Infinity, height: NaN };
    terrain = Object.freeze({
      kind: 'coast' as const,
      seaLevel: 0,
      coastZ: vellamarCoastZ,
      height(x: number, z: number) {
        const natural = vellamarNatural(x, z);
        field.sample(x, z, sample);
        if (!Number.isFinite(sample.distance)) return natural;
        // Just under the grass apron's outer edge (road − ~1.2 m at 46 m),
        // falling gently away, then blending into the landform by ~230 m.
        const apronEdge = 46;
        const near = sample.height - 1.4 - Math.max(0, sample.distance - apronEdge) * 0.03;
        const t = Math.min(1, Math.max(0, (sample.distance - apronEdge) / 185));
        const w = t * t * (3 - 2 * t);
        return near + (natural - near) * w;
      },
    });
  }
  cache.set(track, terrain);
  return terrain;
}
