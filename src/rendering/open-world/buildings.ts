import * as T from 'three';
import type { Structure } from '../../simulation/open-world/placement.ts';
import { OW_NOISE_GLSL } from './terrain-material.ts';

const KIND_CODE: Record<Structure['kind'], number> = {
  house: 0,
  shop: 1,
  block: 2,
  farm: 3,
  chapel: 4,
  hangar: 5,
  terminal: 6,
  tower: 7,
  lighthouse: 8,
  warehouse: 9,
};
/** Linear-ish wall albedos: limewash, ochre, pale blue, terracotta, brick,
 * concrete, stone; corrugated metal for sheds. */
const WALLS = [0xd8d2c4, 0xc9a66b, 0xa9b7bf, 0xb86a4b, 0x8c4f3a, 0x9a9690, 0xb3a891, 0xe6dfcf];
const METAL = [0x8e9590, 0x6f7f74, 0xa7aaa8];
const ROOFS = [0x8a3f2a, 0x6d3426, 0x45484c, 0x5b5d5f, 0x7a5a3e];

class Mesher {
  position: number[] = [];
  normal: number[] = [];
  uv: number[] = [];
  color: number[] = [];
  facade: number[] = [];
  index: number[] = [];
  private c = new T.Color();
  quad(
    corners: readonly (readonly [number, number, number])[],
    n: readonly [number, number, number],
    uvs: readonly (readonly [number, number])[],
    color: number,
    facade: readonly [number, number, number, number],
  ) {
    const base = this.position.length / 3;
    this.c.setHex(color);
    corners.forEach((p, k) => {
      this.position.push(p[0], p[1], p[2]);
      this.normal.push(n[0], n[1], n[2]);
      this.uv.push(uvs[k][0], uvs[k][1]);
      this.color.push(this.c.r, this.c.g, this.c.b);
      this.facade.push(...facade);
    });
    this.index.push(base, base + 1, base + 2, base, base + 2, base + 3);
  }
  tri(
    corners: readonly (readonly [number, number, number])[],
    n: readonly [number, number, number],
    color: number,
    facade: readonly [number, number, number, number],
  ) {
    const base = this.position.length / 3;
    this.c.setHex(color);
    corners.forEach((p) => {
      this.position.push(p[0], p[1], p[2]);
      this.normal.push(n[0], n[1], n[2]);
      this.uv.push(p[0], p[2]);
      this.color.push(this.c.r, this.c.g, this.c.b);
      this.facade.push(...facade);
    });
    this.index.push(base, base + 1, base + 2);
  }
  geometry() {
    if (!this.index.length) return null;
    const g = new T.BufferGeometry();
    g.setAttribute('position', new T.Float32BufferAttribute(this.position, 3));
    g.setAttribute('normal', new T.Float32BufferAttribute(this.normal, 3));
    g.setAttribute('uv', new T.Float32BufferAttribute(this.uv, 2));
    g.setAttribute('color', new T.Float32BufferAttribute(this.color, 3));
    g.setAttribute('facade', new T.Float32BufferAttribute(this.facade, 4));
    g.setIndex(this.index);
    g.computeBoundingSphere();
    return g;
  }
}

/** Facade material: plaster/brick/metal walls with a window grid per floor
 * and bay (dark glazing with low roughness, deep reveals), shopfronts on
 * town ground floors, ribbed cladding on sheds, weathering stains, and
 * individually lit windows at night. */
