import * as T from 'three';
import type { Structure } from '../../simulation/open-world/placement.ts';
import { OW_NOISE_GLSL } from './terrain-material.ts';
import { facadeLayout, addRecessedFacade, type FacadePlacement } from './facade-layout.ts';
import { FacadeJoinery } from './facade-joinery.ts';
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
  const material = new T.MeshStandardMaterial({
    vertexColors: true,
    roughness: 0.85,
    metalness: 0,
  });
  material.name = 'Festival building facades';
  (material as unknown as { defines: Record<string, string> }).defines = { USE_UV: '' };
  material.onBeforeCompile = (shader) => {
    shader.uniforms.owNight = night;
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
varying vec4 vFacade;
${OW_NOISE_GLSL}
float owGlass;
float owLit;
float owRib;
float owWallRelief;
float owWallRoughness;
vec3 owLamp;`,
      )
      .replace(
        '#include <color_fragment>',
        `#include <color_fragment>
{
  float style = vFacade.x, kind = vFacade.y, height = vFacade.w;
  vec2 q = vUv;
  owGlass = 0.0; owLit = 0.0; owRib = 0.0; owWallRelief = 0.0; owWallRoughness = -1.0; owLamp = vec3(1.0, 0.7, 0.42);
  bool shed = kind > 4.5 && kind < 5.5 || kind > 8.5;
  bool roof = vFacade.z < -0.5 && vFacade.z > -1.5;
  bool trim = vFacade.z < -1.5;
  bool physicalPane = abs(vFacade.z + 4.0) < 0.1;
  bool physicalWall = abs(vFacade.z + 3.0) < 0.1;
  // Weathering: rain streaks down from sills, grime near the ground.
  float streak = owNoise(vec2(q.x * 1.7, q.y * 0.08 + style * 13.0));
  float grime = 1.0 - smoothstep(0.0, 1.6, q.y);
  if (!physicalPane) diffuseColor.rgb *= physicalWall
    ? (0.945 + 0.055 * streak) * (1.0 - 0.14 * grime)
    : (0.86 + 0.18 * streak) * (1.0 - 0.25 * grime);
  if (physicalPane) {
    // Geometry supplies the actual reveal depth. This inset pane adds a
    // bounded interior illustration, not a ray-traced or enterable room.
    float room = vFacade.x;
    vec2 aa = max(fwidth(q), vec2(0.001));
    float upright = vFacade.w > 0.5 ? min(abs(q.x-0.3333),abs(q.x-0.6667)) : abs(q.x-0.5);
    float transom = abs(q.y - (vFacade.w > 0.5 ? 0.78 : 0.63));
    float perimeter = min(min(q.x,1.0-q.x),min(q.y,1.0-q.y));
    float frame = max(1.0-smoothstep(0.012,0.012+aa.x,upright),
                      1.0-smoothstep(0.012,0.012+aa.y,transom));
    frame = max(frame,1.0-smoothstep(0.028,0.028+max(aa.x,aa.y),perimeter));
    owGlass = 1.0-frame;
    diffuseColor.rgb = vec3(0.043,0.050,0.047);
    float ceiling = 1.0 - smoothstep(0.77,1.0,q.y)*0.52;
    float curtain = smoothstep(0.06,0.16,q.x)*smoothstep(0.06,0.16,1.0-q.x);
    float furniture = 1.0-(1.0-smoothstep(0.19,0.32,q.y)) *
      (1.0-smoothstep(0.09,0.23,abs(q.x-(0.30+room*0.35))))*0.68;
    owLamp = mix(vec3(1.0,0.69,0.42),vec3(0.78,0.87,1.0),step(0.86,room));
    owLit = step(0.57,room)*(0.34+room*0.45)*owGlass*ceiling*curtain*furniture;
  } else if (physicalWall) {
    // Metre-scaled surface detail. Derivative fades remove sub-pixel grit
    // and mortar instead of adding sparkling high-frequency noise at speed.
    vec2 aa = max(fwidth(q), vec2(0.00001));
    float gritFade = 1.0-smoothstep(0.002,0.016,max(aa.x,aa.y));
    float grit = owNoise(q*67.0 + vec2(style*27.0,style*31.0));
    diffuseColor.rgb *= 1.0 + (grit-0.5)*0.055*gritFade;
    owWallRelief = (grit-0.5)*0.0012*gritFade;
    owWallRoughness = 0.87 + (grit-0.5)*0.08*gritFade;
    if (vFacade.w > 0.5) {
      bool stone = vFacade.w > 1.5;
      vec2 course = stone ? vec2(0.61,0.285) : vec2(0.245,0.078);
      vec2 tile = q/course;
      tile.x += mod(floor(tile.y),2.0)*0.5;
      vec2 f = fract(tile), edge = min(f,1.0-f)*course;
      float joint = stone ? 0.0045 : 0.003;
      vec2 mask = smoothstep(vec2(joint),vec2(joint)+aa,edge);
      float face = mask.x*mask.y;
      float resolve = 1.0-smoothstep(0.3,0.9,max(aa.x/course.x,aa.y/course.y));
      float variation = owHash(floor(tile)+vec2(style*37.0,style*19.0));
      vec3 unitColor = diffuseColor.rgb*(0.88+0.22*variation);
      vec3 mortar = vec3(0.22,0.215,0.195)*(0.97+0.06*streak);
      vec3 detailed = mix(mortar,unitColor,face);
      // The unresolved average stays close to the resolved material value.
      diffuseColor.rgb = mix(mix(diffuseColor.rgb,mortar,stone ? 0.055 : 0.11),detailed,resolve);
      owWallRelief += (face-1.0)*(stone ? 0.0035 : 0.0025)*resolve;
      owWallRoughness = stone ? 0.93 : 0.9;
    }
  } else if (trim) {
    // Physical cornices, pilasters, sills and roof equipment carry their
    // own vertex colour and must not inherit the facade's window grid.
    diffuseColor.rgb *= 0.92 + 0.1 * owNoise(q * 2.5 + style);
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
}`,
      )
      .replace(
        '#include <roughnessmap_fragment>',
        `#include <roughnessmap_fragment>
if (owWallRoughness >= 0.0) roughnessFactor = owWallRoughness;
roughnessFactor = mix(roughnessFactor, mix(0.1, 0.18, owNight), owGlass);
roughnessFactor = mix(roughnessFactor, 0.5, step(0.001, abs(owRib)));`,
      )
      .replace(
        '#include <normal_fragment_maps>',
        `#include <normal_fragment_maps>
if (owWallRoughness >= 0.0) {
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
totalEmissiveRadiance += owLamp * owLit * owNight * 0.2;`,
      );
  };
  material.customProgramCacheKey = () => 'festival-facades-v6-metric-recessed-joinery';
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
  readonly joinery: FacadeJoinery;
  private readonly openings: FacadePlacement[] = [];
  stats = { buildings: 0, triangles: 0, openings: 0 };
  constructor(structures: readonly Structure[]) {
    this.root.name = 'Festival buildings';
    this.material = facadeMaterial(this.night);
    this.lantern = new T.MeshStandardMaterial({
      color: 0xfff6d8,
      emissive: 0xfff0c0,
      emissiveIntensity: 0.2,
      roughness: 0.2,
    });
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
    this.joinery = new FacadeJoinery(this.openings);
    this.root.add(this.joinery.root);
    this.stats = { buildings: structures.length, triangles, openings: this.openings.length };
  }
  private add(m: Mesher, s: Structure) {
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
    // All architectural parts bake into the same per-district mesh. The
    // side faces supply true silhouette and self-shadow without adding a
    // material or a draw call for every sill or rooftop.
    const box = (
      x: number,
      y: number,
      z: number,
      w: number,
      h: number,
      d: number,
      color: number,
    ) => {
      const x0 = x - w / 2,
        x1 = x + w / 2,
        y0 = y - h / 2,
        y1 = y + h / 2,
        z0 = z - d / 2,
        z1 = z + d / 2;
      const face = (
        points: readonly (readonly [number, number, number])[],
        normal: readonly [number, number, number],
        u: number,
        v: number,
      ) => {
        m.quad(
          points.map(([lx, ly, lz]) => local(lx, ly, lz)),
          [c * normal[0] - n * normal[2], normal[1], n * normal[0] + c * normal[2]],
          [
            [0, 0],
            [u, 0],
            [u, v],
            [0, v],
          ],
          color,
          detailFacade,
        );
      };
      face(
        [
          [x0, y0, z0],
          [x0, y1, z0],
          [x1, y1, z0],
          [x1, y0, z0],
        ],
        [0, 0, -1],
        h,
        w,
      );
      face(
        [
          [x1, y0, z1],
          [x1, y1, z1],
          [x0, y1, z1],
          [x0, y0, z1],
        ],
        [0, 0, 1],
        h,
        w,
      );
      face(
        [
          [x0, y0, z1],
          [x0, y1, z1],
          [x0, y1, z0],
          [x0, y0, z0],
        ],
        [-1, 0, 0],
        h,
        d,
      );
      face(
        [
          [x1, y0, z0],
          [x1, y1, z0],
          [x1, y1, z1],
          [x1, y0, z1],
        ],
        [1, 0, 0],
        h,
        d,
      );
      face(
        [
          [x0, y1, z0],
          [x0, y1, z1],
          [x1, y1, z1],
          [x1, y1, z0],
        ],
        [0, 1, 0],
        d,
        w,
      );
      face(
        [
          [x0, y0, z1],
          [x0, y0, z0],
          [x1, y0, z0],
          [x1, y0, z1],
        ],
        [0, -1, 0],
        d,
        w,
      );
    };
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
        m.quad(
          corners,
          [-n * nl, ny, c * nl],
          [
            [0, 0],
            [2 * hx, 0],
            [2 * hx, hz],
            [0, hz],
          ],
          roof,
          roofFacade,
        );
      }
      for (const side of [-1, 1]) {
        m.tri(
          side < 0
            ? [local(-hx, top, -hz), local(-hx, top, hz), local(-hx, ridge, 0)]
            : [local(hx, top, hz), local(hx, top, -hz), local(hx, ridge, 0)],
          [c * side, 0, n * side],
          wall,
          [style, kind, -3, s.height],
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
            [
              local(x1, base, z1),
              local(x0, base, z0),
              local(x0, towerTop, z0),
              local(x1, towerTop, z1),
            ],
            [c * nx - n * nz, 0, n * nx + c * nz],
            [
              [0, 0],
              [4.4, 0],
              [4.4, towerTop - base],
              [0, towerTop - base],
            ],
            0xb3a891,
            [style, 4, 0, towerTop - base],
          );
        for (const [x0, z0, x1, z1] of [
          [tx - 2.3, -2.3, tx + 2.3, -2.3],
          [tx + 2.3, -2.3, tx + 2.3, 2.3],
          [tx + 2.3, 2.3, tx - 2.3, 2.3],
          [tx - 2.3, 2.3, tx - 2.3, -2.3],
        ] as const)
          m.tri(
            [local(x1, towerTop, z1), local(x0, towerTop, z0), local(tx, towerTop + 5, 0)],
            [0, 1, 0],
            0x45484c,
            roofFacade,
          );
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
      if (s.kind === 'shop' || s.kind === 'block' || s.kind === 'terminal') {
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
        if (s.kind === 'block' && (s.style & 3) !== 0) {
          // Setback service floor and overhanging metal cap vary the skyline
          // while keeping every addition inside its collision footprint.
          const rx = hx * 0.47,
            rz = hz * 0.43;
          box(
            0,
            top + 1.1,
            hz * 0.12,
            rx * 2,
            2.2,
            rz * 2,
            pick([0x707d7c, 0xb8b4a7, 0x867566], 2),
          );
          box(0, top + 2.23, hz * 0.12, rx * 2 + 0.4, 0.16, rz * 2 + 0.4, 0x3a4548);
        }
        // Roof services make scale readable from taller chase/photo views.
        box(-hx * 0.6, top + 0.5, hz * 0.45, Math.min(2.1, hx * 0.42), 0.9, 1.4, 0x839093);
        for (let rib = 0; rib < 4; rib++)
          box(
            -hx * 0.6,
            top + 0.5,
            hz * 0.45 - 0.69 + rib * 0.22,
            Math.min(2.15, hx * 0.44),
            0.11,
            0.06,
            0x424b4d,
          );
      } else if (pitched && s.kind !== 'chapel') {
        const chimneyY = top + hz * 0.43;
        box(hx * 0.53, chimneyY, hz * 0.2, 0.85, 2.4, 0.9, 0x81664f);
        box(hx * 0.53, chimneyY + 1.21, hz * 0.2, 1.03, 0.18, 1.08, 0x4b4b48);
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
