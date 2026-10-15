import type * as T from 'three';
import { clamp } from '../../core/math.ts';
import { SURFACE, trackPoint } from '../../simulation/track.ts';
import type { BuildQueue } from '../build-queue.ts';
import { terrainFor } from '../terrain.ts';
import type { VenueKitContext } from './context.ts';

/** The CircuitScene surface API the kit reuses, so verges and skirts carry
 * the same metre UVs, track UVs and edge attributes as every road ribbon. */
export interface RibbonHost {
  readonly construction: BuildQueue;
  ribbon(
    material: T.Material,
    options: {
      start?: number;
      end?: number;
      step?: number;
      offset: (s: number, t: number) => number;
      height?: (s: number, l: number, t: number) => number;
      columns?: number;
      include?: (s: number, lateral: number) => boolean;
    },
  ): T.Mesh;
}

/** Verge between the run-off paint and the barrier (grass, sand, gravel trap
 * or asphalt run-off exactly where physics reads them), then a skirt beyond
 * the barrier that eases onto the venue terrain. Quads over another section
 * (hairpin legs, stacked or crossing roads) are dropped. */
export function queueGround(kit: VenueKitContext, host: RibbonHost) {
  const track = kit.track,
    p = trackPoint(),
    m = kit.materials,
    terrain = terrainFor(track);
  const inner = (s: number) => track.at(s, p).width + 4;
  const verge = (side: 1 | -1, kind: number, material: T.Material, lift: number) => ({
    step: 4,
    columns: 2,
    offset: (s: number, t: number) => {
      track.at(s, p);
      const a = p.width + 4,
        b = Math.max(a, track.boundaryAt(p, side) + 1);
      return side * (a + (b - a) * t);
    },
    height: () => lift,
    include: (s: number, lateral: number) =>
      Math.abs(lateral) > inner(s) + 0.05 && track.runoffSurface(track.at(s, p), lateral) === kind,
  });
  const skirt = (side: 1 | -1) => ({
    step: 4,
    columns: 4,
    offset: (s: number, t: number) => {
      track.at(s, p);
      const a = Math.max(p.width + 4, track.boundaryAt(p, side) + 1);
      return side * (a + 26 * t);
    },
    height: (s: number, l: number, t: number) => {
      track.at(s, p);
      const road = p.y + p.bank * clamp(l, -12, 12),
        ground = terrain.height(p.x + p.nx * l, p.z + p.nz * l) - 0.08 - road,
        k = t * t * (3 - 2 * t);
      return -0.05 + (ground + 0.05) * k;
    },
    include: (s: number, lateral: number) => {
      track.at(s, p);
      return !kit.overOtherSection(p.x + p.nx * lateral, p.z + p.nz * lateral, s, 0);
    },
  });
  const chunk = 80,
    count = Math.ceil(track.length / chunk);
  for (let i = 0; i < count; i++) {
    const start = (track.length * i) / count,
      end = (track.length * (i + 1)) / count;
    host.construction.add('Venue kit verges and run-off', 1, () => {
      for (const side of [-1, 1] as const)
        for (const [kind, material, lift] of [
          [SURFACE.GRASS, m.ground, -0.04],
          [SURFACE.GRAVEL, m.gravel, -0.027],
          [SURFACE.ASPHALT, m.runoff, -0.014],
        ] as const) {
          // Street walls stand inside the paint band: no verge to lay there.
          let present = false;
          for (let s = start; s < end && !present; s += 4) {
            track.at(s, p);
            const outer = track.boundaryAt(p, side) + 1,
              middle = side * (p.width + 4 + Math.max(0, outer - p.width - 4) / 2);
            present = outer > p.width + 4.2 && track.runoffSurface(p, middle) === kind;
          }
          if (present) host.ribbon(material, { start, end, ...verge(side, kind, material, lift) });
        }
    });
    host.construction.add('Venue kit terrain skirts', 2, () => {
      for (const side of [-1, 1] as const) host.ribbon(m.ground, { start, end, ...skirt(side) });
    });
  }
}
