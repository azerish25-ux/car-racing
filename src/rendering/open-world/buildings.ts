import * as T from 'three';
import type { Structure } from '../../simulation/open-world/placement.ts';
import { OW_NOISE_GLSL } from './terrain-material.ts';
import {
  facadeLayout,
  addRecessedFacade,
  WALL_FINISH,
  type FacadeLayout,
  type FacadePlacement,
} from './facade-layout.ts';
import { FacadeJoinery } from './facade-joinery.ts';
import {
  ARCH_CODE,
  isApartment,
  type ArchitecturePlan,
  type VisualLandmark,
} from './japan-architecture.ts';
import { SEASON_GLSL, bindSeasonUniforms } from './season.ts';
import type { QualityPreset } from '../options.ts';

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
/** Japanese palettes, sRGB, read from the references: ibushi (smoked) and
 * glazed kawara #33373c-#53575c (020, 034, 064), shikkui white plaster
 * #e6e2d8 and earthen plaster #c9ad7f (020, 026), stained cedar #3b2f27,
 * temple compound ochre #d2b07a (026/027), mid-rise mosaic tile, formed
 * concrete and painted render (030, 038, 089). */
const KAWARA = [0x3f4349, 0x363a3f, 0x4a4e53, 0x2f3338];
const PLASTER = [0xe6e2d8, 0xdcd6c8, 0xcbb995];
const URBAN = [...WALL_FINISH.tile, ...WALL_FINISH.concrete, 0xe2dccb, 0xa9b2a3, 0xcfc6b4];
const TIMBER = 0x2e2620;
const ALUMINIUM = 0xb9bdbd;

type V3 = readonly [number, number, number];
/** Deterministic integer hash of a structure seed and two cell indices. */
function hashOf(seed: number, a: number, b: number) {
  let h = (seed ^ Math.imul(a + 7, 0x9e3779b1) ^ Math.imul(b + 3, 0x85ebca6b)) >>> 0;
  h = Math.imul(h ^ (h >>> 15), 0x2c1b3c6d) >>> 0;
  return (h ^ (h >>> 13)) >>> 0;
}
type UV = readonly [number, number];
type Facade = readonly [number, number, number, number];

