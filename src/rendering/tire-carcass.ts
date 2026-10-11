import { tireProfile } from './tire-profile.ts';
import { bindTireSurface } from './tire-finish.ts';
import * as T from 'three';
import { clamp } from '../core/math.ts';
import { mesh } from './geometry.ts';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

const BEAD = 0.245,
  NOMINAL = 0.335;
/** Presentation-only reduced carcass model. Radius is the recorded effective
 * contact radius, NOT a new tire-force simulation. The bead remains on its
 * rigid rim. Loaded rubber develops a bounded, axle-plane contact patch whose
 * bottom matches that radius; the crown and sidewall absorb the deflection.
 * No random state, wall clock, or force feedback enters this geometry. */
export function tireDeflection(radius: number, load: number, pressure: number) {
  return clamp(
    Math.max(0, load) / (260000 * clamp(pressure / 155, 0.12, 2)),
    0,
    Math.min(0.022, Math.max(0, radius - BEAD) * 0.5),
  );
}
interface Surface {
  geometry: T.BufferGeometry;
  positions: T.BufferAttribute;
  original: Float32Array;
  seams: number[][];
  /** Per-vertex constants of the undeformed carcass: crown weight and the
   * radial denominator, so a frame only evaluates the pose-dependent terms. */
  weight: Float64Array;
  denominator: Float64Array;
  /** Plain float position/normal arrays and the triangle list, when the
   * attributes allow direct array access (else three's generic path). */
  direct: { position: Float32Array; normal: Float32Array; index: ArrayLike<number> | null } | null;
}
export class TireCarcass {
  readonly root = new T.Group();
  private surfaces: Surface[] = [];
  private lastPhase = NaN;
  private lastRadius = NaN;
  private lastDeflection = NaN;
  constructor(
    half: number,
    tread: T.Material,
    marking: T.Material,
    ownedRubber?: T.BufferGeometry,
  ) {
    const profile = tireProfile(half);
    const rubber = ownedRubber ?? new T.LatheGeometry(profile, 48).rotateZ(Math.PI / 2);
    bindTireSurface(rubber);
    mesh(this.root, rubber, tread);
    const rings = [-1, 1].map((side) =>
      // D12: a hairline ring; the band and lettering are drawn in the tread shader.
      new T.TorusGeometry(0.287, 0.0015, 6, 48)
        .rotateY(Math.PI / 2)
        .translate(side * (half + 0.001), 0, 0),
    );
    mesh(this.root, mergeGeometries(rings, false), marking).name = 'Compound sidewall markings';
    for (const ring of rings) ring.dispose();
    this.root.name = 'Deformable tire rubber (rigid rim excluded)';
    for (const child of this.root.children) {
      if (!(child instanceof T.Mesh)) continue;
      const geometry = child.geometry as T.BufferGeometry,
        positions = geometry.getAttribute('position') as T.BufferAttribute;
      positions.setUsage(T.DynamicDrawUsage);
      const original = new Float32Array(positions.array),
        groups = new Map<string, number[]>();
      // UV and material seams retain their own vertices. Reconcile only their
      // normals after deformation, avoiding an artificial bright longitudinal seam.
      for (let i = 0; i < positions.count; i++) {
        const key = `${Math.round(original[i * 3] * 1e6)},${Math.round(original[i * 3 + 1] * 1e6)},${Math.round(original[i * 3 + 2] * 1e6)}`;
        const existing = groups.get(key);
        if (existing) existing.push(i);
        else groups.set(key, [i]);
      }
      const normals = geometry.getAttribute('normal') as T.BufferAttribute;
      normals.setUsage(T.DynamicDrawUsage);
      const weight = new Float64Array(positions.count),
        denominator = new Float64Array(positions.count);
      for (let i = 0; i < positions.count; i++) {
        const radial = Math.hypot(original[i * 3 + 1], original[i * 3 + 2]);
        weight[i] = clamp((radial - BEAD) / (NOMINAL - BEAD), 0, 1);
        denominator[i] = Math.max(BEAD, radial);
      }
      const plain = (a: T.BufferAttribute | T.InterleavedBufferAttribute | undefined) =>
        a instanceof T.BufferAttribute &&
        a.array instanceof Float32Array &&
        a.itemSize === 3 &&
        !a.normalized;
      this.surfaces.push({
        geometry,
        positions,
        original,
        seams: [...groups.values()].filter((g) => g.length > 1),
        weight,
        denominator,
        direct:
          plain(positions) && plain(normals)
            ? {
                position: positions.array as Float32Array,
                normal: normals.array as Float32Array,
                index: geometry.index ? geometry.index.array : null,
              }
            : null,
      });
      // Conservative immutable bounds cover every permitted crown/sidewall pose.
      geometry.boundingBox = new T.Box3(
        new T.Vector3(-half - 0.015, -0.36, -0.36),
        new T.Vector3(half + 0.015, 0.36, 0.36),
      );
      geometry.boundingSphere = new T.Sphere(new T.Vector3(), Math.hypot(half + 0.015, 0.36));
    }
  }
  update(phase: number, recordedRadius: number, load: number, pressure: number, flatSpot = 0) {
    // Invalid external fixture data is never allowed to poison a GPU buffer.
    if (![phase, recordedRadius, load, pressure, flatSpot].every(Number.isFinite))
      throw new Error('Non-finite tire presentation state');
    const radius = clamp(
        (recordedRadius || NOMINAL) - clamp(flatSpot, 0, 1) * 0.002 * (1 + Math.cos(phase)),
        BEAD + 0.007,
        NOMINAL,
      ),
      deflection = tireDeflection(radius, load, pressure || 155);
    if (
      phase === this.lastPhase &&
      radius === this.lastRadius &&
      deflection === this.lastDeflection
    )
      return;
    this.lastPhase = phase;
    this.lastRadius = radius;
    this.lastDeflection = deflection;
    const sn = Math.sin(phase),
      cs = Math.cos(phase),
      free = radius + deflection;
    for (const surface of this.surfaces) {
      const { geometry, positions, original, seams, direct } = surface;
      const weights = surface.weight,
        denominators = surface.denominator;
      for (let i = 0; i < positions.count; i++) {
        const x = original[3 * i],
          y = original[3 * i + 1],
          z = original[3 * i + 2],
          weight = weights[i],
          scale = 1 + ((free - NOMINAL) * weight) / denominators[i],
          rollingY = (y * cs - z * sn) * scale,
          rollingZ = (y * sn + z * cs) * scale,
          bottom = Math.max(rollingY, -radius),
          bulge = Math.max(0, -rollingY / Math.max(0.01, free)) ** 4 * weight * deflection * 0.35;
        // Deform in the non-spinning axle frame, then return to mesh space.
        // The contact patch stays below the axle while the UVs rotate with it.
        const px = x + Math.sign(x) * bulge,
          py = bottom * cs + rollingZ * sn,
          pz = -bottom * sn + rollingZ * cs;
        if (direct) {
          direct.position[3 * i] = px;
          direct.position[3 * i + 1] = py;
          direct.position[3 * i + 2] = pz;
        } else positions.setXYZ(i, px, py, pz);
      }
      positions.needsUpdate = true;
      if (direct) vertexNormals(direct.position, direct.normal, direct.index);
      else geometry.computeVertexNormals();
      const normals = geometry.getAttribute('normal') as T.BufferAttribute;
      for (const seam of seams) {
        let x = 0,
          y = 0,
          z = 0;
        for (const i of seam) {
          x += normals.getX(i);
          y += normals.getY(i);
          z += normals.getZ(i);
        }
        const length = Math.hypot(x, y, z) || 1;
        for (const i of seam) normals.setXYZ(i, x / length, y / length, z / length);
      }
      normals.needsUpdate = true;
    }
  }
}

