/** Garland-Heckbert quadric edge-collapse decimation for closed, indexed
 * triangle meshes (authoring-time only). Rejects collapses that flip a face
 * or break the edge link condition, so the result stays manifold. */

class Heap {
  private cost: number[] = [];
  private items: number[] = [];
  push(cost: number, item: number) {
    const c = this.cost,
      it = this.items;
    let i = c.length;
    c.push(cost);
    it.push(item);
    while (i > 0) {
      const p = (i - 1) >> 1;
      if (c[p] <= c[i]) break;
      [c[p], c[i]] = [c[i], c[p]];
      [it[p], it[i]] = [it[i], it[p]];
      i = p;
    }
  }
  pop(): [number, number] | null {
    const c = this.cost,
      it = this.items;
    if (!c.length) return null;
    const top: [number, number] = [c[0], it[0]];
    const lc = c.pop()!,
      li = it.pop()!;
    if (c.length) {
      c[0] = lc;
      it[0] = li;
      let i = 0;
      for (;;) {
        const l = 2 * i + 1,
          r = l + 1;
        let m = i;
        if (l < c.length && c[l] < c[m]) m = l;
        if (r < c.length && c[r] < c[m]) m = r;
        if (m === i) break;
        [c[m], c[i]] = [c[i], c[m]];
        [it[m], it[i]] = [it[i], it[m]];
        i = m;
      }
    }
    return top;
  }
}

