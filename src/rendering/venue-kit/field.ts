import type { Track } from '../../simulation/track.ts';

/** A coarse world grid around a catalogue venue: distance to the nearest
 * centreline, that station, the side of the road the cell lies on, the road
 * height there, and the LOWEST road height among every section whose corridor
 * covers the cell (so ground under a bridge follows the lower road, never the
 * deck). Rasterised per segment within `reach`: O(segments x local cells).
 * Visual only; physics keeps the contact ribbon. */
export class VenueField {
  readonly size: number;
  readonly originX: number;
  readonly originZ: number;
  readonly distance: Float32Array;
  readonly height: Float32Array;
  readonly station: Float32Array;
  readonly side: Int8Array;
  readonly corridorLow: Float32Array;
  constructor(
    readonly track: Track,
    readonly cell = 10,
    readonly reach = 320,
    /** Lateral half-width (m) treated as "under this road". */
    readonly corridor = 24,
  ) {
    let minX = Infinity,
      maxX = -Infinity,
      minZ = Infinity,
      maxZ = -Infinity;
    for (const p of track.points) {
      minX = Math.min(minX, p.x);
      maxX = Math.max(maxX, p.x);
      minZ = Math.min(minZ, p.z);
      maxZ = Math.max(maxZ, p.z);
    }
    const margin = reach + cell;
    this.originX = Math.floor((minX - margin) / cell) * cell;
    this.originZ = Math.floor((minZ - margin) / cell) * cell;
    this.size =
      Math.ceil(Math.max(maxX - this.originX, maxZ - this.originZ) / cell + margin / cell) + 2;
    const n = this.size * this.size;
    this.distance = new Float32Array(n).fill(Infinity);
    this.height = new Float32Array(n).fill(NaN);
    this.station = new Float32Array(n).fill(NaN);
    this.side = new Int8Array(n);
    this.corridorLow = new Float32Array(n).fill(Infinity);
    const points = track.points,
      radius = Math.ceil(reach / cell);
    for (let i = 0; i < points.length - 1; i++) {
      const a = points[i],
        b = points[i + 1];
      const cx = Math.round((a.x - this.originX) / cell),
        cz = Math.round((a.z - this.originZ) / cell);
      const dx = b.x - a.x,
        dz = b.z - a.z,
        len2 = dx * dx + dz * dz || 1;
      for (let gz = Math.max(0, cz - radius); gz <= Math.min(this.size - 1, cz + radius); gz++)
        for (let gx = Math.max(0, cx - radius); gx <= Math.min(this.size - 1, cx + radius); gx++) {
          const x = this.originX + gx * cell,
            z = this.originZ + gz * cell;
          const t = Math.min(1, Math.max(0, ((x - a.x) * dx + (z - a.z) * dz) / len2));
          const px = a.x + dx * t,
            pz = a.z + dz * t;
          const d = Math.hypot(x - px, z - pz),
            k = gz * this.size + gx,
            y = a.y + (b.y - a.y) * t;
          if (d < this.corridor && y < this.corridorLow[k]) this.corridorLow[k] = y;
          if (d < this.distance[k]) {
            this.distance[k] = d;
            this.height[k] = y;
            this.station[k] = a.s + (b.s - a.s) * t;
            // Right of travel is +lateral (n = (tz, -tx)).
            this.side[k] = (x - px) * dz - (z - pz) * dx >= 0 ? 1 : -1;
          }
        }
    }
  }
  private index(x: number, z: number) {
    const gx = Math.round((x - this.originX) / this.cell),
      gz = Math.round((z - this.originZ) / this.cell);
    if (gx < 0 || gz < 0 || gx >= this.size || gz >= this.size) return -1;
    return gz * this.size + gx;
  }
  /** Nearest-cell lookup (station, side, distance, heights). */
  nearest(x: number, z: number) {
    const k = this.index(x, z);
    if (k < 0)
      return { distance: Infinity, height: NaN, station: NaN, side: 1 as 1 | -1, low: Infinity };
    return {
      distance: this.distance[k],
      height: this.height[k],
      station: this.station[k],
      side: (this.side[k] || 1) as 1 | -1,
      low: this.corridorLow[k],
    };
  }
  /** Bilinear distance and ground reference height (the corridor's lowest
   * road where one covers the cell). Infinity outside the rasterised reach. */
  sample(x: number, z: number, out: { distance: number; height: number }) {
    const fx = (x - this.originX) / this.cell,
      fz = (z - this.originZ) / this.cell;
    const ix = Math.floor(fx),
      iz = Math.floor(fz);
    out.distance = Infinity;
    out.height = NaN;
    if (ix < 0 || iz < 0 || ix >= this.size - 1 || iz >= this.size - 1) return out;
    const u = fx - ix,
      v = fz - iz,
      k = iz * this.size + ix;
    const corners = [k, k + 1, k + this.size, k + this.size + 1],
      weights = [(1 - u) * (1 - v), u * (1 - v), (1 - u) * v, u * v];
    let d = 0,
      h = 0,
      w = 0;
    for (let c = 0; c < 4; c++) {
      const dc = this.distance[corners[c]];
      if (!Number.isFinite(dc)) continue;
      const low = this.corridorLow[corners[c]];
      d += dc * weights[c];
      h += (Number.isFinite(low) ? low : this.height[corners[c]]) * weights[c];
      w += weights[c];
    }
    if (w < 0.999) return out;
    out.distance = d;
    out.height = h;
    return out;
  }
}