function facadeMaterial(night: { value: number }) {
  const material = new T.MeshStandardMaterial({ vertexColors: true, roughness: 0.85, metalness: 0 });
  material.name = 'Festival building facades';
  (material as unknown as { defines: Record<string, string> }).defines = { USE_UV: '' };
  material.onBeforeCompile = (shader) => {
    shader.uniforms.owNight = night;
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nattribute vec4 facade;\nvarying vec4 vFacade;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvFacade = facade;');
    shader.fragmentShader = shader.fragmentShader
      .replace(
        '#include <common>',
        `#include <common>
uniform float owNight;
varying vec4 vFacade;
${OW_NOISE_GLSL}
float owGlass;
float owLit;
float owRib;
vec3 owLamp;`,
      )
      .replace(
        '#include <color_fragment>',
        `#include <color_fragment>
{
  float style = vFacade.x, kind = vFacade.y, height = vFacade.w;
  vec2 q = vUv;
  owGlass = 0.0; owLit = 0.0; owRib = 0.0; owLamp = vec3(1.0, 0.7, 0.42);
  bool shed = kind > 4.5 && kind < 5.5 || kind > 8.5;
  bool roof = vFacade.z < 0.0;
  // Weathering: rain streaks down from sills, grime near the ground.
  float streak = owNoise(vec2(q.x * 1.7, q.y * 0.08 + style * 13.0));
  float grime = 1.0 - smoothstep(0.0, 1.6, q.y);
  diffuseColor.rgb *= (0.86 + 0.18 * streak) * (1.0 - 0.25 * grime);
  if (roof) {
    diffuseColor.rgb *= 0.85 + 0.3 * owNoise(q * 0.9);
  } else if (shed) {
    owRib = sin(q.x * 6.2832 / 0.6);
    diffuseColor.rgb *= 0.92 + 0.08 * owRib;
    // A band of clerestory glazing.
    float band = step(height - 2.6, q.y) * step(q.y, height - 1.2);
    owGlass = band * step(0.1, fract(q.x / 3.0)) * step(fract(q.x / 3.0), 0.9) * (kind > 8.5 && kind < 9.5 ? 0.0 : 1.0);
  } else {
    float bay = kind < 0.5 ? 2.7 : kind > 6.5 ? 2.2 : 3.3;
    float floorH = kind > 6.5 ? 3.0 : 3.2;
    vec2 cell = vec2(q.x / bay, q.y / floorH);
    vec2 f = fract(cell), id = floor(cell);
    float shopfront = (kind > 0.5 && kind < 2.5 && id.y < 0.5) ? 1.0 : 0.0;
    vec2 lo = shopfront > 0.5 ? vec2(0.06, 0.05) : vec2(0.24, 0.3);
    vec2 hi = shopfront > 0.5 ? vec2(0.94, 0.8) : vec2(0.76, 0.82);
    float inside = step(lo.x, f.x) * step(f.x, hi.x) * step(lo.y, f.y) * step(f.y, hi.y);
    float underRoof = step(q.y, height - 0.6) * step(0.4, q.y);
    // Some bays are blind on houses and the chapel has tall lancets.
    float blind = kind < 0.5 ? step(0.82, owHash(id + style * 31.0)) : 0.0;
    owGlass = inside * underRoof * (1.0 - blind);
    float reveal = (1.0 - inside) * step(lo.x - 0.05, f.x) * step(f.x, hi.x + 0.05) * step(lo.y - 0.05, f.y) * step(f.y, hi.y + 0.05);
    diffuseColor.rgb *= 1.0 - 0.35 * reveal * underRoof;
    // About a third of the rooms are lit, each at its own brightness and
    // lamp colour (warm tungsten to cool fluorescent), dimmer deeper in.
    float room = owHash(id + vec2(style * 97.0, 3.0));
    owLit = step(0.64, room) * owGlass * (0.3 + 0.7 * owHash(id + vec2(5.0, style * 11.0)));
    owLamp = mix(vec3(1.0, 0.66, 0.36), vec3(0.86, 0.9, 1.0), step(0.85, owHash(id + vec2(17.0, style))));
    owLit *= 0.65 + 0.35 * smoothstep(0.0, 0.5, min(f.x - lo.x, hi.x - f.x) / (hi.x - lo.x));
  }
  vec3 glass = vec3(0.025, 0.03, 0.035) + vec3(0.02) * owNoise(q * 3.0);
  diffuseColor.rgb = mix(diffuseColor.rgb, glass, owGlass);
}`,
      )
      .replace(
        '#include <roughnessmap_fragment>',
        `#include <roughnessmap_fragment>
roughnessFactor = mix(roughnessFactor, 0.06, owGlass);
roughnessFactor = mix(roughnessFactor, 0.5, step(0.001, abs(owRib)));`,
      )
      .replace(
        '#include <normal_fragment_maps>',
        `#include <normal_fragment_maps>
if (abs(owRib) > 0.001) normal = normalize(normal + (viewMatrix * vec4(0.0, 0.0, 0.0, 0.0)).xyz + cross(normal, vec3(0.0, 1.0, 0.0)) * owRib * 0.12);`,
      )
      .replace(
        '#include <emissivemap_fragment>',
        `#include <emissivemap_fragment>
totalEmissiveRadiance += owLamp * owLit * owNight * 0.9;`,
      );
  };
  material.customProgramCacheKey = () => 'festival-facades-v2';
  return material;
}