/** BufferGeometry.computeVertexNormals on plain float arrays, without its
 * per-call vectors and accessor calls. The arithmetic and its float32 rounding
 * are the same: each triangle's (C - B) x (A - B) accumulates into the stored
 * normals, which are then scaled by the reciprocal of their length. */
function vertexNormals(p: Float32Array, n: Float32Array, index: ArrayLike<number> | null) {
  n.fill(0);
  const triangles = index ? index.length : p.length / 3;
  for (let i = 0; i < triangles; i += 3) {
    const a = 3 * (index ? index[i] : i),
      b = 3 * (index ? index[i + 1] : i + 1),
      c = 3 * (index ? index[i + 2] : i + 2);
    const bx = p[b],
      by = p[b + 1],
      bz = p[b + 2];
    const cbx = p[c] - bx,
      cby = p[c + 1] - by,
      cbz = p[c + 2] - bz,
      abx = p[a] - bx,
      aby = p[a + 1] - by,
      abz = p[a + 2] - bz;
    const x = cby * abz - cbz * aby,
      y = cbz * abx - cbx * abz,
      z = cbx * aby - cby * abx;
    if (index) {
      // Read all three before writing, as three does: a repeated vertex in a
      // degenerate triangle receives the face term once.
      const ax = n[a] + x,
        ay = n[a + 1] + y,
        az = n[a + 2] + z,
        bx2 = n[b] + x,
        by2 = n[b + 1] + y,
        bz2 = n[b + 2] + z,
        cx = n[c] + x,
        cy = n[c + 1] + y,
        cz = n[c + 2] + z;
      n[a] = ax;
      n[a + 1] = ay;
      n[a + 2] = az;
      n[b] = bx2;
      n[b + 1] = by2;
      n[b + 2] = bz2;
      n[c] = cx;
      n[c + 1] = cy;
      n[c + 2] = cz;
    } else {
      n[a] = n[b] = n[c] = x;
      n[a + 1] = n[b + 1] = n[c + 1] = y;
      n[a + 2] = n[b + 2] = n[c + 2] = z;
    }
  }
  for (let i = 0; i < n.length; i += 3) {
    const x = n[i],
      y = n[i + 1],
      z = n[i + 2],
      inverse = 1 / (Math.sqrt(x * x + y * y + z * z) || 1);
    n[i] = x * inverse;
    n[i + 1] = y * inverse;
    n[i + 2] = z * inverse;
  }
}
