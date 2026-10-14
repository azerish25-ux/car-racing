import { clamp, TAU, Vec3 } from '../core/math.ts';
import { TriangleBVH, rayHit } from './bvh.ts';
import type { Track, SurfaceSample } from './track.ts';

/** One authored height law feeds the contact mesh and rendered kerbs. */
export function kerbHeight(s: number, across: number): number {
  const shoulder = clamp(across / 0.12, 0, 1) * clamp((1.1 - across) / 0.12, 0, 1);
  return shoulder * (0.025 + 0.016 * Math.sin((s * TAU) / 0.65));
}
export function trackHeight(y: number, bank: number, s: number, lateral: number, width: number) {
  const across = Math.abs(lateral) - width;
  return (
    y + bank * clamp(lateral, -12, 12) + (across > 0 && across < 1.1 ? kerbHeight(s, across) : 0)
  );
}

/** Independent static collision ribbon. Narrow bands preserve kerb profiles;
 * vertex normals are shared across triangle seams. No Three.js/DOM dependency.
 */
export class TrackContactMesh {
  readonly bvh: TriangleBVH;
  readonly vertices: Float64Array;
  readonly normals: Float64Array;
  readonly indices: Uint32Array;
  private hit = rayHit();
  constructor(
    readonly track: Track,
    readonly rows = 8192,
  ) {
    const p = { ...track.points[0] };
    const bands = [-35, -12, -4, -1.1, -0.55, 0, 0.18, 100, 0.18, 0, 0.55, 1.1, 4, 12, 35];
    const columns = bands.length;
    this.vertices = new Float64Array((rows + 1) * columns * 3);
    this.normals = new Float64Array(this.vertices.length);
    this.indices = new Uint32Array(rows * (columns - 1) * 6);
    const n = new Vec3();
    for (let row = 0; row <= rows; row++) {
      track.at((row * track.length) / rows, p);
      for (let col = 0; col < columns; col++) {
        let lateral: number;
        if (col === 0 || col === columns - 1) lateral = bands[col];
        else if (col === 7) lateral = 0;
        else if (col < 7) lateral = -p.width + bands[col];
        else lateral = p.width + bands[col];
        // Asphalt/paint bands approach the kerb from the inside.
        if (col === 6) lateral = -p.width + 0.18;
        if (col === 8) lateral = p.width - 0.18;
        const inPit = track.inPitLane(p.s, lateral);
        const height = inPit
          ? p.y + p.bank * clamp(lateral, -12, 12)
          : trackHeight(p.y, p.bank, p.s, lateral, p.width);
        const i = (row * columns + col) * 3;
        this.vertices[i] = p.x + p.nx * lateral;
        this.vertices[i + 1] = height;
        this.vertices[i + 2] = p.z + p.nz * lateral;
        const across = Math.abs(lateral) - p.width;
        const sideDerivative =
          !inPit && across > 0 && across < 1.1
            ? ((kerbHeight(p.s, across + 0.005) - kerbHeight(p.s, across - 0.005)) / 0.01) *
              Math.sign(lateral)
            : 0;
        const alongDerivative =
          !inPit && across > 0 && across < 1.1
            ? (kerbHeight(p.s + 0.005, across) - kerbHeight(p.s - 0.005, across)) / 0.01
            : 0;
        const bank = Math.abs(lateral) < 12 ? p.bank : 0;
        n.set(
          -p.tx * (p.gradient + alongDerivative) - p.nx * (bank + sideDerivative),
          1,
          -p.tz * (p.gradient + alongDerivative) - p.nz * (bank + sideDerivative),
        ).normalize();
        this.normals.set([n.x, n.y, n.z], i);
        if (row < rows && col < columns - 1) {
          const a = row * columns + col,
            b = a + 1,
            c = a + columns,
            d = c + 1;
          this.indices.set([a, c, b, b, c, d], (row * (columns - 1) + col) * 6);
        }
      }
    }
    this.bvh = new TriangleBVH(this.vertices, this.indices, this.normals);
  }
  cast(origin: Vec3, down: Vec3, maximum: number, surface: SurfaceSample) {
    if (!this.bvh.raycast(origin, down, maximum, this.hit)) return Infinity;
    this.track.sample(this.hit.point.x, this.hit.point.z, surface);
    surface.height = this.hit.point.y;
    surface.normal.copy(this.hit.normal);
    return this.hit.distance;
  }
}