/**
 * Procedural buildings from the region's structures: town houses, shops and
 * blocks with window grids and shopfronts, farmsteads, the chapel, hangars
 * and warehouses with ribbed cladding and barrel or pitched roofs, the
 * airfield terminal and control tower, and the lighthouse whose lantern
 * shines at night. One merged mesh per 512 m chunk (walls and roofs share
 * the facade material through per-vertex style data).
 */
export class Buildings {
  readonly root = new T.Group();
  readonly night = { value: 0 };
  readonly material: T.MeshStandardMaterial;
  readonly lantern: T.MeshStandardMaterial;
  stats = { buildings: 0, triangles: 0 };
  constructor(structures: readonly Structure[]) {
    this.root.name = 'Festival buildings';
    this.material = facadeMaterial(this.night);
    this.lantern = new T.MeshStandardMaterial({ color: 0xfff6d8, emissive: 0xfff0c0, emissiveIntensity: 0.2, roughness: 0.2 });
    const chunks = new Map<string, Mesher>();
    const lanterns: T.Vector3[] = [];
    for (const s of structures) {
      const key = `${Math.floor(s.x / 512)},${Math.floor(s.z / 512)}`;
      let m = chunks.get(key);
      if (!m) chunks.set(key, (m = new Mesher()));
      this.add(m, s);
      if (s.kind === 'lighthouse') lanterns.push(new T.Vector3(s.x, s.base + s.height + 1.6, s.z));
    }
    let triangles = 0;
    for (const [key, m] of chunks) {
      const g = m.geometry();
      if (!g) continue;
      triangles += m.index.length / 3;
      const mesh = new T.Mesh(g, this.material);
      mesh.name = `Buildings ${key}`;
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      mesh.matrixAutoUpdate = false;
      this.root.add(mesh);
    }
    for (const p of lanterns) {
      const lamp = new T.Mesh(new T.CylinderGeometry(2.2, 2.2, 3.2, 12), this.lantern);
      lamp.position.copy(p);
      lamp.name = 'Lighthouse lantern';
      this.root.add(lamp);
    }
    this.stats = { buildings: structures.length, triangles };
  }
  private add(m: Mesher, s: Structure) {
    const c = Math.cos(s.heading),
      n = Math.sin(s.heading),
      base = s.base,
      top = s.base + s.height,
      kind = KIND_CODE[s.kind],
      style = (s.style % 9973) / 9973;
    const local = (x: number, y: number, z: number) => [s.x + c * x - n * z, y, s.z + n * x + c * z] as const;
    const pick = (list: number[], salt: number) => list[(s.style >>> salt) % list.length];
    const metal = s.kind === 'hangar' || s.kind === 'warehouse';
    const wall = metal ? pick(METAL, 3) : s.kind === 'block' ? pick([0x9a9690, 0xb9b2a3, 0x8c4f3a, 0xcfc8b8], 5) : pick(WALLS, 7);
    const roof = metal ? 0x5d6266 : pick(ROOFS, 11);
    const facade = [style, kind, s.floors, s.height] as const;
    const roofFacade = [style, kind, -1, s.height] as const;
    if (s.kind === 'tower' || s.kind === 'lighthouse') {
      // Round shaft (16 sides), lighthouse white with a red band.
      const r = Math.min(s.hx, s.hz),
        sides = 16;
      for (let k = 0; k < sides; k++) {
        const a0 = (k / sides) * Math.PI * 2,
          a1 = ((k + 1) / sides) * Math.PI * 2,
          taper = s.kind === 'lighthouse' ? 0.72 : 1;
        const p0 = [s.x + Math.cos(a0) * r, s.z + Math.sin(a0) * r],
          p1 = [s.x + Math.cos(a1) * r, s.z + Math.sin(a1) * r],
          t0 = [s.x + Math.cos(a0) * r * taper, s.z + Math.sin(a0) * r * taper],
          t1 = [s.x + Math.cos(a1) * r * taper, s.z + Math.sin(a1) * r * taper];
        const am = (a0 + a1) / 2;
        const color = s.kind === 'lighthouse' ? 0xe8e6e0 : 0xb9b6ae;
        m.quad(
          [
            [p1[0], base, p1[1]],
            [p0[0], base, p0[1]],
            [t0[0], top, t0[1]],
            [t1[0], top, t1[1]],
          ],
          [Math.cos(am), 0, Math.sin(am)],
          [
            [k * 2.5, 0],
            [(k + 1) * 2.5, 0],
            [(k + 1) * 2.5, s.height],
            [k * 2.5, s.height],
          ],
          color,
          [style, 9, 0, s.height],
        );
        if (s.kind === 'tower') {
          // Glazed control cab on top.
          const g0 = [s.x + Math.cos(a0) * r * 1.5, s.z + Math.sin(a0) * r * 1.5],
            g1 = [s.x + Math.cos(a1) * r * 1.5, s.z + Math.sin(a1) * r * 1.5];
          m.quad(
            [
              [g1[0], top, g1[1]],
              [g0[0], top, g0[1]],
              [g0[0], top + 3.4, g0[1]],
              [g1[0], top + 3.4, g1[1]],
            ],
            [Math.cos(am), 0, Math.sin(am)],
            [
              [0.3, 0.5],
              [2.9, 0.5],
              [2.9, 3],
              [0.3, 3],
            ],
            0x30383c,
            [style, 7, 1, 3.4],
          );
          m.tri([[g0[0], top + 3.4, g0[1]], [s.x, top + 4.2, s.z], [g1[0], top + 3.4, g1[1]]], [0, 1, 0], 0x3a3d40, roofFacade);
        }
      }
      return;
    }
    // Walls.
    const hx = s.hx,
      hz = s.hz;
    const sides: [number, number, number, number, number, number][] = [
      // x0, z0, x1, z1 (local), outward normal (local x, z)
      [-hx, -hz, hx, -hz, 0, -1],
      [hx, -hz, hx, hz, 1, 0],
      [hx, hz, -hx, hz, 0, 1],
      [-hx, hz, -hx, -hz, -1, 0],
    ];
    const eave = s.kind === 'hangar' ? top - s.hz * 0.45 : top;
    for (const [x0, z0, x1, z1, nx, nz] of sides) {
      const len = Math.hypot(x1 - x0, z1 - z0);
      const a = local(x0, base, z0),
        b = local(x1, base, z1),
        d = local(x1, eave, z1),
        e = local(x0, eave, z0);
      // Counter-clockwise seen from outside.
      m.quad([b, a, e, d], [c * nx - n * nz, 0, n * nx + c * nz], [[0, 0], [len, 0], [len, eave - base], [0, eave - base]], wall, facade);
    }
    // Roofs.
    const pitched = s.kind === 'house' || s.kind === 'farm' || s.kind === 'chapel';
    if (s.kind === 'hangar') {
      // Barrel vault across the short axis.
      const steps = 8,
        rise = top - eave;
      for (let k = 0; k < steps; k++) {
        const t0 = k / steps,
          t1 = (k + 1) / steps;
        const z0 = -hz + 2 * hz * t0,
          z1 = -hz + 2 * hz * t1,
          y0 = eave + rise * Math.sin(t0 * Math.PI),
          y1 = eave + rise * Math.sin(t1 * Math.PI),
          slope = Math.atan2(y1 - y0, z1 - z0);
        // Local normal (0, cos, -sin) rotated into the world.
        const normal: [number, number, number] = [n * Math.sin(slope), Math.cos(slope), -c * Math.sin(slope)];
        m.quad(
          [local(hx, y0, z0), local(-hx, y0, z0), local(-hx, y1, z1), local(hx, y1, z1)],
          normal,
          [[0, z0], [2 * hx, z0], [2 * hx, z1], [0, z1]],
          roof,
          roofFacade,
        );
        // Gable infill.
        for (const side of [-1, 1]) {
          const nx = side;
          m.tri(
            side < 0
              ? [local(-hx, eave, z0), local(-hx, y1, z1), local(-hx, y0, z0)]
              : [local(hx, eave, z0), local(hx, y0, z0), local(hx, y1, z1)],
            [c * nx, 0, n * nx],
            wall,
            facade,
          );
          m.tri(
            side < 0
              ? [local(-hx, eave, z0), local(-hx, eave, z1), local(-hx, y1, z1)]
              : [local(hx, eave, z0), local(hx, y1, z1), local(hx, eave, z1)],
            [c * nx, 0, n * nx],
            wall,
            facade,
          );
        }
      }
    } else if (pitched) {
      // Gable roof along local x, ridge rising 0.45 × half depth, eaves overhang.
      const ridge = top + hz * 0.55,
        o = 0.45;
      const ra = local(-hx - o, ridge, 0),
        rb = local(hx + o, ridge, 0);
      for (const side of [-1, 1]) {
        const ea = local(-hx - o, top - 0.15, side * (hz + o)),
          eb = local(hx + o, top - 0.15, side * (hz + o));
        const slope = Math.atan2(ridge - top, hz),
          ny = Math.cos(slope),
          nl = Math.sin(slope) * side;
        const corners = side > 0 ? [ea, eb, rb, ra] : [eb, ea, ra, rb];
        m.quad(corners, [-n * nl, ny, c * nl], [[0, 0], [2 * hx, 0], [2 * hx, hz], [0, hz]], roof, roofFacade);
      }
      for (const side of [-1, 1]) {
        m.tri(
          side < 0
            ? [local(-hx, top, -hz), local(-hx, top, hz), local(-hx, ridge, 0)]
            : [local(hx, top, hz), local(hx, top, -hz), local(hx, ridge, 0)],
          [c * side, 0, n * side],
          wall,
          [style, kind, 0, s.height],
        );
      }
      if (s.kind === 'chapel') {
        // Bell tower at the west end.
        const tx = -hx + 2.4;
        const towerTop = ridge + 7;
        for (const [x0, z0, x1, z1, nx, nz] of [
          [tx - 2.2, -2.2, tx + 2.2, -2.2, 0, -1],
          [tx + 2.2, -2.2, tx + 2.2, 2.2, 1, 0],
          [tx + 2.2, 2.2, tx - 2.2, 2.2, 0, 1],
          [tx - 2.2, 2.2, tx - 2.2, -2.2, -1, 0],
        ] as const)
          m.quad(
            [local(x1, base, z1), local(x0, base, z0), local(x0, towerTop, z0), local(x1, towerTop, z1)],
            [c * nx - n * nz, 0, n * nx + c * nz],
            [[0, 0], [4.4, 0], [4.4, towerTop - base], [0, towerTop - base]],
            0xb3a891,
            [style, 4, 0, towerTop - base],
          );
        for (const [x0, z0, x1, z1] of [
          [tx - 2.3, -2.3, tx + 2.3, -2.3],
          [tx + 2.3, -2.3, tx + 2.3, 2.3],
          [tx + 2.3, 2.3, tx - 2.3, 2.3],
          [tx - 2.3, 2.3, tx - 2.3, -2.3],
        ] as const)
          m.tri([local(x1, towerTop, z1), local(x0, towerTop, z0), local(tx, towerTop + 5, 0)], [0, 1, 0], 0x45484c, roofFacade);
      }
    } else {
      // Flat roof with a parapet lip.
      m.quad([local(-hx, top, -hz), local(-hx, top, hz), local(hx, top, hz), local(hx, top, -hz)], [0, 1, 0], [[0, 0], [0, 2 * hz], [2 * hx, 2 * hz], [2 * hx, 0]], metal ? roof : 0x6a6763, roofFacade);
    }
  }
  setNight(night: number) {
    this.night.value = night;
    this.lantern.emissiveIntensity = 0.2 + night * 30;
  }
  dispose() {
    this.root.traverse((o) => {
      if (o instanceof T.Mesh) o.geometry.dispose();
    });
    this.material.dispose();
    this.lantern.dispose();
  }
}
