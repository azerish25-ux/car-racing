import * as T from 'three';
import { clamp, mod } from '../../core/math.ts';
import { trackPoint, type Track, type TrackPoint } from '../../simulation/track.ts';

/** World position at lap distance `s`, lateral `l` (+ right of travel) and
 * height `dy` above the banked road plane extended outward. */
export function venuePoint(
  track: Track,
  s: number,
  l: number,
  dy = 0,
  p: TrackPoint = trackPoint(),
) {
  track.at(mod(s, track.length), p);
  return new T.Vector3(p.x + p.nx * l, p.y + p.bank * clamp(l, -12, 12) + dy, p.z + p.nz * l);
}

/** A cross-section swept along the lap: each profile vertex is (u, v) where u
 * is metres outward from `base(s)` on `side` and v metres above the road
 * plane there. Rows every `step` metres; UV in metres (s, profile length).
 * `heightAt` may override v from the actual position (e.g. terrain). */
export function sweep(
  track: Track,
  from: number,
  to: number,
  side: 1 | -1,
  profile: readonly (readonly [number, number])[],
  options: {
    step?: number;
    base?: (s: number, p: TrackPoint) => number;
    closed?: boolean;
    heightAt?: (x: number, z: number, index: number, roadY: number, v: number) => number;
    include?: (s: number) => boolean;
  } = {},
) {
  const step = options.step ?? 4,
    length = to - from,
    rows = Math.max(1, Math.ceil(length / step)),
    p = trackPoint(),
    n = profile.length;
  const position: number[] = [],
    uv: number[] = [],
    index: number[] = [];
  const across: number[] = [0];
  for (let k = 1; k < n; k++)
    across.push(
      across[k - 1] +
        Math.hypot(profile[k][0] - profile[k - 1][0], profile[k][1] - profile[k - 1][1]),
    );
  for (let r = 0; r <= rows; r++) {
    const s = from + (length * r) / rows;
    track.at(mod(s, track.length), p);
    const base = options.base ? options.base(s, p) : track.boundaryAt(p, side);
    for (let k = 0; k < n; k++) {
      const [u, v] = profile[k],
        l = side * (base + u),
        x = p.x + p.nx * l,
        z = p.z + p.nz * l,
        road = p.y + p.bank * clamp(l, -12, 12);
      const y = options.heightAt ? options.heightAt(x, z, k, road, v) : road + v;
      position.push(x, y, z);
      uv.push(s, across[k]);
    }
  }
  const edges = options.closed ? n : n - 1;
  for (let r = 0; r < rows; r++) {
    if (options.include && !options.include(from + (length * (r + 0.5)) / rows)) continue;
    for (let k = 0; k < edges; k++) {
      const a = r * n + k,
        b = r * n + ((k + 1) % n),
        c = a + n,
        d = b + n;
      // Faces outward for side +1 profiles listed bottom-to-top on the road
      // side; mirrored sides flip the winding.
      if (side > 0) index.push(a, c, b, b, c, d);
      else index.push(a, b, c, b, d, c);
    }
  }
  const g = new T.BufferGeometry();
  g.setAttribute('position', new T.Float32BufferAttribute(position, 3));
  g.setAttribute('uv', new T.Float32BufferAttribute(uv, 2));
  g.setIndex(index);
  g.computeVertexNormals();
  g.computeBoundingSphere();
  return g;
}

/** Iterate (from, to) chunks of at most `size` metres over a lap span. */
export function chunks(from: number, to: number, size: number) {
  const out: [number, number][] = [];
  const span = to - from,
    count = Math.max(1, Math.ceil(span / size));
  for (let i = 0; i < count; i++)
    out.push([from + (span * i) / count, from + (span * (i + 1)) / count]);
  return out;
}

/** Unwrap a lap span into a monotone [from, to] (to may exceed the length). */
export function unwrap(span: { from: number; to: number }, length: number): [number, number] {
  return span.to >= span.from ? [span.from, span.to] : [span.from, span.to + length];
}