class Mesher {
  position: number[] = [];
  normal: number[] = [];
  uv: number[] = [];
  color: number[] = [];
  facade: number[] = [];
  index: number[] = [];
  private c = new T.Color();
  /** Current colour for vertex(); set once per polygon. */
  paint(color: number) {
    this.c.setHex(color);
  }
  vertex(x: number, y: number, z: number, n: V3, u: number, v: number, facade: Facade) {
    this.position.push(x, y, z);
    this.normal.push(n[0], n[1], n[2]);
    this.uv.push(u, v);
    this.color.push(this.c.r, this.c.g, this.c.b);
    this.facade.push(facade[0], facade[1], facade[2], facade[3]);
  }
  quad(corners: readonly V3[], n: V3, uvs: readonly UV[], color: number, facade: Facade) {
    const base = this.position.length / 3;
    this.paint(color);
    for (let k = 0; k < 4; k++)
      this.vertex(corners[k][0], corners[k][1], corners[k][2], n, uvs[k][0], uvs[k][1], facade);
    this.index.push(base, base + 1, base + 2, base, base + 2, base + 3);
  }
  tri(corners: readonly V3[], n: V3, color: number, facade: Facade, uvs?: readonly UV[]) {
    const base = this.position.length / 3;
    this.paint(color);
    for (let k = 0; k < 3; k++) {
      const p = corners[k];
      this.vertex(p[0], p[1], p[2], n, uvs ? uvs[k][0] : p[0], uvs ? uvs[k][1] : p[2], facade);
    }
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

/** Unit-cube faces as corner indices (bit 0 = +x, bit 1 = +y, bit 2 = +z),
 * counter-clockwise seen from outside, with their outward normal and the
 * two local axes used as metric UVs. The bottom face is last. */
const BOX_FACES: readonly (readonly [readonly number[], V3, number, number])[] = [
  [[1, 0, 2, 3], [0, 0, -1], 0, 1],
  [[4, 5, 7, 6], [0, 0, 1], 0, 1],
  [[0, 4, 6, 2], [-1, 0, 0], 2, 1],
  [[5, 1, 3, 7], [1, 0, 0], 2, 1],
  [[2, 6, 7, 3], [0, 1, 0], 0, 2],
  [[0, 1, 5, 4], [0, -1, 0], 0, 2],
];

/** A structure's local frame: +x along the frontage, +z across, y absolute.
 * Every helper bakes into the district mesh with outward winding. */
class Frame {
  readonly c: number;
  readonly n: number;
  private readonly corner = new Float64Array(24);
  private readonly local = new Float64Array(24);
  constructor(
    readonly m: Mesher,
    readonly x: number,
    readonly z: number,
    heading: number,
    readonly detail: Facade,
  ) {
    this.c = Math.cos(heading);
    this.n = Math.sin(heading);
  }
  at(x: number, y: number, z: number): V3 {
    return [this.x + this.c * x - this.n * z, y, this.z + this.n * x + this.c * z];
  }
  dir(x: number, y: number, z: number): V3 {
    return [this.c * x - this.n * z, y, this.n * x + this.c * z];
  }
  /** Convex planar polygon in local coordinates. Its winding follows the
   * geometric normal turned toward `hint`; UVs default to metres in-plane. */
  poly(points: readonly V3[], hint: V3, color: number, facade: Facade, uvs?: readonly UV[]) {
    const count = points.length;
    let nx = 0,
      ny = 0,
      nz = 0;
    for (let i = 0; i < count; i++) {
      const a = points[i],
        b = points[(i + 1) % count];
      nx += (a[1] - b[1]) * (a[2] + b[2]);
      ny += (a[2] - b[2]) * (a[0] + b[0]);
      nz += (a[0] - b[0]) * (a[1] + b[1]);
    }
    const flip = nx * hint[0] + ny * hint[1] + nz * hint[2] < 0;
    const l = (flip ? -1 : 1) / (Math.hypot(nx, ny, nz) || 1);
    nx *= l;
    ny *= l;
    nz *= l;
    const at = (k: number) => points[flip ? count - 1 - k : k];
    // Default UVs: metres along the first edge and across it in-plane.
    const p0 = at(0),
      p1 = at(1);
    let ex = p1[0] - p0[0],
      ey = p1[1] - p0[1],
      ez = p1[2] - p0[2];
    const el = Math.hypot(ex, ey, ez) || 1;
    ex /= el;
    ey /= el;
    ez /= el;
    const fx = ny * ez - nz * ey,
      fy = nz * ex - nx * ez,
      fz = nx * ey - ny * ex;
    const m = this.m,
      normal = this.dir(nx, ny, nz),
      base = m.position.length / 3;
    m.paint(color);
    for (let k = 0; k < count; k++) {
      const p = at(k);
      let u: number, v: number;
      if (uvs) {
        const t = uvs[flip ? count - 1 - k : k];
        u = t[0];
        v = t[1];
      } else {
        const dx = p[0] - p0[0],
          dy = p[1] - p0[1],
          dz = p[2] - p0[2];
        u = dx * ex + dy * ey + dz * ez;
        v = dx * fx + dy * fy + dz * fz;
      }
      m.vertex(
        this.x + this.c * p[0] - this.n * p[2],
        p[1],
        this.z + this.n * p[0] + this.c * p[2],
        normal,
        u,
        v,
        facade,
      );
    }
    for (let k = 1; k < count - 1; k++) m.index.push(base, base + k, base + k + 1);
  }
  /** Axis-aligned box in the local frame (no allocation per face). */
  box(
    x: number,
    y: number,
    z: number,
    w: number,
    h: number,
    d: number,
    color: number,
    facade = this.detail,
    bottom = false,
  ) {
    const corner = this.corner,
      local = this.local;
    for (let i = 0; i < 8; i++) {
      const lx = x + (i & 1 ? w : -w) / 2,
        ly = y + (i & 2 ? h : -h) / 2,
        lz = z + (i & 4 ? d : -d) / 2;
      local[i * 3] = lx;
      local[i * 3 + 1] = ly;
      local[i * 3 + 2] = lz;
      corner[i * 3] = this.x + this.c * lx - this.n * lz;
      corner[i * 3 + 1] = ly;
      corner[i * 3 + 2] = this.z + this.n * lx + this.c * lz;
    }
    const m = this.m;
    m.paint(color);
    for (let f = 0; f < (bottom ? 6 : 5); f++) {
      const [ids, n, ua, va] = BOX_FACES[f];
      const normal = this.dir(n[0], n[1], n[2]),
        base = m.position.length / 3;
      for (const i of ids)
        m.vertex(
          corner[i * 3],
          corner[i * 3 + 1],
          corner[i * 3 + 2],
          normal,
          local[i * 3 + ua],
          local[i * 3 + va],
          facade,
        );
      m.index.push(base, base + 1, base + 2, base, base + 2, base + 3);
    }
  }
  /** Square-section member between two local points (rafters, ridges,
   * pipes, stair stringers). `up` orients the section's height. */
  beam(a: V3, b: V3, w: number, h: number, color: number, facade = this.detail) {
    const dx = b[0] - a[0],
      dy = b[1] - a[1],
      dz = b[2] - a[2];
    const len = Math.hypot(dx, dy, dz) || 1;
    const d: V3 = [dx / len, dy / len, dz / len];
    let sx = d[2],
      sz = -d[0],
      sy = 0;
    if (Math.hypot(sx, sz) < 1e-4) [sx, sy, sz] = [1, 0, 0];
    const sl = Math.hypot(sx, sy, sz);
    const side: V3 = [sx / sl, sy / sl, sz / sl];
    const up: V3 = [
      side[1] * d[2] - side[2] * d[1],
      side[2] * d[0] - side[0] * d[2],
      side[0] * d[1] - side[1] * d[0],
    ];
    const corner = (p: V3, s: number, u: number): V3 => [
      p[0] + side[0] * s * (w / 2) + up[0] * u * (h / 2),
      p[1] + side[1] * s * (w / 2) + up[1] * u * (h / 2),
      p[2] + side[2] * s * (w / 2) + up[2] * u * (h / 2),
    ];
    const ring = [
      [-1, -1],
      [1, -1],
      [1, 1],
      [-1, 1],
    ] as const;
    for (let k = 0; k < 4; k++) {
      const [s0, u0] = ring[k],
        [s1, u1] = ring[(k + 1) % 4];
      const hint: V3 = [
        side[0] * (s0 + s1) + up[0] * (u0 + u1),
        side[1] * (s0 + s1) + up[1] * (u0 + u1),
        side[2] * (s0 + s1) + up[2] * (u0 + u1),
      ];
      this.poly(
        [corner(a, s0, u0), corner(b, s0, u0), corner(b, s1, u1), corner(a, s1, u1)],
        hint,
        color,
        facade,
      );
    }
    this.poly(
      ring.map(([s, u]) => corner(b, s, u)),
      d,
      color,
      facade,
    );
    this.poly(
      ring.map(([s, u]) => corner(a, s, u)),
      [-d[0], -d[1], -d[2]],
      color,
      facade,
    );
  }
}

interface RoofSpec {
  /** Half extents of the wall plate rectangle; ridge runs along local x. */
  hx: number;
  hz: number;
  plate: number;
  pitch: number;
  /** Eave overhang beyond the walls and verge overhang on gable ends. */
  eave: number;
  verge?: number;
  form: 'irimoya' | 'kirizuma' | 'yosemune';
  tile: number;
  gable: number;
  /** Upward sweep of the eave corners (sori), m. */
  lift?: number;
  facade: Facade;
  wallFacade: Facade;
  /** Soffit facade (e.g. a glow panel for lantern-lit eaves). */
  soffit?: Facade;
}

/** Facade material: plaster/brick/metal walls with a window grid per floor
 * and bay (dark glazing with low roughness, deep reveals), shopfronts on
 * town ground floors, ribbed cladding on sheds, weathering stains, and
 * individually lit windows at night. Japanese styles add kawara roof
 * courses, mosaic tile, cedar boards, formed concrete and siding, koshi
 * lattice and shoji glazing, lit store interiors and winter snow. */
function facadeMaterial(night: { value: number }, wet: { value: number }) {
  const material = new T.MeshStandardMaterial({
    vertexColors: true,
    roughness: 0.85,
    metalness: 0,
  });
  material.name = 'Festival building facades';
  (material as unknown as { defines: Record<string, string> }).defines = { USE_UV: '' };
  material.onBeforeCompile = (shader) => {
    shader.uniforms.owNight = night;
    shader.uniforms.owWet = wet;
    bindSeasonUniforms(shader);
    shader.vertexShader = shader.vertexShader
      .replace(
        '#include <common>',
        '#include <common>\nattribute vec4 facade;\nvarying vec4 vFacade;',
      )
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvFacade = facade;');
    shader.fragmentShader = shader.fragmentShader
      .replace(
        '#include <common>',
        `#include <common>
uniform float owNight;
uniform float owWet;
${SEASON_GLSL}
varying vec4 vFacade;
${OW_NOISE_GLSL}
float owGlass;
float owLit;
float owGlow;
float owRib;
float owSnow;
float owWallRelief;
float owWallRoughness;
vec3 owLamp;`,
      )
      .replace(
        '#include <color_fragment>',
        `#include <color_fragment>
{
  float arch = floor(vFacade.y / 16.0 + 0.01);
  float kind = vFacade.y - arch * 16.0;
  float style = vFacade.x, height = vFacade.w;
  vec2 q = vUv;
  owGlass = 0.0; owLit = 0.0; owGlow = 0.0; owRib = 0.0; owSnow = 0.0; owWallRelief = 0.0;
  owWallRoughness = -1.0; owLamp = vec3(1.0, 0.7, 0.42);
  bool shed = arch < 0.5 && (kind > 4.5 && kind < 5.5 || kind > 8.5);
  bool roof = vFacade.z < -0.5 && vFacade.z > -1.5;
  bool trim = vFacade.z < -1.5;
  bool physicalPane = abs(vFacade.z + 4.0) < 0.1;
  bool physicalWall = abs(vFacade.z + 3.0) < 0.1;
  bool glowPanel = abs(vFacade.z + 6.0) < 0.1;
  // Weathering: rain streaks down from sills, grime near the ground.
  float streak = owNoise(vec2(q.x * 1.7, q.y * 0.08 + style * 13.0));
  float grime = 1.0 - smoothstep(0.0, 1.6, q.y);
  if (!physicalPane && !glowPanel) diffuseColor.rgb *= physicalWall
    ? (0.945 + 0.055 * streak) * (1.0 - 0.14 * grime)
    : (0.86 + 0.18 * streak) * (1.0 - 0.25 * grime);
  if (physicalPane && arch > 0.5 && arch < 1.5) {
    // Traditional fronts (metric UV): koshi lattice of 30 mm slats at 60 mm
    // on the ground floor, kumiko/shoji grids and glazed sliding sashes above.
    float room = vFacade.x;
    vec2 aa = max(fwidth(q), vec2(0.0005));
    if (vFacade.w > 0.5 && room < 0.66) {
      float d = abs(fract(q.x / 0.06) - 0.5) * 0.06;
      float slat = 1.0 - smoothstep(0.0145 - aa.x * 0.5, 0.0145 + aa.x * 0.5, d);
      slat = mix(0.52, slat, 1.0 - smoothstep(0.2, 0.55, aa.x / 0.06));
      float rail = 1.0 - smoothstep(0.03, 0.03 + aa.y, min(abs(q.y - 0.95), abs(q.y - 1.85)));
      float wood = max(slat, rail);
      diffuseColor.rgb = mix(vec3(0.018, 0.016, 0.014), vec3(0.085, 0.058, 0.038), wood);
      owLit = step(0.25, room) * (1.0 - wood) * 1.6;
      owLamp = vec3(1.0, 0.6, 0.3);
    } else {
      vec2 cell = vec2(0.3, 0.38);
      vec2 f = fract(q / cell), e = min(f, 1.0 - f) * cell;
      float bar = max(1.0 - smoothstep(0.012, 0.012 + aa.x, e.x), 1.0 - smoothstep(0.012, 0.012 + aa.y, e.y));
      bar = mix(0.16, bar, 1.0 - smoothstep(0.25, 0.6, max(aa.x / cell.x, aa.y / cell.y)));
      bool glazed = room > 0.78 || (vFacade.w > 0.5 && room > 0.66);
      vec3 paper = vec3(0.6, 0.58, 0.53) * (0.92 + 0.08 * owNoise(q * 3.0 + room * 9.0));
      diffuseColor.rgb = mix(glazed ? vec3(0.035, 0.042, 0.044) : paper, vec3(0.1, 0.07, 0.048), bar);
      owGlass = glazed ? 1.0 - bar : 0.0;
      owLit = step(0.3, room) * (1.0 - bar) * (glazed ? 0.8 : 1.4);
      owLamp = vec3(1.0, 0.66, 0.36);
    }
  } else if (physicalPane && arch > 2.5) {
    // Convenience store: ceiling light rows, colourful shelving, pale floor,
    // aluminium mullions; lit day and night.
    float room = vFacade.x;
    vec2 aa = max(fwidth(q), vec2(0.001));
    float perimeter = min(min(q.x, 1.0 - q.x), min(q.y, 1.0 - q.y));
    float frame = 1.0 - smoothstep(0.022, 0.022 + max(aa.x, aa.y), perimeter);
    // Shelving gondolas 1.2 m tall with aisles between them, seen 3-6 m
    // behind the glass; a pale ceiling with two rows of LED tubes.
    float ceilingBand = smoothstep(0.8, 0.83, q.y);
    float aisle = step(0.78, fract(q.x * 2.2 + room * 0.7));
    vec2 cellId = floor(vec2(q.x * 18.0 + room * 5.0, q.y * 11.0));
    vec3 product = 0.5 + 0.5 * cos(6.2832 * (owHash(cellId) + vec3(0.0, 0.33, 0.67)));
    float shelf = step(0.12, q.y) * (1.0 - step(0.52, q.y)) * (1.0 - aisle) * step(0.22, fract(q.y * 11.0));
    vec3 interior = mix(vec3(0.3, 0.3, 0.29), product * 0.22 + 0.04, shelf);
    interior = mix(interior, vec3(0.42, 0.42, 0.41), step(0.52, q.y) * (1.0 - ceilingBand));
    float strip = ceilingBand * step(0.6, fract(q.x * 2.0 + 0.15)) * step(0.35, fract(q.y * 7.0));
    interior = mix(interior, vec3(0.6, 0.6, 0.58), ceilingBand);
    diffuseColor.rgb = mix(interior, vec3(0.56, 0.58, 0.58), frame);
    owGlass = (1.0 - frame) * 0.7;
    // The lit interior emits its own albedo, so shelves stay legible.
    owGlow = (1.0 - frame) * (1.0 + 2.6 * strip);
    owLamp = interior * vec3(0.95, 0.98, 1.0);
  } else if (physicalPane) {
    // Geometry supplies the actual reveal depth. This inset pane adds a
    // bounded interior illustration, not a ray-traced or enterable room.
    float room = vFacade.x;
    vec2 aa = max(fwidth(q), vec2(0.001));
    bool shopPane = vFacade.w > 0.5;
    float upright = shopPane ? min(abs(q.x-0.3333),abs(q.x-0.6667)) : abs(q.x-0.5);
    float transom = abs(q.y - (shopPane ? 0.78 : 0.63));
    float perimeter = min(min(q.x,1.0-q.x),min(q.y,1.0-q.y));
    float frame = max(1.0-smoothstep(0.012,0.012+aa.x,upright),
                      1.0-smoothstep(0.012,0.012+aa.y,transom));
    frame = max(frame,1.0-smoothstep(0.028,0.028+max(aa.x,aa.y),perimeter));
    owGlass = 1.0-frame;
    // Japanese aluminium sashes: anodised silver or bronze.
    diffuseColor.rgb = arch > 1.5 && room > 0.45 ? vec3(0.36,0.37,0.37) : vec3(0.043,0.050,0.047);
    float ceiling = 1.0 - smoothstep(0.77,1.0,q.y)*0.52;
    float curtain = smoothstep(0.06,0.16,q.x)*smoothstep(0.06,0.16,1.0-q.x);
    float furniture = 1.0-(1.0-smoothstep(0.19,0.32,q.y)) *
      (1.0-smoothstep(0.09,0.23,abs(q.x-(0.30+room*0.35))))*0.68;
    owLamp = mix(vec3(1.0,0.69,0.42),vec3(0.78,0.87,1.0),step(0.86,room));
    owLit = step(0.57,room)*(0.34+room*0.45)*owGlass*ceiling*curtain*furniture;
    if (arch > 1.5 && shopPane) {
      if (room < 0.13) {
        // A closed roller shutter: 80 mm corrugation, slat box above.
        float rib = sin(q.y * 6.2832 * 32.0) * (1.0 - smoothstep(0.3, 0.8, fwidth(q.y * 32.0)));
        diffuseColor.rgb = vec3(0.42, 0.43, 0.43) * (0.9 + 0.08 * rib);
        owGlass = 0.0; owLit = 0.0;
      } else {
        // Most city shops stay open into the evening: bright LED interiors.
        owLit = owGlass * ceiling * (1.6 + 1.4 * room);
        owLamp = mix(vec3(1.0, 0.82, 0.62), vec3(0.9, 0.95, 1.0), step(0.5, room));
      }
    }
  } else if (glowPanel && vFacade.w < 0.0) {
    // Lantern-lit surfaces (pagoda soffits, stone lanterns): dark by day,
    // warm 2200 K light at night only.
    owLit = -vFacade.w * 4.0;
    owLamp = vec3(1.0, 0.55, 0.24);
  } else if (glowPanel) {
    // Backlit acrylic (store fascia, light boxes): vertex colour is the face.
    owGlow = vFacade.w;
    owLamp = diffuseColor.rgb;
  } else if (physicalWall) {
    // Metre-scaled surface detail. Derivative fades remove sub-pixel grit
    // and mortar instead of adding sparkling high-frequency noise at speed.
    vec2 aa = max(fwidth(q), vec2(0.00001));
    float gritFade = 1.0-smoothstep(0.002,0.016,max(aa.x,aa.y));
    float grit = owNoise(q*67.0 + vec2(style*27.0,style*31.0));
    diffuseColor.rgb *= 1.0 + (grit-0.5)*0.055*gritFade;
    owWallRelief = (grit-0.5)*0.0012*gritFade;
    owWallRoughness = 0.87 + (grit-0.5)*0.08*gritFade;
    float finish = vFacade.w;
    if (finish > 0.5 && finish < 3.5) {
      // Brick, dressed stone and glazed mosaic tile share a bonded grid.
      bool stone = finish > 1.5 && finish < 2.5;
      bool tile = finish > 2.5;
      // Japanese dry-stone (ishigaki) reads as large, uneven blocks.
      bool ishigaki = stone && arch > 0.5;
      vec2 course = ishigaki ? vec2(1.05,0.52) : stone ? vec2(0.61,0.285) : tile ? vec2(0.1,0.05) : vec2(0.245,0.078);
      vec2 cellUv = q/course;
      cellUv.x += mod(floor(cellUv.y),2.0)*0.5;
      vec2 f = fract(cellUv), edge = min(f,1.0-f)*course;
      float joint = ishigaki ? 0.03 : stone ? 0.0045 : tile ? 0.0028 : 0.003;
      vec2 mask = smoothstep(vec2(joint),vec2(joint)+aa,edge);
      float face = mask.x*mask.y;
      float resolve = 1.0-smoothstep(0.3,0.9,max(aa.x/course.x,aa.y/course.y));
      float variation = owHash(floor(cellUv)+vec2(style*37.0,style*19.0));
      vec3 unitColor = diffuseColor.rgb*(tile ? 0.9+0.17*variation : ishigaki ? 0.7+0.55*variation : 0.88+0.22*variation);
      vec3 mortar = tile ? vec3(0.42,0.41,0.385) : vec3(0.22,0.215,0.195)*(0.97+0.06*streak);
      vec3 detailed = mix(mortar,unitColor,face);
      // The unresolved average stays close to the resolved material value.
      diffuseColor.rgb = mix(mix(diffuseColor.rgb,mortar,stone ? 0.055 : tile ? 0.1 : 0.11),detailed,resolve);
      owWallRelief += (face-1.0)*(stone ? 0.0035 : tile ? 0.0012 : 0.0025)*resolve;
      owWallRoughness = stone ? 0.93 : tile ? mix(0.62, 0.42, face * resolve) : 0.9;
    } else if (finish > 3.5 && finish < 4.5) {
      // Stained cedar: 180 mm vertical boards, dark joints, grain, battens.
      float board = q.x / 0.18;
      float edge = min(fract(board), 1.0 - fract(board)) * 0.18;
      float resolve = 1.0 - smoothstep(0.25, 0.7, aa.x / 0.18);
      float joint = mix(0.85, smoothstep(0.004, 0.004 + aa.x, edge), resolve);
      float grain = owNoise(vec2(floor(board) * 7.3 + q.x * 30.0, q.y * 1.6));
      float batten = 1.0 - smoothstep(0.03, 0.03 + aa.y, abs(fract(q.y / 0.91) - 0.5) * 0.91 - 0.42);
      diffuseColor.rgb *= (0.86 + 0.24 * owHash(vec2(floor(board), style * 5.0))) * (0.85 + 0.2 * grain) * joint;
      diffuseColor.rgb *= 1.0 - 0.2 * batten * resolve;
      owWallRelief += (joint - 1.0) * 0.004;
      owWallRoughness = 0.82;
    } else if (finish > 4.5 && finish < 5.5) {
      // Formed concrete: 1.8 x 0.9 m panel joints and form-tie holes.
      vec2 panel = q / vec2(1.8, 0.9);
      vec2 f = fract(panel), edge = min(f, 1.0 - f) * vec2(1.8, 0.9);
      float resolve = 1.0 - smoothstep(0.02, 0.06, max(aa.x, aa.y));
      float seam = mix(1.0, smoothstep(0.004, 0.004 + max(aa.x, aa.y), min(edge.x, edge.y)), resolve);
      vec2 tie = abs(fract(q / vec2(0.6, 0.45)) - 0.5) * vec2(0.6, 0.45);
      float hole = (1.0 - smoothstep(0.012, 0.016, length(tie))) * resolve;
      diffuseColor.rgb *= (0.93 + 0.12 * owHash(floor(panel) + style * 3.0)) * mix(0.82, 1.0, seam) * (1.0 - 0.35 * hole);
      owWallRelief += (seam - 1.0) * 0.003 - hole * 0.004;
      owWallRoughness = 0.9;
    } else if (finish > 5.5) {
      // Lap siding: 200 mm horizontal boards with a shadow line.
      float lap = fract(q.y / 0.2);
      float resolve = 1.0 - smoothstep(0.2, 0.6, aa.y / 0.2);
      float shadow = mix(0.92, 0.72 + 0.28 * smoothstep(0.0, 0.12, lap), resolve);
      diffuseColor.rgb *= shadow;
      owWallRelief += lap * 0.006 * resolve;
      owWallRoughness = 0.7;
    }
  } else if (trim) {
    // Physical cornices, pilasters, sills and roof equipment carry their
    // own vertex colour and must not inherit the facade's window grid.
    diffuseColor.rgb *= 0.92 + 0.1 * owNoise(q * 2.5 + style);
  } else if (roof && arch > 1.5) {
    // Flat city roofs: weathered membrane and concrete.
    diffuseColor.rgb *= 0.86 + 0.2 * owNoise(q * 0.6 + style * 9.0);
  } else if (roof && arch > 0.5) {
    // Kawara: J-tile columns at 305 mm, courses at 235 mm, each course
    // lapping the one below; the convex profile catches the sky.
    vec2 aa = max(fwidth(q), vec2(0.0001));
    float fade = 1.0 - smoothstep(0.18, 0.5, max(aa.x / 0.305, aa.y / 0.235));
    float column = q.x / 0.305, course = q.y / 0.235;
    float profile = sin(column * 6.2832);
    float lap = smoothstep(0.0, 0.2, fract(course));
    float tileVar = owHash(vec2(floor(column), floor(course)) + style * 7.0);
    float shade = (0.8 + 0.22 * profile) * (0.72 + 0.28 * lap) * (0.92 + 0.16 * tileVar);
    diffuseColor.rgb *= mix(0.87, shade, fade);
    diffuseColor.rgb *= 0.93 + 0.12 * owNoise(q * vec2(0.4, 0.9) + style * 4.0);
    owWallRelief = (profile * 0.016 + lap * 0.01) * fade;
    owWallRoughness = 0.58 + 0.14 * tileVar;
  } else if (roof) {
    vec2 tile = vec2(q.x * 2.0, q.y * 3.3);
    tile.x += mod(floor(tile.y), 2.0) * 0.5;
    vec2 f = fract(tile), aa = max(fwidth(tile), vec2(0.002));
    vec2 seam = smoothstep(vec2(0.025), vec2(0.025) + aa, min(f, 1.0 - f));
    diffuseColor.rgb *= (0.8 + 0.27 * owHash(floor(tile))) * (0.78 + 0.22 * seam.x * seam.y);
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
    // Divide the wide shop panes and room windows into real-looking glazing
    // bays. Keep the frames dark when the room lights switch on; otherwise a
    // three-metre shopfront becomes one broad luminous rectangle at night.
    vec2 pane = clamp((f - lo) / (hi - lo), 0.0, 1.0);
    vec2 paneAA = max(fwidth(f) / (hi - lo), vec2(0.001));
    float upright = shopfront > 0.5
      ? min(abs(pane.x - 0.33), abs(pane.x - 0.67))
      : abs(pane.x - 0.5);
    float transom = abs(pane.y - (shopfront > 0.5 ? 0.79 : 0.64));
    float frame = max(1.0 - smoothstep(0.012, 0.012 + paneAA.x, upright),
                      1.0 - smoothstep(0.013, 0.013 + paneAA.y, transom));
    diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.036, 0.044, 0.049), owGlass * frame);
    owGlass *= 1.0 - frame;
    float reveal = (1.0 - inside) * step(lo.x - 0.05, f.x) * step(f.x, hi.x + 0.05) * step(lo.y - 0.05, f.y) * step(f.y, hi.y + 0.05);
    diffuseColor.rgb *= 1.0 - 0.35 * reveal * underRoof;
    // About a third of the rooms are lit, each at its own brightness and
    // lamp colour (warm tungsten to cool fluorescent), dimmer deeper in.
    float room = owHash(id + vec2(style * 97.0, 3.0));
    owLit = step(0.64, room) * owGlass * (0.3 + 0.7 * owHash(id + vec2(5.0, style * 11.0)));
    owLamp = mix(vec3(1.0, 0.66, 0.36), vec3(0.86, 0.9, 1.0), step(0.85, owHash(id + vec2(17.0, style))));
    owLit *= 0.65 + 0.35 * smoothstep(0.0, 0.5, min(f.x - lo.x, hi.x - f.x) / (hi.x - lo.x));
    float ceiling = 1.0 - 0.42 * smoothstep(0.67, 1.0, pane.y);
    float furnishing = 1.0 - 0.52 * (1.0 - smoothstep(0.21, 0.37, pane.y))
      * (1.0 - smoothstep(0.09, 0.19, abs(pane.x - (0.25 + room * 0.43))));
    owLit *= ceiling * furnishing;
  }
  if (!(physicalPane && (arch > 0.5 && arch < 1.5 || arch > 2.5))) {
    // Unequal room depth, sill shadow and a few closed blinds make each bay
    // read as a recess instead of a flat repeated black rectangle. These are
    // authored facade cues; the material does not claim to ray trace rooms.
    float roomId = physicalPane ? vFacade.x : owHash(floor(q / vec2(3.3, 3.2)) + style * 43.0);
    vec2 roomUv = physicalPane ? q : fract(q / vec2(3.3, 3.2));
    float blind = step(0.77, roomId) * (0.65 + 0.35 * sin(q.y * 56.0)
      * (1.0 - smoothstep(0.6, 3.2, fwidth(q.y * 56.0))));
    float reflectionBand = pow(clamp(1.0 - abs(roomUv.y - 0.67) * 2.0, 0.0, 1.0), 3.0);
    vec3 glass = mix(vec3(0.032, 0.047, 0.052), vec3(0.075, 0.115, 0.13), reflectionBand);
    glass *= 0.68 + 0.45 * roomId;
    glass = mix(glass, vec3(0.17, 0.155, 0.125), blind * 0.72);
    diffuseColor.rgb = mix(diffuseColor.rgb, glass, owGlass);
    owLit *= 1.0 - blind * 0.72;
  }
  // Rain darkens porous plaster, timber and concrete (glass and lit faces
  // excepted); roughness drops below in the roughness stage.
  if (!physicalPane && !glowPanel) diffuseColor.rgb *= 1.0 - 0.16 * owWet;
  // Winter: snow lies on roofs, ridges, sills and slabs that face the sky.
  if (owSnowCover > 0.0 && !physicalPane && !glowPanel) {
    vec3 upView = normalize((viewMatrix * vec4(0.0, 1.0, 0.0, 0.0)).xyz);
    float facing = dot(normalize(vNormal), upView);
    float drift = owNoise(q * 1.3 + style * 5.0);
    owSnow = owSnowCover * smoothstep(0.3, 0.62, facing + (drift - 0.5) * 0.25);
    diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.8, 0.82, 0.85) * (0.94 + 0.06 * drift), owSnow);
  }
}`,
      )
      .replace(
        '#include <roughnessmap_fragment>',
        `#include <roughnessmap_fragment>
if (owWallRoughness >= 0.0) roughnessFactor = owWallRoughness;
roughnessFactor = mix(roughnessFactor, mix(0.1, 0.18, owNight), owGlass);
roughnessFactor = mix(roughnessFactor, 0.5, step(0.001, abs(owRib)));
roughnessFactor = mix(roughnessFactor, 0.75, owSnow);
roughnessFactor = mix(roughnessFactor, max(0.14, roughnessFactor * 0.42), owWet * (1.0 - owSnow));`,
      )
      .replace(
        '#include <normal_fragment_maps>',
        `#include <normal_fragment_maps>
if (owWallRoughness >= 0.0 && owSnow < 0.5) {
  // Surface-gradient bump in view space; stays correct on every rotated wall.
  vec3 sx = dFdx(-vViewPosition), sy = dFdy(-vViewPosition);
  vec3 r1 = cross(sy,normal), r2 = cross(normal,sx);
  float determinant = dot(sx,r1);
  if (abs(determinant) > 0.0000000001) {
    vec3 gradient = sign(determinant)*(dFdx(owWallRelief)*r1+dFdy(owWallRelief)*r2);
    normal = normalize(abs(determinant)*normal-gradient);
  }
}
if (abs(owRib) > 0.001) normal = normalize(normal + (viewMatrix * vec4(0.0, 0.0, 0.0, 0.0)).xyz + cross(normal, vec3(0.0, 1.0, 0.0)) * owRib * 0.12);`,
      )
      .replace(
        '#include <emissivemap_fragment>',
        `#include <emissivemap_fragment>
totalEmissiveRadiance += owLamp * (owLit * owNight * 0.32 + owGlow * (0.3 + owNight * 1.5));`,
      );
  };
  material.customProgramCacheKey = () => 'festival-facades-v8-japan-wet';
  return material;
}

/**
 * Procedural buildings from the region's structures. In the festival's
 * Japanese reading (japan-architecture.ts): village minka and machiya with
 * tiled irimoya/kirizuma roofs, deep eaves, cedar and plaster walls and
 * lattice fronts; city mid-rises with tile/concrete cladding, window bands,
 * balconies, AC units, roof tanks and stair towers; convenience stores; and
 * the landmark temple. Hangars, warehouses, the terminal, the control tower
 * and the lighthouse keep their own forms. One merged mesh per 512 m chunk;
 * every part shares the facade material through per-vertex style data, and
 * nothing changes a collision footprint or height.
 */
export class Buildings {
  readonly root = new T.Group();
  readonly night = { value: 0 };
  readonly wet = { value: 0 };
  readonly material: T.MeshStandardMaterial;
  readonly lantern: T.MeshStandardMaterial;
  readonly joinery: FacadeJoinery;
  private readonly openings: FacadePlacement[] = [];
  stats = { buildings: 0, triangles: 0, openings: 0 };
  constructor(
    structures: readonly Structure[],
    private readonly plan: ArchitecturePlan | null = null,
  ) {
    this.root.name = 'Festival buildings';
    this.material = facadeMaterial(this.night, this.wet);
    this.lantern = new T.MeshStandardMaterial({
      color: 0xfff6d8,
      emissive: 0xfff0c0,
      emissiveIntensity: 0.2,
      roughness: 0.2,
    });
    const chunks = new Map<string, Mesher>();
    const lanterns: T.Vector3[] = [];
    structures.forEach((s, i) => {
      const key = `${Math.floor(s.x / 512)},${Math.floor(s.z / 512)}`;
      let m = chunks.get(key);
      if (!m) chunks.set(key, (m = new Mesher()));
      this.add(m, s, i);
      if (s.kind === 'lighthouse') lanterns.push(new T.Vector3(s.x, s.base + s.height + 1.6, s.z));
    });
    for (const site of plan?.landmarks ?? []) {
      const key = `${Math.floor(site.x / 512)},${Math.floor(site.z / 512)}`;
      let m = chunks.get(key);
      if (!m) chunks.set(key, (m = new Mesher()));
      this.castle(m, site);
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
    this.joinery = new FacadeJoinery(this.openings);
    this.root.add(this.joinery.root);
    this.stats = { buildings: structures.length, triangles, openings: this.openings.length };
  }
  private add(m: Mesher, s: Structure, index: number) {
    const style = this.plan?.style[index] ?? 'legacy';
    const front = this.plan?.front[index] ?? 1;
    const kind = KIND_CODE[s.kind] + 16 * ARCH_CODE[style];
    const detail: Facade = [(s.style % 9973) / 9973, kind, -2, s.height];
    const f = new Frame(m, s.x, s.z, s.heading, detail);
    if (style === 'minka' || style === 'machiya') return this.traditional(f, s, kind, front, style);
    if (style === 'urban')
      return this.urban(f, s, kind, front, this.plan?.konbiniFloor.has(index) ?? false);
    if (style === 'konbini')
      return this.konbini(
        f,
        s,
        kind,
        front,
        this.plan?.chain.get(index),
        this.plan?.lotSide.get(index),
      );
    if (style === 'temple')
      return this.temple(f, s, kind, front, this.plan?.terrace.get(index) ?? s.base + s.height);
    this.legacy(m, s);
  }

  /** Walls of all four sides through the recessed-opening partition. */
  private walls(
    f: Frame,
    s: Structure,
    kind: number,
    variant: 'urban' | 'traditional',
    wall: number,
    options: Parameters<typeof addRecessedFacade>[9],
    top = s.base + s.height,
  ) {
    const layouts: (FacadeLayout | null)[] = [];
    const sides: [number, number, number, number, number, number][] = [
      [-s.hx, -s.hz, s.hx, -s.hz, 0, -1],
      [s.hx, -s.hz, s.hx, s.hz, 1, 0],
      [s.hx, s.hz, -s.hx, s.hz, 0, 1],
      [-s.hx, s.hz, -s.hx, -s.hz, -1, 0],
    ];
    const style = (s.style % 9973) / 9973;
    for (const [sideIndex, [x0, z0, x1, z1, nx, nz]] of sides.entries()) {
      const len = Math.hypot(x1 - x0, z1 - z0);
      const a = f.at(x0, s.base, z0),
        b = f.at(x1, s.base, z1);
      const layout = facadeLayout(s, len, sideIndex, variant);
      layouts.push(layout);
      const normal = f.dir(nx, 0, nz);
      if (layout) {
        addRecessedFacade(
          f.m,
          layout,
          b,
          [(a[0] - b[0]) / len, 0, (a[2] - b[2]) / len],
          normal,
          wall,
          style,
          kind,
          this.openings,
          options,
        );
        continue;
      }
      f.m.quad(
        [b, a, f.at(x0, top, z0), f.at(x1, top, z1)],
        normal,
        [
          [0, 0],
          [len, 0],
          [len, top - s.base],
          [0, top - s.base],
        ],
        options?.paint?.(0, top - s.base) ?? wall,
        [style, kind, -3, 0],
      );
    }
    return layouts;
  }

  /** Hip-and-gable, gable or hip roof with deep eaves, boxed soffits,
   * fascia, ridge and hip caps and onigawara ridge ends. */
  private roof(f: Frame, r: RoofSpec) {
    const o = r.eave,
      p = r.pitch,
      slope = Math.hypot(1, p),
      t = 0.16;
    const verge = r.form === 'kirizuma' ? (r.verge ?? 0.45) : o;
    const A = r.hx + verge,
      B = r.hz + o;
    const y0 = r.plate - o * p,
      yr = r.plate + r.hz * p;
    const lift = r.lift ?? 0.06;
    const tile = r.tile,
      rf = r.facade;
    const ridgeColor = 0x2c2f33;
    const soffitColor = r.soffit ? 0x6a4a32 : 0x4a3c30,
      soffitFacade = r.soffit ?? f.detail;
    let G = A - B / 2;
    let form = r.form;
    if (form === 'irimoya' && G < 0.6) form = 'yosemune';
    if (form === 'yosemune') G = Math.max(0, A - B);
    const zg = form === 'irimoya' ? B - (A - G) : 0;
    const ym = y0 + (form === 'irimoya' ? (A - G) * p : 0);
    const eaveY = (x: number) => y0 + lift * (Math.abs(x) / A) ** 4;
    for (const side of [-1, 1]) {
      const z = side * B,
        hint: V3 = [0, 1, side * p];
      const u = (x: number) => x + A;
      const v = (zz: number) => (B - Math.abs(zz)) * slope;
      if (form === 'kirizuma') {
        f.poly(
          [
            [-A, eaveY(-A), z],
            [A, eaveY(A), z],
            [A, yr, 0],
            [-A, yr, 0],
          ],
          hint,
          tile,
          rf,
          [
            [u(-A), 0],
            [u(A), 0],
            [u(A), v(0)],
            [u(-A), v(0)],
          ],
        );
      } else {
        const zm = side * zg;
        f.poly(
          [
            [-A, eaveY(-A), z],
            [A, eaveY(A), z],
            [G, ym, zm],
            [-G, ym, zm],
          ],
          hint,
          tile,
          rf,
          [
            [u(-A), 0],
            [u(A), 0],
            [u(G), v(zm)],
            [u(-G), v(zm)],
          ],
        );
        if (form === 'irimoya')
          f.poly(
            [
              [-G, ym, zm],
              [G, ym, zm],
              [G, yr, 0],
              [-G, yr, 0],
            ],
            hint,
            tile,
            rf,
            [
              [u(-G), v(zm)],
              [u(G), v(zm)],
              [u(G), v(0)],
              [u(-G), v(0)],
            ],
          );
        // Hip end (and its gable triangle above, for irimoya).
        const x = side * A;
        const ends: V3[] = [
          [x, eaveY(x), -B],
          [x, eaveY(x), B],
        ];
        if (form === 'irimoya') ends.push([side * G, ym, zg], [side * G, ym, -zg]);
        else ends.push([side * G, yr, 0]);
        f.poly(
          ends,
          [side, 1, 0],
          tile,
          rf,
          ends.map((q) => [q[2] + B, (A - Math.abs(q[0])) * slope] as const),
        );
        if (form === 'irimoya') {
          f.poly(
            [
              [side * G, ym, -zg],
              [side * G, ym, zg],
              [side * G, yr, 0],
            ],
            [side, 0, 0],
            r.gable,
            r.wallFacade,
          );
          // Gable-edge ridges (verge caps) and the hip ridges.
          for (const zs of [-1, 1])
            f.beam(
              [side * (G + 0.05), ym + 0.06, zs * zg],
              [side * (G + 0.05), yr + 0.06, 0],
              0.2,
              0.2,
              ridgeColor,
            );
        }
        for (const zs of [-1, 1])
          f.beam(
            [x, eaveY(x) + 0.08, zs * B],
            form === 'irimoya' ? [side * G, ym + 0.08, zs * zg] : [side * G, yr + 0.06, 0],
            0.22,
            0.2,
            ridgeColor,
          );
      }
      // Fascia board and the soffit back to the wall plate.
      const xa = A;
      f.poly(
        [
          [-xa, eaveY(-xa), z],
          [xa, eaveY(xa), z],
          [xa, eaveY(xa) - t, z],
          [-xa, eaveY(-xa) - t, z],
        ],
        [0, 0, side],
        TIMBER,
        f.detail,
      );
      f.poly(
        [
          [-xa, eaveY(-xa) - t, z],
          [xa, eaveY(xa) - t, z],
          [form === 'kirizuma' ? xa : r.hx, r.plate - t, side * r.hz],
          [form === 'kirizuma' ? -xa : -r.hx, r.plate - t, side * r.hz],
        ],
        [0, -1, 0],
        soffitColor,
        soffitFacade,
      );
    }
    if (form === 'kirizuma') {
      for (const side of [-1, 1]) {
        // Gable wall above the plate and the verge boards.
        f.poly(
          [
            [side * r.hx, r.plate, -r.hz],
            [side * r.hx, r.plate, r.hz],
            [side * r.hx, yr - 0.05, 0],
          ],
          [side, 0, 0],
          r.gable,
          r.wallFacade,
        );
        for (const zs of [-1, 1]) {
          f.beam([side * A, eaveY(A) - 0.04, zs * B], [side * A, yr, 0], 0.08, 0.3, TIMBER);
          f.poly(
            [
              [side * r.hx, eaveY(A) - t, zs * B],
              [side * A, eaveY(A) - t, zs * B],
              [side * A, yr - t, 0],
              [side * r.hx, yr - t, 0],
            ],
            [0, -1, 0],
            soffitColor,
            soffitFacade,
          );
        }
      }
    } else {
      for (const side of [-1, 1]) {
        const x = side * A;
        f.poly(
          [
            [x, eaveY(x), -B],
            [x, eaveY(x), B],
            [x, eaveY(x) - t, B],
            [x, eaveY(x) - t, -B],
          ],
          [side, 0, 0],
          TIMBER,
          f.detail,
        );
        f.poly(
          [
            [x, eaveY(x) - t, -B],
            [x, eaveY(x) - t, B],
            [side * r.hx, r.plate - t, r.hz],
            [side * r.hx, r.plate - t, -r.hz],
          ],
          [0, -1, 0],
          soffitColor,
          soffitFacade,
        );
      }
    }
    // Ridge (noshi stack) and onigawara end tiles.
    const rl = form === 'kirizuma' ? A + 0.05 : G + 0.12;
    if (rl > 0.2) {
      f.box(0, yr + 0.16, 0, rl * 2, 0.34, 0.36, ridgeColor);
      for (const side of [-1, 1]) f.box(side * rl, yr + 0.28, 0, 0.22, 0.62, 0.46, ridgeColor);
    } else f.box(0, yr + 0.3, 0, 0.5, 0.6, 0.5, ridgeColor);
    // Half-round gutters along the long eaves of houses (not swept eaves).
    if (lift <= 0.12)
      for (const side of [-1, 1])
        f.box(0, y0 + lift - 0.16, side * (B + 0.06), A * 2 - 0.3, 0.12, 0.13, 0x8d8c86);
  }

  /** A mono-pitch tiled pent roof (hisashi) along one face. */
  private pent(
    f: Frame,
    width: number,
    y: number,
    face: number,
    hz: number,
    depth: number,
    tile: number,
    rf: Facade,
    x = 0,
  ) {
    const z0 = face * hz,
      z1 = face * (hz + depth),
      rise = depth * 0.42;
    f.poly(
      [
        [x - width / 2, y + rise, z0],
        [x + width / 2, y + rise, z0],
        [x + width / 2, y, z1],
        [x - width / 2, y, z1],
      ],
      [0, 1, face * 0.4],
      tile,
      rf,
      [
        [0, depth * 1.09],
        [width, depth * 1.09],
        [width, 0],
        [0, 0],
      ],
    );
    f.poly(
      [
        [x - width / 2, y - 0.12, z1],
        [x + width / 2, y - 0.12, z1],
        [x + width / 2, y + rise - 0.14, z0],
        [x - width / 2, y + rise - 0.14, z0],
      ],
      [0, -1, 0],
      0x4a3c30,
      f.detail,
    );
    f.box(x, y - 0.06, face * (hz + depth), width, 0.14, 0.05, TIMBER);
    for (const side of [-1, 1])
      f.poly(
        [
          [x + (side * width) / 2, y + rise, z0],
          [x + (side * width) / 2, y, z1],
          [x + (side * width) / 2, y - 0.12, z1],
          [x + (side * width) / 2, y + rise - 0.14, z0],
        ],
        [side, 0, 0],
        TIMBER,
        f.detail,
      );
  }

  /** Village houses: minka (one storey) and machiya (two or three). */
  private traditional(
    f: Frame,
    s: Structure,
    kind: number,
    front: number,
    style: 'minka' | 'machiya',
  ) {
    const pick = <V>(list: readonly V[], salt: number) => list[(s.style >>> salt) % list.length];
    const top = s.base + s.height,
      floors = Math.max(1, Math.floor(s.floors)),
      floorH = (s.height - 0.6) / floors;
    const darkHouse = style === 'minka' && (s.style & 7) < 3;
    const timber = pick(WALL_FINISH.timber, 3),
      plaster = pick(PLASTER, 5);
    const tile = pick(KAWARA, 9);
    const styleN = (s.style % 9973) / 9973;
    const rf: Facade = [styleN, kind, -1, s.height];
    const wf: Facade = [styleN, kind, -3, 0];
    // Ground floor cedar boards; plaster (or cedar) above the first floor.
    const paint = (v0: number) =>
      style === 'machiya'
        ? v0 < floorH - 0.01
          ? timber
          : (s.style & 1) === 0
            ? plaster
            : timber
        : darkHouse
          ? timber
          : v0 < 0.95
            ? timber
            : plaster;
    const layouts = this.walls(f, s, kind, 'traditional', timber, {
      paint,
      metric: true,
      joinery: false,
    });
    // Granite/concrete base course and exposed posts and beams.
    f.box(0, s.base + 0.25, 0, s.hx * 2 + 0.1, 0.5, s.hz * 2 + 0.1, 0x8f8b84);
    const post = 0x30261f;
    for (const [sideIndex, layout] of layouts.entries()) {
      if (!layout || sideIndex % 2) continue;
      const face = sideIndex === 0 ? -1 : 1;
      const len = s.hx * 2;
      const edges = new Set<number>();
      for (const o of layout.openings) edges.add(Math.round(o.cell0 * 100) / 100);
      edges.add(0);
      edges.add(Math.round(len * 100) / 100);
      for (const e of edges) {
        const x = face < 0 ? s.hx - e : -s.hx + e;
        f.box(x, s.base + s.height / 2, face * (s.hz + 0.04), 0.16, s.height, 0.1, post);
      }
    }
    for (let floor = 1; floor <= floors; floor++) {
      const y = s.base + (floor === floors ? s.height : floor * floorH) - 0.1;
      for (const side of [-1, 1]) {
        f.box(0, y, side * (s.hz + 0.05), s.hx * 2 + 0.14, 0.2, 0.1, post);
        f.box(side * (s.hx + 0.05), y, 0, 0.1, 0.2, s.hz * 2, post);
      }
    }
    for (const sx of [-1, 1])
      for (const sz of [-1, 1])
        f.box(
          sx * (s.hx + 0.02),
          s.base + s.height / 2,
          sz * (s.hz + 0.02),
          0.2,
          s.height,
          0.2,
          post,
        );
    if (style === 'machiya') {
      // Tiled pent roof over the shopfront; a gable roof parallel to the
      // street (hirairi) on wide lots, gable-to-street (tsumairi) on deep
      // ones, shallower than a farmhouse.
      this.pent(f, s.hx * 2 + 0.3, s.base + floorH + 0.18, front, s.hz, 0.85, tile, rf);
      if (floors > 2)
        this.pent(f, s.hx * 2 + 0.3, s.base + 2 * floorH + 0.18, front, s.hz, 0.6, tile, rf);
      const along = s.hx >= s.hz * 0.85;
      this.roof(along ? f : this.turned(f), {
        hx: along ? s.hx : s.hz,
        hz: along ? s.hz : s.hx,
        plate: top,
        pitch: 0.45,
        eave: 0.75,
        verge: 0.45,
        form: 'kirizuma',
        tile,
        gable: plaster,
        facade: rf,
        wallFacade: wf,
      });
    } else {
      // Entrance canopy over the front sliding doors.
      this.pent(f, Math.min(4.2, s.hx * 1.2), s.base + 2.75, front, s.hz, 0.9, tile, rf);
      const along = s.hx >= s.hz;
      const roofFrame = along ? f : this.turned(f);
      this.roof(roofFrame, {
        hx: along ? s.hx : s.hz,
        hz: along ? s.hz : s.hx,
        plate: top,
        pitch: 0.5,
        eave: 0.95,
        form: s.kind === 'farm' || (s.style & 3) !== 0 ? 'irimoya' : 'yosemune',
        tile,
        gable: (s.style & 8) === 0 ? plaster : timber,
        lift: 0.1,
        facade: rf,
        wallFacade: wf,
      });
    }
    // An outdoor AC unit and a meter box on a side wall: modern village life.
    const side = (s.style & 16) === 0 ? 1 : -1;
    f.box(side * (s.hx + 0.2), s.base + 0.65, -front * (s.hz - 1.2), 0.3, 0.55, 0.8, 0xd9d9d3);
    f.box(side * (s.hx + 0.36), s.base + 0.65, -front * (s.hz - 1.2), 0.02, 0.4, 0.4, 0x3d4143);
  }

  /** City mid-rises and shop buildings. */
  private urban(f: Frame, s: Structure, kind: number, front: number, konbini: boolean) {
    const pick = <V>(list: readonly V[], salt: number) => list[(s.style >>> salt) % list.length];
    const wall = pick(URBAN, 7);
    const top = s.base + s.height,
      floors = Math.max(1, Math.floor(s.floors)),
      floorH = (s.height - 0.6) / floors;
    const styleN = (s.style % 9973) / 9973;
    const store = kind - 16 * ARCH_CODE.urban + 16 * ARCH_CODE.konbini;
    const layouts = this.walls(f, s, kind, 'urban', wall, {
      pane: (hole) => (konbini && hole.kind === 'shop' && hole.row0 === 0 ? store : kind),
    });
    const coping = 0xc4c6c4;
    // A plinth course of dark tile.
    f.box(0, s.base + 0.3, 0, s.hx * 2 + 0.04, 0.6, s.hz * 2 + 0.04, 0x55534f);
    const banded = (s.style & 6) === 2;
    const apartment = isApartment(s);
    if (banded)
      for (let floor = 1; floor < floors; floor++) {
        const y = s.base + floor * floorH;
        for (const side of [-1, 1]) {
          f.box(0, y, side * (s.hz + 0.04), s.hx * 2 + 0.08, 0.22, 0.08, 0xb4b1a9);
          f.box(side * (s.hx + 0.04), y, 0, 0.08, 0.22, s.hz * 2, 0xb4b1a9);
        }
      }
    // Balconies or open corridors with solid parapets (ref 089), from the
    // first floor up, projecting 0.9 m inside the 1.2 m town setback.
    if (apartment)
      for (let floor = 1; floor < floors; floor++) {
        const y = s.base + floor * floorH;
        const z = front * (s.hz + 0.45);
        const parapet = (s.style & 64) === 0 ? 0xe2e0d8 : 0x9aa7a8;
        f.box(0, y + 0.02, z, s.hx * 2 - 0.3, 0.18, 0.9, 0xc9c6bd, f.detail, true);
        f.box(0, y + 0.62, front * (s.hz + 0.86), s.hx * 2 - 0.3, 1.0, 0.08, parapet);
        f.box(0, y + 1.14, front * (s.hz + 0.86), s.hx * 2 - 0.26, 0.05, 0.1, 0x6e7272);
        for (const sx of [-1, 1]) f.box(sx * (s.hx - 0.19), y + 0.62, z, 0.08, 1.0, 0.9, parapet);
        // Unit partitions and an AC unit per unit on the slab.
        const units = Math.max(1, Math.round((s.hx * 2) / 6));
        for (let k = 0; k < units; k++) {
          const x = -s.hx + ((k + 0.5) * s.hx * 2) / units;
          if (k > 0) f.box(-s.hx + (k * s.hx * 2) / units, y + 1.2, z, 0.06, 2.0, 0.86, 0xd6d4cc);
          this.acUnit(f, x + 0.9, y + 0.4, front * (s.hz + 0.35), front);
        }
      }
    // Wall-hung AC units on the piers between window bands and on the side
    // walls (u runs from each wall's end back toward its start, as in
    // addRecessedFacade); one downpipe per corner of the street face.
    const faces = [
      [0, -1],
      [1, 0],
      [0, 1],
      [-1, 0],
    ] as const;
    for (const [sideIndex, layout] of layouts.entries()) {
      if (!layout) continue;
      const [fx, fz] = faces[sideIndex];
      if (apartment && fz === front) continue;
      const len = sideIndex % 2 ? s.hz * 2 : s.hx * 2;
      for (const o of layout.openings) {
        if (o.row0 === 0 || o.cell1 > len - 0.5) continue;
        const h = hashOf(s.style, Math.round(o.cell1 * 10), Math.round(o.row0 * 10) + sideIndex);
        if (h % 5 !== 0) continue;
        const u = o.cell1;
        const lx = fx !== 0 ? fx * (s.hx + 0.17) : fz < 0 ? s.hx - u : -s.hx + u;
        const lz = fz !== 0 ? fz * (s.hz + 0.17) : fx > 0 ? s.hz - u : -s.hz + u;
        this.acUnit(f, lx, s.base + o.row0 + 0.3, lz, fz, fx);
      }
    }
    for (const sx of [-1, 1])
      f.box(
        sx * (s.hx - 0.12),
        s.base + s.height / 2,
        front * (s.hz + 0.07),
        0.1,
        s.height,
        0.1,
        0x6c6d68,
      );
    // Roof: flat membrane, a stair tower, an elevated water tank and plant.
    f.poly(
      [
        [-s.hx, top, -s.hz],
        [s.hx, top, -s.hz],
        [s.hx, top, s.hz],
        [-s.hx, top, s.hz],
      ],
      [0, 1, 0],
      0x77746e,
      [styleN, kind, -1, s.height],
    );
    // Parapets with an aluminium coping.
    for (const side of [-1, 1]) {
      f.box(0, top + 0.45, side * (s.hz - 0.1), s.hx * 2, 0.9, 0.2, wall);
      f.box(side * (s.hx - 0.1), top + 0.45, 0, 0.2, 0.9, s.hz * 2 - 0.4, wall);
      f.box(0, top + 0.93, side * (s.hz - 0.1), s.hx * 2 + 0.06, 0.06, 0.28, coping);
      f.box(side * (s.hx - 0.1), top + 0.93, 0, 0.28, 0.06, s.hz * 2 - 0.2, coping);
    }
    const rear = -front;
    if (s.kind === 'block') {
      const sx = (s.style & 128) === 0 ? 1 : -1;
      const px = sx * (s.hx - 2.0),
        pz = rear * (s.hz - 1.9);
      f.box(px, top + 1.5, pz, 3.2, 3.0, 2.8, wall);
      f.box(px, top + 3.05, pz, 3.5, 0.12, 3.1, coping);
      if ((s.style & 256) === 0) {
        // FRP panel tank on a steel stand.
        const tx = -sx * Math.min(s.hx - 2.2, 4),
          tz = rear * (s.hz - 2.2);
        for (const lx of [-0.9, 0.9])
          for (const lz of [-0.7, 0.7]) f.box(tx + lx, top + 0.7, tz + lz, 0.1, 1.4, 0.1, 0x5d6466);
        f.box(tx, top + 1.42, tz, 2.1, 0.08, 1.7, 0x5d6466);
        f.box(tx, top + 2.36, tz, 2.0, 1.8, 1.6, 0xbcc6c4);
      }
    }
    for (let k = 0; k < 2 + ((s.style >>> 9) & 1); k++)
      this.acUnit(f, -s.hx + 1.6 + k * 1.0, top + 0.3, rear * (s.hz - 1.2), rear);
    // Antenna mast.
    if ((s.style & 512) !== 0)
      f.beam(
        [s.hx - 1.2, top, front * (s.hz - 1.2)],
        [s.hx - 1.2, top + 3.4, front * (s.hz - 1.2)],
        0.06,
        0.06,
        0x8b8f8f,
      );
  }

  /** 0.8 x 0.55 x 0.29 m outdoor AC condenser with a dark fan grille,
   * facing local +z*facing (or +x*side on end walls). */
  private acUnit(f: Frame, x: number, y: number, z: number, facing: number, side = 0) {
    if (side !== 0) {
      f.box(x, y + 0.275, z, 0.29, 0.55, 0.8, 0xd8d9d3);
      f.box(x + side * 0.15, y + 0.29, z - 0.1, 0.02, 0.4, 0.4, 0x3a3e40);
      return;
    }
    f.box(x, y + 0.275, z, 0.8, 0.55, 0.29, 0xd8d9d3);
    f.box(x - 0.1, y + 0.29, z + facing * 0.15, 0.4, 0.4, 0.02, 0x3a3e40);
  }

  /** Stand-alone convenience store: glazed front, backlit fascia with an
   * original two-stripe palette, brick and formed-concrete side walls. */
  private konbini(f: Frame, s: Structure, kind: number, front: number, chain = 0, lot = 1) {
    const H = 4.6,
      P = 5.3,
      styleN = (s.style % 9973) / 9973;
    const base = s.base;
    const wf = (color: number): Facade => [styleN, kind, -3, color === 0x8c4f3a ? 1 : 5];
    const wallQuad = (
      x0: number,
      z0: number,
      x1: number,
      z1: number,
      y0: number,
      y1: number,
      color: number,
    ) =>
      f.poly(
        [
          [x0, y0, z0],
          [x1, y0, z1],
          [x1, y1, z1],
          [x0, y1, z0],
        ],
        [z1 - z0 === 0 ? 0 : x0 < 0 && x1 < 0 ? -1 : 1, 0, z1 - z0 === 0 ? (z0 < 0 ? -1 : 1) : 0],
        color,
        wf(color),
        [
          [0, y0 - base],
          [Math.hypot(x1 - x0, z1 - z0), y0 - base],
          [Math.hypot(x1 - x0, z1 - z0), y1 - base],
          [0, y1 - base],
        ],
      );
    const fz = front * s.hz,
      bz = -front * s.hz;
    const brickSide = lot;
    // Side and back walls.
    wallQuad(brickSide * s.hx, -s.hz, brickSide * s.hx, s.hz, base, base + H, 0x8c4f3a);
    wallQuad(-brickSide * s.hx, -s.hz, -brickSide * s.hx, s.hz, base, base + H, 0xbab7ae);
    wallQuad(-s.hx, bz, s.hx, bz, base, base + H, 0xbab7ae);
    // Front: wall piers at both ends, glazing modules of ~1.8 m between.
    const glassX0 = -s.hx + 1.1,
      glassX1 = s.hx - 1.1;
    wallQuad(-s.hx, fz, glassX0, fz, base, base + H, 0xd9d6cf);
    wallQuad(glassX1, fz, s.hx, fz, base, base + H, 0xd9d6cf);
    wallQuad(glassX0, fz, glassX1, fz, base + 2.95, base + H, 0xd9d6cf);
    wallQuad(glassX0, fz, glassX1, fz, base, base + 0.35, 0x8d8a84);
    const modules = Math.max(2, Math.round((glassX1 - glassX0) / 1.8));
    const mw = (glassX1 - glassX0) / modules;
    const store = kind;
    for (let k = 0; k < modules; k++) {
      const x0 = glassX0 + k * mw,
        x1 = x0 + mw;
      const room = ((s.style >>> k) & 15) / 15;
      f.poly(
        [
          [x0, base + 0.35, fz],
          [x1, base + 0.35, fz],
          [x1, base + 2.95, fz],
          [x0, base + 2.95, fz],
        ],
        [0, 0, front],
        0xffffff,
        [room, store, -4, 1],
        front > 0
          ? [
              [0, 0],
              [1, 0],
              [1, 1],
              [0, 1],
            ]
          : [
              [1, 0],
              [0, 0],
              [0, 1],
              [1, 1],
            ],
      );
      f.box(x0, base + 1.65, fz + front * 0.03, 0.07, 2.6, 0.08, ALUMINIUM);
    }
    f.box(glassX1, base + 1.65, fz + front * 0.03, 0.07, 2.6, 0.08, ALUMINIUM);
    // Backlit fascia canopy (0.95 m) and the two chain stripes.
    const palette = chain === 0 ? [0x5b3aa8, 0x8fcf3a] : [0x1f3b7a, 0xf2a019];
    const glow = (w: number): Facade => [styleN, kind, -6, w];
    const fy = base + 3.5;
    f.box(0, fy, fz + front * 0.35, s.hx * 2 + 0.1, 0.95, 0.7, 0xf4f4f0, glow(0.5), true);
    f.box(0, fy + 0.18, fz + front * 0.71, s.hx * 2 + 0.06, 0.2, 0.03, palette[0], glow(0.75));
    f.box(0, fy - 0.06, fz + front * 0.71, s.hx * 2 + 0.06, 0.1, 0.03, palette[1], glow(0.75));
    f.box(0, fy - 0.2, fz + front * 0.71, s.hx * 2 + 0.06, 0.05, 0.03, palette[0], glow(0.75));
    // Parapet panels with seams, a coping and the roof.
    for (const side of [-1, 1]) {
      f.box(0, base + (H + P) / 2, side * (s.hz - 0.08), s.hx * 2, P - H, 0.16, 0xc9c8c2);
      f.box(side * (s.hx - 0.08), base + (H + P) / 2, 0, 0.16, P - H, s.hz * 2, 0xc9c8c2);
    }
    for (let x = -s.hx + 1.2; x < s.hx; x += 1.2)
      f.box(x, base + (H + P) / 2, fz + front * 0.01, 0.03, P - H, 0.02, 0x8e8f8b);
    f.box(0, base + P + 0.03, 0, s.hx * 2 + 0.08, 0.06, s.hz * 2 + 0.08, 0xa9aaa6);
    f.poly(
      [
        [-s.hx, base + H, -s.hz],
        [s.hx, base + H, -s.hz],
        [s.hx, base + H, s.hz],
        [-s.hx, base + H, s.hz],
      ],
      [0, 1, 0],
      0x7a7871,
      [styleN, kind, -1, s.height],
    );
    for (let k = 0; k < 3; k++) this.acUnit(f, -s.hx + 2 + k * 1.1, base + H, bz * 0.6, -front);
    // Wall lamp and a delivery door on the brick side.
    f.box(brickSide * (s.hx + 0.02), base + 1.05, -front * (s.hz - 2.4), 0.04, 2.1, 1.0, 0x6f7376);
  }

  /** The landmark chapel as a hillside temple: a battered ishigaki terrace
   * filling the collision box and rising to the surrounding grade, a main
   * hall (hondo) with a sweeping irimoya roof and a five-storey pagoda
   * whose eave soffits glow at dusk (refs 011, 026, 027). */
  private temple(f: Frame, s: Structure, kind: number, front: number, terrace: number) {
    const styleN = (s.style % 9973) / 9973;
    const rf: Facade = [styleN, kind, -1, s.height];
    const wf: Facade = [styleN, kind, -3, 0];
    const top = Math.max(s.base + s.height, terrace + 0.3);
    const stone: Facade = [styleN, kind, -3, 2];
    const batter = Math.min(2.5, (top - s.base) * 0.12);
    for (const side of [-1, 1]) {
      f.poly(
        [
          [-s.hx - batter, s.base, side * (s.hz + batter)],
          [s.hx + batter, s.base, side * (s.hz + batter)],
          [s.hx, top, side * s.hz],
          [-s.hx, top, side * s.hz],
        ],
        [0, 0.12, side],
        0x8f8a80,
        stone,
      );
      f.poly(
        [
          [side * (s.hx + batter), s.base, -s.hz - batter],
          [side * (s.hx + batter), s.base, s.hz + batter],
          [side * s.hx, top, s.hz],
          [side * s.hx, top, -s.hz],
        ],
        [side, 0.12, 0],
        0x8f8a80,
        stone,
      );
    }
    f.poly(
      [
        [-s.hx, top, -s.hz],
        [s.hx, top, -s.hz],
        [s.hx, top, s.hz],
        [-s.hx, top, s.hz],
      ],
      [0, 1, 0],
      0xb8b1a2,
      f.detail,
    );
    // Low plastered compound wall with a tiled cap round the terrace edge.
    const ochre = 0xd2b07a;
    for (const side of [-1, 1]) {
      f.box(0, top + 0.6, side * (s.hz - 0.2), s.hx * 2 - 0.2, 1.2, 0.3, ochre, wf);
      f.box(0, top + 1.28, side * (s.hz - 0.2), s.hx * 2, 0.16, 0.6, 0x3c4045, rf);
      f.box(side * (s.hx - 0.2), top + 0.6, 0, 0.3, 1.2, s.hz * 2 - 0.2, ochre, wf);
      f.box(side * (s.hx - 0.2), top + 1.28, 0, 0.6, 0.16, s.hz * 2, 0x3c4045, rf);
    }
    // Main hall on the half facing the road, raised on a stone plinth.
    const hx = 4.6,
      hz = 3.0,
      cx = (s.hx - hx - 1.2) * (front >= 0 ? 1 : -1);
    const heading = Math.atan2(f.n, f.c);
    const hall = new Frame(f.m, ...this.offset(f, cx, 0), heading, f.detail);
    const floorY = top + 0.7;
    hall.box(0, top + 0.35, 0, hx * 2 + 1.0, 0.7, hz * 2 + 1.0, 0x8a8478);
    const timber = 0x5c2f20,
      plaster = 0xe8e3d6;
    for (const side of [-1, 1]) {
      hall.poly(
        [
          [-hx, floorY, side * hz],
          [hx, floorY, side * hz],
          [hx, floorY + 4.0, side * hz],
          [-hx, floorY + 4.0, side * hz],
        ],
        [0, 0, side],
        plaster,
        wf,
      );
      hall.poly(
        [
          [side * hx, floorY, -hz],
          [side * hx, floorY, hz],
          [side * hx, floorY + 4.0, hz],
          [side * hx, floorY + 4.0, -hz],
        ],
        [side, 0, 0],
        plaster,
        wf,
      );
      for (let k = 0; k <= 4; k++)
        hall.box(-hx + (k * hx * 2) / 4, floorY + 2.0, side * (hz + 0.05), 0.3, 4.0, 0.3, timber);
      for (let k = 1; k < 3; k++)
        hall.box(side * (hx + 0.05), floorY + 2.0, -hz + (k * hz * 2) / 3, 0.3, 4.0, 0.3, timber);
      hall.box(0, floorY + 3.75, side * (hz + 0.08), hx * 2 + 0.4, 0.32, 0.18, timber);
      hall.box(0, floorY + 1.0, side * (hz + 0.1), hx * 2 + 0.2, 0.14, 0.12, timber);
      // Lattice doors in every bay and a veranda floor.
      for (let k = 0; k < 4; k++)
        hall.box(
          -hx + ((k + 0.5) * hx * 2) / 4,
          floorY + 1.7,
          side * (hz + 0.03),
          1.75,
          2.3,
          0.04,
          0x2d211a,
        );
    }
    for (let k = 0; k <= 10; k++)
      for (const side of [-1, 1])
        hall.box(
          -hx + (k * hx * 2) / 10,
          floorY + 4.25,
          side * (hz + 0.4),
          0.22,
          0.3,
          0.8,
          0x7a3a24,
        );
    this.roof(hall, {
      hx: hx + 0.25,
      hz: hz + 0.25,
      plate: floorY + 4.5,
      pitch: 0.6,
      eave: 2.1,
      form: 'irimoya',
      tile: 0x3c4045,
      gable: plaster,
      lift: 0.55,
      facade: rf,
      wallFacade: wf,
      soffit: [styleN, kind, -6, -0.12],
    });
    // Five-storey pagoda on the other half (ref 011): storeys from 2.6 m
    // to 2.1 m, bodies from 4.4 m to 2.8 m wide, eaves 1.35 m, sorin spire.
    const px = -(s.hx - 3.3) * (front >= 0 ? 1 : -1);
    const pagoda = new Frame(f.m, ...this.offset(f, px, 0), heading, f.detail);
    let y = top;
    pagoda.box(0, y + 0.4, 0, 5.4, 0.8, 5.4, 0x8a8478);
    y += 0.8;
    for (let k = 0; k < 5; k++) {
      const half = 2.2 - k * 0.2,
        storey = k === 0 ? 2.8 : 2.2;
      pagoda.box(0, y + storey / 2, 0, half * 2, storey, half * 2, timber, wf);
      for (const side of [-1, 1]) {
        pagoda.box(
          0,
          y + storey * 0.5,
          side * (half + 0.02),
          half * 0.9,
          storey * 0.6,
          0.04,
          0x2d211a,
        );
        pagoda.box(
          side * (half + 0.02),
          y + storey * 0.5,
          0,
          0.04,
          storey * 0.6,
          half * 0.9,
          0x2d211a,
        );
      }
      // Bracket course under each roof.
      pagoda.box(0, y + storey - 0.12, 0, half * 2 + 0.8, 0.26, half * 2 + 0.8, 0x8a4a24);
      this.roof(pagoda, {
        hx: half + 0.4,
        hz: half + 0.4,
        plate: y + storey + 0.05,
        pitch: 0.34,
        eave: 1.35,
        form: 'yosemune',
        tile: 0x34383c,
        gable: plaster,
        lift: 0.4,
        facade: rf,
        wallFacade: wf,
        soffit: [styleN, kind, -6, -0.22],
      });
      y += storey + 0.5;
    }
    pagoda.box(0, y + 0.25, 0, 0.9, 0.5, 0.9, 0x34383c);
    pagoda.beam([0, y, 0], [0, y + 7.0, 0], 0.16, 0.16, 0x6d6a4c);
    for (let k = 0; k < 9; k++)
      pagoda.box(0, y + 1.4 + k * 0.48, 0, 0.66 - k * 0.02, 0.09, 0.66 - k * 0.02, 0x7a734f);
    pagoda.box(0, y + 6.2, 0, 0.42, 0.42, 0.42, 0x7a734f);
    // Stone lanterns (toro) flanking the hall approach.
    for (const sz of [-1, 1]) {
      const lantern = new Frame(
        f.m,
        ...this.offset(f, cx - hx - 0.4, sz * (hz + 0.2)),
        heading,
        f.detail,
      );
      lantern.box(0, top + 0.25, 0, 0.6, 0.5, 0.6, 0x8d8a82);
      lantern.box(0, top + 0.9, 0, 0.22, 0.8, 0.22, 0x8d8a82);
      lantern.box(0, top + 1.45, 0, 0.5, 0.3, 0.5, 0xe8c27a, [styleN, kind, -6, -0.4]);
      lantern.box(0, top + 1.72, 0, 0.75, 0.22, 0.75, 0x7f7b74);
    }
  }

  /** Three-tier castle keep (tenshu) on a battered ishigaki base, white
   * plaster walls with black-framed windows, copper-grey irimoya roofs with
   * a front chidori gable per tier and ridge ornaments (ref 033). Visual
   * only: the site is an open hilltop >= 90 m from every road. */
  private castle(m: Mesher, site: VisualLandmark) {
    const styleN = 0.37;
    const kind = KIND_CODE.chapel + 16 * ARCH_CODE.temple;
    const rf: Facade = [styleN, kind, -1, 20];
    const wf: Facade = [styleN, kind, -3, 0];
    const f = new Frame(m, site.x, site.z, site.heading, [styleN, kind, -2, 20]);
    const stone = [styleN, kind, -3, 2] as const;
    const y0 = site.y,
      top = y0 + 7.6;
    const base = (hx: number, hz: number, batter: number) => {
      for (const side of [-1, 1]) {
        f.poly(
          [
            [-hx - batter, y0, side * (hz + batter)],
            [hx + batter, y0, side * (hz + batter)],
            [hx, top, side * hz],
            [-hx, top, side * hz],
          ],
          [0, 0.15, side],
          0x8b867c,
          stone,
        );
        f.poly(
          [
            [side * (hx + batter), y0, -hz - batter],
            [side * (hx + batter), y0, hz + batter],
            [side * hx, top, hz],
            [side * hx, top, -hz],
          ],
          [side, 0.15, 0],
          0x8b867c,
          stone,
        );
      }
      f.poly(
        [
          [-hx, top, -hz],
          [hx, top, -hz],
          [hx, top, hz],
          [-hx, top, hz],
        ],
        [0, 1, 0],
        0x9b968a,
        f.detail,
      );
    };
    base(8.2, 7, 2.2);
    const copper = 0x48524f,
      white = 0xe9e7e0;
    const tiers = [
      [6.2, 5.1, 4.4],
      [4.7, 3.9, 3.7],
      [3.5, 2.9, 3.4],
    ];
    let y = top;
    tiers.forEach(([hx, hz, h], k) => {
      for (const side of [-1, 1]) {
        f.poly(
          [
            [-hx, y, side * hz],
            [hx, y, side * hz],
            [hx, y + h, side * hz],
            [-hx, y + h, side * hz],
          ],
          [0, 0, side],
          white,
          wf,
        );
        f.poly(
          [
            [side * hx, y, -hz],
            [side * hx, y, hz],
            [side * hx, y + h, hz],
            [side * hx, y + h, -hz],
          ],
          [side, 0, 0],
          white,
          wf,
        );
        // Black-framed windows (renji mado) and a dark wainscot band.
        const count = Math.max(2, Math.round(hx / 1.6));
        for (let w = 0; w < count; w++) {
          const x = -hx + ((w + 0.5) * hx * 2) / count;
          f.box(x, y + h * 0.55, side * (hz + 0.04), 0.95, 1.05, 0.08, 0x1c1d1e);
        }
        f.box(0, y + 0.45, side * (hz + 0.03), hx * 2, 0.9, 0.06, 0x2a2a2a);
      }
      const last = k === tiers.length - 1;
      this.roof(f, {
        hx,
        hz,
        plate: y + h,
        pitch: 0.55,
        eave: last ? 1.4 : 1.6,
        form: 'irimoya',
        tile: copper,
        gable: white,
        lift: 0.35,
        facade: rf,
        wallFacade: wf,
      });
      if (!last) {
        // Chidori gable dormer on the front slope.
        const zf = hz + 1.0,
          gy = y + h + 0.6;
        f.poly(
          [
            [-1.8, gy, zf],
            [1.8, gy, zf],
            [0, gy + 1.7, zf],
          ],
          [0, 0, 1],
          white,
          wf,
        );
        for (const sx of [-1, 1])
          f.poly(
            [
              [sx * 2.2, gy - 0.1, zf + 0.3],
              [0, gy + 1.95, zf + 0.3],
              [0, gy + 1.6, hz - 0.6],
              [sx * 1.6, gy - 0.4, hz - 0.2],
            ],
            [sx, 1, 0.3],
            copper,
            rf,
          );
      }
      y += h + (last ? 0 : 0.9);
    });
    // Shachihoko on the top ridge ends.
    const ridgeY = y + tiers[2][1] * 0.55;
    for (const sx of [-1, 1])
      f.box(
        sx * (tiers[2][0] + 1.4 - (tiers[2][1] + 1.4) / 2 + 0.1),
        ridgeY + 0.75,
        0,
        0.3,
        0.9,
        0.3,
        0xb39a52,
      );
  }

  /** The same origin with local x and z exchanged (ridge across the lot). */
  private turned(f: Frame) {
    return new Frame(f.m, f.x, f.z, Math.atan2(f.n, f.c) + Math.PI / 2, f.detail);
  }

  private offset(f: Frame, x: number, z: number): [number, number] {
    const p = f.at(x, 0, z);
    return [p[0], p[2]];
  }

  /** The original European/industrial forms for sheds, terminal, tower
   * and lighthouse. */
  private legacy(m: Mesher, s: Structure) {
    const c = Math.cos(s.heading),
      n = Math.sin(s.heading),
      base = s.base,
      top = s.base + s.height,
      kind = KIND_CODE[s.kind],
      style = (s.style % 9973) / 9973;
    const local = (x: number, y: number, z: number) =>
      [s.x + c * x - n * z, y, s.z + n * x + c * z] as const;
    const pick = (list: number[], salt: number) => list[(s.style >>> salt) % list.length];
    const metal = s.kind === 'hangar' || s.kind === 'warehouse';
    const wall = metal
      ? pick(METAL, 3)
      : s.kind === 'block'
        ? pick([0x9a9690, 0xb9b2a3, 0x8c4f3a, 0xcfc8b8], 5)
        : pick(WALLS, 7);
    const roof = metal ? 0x5d6266 : pick(ROOFS, 11);
    const facade = [style, kind, s.floors, s.height] as const;
    const roofFacade = [style, kind, -1, s.height] as const;
    const detailFacade = [style, kind, -2, s.height] as const;
    const f = new Frame(m, s.x, s.z, s.heading, detailFacade);
    const box = (x: number, y: number, z: number, w: number, h: number, d: number, color: number) =>
      f.box(x, y, z, w, h, d, color, detailFacade, true);
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
          m.tri(
            [
              [g0[0], top + 3.4, g0[1]],
              [s.x, top + 4.2, s.z],
              [g1[0], top + 3.4, g1[1]],
            ],
            [0, 1, 0],
            0x3a3d40,
            roofFacade,
          );
        }
      }
      if (s.kind === 'tower') {
        box(0, top + 3.5, 0, r * 3.15, 0.25, r * 3.15, 0x484e50);
        box(0, top + 5.6, 0, 0.14, 4.1, 0.14, 0x6f7778);
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
    for (const [sideIndex, [x0, z0, x1, z1, nx, nz]] of sides.entries()) {
      const len = Math.hypot(x1 - x0, z1 - z0);
      const a = local(x0, base, z0),
        b = local(x1, base, z1),
        d = local(x1, eave, z1),
        e = local(x0, eave, z0);
      const layout = facadeLayout(s, len, sideIndex);
      if (layout) {
        addRecessedFacade(
          m,
          layout,
          b,
          [(a[0] - b[0]) / len, 0, (a[2] - b[2]) / len],
          [c * nx - n * nz, 0, n * nx + c * nz],
          wall,
          style,
          kind,
          this.openings,
        );
        continue;
      }
      // Counter-clockwise seen from outside.
      m.quad(
        [b, a, e, d],
        [c * nx - n * nz, 0, n * nx + c * nz],
        [
          [0, 0],
          [len, 0],
          [len, eave - base],
          [0, eave - base],
        ],
        wall,
        facade,
      );
    }
    // Roofs.
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
        const normal: [number, number, number] = [
          n * Math.sin(slope),
          Math.cos(slope),
          -c * Math.sin(slope),
        ];
        m.quad(
          [local(hx, y0, z0), local(-hx, y0, z0), local(-hx, y1, z1), local(hx, y1, z1)],
          normal,
          [
            [0, z0],
            [2 * hx, z0],
            [2 * hx, z1],
            [0, z1],
          ],
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
    } else {
      // Flat roof with a parapet lip.
      m.quad(
        [local(-hx, top, -hz), local(-hx, top, hz), local(hx, top, hz), local(hx, top, -hz)],
        [0, 1, 0],
        [
          [0, 0],
          [0, 2 * hz],
          [2 * hx, 2 * hz],
          [2 * hx, 0],
        ],
        metal ? roof : 0x6a6763,
        roofFacade,
      );
    }
    if (!metal) {
      const trim = pick([0xddd7c7, 0xc5c0b3, 0x777d7e, 0xb1a797], 4);
      // A stone base course, shallow corner pilasters and a real projecting
      // cornice anchor each building. Maximum frontage projection is 0.30 m,
      // within the existing >=1 m clearance beyond all road shoulders.
      box(0, base + 0.25, 0, hx * 2 + 0.12, 0.5, hz * 2 + 0.12, 0x736f66);
      box(0, top - 0.08, 0, hx * 2 + 0.5, 0.25, hz * 2 + 0.5, trim);
      for (const side of [-1, 1]) {
        box(side * (hx - 0.1), base + s.height / 2, -hz - 0.035, 0.32, s.height, 0.13, trim);
        box(side * (hx - 0.1), base + s.height / 2, hz + 0.035, 0.32, s.height, 0.13, trim);
      }
      if (s.kind === 'terminal') {
        for (let floor = 1; floor < s.floors; floor++) {
          const y = base + floor * 3.2 + 0.08;
          const depth = floor === 1 ? 0.23 : 0.1;
          for (const side of [-1, 1]) {
            box(
              0,
              y,
              side * (hz + depth / 2),
              hx * 2 + 0.24,
              floor === 1 ? 0.26 : 0.14,
              depth,
              trim,
            );
            box(side * (hx + depth / 2), y, 0, depth, 0.14, hz * 2, trim);
          }
        }
        // Roof parapets: the upper skyline now has thickness and returns.
        for (const side of [-1, 1]) {
          box(0, top + 0.25, side * (hz - 0.1), hx * 2, 0.5, 0.2, wall);
          box(side * (hx - 0.1), top + 0.25, 0, 0.2, 0.5, hz * 2, wall);
        }
        // Roof services make scale readable from taller chase/photo views.
        box(-hx * 0.6, top + 0.5, hz * 0.45, Math.min(2.1, hx * 0.42), 0.9, 1.4, 0x839093);
      }
    } else {
      // Hangar and warehouse side frames break up large flat sheds without
      // changing their clearance or adding ground-level obstacles.
      for (let x = -hx + 1; x < hx; x += 6)
        for (const side of [-1, 1])
          box(x, base + (eave - base) / 2, side * (hz + 0.05), 0.16, eave - base, 0.12, 0x515d5f);
      box(0, eave - 0.35, 0, hx * 2 + 0.2, 0.25, hz * 2 + 0.2, 0x566367);
    }
  }
  update(camera: T.Camera, quality: QualityPreset) {
    this.joinery.update(camera, quality);
  }
  /** Surface water (0 dry .. 1 soaked) from the weather presentation. */
  setWet(wet: number) {
    this.wet.value = Number.isFinite(wet) ? Math.min(1, Math.max(0, wet)) : 0;
  }
  setNight(night: number) {
    this.night.value = night;
    this.lantern.emissiveIntensity = 0.2 + night * 30;
  }
  dispose() {
    this.joinery.dispose();
    this.root.traverse((o) => {
      if (o instanceof T.Mesh) o.geometry.dispose();
    });
    this.material.dispose();
    this.lantern.dispose();
  }
}