export function decimate(
  positions: Float32Array,
  indices: Uint32Array,
  targetTriangles: number,
  /** Optional per-vertex importance multiplier (>= 1 keeps detail). */
  importance?: (x: number, y: number, z: number) => number,
) {
  const nv = positions.length / 3;
  const P = Float64Array.from(positions);
  const F = Int32Array.from(indices);
  const nf = F.length / 3;
  const faceAlive = new Uint8Array(nf).fill(1);
  const Q = new Float64Array(nv * 10);
  const vertFaces: Set<number>[] = Array.from({ length: nv }, () => new Set());
  const weight = new Float64Array(nv).fill(1);
  if (importance)
    for (let v = 0; v < nv; v++) weight[v] = importance(P[v * 3], P[v * 3 + 1], P[v * 3 + 2]);
  const normalOf = (f: number, out: number[]) => {
    const a = F[f * 3],
      b = F[f * 3 + 1],
      c = F[f * 3 + 2];
    const ux = P[b * 3] - P[a * 3],
      uy = P[b * 3 + 1] - P[a * 3 + 1],
      uz = P[b * 3 + 2] - P[a * 3 + 2];
    const vx = P[c * 3] - P[a * 3],
      vy = P[c * 3 + 1] - P[a * 3 + 1],
      vz = P[c * 3 + 2] - P[a * 3 + 2];
    out[0] = uy * vz - uz * vy;
    out[1] = uz * vx - ux * vz;
    out[2] = ux * vy - uy * vx;
    return out;
  };
  const n = [0, 0, 0];
  for (let f = 0; f < nf; f++) {
    normalOf(f, n);
    const area = Math.hypot(n[0], n[1], n[2]);
    if (area < 1e-20) continue;
    const a = n[0] / area,
      b = n[1] / area,
      c = n[2] / area;
    const v0 = F[f * 3];
    const d = -(a * P[v0 * 3] + b * P[v0 * 3 + 1] + c * P[v0 * 3 + 2]);
    const q = [a * a, a * b, a * c, a * d, b * b, b * c, b * d, c * c, c * d, d * d];
    for (let k = 0; k < 3; k++) {
      const v = F[f * 3 + k];
      vertFaces[v].add(f);
      const w = area * weight[v];
      for (let j = 0; j < 10; j++) Q[v * 10 + j] += q[j] * w;
    }
  }
  const version = new Uint32Array(nv);
  const alive = new Uint8Array(nv).fill(1);
  const heap = new Heap();
  // Edge entries packed as (a, b, versionA, versionB) in growable arrays.
  const ea: number[] = [],
    eb: number[] = [],
    eva: number[] = [],
    evb: number[] = [],
    ex: number[] = [],
    ey: number[] = [],
    ez: number[] = [];
  const quadric = (q: Float64Array, o: number, x: number, y: number, z: number) =>
    q[o] * x * x +
    2 * q[o + 1] * x * y +
    2 * q[o + 2] * x * z +
    2 * q[o + 3] * x +
    q[o + 4] * y * y +
    2 * q[o + 5] * y * z +
    2 * q[o + 6] * y +
    q[o + 7] * z * z +
    2 * q[o + 8] * z +
    q[o + 9];
  const tmp = new Float64Array(10);
  const pushEdge = (a: number, b: number) => {
    for (let j = 0; j < 10; j++) tmp[j] = Q[a * 10 + j] + Q[b * 10 + j];
    // Optimal point from the 3x3 system, else the best of ends/midpoint.
    const [a11, a12, a13, b1, a22, a23, b2, a33, b3] = tmp;
    const det =
      a11 * (a22 * a33 - a23 * a23) - a12 * (a12 * a33 - a23 * a13) + a13 * (a12 * a23 - a22 * a13);
    let bx = 0,
      by = 0,
      bz = 0,
      best = Infinity;
    const candidates: number[][] = [];
    if (Math.abs(det) > 1e-14) {
      const x =
        (-b1 * (a22 * a33 - a23 * a23) +
          a12 * (b2 * a33 - a23 * b3) -
          a13 * (b2 * a23 - a22 * b3)) /
        det;
      const y =
        (a11 * (-b2 * a33 + a23 * b3) +
          b1 * (a12 * a33 - a23 * a13) -
          a13 * (a12 * b3 - b2 * a13)) /
        det;
      const z =
        (a11 * (-a22 * b3 + b2 * a23) -
          a12 * (-a12 * b3 + b2 * a13) -
          b1 * (a12 * a23 - a22 * a13)) /
        det;
      // Keep the optimum near the edge (degenerate quadrics can shoot far).
      const mx = (P[a * 3] + P[b * 3]) / 2,
        my = (P[a * 3 + 1] + P[b * 3 + 1]) / 2,
        mz = (P[a * 3 + 2] + P[b * 3 + 2]) / 2;
      const len = Math.hypot(
        P[a * 3] - P[b * 3],
        P[a * 3 + 1] - P[b * 3 + 1],
        P[a * 3 + 2] - P[b * 3 + 2],
      );
      if (Math.hypot(x - mx, y - my, z - mz) < len) candidates.push([x, y, z]);
    }
    candidates.push(
      [P[a * 3], P[a * 3 + 1], P[a * 3 + 2]],
      [P[b * 3], P[b * 3 + 1], P[b * 3 + 2]],
      [
        (P[a * 3] + P[b * 3]) / 2,
        (P[a * 3 + 1] + P[b * 3 + 1]) / 2,
        (P[a * 3 + 2] + P[b * 3 + 2]) / 2,
      ],
    );
    for (const [x, y, z] of candidates) {
      const c = quadric(tmp, 0, x, y, z);
      if (c < best) {
        best = c;
        bx = x;
        by = y;
        bz = z;
      }
    }
    const id = ea.length;
    ea.push(a);
    eb.push(b);
    eva.push(version[a]);
    evb.push(version[b]);
    ex.push(bx);
    ey.push(by);
    ez.push(bz);
    // A tiny length term breaks ties on flat areas towards short edges.
    const len2 =
      (P[a * 3] - P[b * 3]) ** 2 +
      (P[a * 3 + 1] - P[b * 3 + 1]) ** 2 +
      (P[a * 3 + 2] - P[b * 3 + 2]) ** 2;
    heap.push(Math.max(0, best) + len2 * 1e-6, id);
  };
  const seen = new Set<number>();
  for (let f = 0; f < nf; f++)
    for (let k = 0; k < 3; k++) {
      const a = F[f * 3 + k],
        b = F[f * 3 + ((k + 1) % 3)];
      const key = a < b ? a * nv + b : b * nv + a;
      if (seen.has(key)) continue;
      seen.add(key);
      pushEdge(a, b);
    }
  let faces = nf;
  const neighbours = (v: number, out: Set<number>) => {
    out.clear();
    for (const f of vertFaces[v])
      for (let k = 0; k < 3; k++) if (F[f * 3 + k] !== v) out.add(F[f * 3 + k]);
    return out;
  };
  const na = new Set<number>(),
    nb = new Set<number>();
  const before = [0, 0, 0],
    after = [0, 0, 0];
  while (faces > targetTriangles) {
    const top = heap.pop();
    if (!top) break;
    const id = top[1];
    const a = ea[id],
      b = eb[id];
    if (!alive[a] || !alive[b] || version[a] !== eva[id] || version[b] !== evb[id]) continue;
    // Link condition: exactly two shared neighbours for an interior edge.
    neighbours(a, na);
    neighbours(b, nb);
    if (!na.has(b)) continue;
    let shared = 0;
    for (const v of na) if (nb.has(v)) shared++;
    if (shared !== 2) continue;
    // Reject face flips and needle triangles around the moved vertex.
    const tx = ex[id],
      ty = ey[id],
      tz = ez[id];
    let ok = true;
    for (const v of [a, b]) {
      for (const f of vertFaces[v]) {
        const hasA = F[f * 3] === a || F[f * 3 + 1] === a || F[f * 3 + 2] === a;
        const hasB = F[f * 3] === b || F[f * 3 + 1] === b || F[f * 3 + 2] === b;
        if (hasA && hasB) continue;
        normalOf(f, before);
        const save = [P[v * 3], P[v * 3 + 1], P[v * 3 + 2]];
        P[v * 3] = tx;
        P[v * 3 + 1] = ty;
        P[v * 3 + 2] = tz;
        normalOf(f, after);
        P[v * 3] = save[0];
        P[v * 3 + 1] = save[1];
        P[v * 3 + 2] = save[2];
        const lb = Math.hypot(...before),
          la = Math.hypot(...after);
        if (
          la < 1e-14 ||
          (before[0] * after[0] + before[1] * after[1] + before[2] * after[2]) / (lb * la) < 0.3
        ) {
          ok = false;
          break;
        }
      }
      if (!ok) break;
    }
    if (!ok) continue;
    // Collapse b into a.
    P[a * 3] = tx;
    P[a * 3 + 1] = ty;
    P[a * 3 + 2] = tz;
    for (let j = 0; j < 10; j++) Q[a * 10 + j] += Q[b * 10 + j];
    for (const f of vertFaces[b]) {
      const hasA = F[f * 3] === a || F[f * 3 + 1] === a || F[f * 3 + 2] === a;
      if (hasA) {
        faceAlive[f] = 0;
        faces--;
        for (let k = 0; k < 3; k++) vertFaces[F[f * 3 + k]].delete(f);
      } else {
        for (let k = 0; k < 3; k++) if (F[f * 3 + k] === b) F[f * 3 + k] = a;
        vertFaces[a].add(f);
      }
    }
    vertFaces[b].clear();
    alive[b] = 0;
    version[a]++;
    for (const v of neighbours(a, na)) version[v]++;
    for (const v of na) pushEdge(a, v);
    // Neighbour edges changed cost only through `a`; refresh their ring.
    for (const v of na) for (const w of neighbours(v, nb)) if (w !== a) pushEdge(v, w);
  }
  // Compact.
  const remap = new Int32Array(nv).fill(-1);
  const outP: number[] = [];
  const outI: number[] = [];
  for (let f = 0; f < nf; f++) {
    if (!faceAlive[f]) continue;
    for (let k = 0; k < 3; k++) {
      const v = F[f * 3 + k];
      if (remap[v] < 0) {
        remap[v] = outP.length / 3;
        outP.push(P[v * 3], P[v * 3 + 1], P[v * 3 + 2]);
      }
      outI.push(remap[v]);
    }
  }
  return { positions: Float32Array.from(outP), indices: Uint32Array.from(outI) };
}
