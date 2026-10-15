import { clamp } from '../../core/math.ts';
import { trackPoint, type Track } from '../../simulation/track.ts';
import { ridgedNoise, valueNoise } from '../terrain-profile.ts';
import type { Terrain } from '../terrain.ts';
import { PLAZA_RADIUS, catalogueLandmark, sideSpanAt, venueField } from './plan.ts';
import { VENUE_THEMES } from './theme.ts';

const smoothstep = (a: number, b: number, x: number) => {
  const t = clamp((x - a) / (b - a), 0, 1);
  return t * t * (3 - 2 * t);
};

/** Landform for a catalogue venue: the ground follows the road (lowest road
 * under stacked sections), then blends over ~200 m into the theme's natural
 * relief — mountains, mesas, rolling parkland, or a coast whose sea lies on
 * the side of the authored drops. Quays and cliffs fall away beside drop
 * spans. The event-hall plaza is levelled. Visual ground only. */
export function catalogueTerrain(track: Track): Terrain {
  const meta = track.circuit.catalogue!,
    style = VENUE_THEMES[meta.theme],
    field = venueField(track),
    drops = meta.dressing.drops,
    sea = meta.seaLevel;
  const heights = track.points.map((p) => p.y).sort((a, b) => a - b);
  const base = heights[Math.floor(heights.length / 2)],
    top = heights[heights.length - 1],
    low = heights[0];
  // Venue centroid and, for coasts, the seaward direction from the drops.
  let cx = 0,
    cz = 0,
    sx = 0,
    sz = 0,
    dx = 0,
    dz = 0,
    dropCount = 0;
  const p = trackPoint();
  for (const point of track.points) {
    cx += point.x / track.points.length;
    cz += point.z / track.points.length;
  }
  for (let s = 0; s < track.length; s += 10)
    for (const side of [-1, 1] as const)
      if (sideSpanAt(drops, s, side, track.length)) {
        track.at(s, p);
        sx += p.nx * side;
        sz += p.nz * side;
        dx += p.x;
        dz += p.z;
        dropCount++;
      }
  const seaward = Math.hypot(sx, sz);
  // An open sea only where the drops agree on one seaward side (a coast);
  // harbours and docks with drops on both sides get local basins only.
  const coastal = sea !== null && style.landform === 'coast' && seaward > dropCount * 0.6;
  const ux = coastal ? sx / seaward : 0,
    uz = coastal ? sz / seaward : 0,
    coastX = dropCount ? dx / dropCount : cx,
    coastZ = dropCount ? dz / dropCount : cz;
  const landmark = catalogueLandmark(track);
  const natural = (x: number, z: number) => {
    const n1 = valueNoise(x * 0.0021 + 3.1, z * 0.0021 - 7.4) - 0.5,
      n2 = valueNoise(x * 0.0067 - 1.7, z * 0.0067 + 2.2) - 0.5;
    switch (style.landform) {
      case 'flat':
        return base - 1.2 + style.relief * (n1 + 0.3 * n2);
      case 'rolling':
        return base - 1.5 + style.relief * (1.4 * n1 + 0.5 * n2);
      case 'hills':
        return (
          base + style.relief * (ridgedNoise(x * 0.0016 + 4.1, z * 0.0016 - 2.3) - 0.35) + 6 * n2
        );
      case 'mountains': {
        // Peaks rise away from the venue: the pass sits on a saddle.
        const r = Math.hypot(x - cx, z - cz);
        const rise = smoothstep(500, 1900, r);
        return (
          low +
          (top - low) * 0.55 +
          rise * style.relief * (0.45 + ridgedNoise(x * 0.0011 + 9.3, z * 0.0011 + 1.7)) +
          40 * n1
        );
      }
      case 'mesas': {
        // Terraced buttes: a stepped plateau field over flat desert floor.
        const m = valueNoise(x * 0.0019 + 5.5, z * 0.0019 - 3.3);
        const plateau =
          smoothstep(0.56, 0.6, m) * style.relief + smoothstep(0.72, 0.75, m) * style.relief * 0.6;
        return base - 3 + plateau + 3 * n2;
      }
      case 'coast': {
        if (!coastal) return base - 1 + 2 * n2;
        const t = (x - coastX) * ux + (z - coastZ) * uz;
        if (t > 40) return (sea as number) - 6 - Math.min(40, (t - 40) * 0.05);
        const inland = smoothstep(40, -900, t);
        return (
          base + inland * style.relief * (0.6 + ridgedNoise(x * 0.0013, z * 0.0013 + 4.4)) + 4 * n1
        );
      }
    }
  };
  const sample = { distance: Infinity, height: NaN };
  const height = (x: number, z: number) => {
    let h: number;
    field.sample(x, z, sample);
    const raw = natural(x, z);
    if (!Number.isFinite(sample.distance)) h = raw;
    else {
      const apron = 40,
        near = sample.height - 0.9 - Math.max(0, sample.distance - apron) * 0.03;
      h = near + (raw - near) * smoothstep(apron, apron + 200, sample.distance);
      // Quays and cliffs: the ground drops to the sea right behind the barrier.
      if (sea !== null) {
        const nearest = field.nearest(x, z);
        if (
          Number.isFinite(nearest.station) &&
          sideSpanAt(drops, nearest.station, nearest.side, track.length)
        ) {
          track.at(nearest.station, p);
          const edge = track.boundaryAt(p, nearest.side) + 2.5,
            fall = style.cliffs ? 55 : 4;
          const floor = Math.min(h, sea - 7);
          h = h + (floor - h) * smoothstep(edge, edge + fall, nearest.distance);
        }
      }
    }
    // Levelled event-hall plaza.
    const r = Math.hypot(x - landmark.x, z - landmark.z),
      pad = smoothstep(PLAZA_RADIUS + 40, PLAZA_RADIUS + 6, r);
    return h + (landmark.y - h) * pad;
  };
  return Object.freeze({
    kind: sea !== null ? ('coast' as const) : ('valley' as const),
    seaLevel: sea,
    height,
  });
}
