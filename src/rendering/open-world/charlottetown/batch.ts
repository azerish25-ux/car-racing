import * as T from 'three';
import type { CityMaterial } from './materials.ts';
type V3 = readonly [number, number, number];
/** Decide winding at the precision actually sent to the GPU. A clipped gable
 * may have a collapsed first triangle but a perfectly valid second one. */
function facing(a: V3, b: V3, c: V3, normal: V3) {
  const ax = Math.fround(a[0]),
    ay = Math.fround(a[1]),
    az = Math.fround(a[2]);
  const bx = Math.fround(b[0]) - ax,
    by = Math.fround(b[1]) - ay,
    bz = Math.fround(b[2]) - az;
  const cx = Math.fround(c[0]) - ax,
    cy = Math.fround(c[1]) - ay,
    cz = Math.fround(c[2]) - az;
  const nx = by * cz - bz * cy,
    ny = bz * cx - bx * cz,
    nz = bx * cy - by * cx;
  const dot = nx * normal[0] + ny * normal[1] + nz * normal[2];
  if (!Number.isFinite(dot) || nx * nx + ny * ny + nz * nz <= 1e-12) return 0;
  return Math.sign(dot);
}
/** Static chunks share materials; no Object3D is allocated per window/brick. */
export class CityBatch {
  readonly p: number[] = [];
  readonly n: number[] = [];
  readonly uv: number[] = [];
  readonly c: number[] = [];
  readonly ix: number[] = [];
  private readonly color = new T.Color();
  quad(
    a: V3,
    b: V3,
    c: V3,
    d: V3,
    n: V3,
    tint: number,
    u = 1,
    v = 1,
    atlas = -1,
    grid: readonly [number, number] = [4, 4],
  ) {
    if (![a, b, c, d, n].every((p) => p.every(Number.isFinite))) return;
    const first = facing(a, b, c, n),
      second = facing(a, c, d, n);
    if (!first && !second) return;
    const offset = this.p.length / 3;
    this.color.setHex(tint);
    for (const [i, p] of [a, b, c, d].entries()) {
      this.p.push(...p);
      this.n.push(...n);
      this.c.push(this.color.r, this.color.g, this.color.b);
      let x = i === 1 || i === 2 ? u : 0,
        y = i > 1 ? v : 0;
      if (atlas >= 0) {
        x = ((atlas % grid[0]) + 0.01 + x * 0.98) / grid[0];
        y = (grid[1] - 1 - Math.floor(atlas / grid[0]) + 0.02 + y * 0.96) / grid[1];
      }
      this.uv.push(x, y);
    }
    if (first) this.ix.push(offset, offset + (first > 0 ? 1 : 2), offset + (first > 0 ? 2 : 1));
    if (second) this.ix.push(offset, offset + (second > 0 ? 2 : 3), offset + (second > 0 ? 3 : 2));
  }
  tri(a: V3, b: V3, c: V3, n: V3, tint: number) {
    const direction = facing(a, b, c, n);
    if (!direction) return;
    const offset = this.p.length / 3;
    this.color.setHex(tint);
    for (const p of [a, b, c]) {
      this.p.push(...p);
      this.n.push(...n);
      this.c.push(this.color.r, this.color.g, this.color.b);
      this.uv.push(
        (Math.abs(n[1]) > 0.5 ? p[0] : Math.abs(n[0]) > Math.abs(n[2]) ? p[2] : p[0]) / 2.4,
        (Math.abs(n[1]) > 0.5 ? p[2] : p[1]) / 2.4,
      );
    }
    this.ix.push(offset, offset + (direction > 0 ? 1 : 2), offset + (direction > 0 ? 2 : 1));
  }
  box(
    x: number,
    y: number,
    z: number,
    w: number,
    h: number,
    d: number,
    heading: number,
    tint: number,
  ) {
    if (w <= 0 || h <= 0 || d <= 0) return;
    const co = Math.cos(heading),
      si = Math.sin(heading);
    const p = (u: number, v: number, q: number): V3 => [
      x + co * u - si * q,
      y + v,
      z + si * u + co * q,
    ];
    const a = w / 2,
      b = h / 2,
      c = d / 2;
    this.quad(
      p(-a, -b, c),
      p(a, -b, c),
      p(a, b, c),
      p(-a, b, c),
      [-si, 0, co],
      tint,
      w / 2.4,
      h / 2.4,
    );
    this.quad(
      p(a, -b, -c),
      p(-a, -b, -c),
      p(-a, b, -c),
      p(a, b, -c),
      [si, 0, -co],
      tint,
      w / 2.4,
      h / 2.4,
    );
    this.quad(
      p(a, -b, c),
      p(a, -b, -c),
      p(a, b, -c),
      p(a, b, c),
      [co, 0, si],
      tint,
      d / 2.4,
      h / 2.4,
    );
    this.quad(
      p(-a, -b, -c),
      p(-a, -b, c),
      p(-a, b, c),
      p(-a, b, -c),
      [-co, 0, -si],
      tint,
      d / 2.4,
      h / 2.4,
    );
    this.quad(
      p(-a, b, c),
      p(a, b, c),
      p(a, b, -c),
      p(-a, b, -c),
      [0, 1, 0],
      tint,
      w / 2.4,
      d / 2.4,
    );
    this.quad(
      p(-a, -b, -c),
      p(a, -b, -c),
      p(a, -b, c),
      p(-a, -b, c),
      [0, -1, 0],
      tint,
      w / 2.4,
      d / 2.4,
    );
  }
  geometry() {
    const g = new T.BufferGeometry();
    g.setAttribute('position', new T.Float32BufferAttribute(this.p, 3));
    g.setAttribute('normal', new T.Float32BufferAttribute(this.n, 3));
    g.setAttribute('uv', new T.Float32BufferAttribute(this.uv, 2));
    g.setAttribute('color', new T.Float32BufferAttribute(this.c, 3));
    g.setIndex(this.ix);
    g.computeBoundingBox();
    g.computeBoundingSphere();
    return g;
  }
}
export interface CityChunk {
  root: T.Group;
  levels: T.Group[];
  x: number;
  z: number;
  radius: number;
}
export class CityBatches {
  private readonly stores = new Map<
    string,
    { batch: CityBatch; cx: number; cz: number; material: CityMaterial; level: number }
  >();
  get(x: number, z: number, material: CityMaterial, level = 0) {
    const cx = Math.floor(x / 128),
      cz = Math.floor(z / 128),
      key = `${cx}:${cz}:${material}:${level}`;
    let value = this.stores.get(key);
    if (!value) {
      value = { batch: new CityBatch(), cx, cz, material, level };
      this.stores.set(key, value);
    }
    return value.batch;
  }
  build(materials: Record<CityMaterial, T.Material>) {
    const chunks = new Map<string, CityChunk>();
    let triangles = 0;
    for (const s of this.stores.values()) {
      if (!s.batch.ix.length) continue;
      const key = `${s.cx}:${s.cz}`;
      let chunk = chunks.get(key);
      if (!chunk) {
        const root = new T.Group();
        root.name = `Charlottetown chunk ${key}`;
        const levels = [new T.Group(), new T.Group(), new T.Group()];
        root.add(...levels);
        chunk = { root, levels, x: (s.cx + 0.5) * 128, z: (s.cz + 0.5) * 128, radius: 100 };
        chunks.set(key, chunk);
      }
      const g = s.batch.geometry(),
        m = new T.Mesh(g, materials[s.material]);
      m.name = `${s.material} L${s.level}`;
      m.castShadow = ![
        'grass',
        'paving',
        'asphalt',
        'paint',
        'glass',
        'litGlass',
        'sign',
        'label',
      ].includes(s.material);
      m.receiveShadow = true;
      m.matrixAutoUpdate = false;
      chunk.levels[s.level].add(m);
      triangles += g.index!.count / 3;
      const sphere = g.boundingSphere!;
      chunk.radius = Math.max(
        chunk.radius,
        Math.hypot(sphere.center.x - chunk.x, sphere.center.z - chunk.z) + sphere.radius,
      );
    }
    this.stores.clear();
    return { chunks: [...chunks.values()], triangles };
  }
}
