import * as T from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { carvedGroundHeight } from '../../simulation/open-world/ground-height.ts';
import { hash01 } from '../../simulation/open-world/noise.ts';
import { StructureGrid, type Structure } from '../../simulation/open-world/placement.ts';
import { BIOME } from '../../simulation/open-world/terrain-field.ts';
import type { OpenWorld } from '../../simulation/open-world/world.ts';
import type { TrackPoint } from '../../simulation/track.ts';
import { canvasTexture } from '../geometry.ts';
import type { QualityPreset } from '../options.ts';
import { chainShaderHook, injectAfter } from '../studio/shader-hooks.ts';
import { useStudioUniforms } from '../studio/studio-frame.ts';
import { BAMBOO_SEED, FLOWER_SEED, floraZone, SUSUKI_SEED } from './flora-roles.ts';
import { bindSeasonUniforms } from './season.ts';
import { SEASON_DECL_GLSL } from './season-flora.ts';

/**
 * Decorative Japanese ground flora of the festival (no colliders, never on
 * or beside the driving surface): susuki pampas grass in meadow fields and
 * along the verges (032, 036: 1.2-2 m clumps, silvery-gold plumes
 * #c5a57d..#e5c69a sunlit), wildflower patches (021, 051) and bamboo groves
 * at forest edges (099: culms 10-14 m, 6-10 cm, dark #1f2611 to lit
 * #3c4d32, feathery leaf sprays #597352). Deterministic from the region
 * (hashes and smooth zones), streamed in chunks around the camera, one
 * instanced draw per kind and chunk; wind sway and a shrink-into-the-ground
 * fade at the draw distance; seasonal colour through the shared uniforms.
 */
export const FLORA = Object.freeze({
  /** Chunk edge (m). */
  chunk: 96,
  /** Candidate spacing (m). */
  cell: 3.2,
  /** Grass and flower draw distance (m) per preset. */
  range: Object.freeze({ low: 0, medium: 130, high: 190, ultra: 240 }),
  /** Bamboo draw distance (m) per preset. */
  bamboo: Object.freeze({ low: 0, medium: 300, high: 420, ultra: 520 }),
  /** Chunks planned per frame (planting costs field queries). */
  buildsPerFrame: 1,
});
/** Part ids carried in the geometry (shader colour per part). */
const PART = Object.freeze({ BLADE: 0, PLUME: 1, CULM: 2, LEAF: 3, PETAL: 4 });

/** Atlas columns: blade (solid), susuki plume, bamboo leaf spray, flower. */
function floraAtlas() {
  const w = 256,
    h = 256;
  return canvasTexture(w, h, (c) => {
    c.clearRect(0, 0, w, h);
    c.fillStyle = '#ffffff';
    c.fillRect(0, 0, 64, h);
    // Susuki plume: a rachis with fine silky spikelets drooping to one side.
    let seed = 7;
    const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
    c.strokeStyle = 'rgba(255,255,255,0.95)';
    c.lineCap = 'round';
    for (let i = 0; i < 70; i++) {
      const t = i / 70,
        y = 6 + t * 230,
        x = 96 + Math.sin(t * 3) * 3;
      const len = 10 + 22 * Math.sin(Math.PI * Math.min(1, t * 1.25)) * (0.7 + 0.3 * rnd());
      c.lineWidth = 0.8 + rnd() * 1.1;
      c.beginPath();
      c.moveTo(x, y);
      const side = rnd() < 0.5 ? -1 : 1;
      c.quadraticCurveTo(x + side * len * 0.6, y + len * 0.3, x + side * len * 0.85, y + len * 0.9);
      c.stroke();
    }
    c.lineWidth = 2;
    c.beginPath();
    c.moveTo(96, 0);
    c.lineTo(97, 256);
    c.stroke();
    // Bamboo leaf spray: lanceolate leaves fanning down from a twig.
    c.fillStyle = '#ffffff';
    for (let i = 0; i < 11; i++) {
      const a = -0.2 + (i / 10) * (Math.PI + 0.4) + (rnd() - 0.5) * 0.2,
        x0 = 160 + (rnd() - 0.5) * 8,
        y0 = 20 + i * 16 + rnd() * 6,
        len = 34 + rnd() * 16;
      const dx = Math.cos(a) * len * 0.55,
        dy = Math.abs(Math.sin(a)) * len * 0.8 + 10;
      c.beginPath();
      c.moveTo(x0, y0);
      c.quadraticCurveTo(x0 + dx * 0.5 - dy * 0.12, y0 + dy * 0.5 + 4, x0 + dx, y0 + dy);
      c.quadraticCurveTo(x0 + dx * 0.5 + dy * 0.12, y0 + dy * 0.5 - 4, x0, y0);
      c.fill();
    }
    // Flower head: five petals and a darker centre.
    for (let k = 0; k < 5; k++) {
      const a = (k / 5) * Math.PI * 2;
      c.beginPath();
      c.ellipse(224 + Math.cos(a) * 14, 128 + Math.sin(a) * 14, 15, 9, a, 0, Math.PI * 2);
      c.fill();
    }
    c.fillStyle = '#7a7a40';
    c.beginPath();
    c.arc(224, 128, 7, 0, Math.PI * 2);
    c.fill();
  });
}

/** Geometry builder with the per-vertex part and bend (0 base, 1 tip). */
class Parts {
  position: number[] = [];
  normal: number[] = [];
  uv: number[] = [];
  part: number[] = [];
  index: number[] = [];
  vertex(p: T.Vector3, n: T.Vector3, u: number, v: number, part: number, bend: number) {
    this.position.push(p.x, p.y, p.z);
    this.normal.push(n.x, n.y, n.z);
    this.uv.push(u, v);
    this.part.push(part, bend);
    return this.position.length / 3 - 1;
  }
  /** A tapering ribbon along `points` (width per point), facing `side`. */
  ribbon(
    points: T.Vector3[],
    widths: number[],
    side: T.Vector3,
    part: number,
    u0: number,
    u1: number,
  ) {
    const up = new T.Vector3(0, 1, 0);
    let prev: [number, number] | null = null;
    points.forEach((p, i) => {
      const t = i / (points.length - 1),
        n = new T.Vector3().copy(side).cross(up).normalize().lerp(up, 0.6).normalize();
      const a = this.vertex(p.clone().addScaledVector(side, -widths[i]), n, u0, t, part, t),
        b = this.vertex(p.clone().addScaledVector(side, widths[i]), n, u1, t, part, t);
      if (prev) this.index.push(prev[0], a, prev[1], prev[1], a, b);
      prev = [a, b];
    });
  }
  /** A card from `base` up along `dir` (height) and across `side` (half width). */
  card(
    base: T.Vector3,
    dir: T.Vector3,
    side: T.Vector3,
    height: number,
    half: number,
    part: number,
    u: readonly [number, number, number, number],
    bend0: number,
    bend1: number,
    normal?: T.Vector3,
  ) {
    const n = normal ?? new T.Vector3(0, 1, 0);
    const top = base.clone().addScaledVector(dir, height);
    const [u0, u1, v0, v1] = u;
    const a = this.vertex(base.clone().addScaledVector(side, -half), n, u0, v1, part, bend0),
      b = this.vertex(base.clone().addScaledVector(side, half), n, u1, v1, part, bend0),
      c = this.vertex(top.clone().addScaledVector(side, -half), n, u0, v0, part, bend1),
      d = this.vertex(top.clone().addScaledVector(side, half), n, u1, v0, part, bend1);
    this.index.push(a, b, c, b, d, c);
  }
  geometry() {
    const g = new T.BufferGeometry();
    g.setAttribute('position', new T.Float32BufferAttribute(this.position, 3));
    g.setAttribute('normal', new T.Float32BufferAttribute(this.normal, 3));
    g.setAttribute('uv', new T.Float32BufferAttribute(this.uv, 2));
    g.setAttribute('floraPart', new T.Float32BufferAttribute(this.part, 2));
    g.setIndex(this.index);
    g.computeBoundingSphere();
    return g;
  }
}

/** Susuki clump (unit height ~ 1.7 m at scale 1): arching blades and
 * plume-bearing stalks. */
function susukiGeometry() {
  const b = new Parts();
  for (let i = 0; i < 9; i++) {
    const a = i * 2.399963,
      len = 0.5 + hash01(i, 1, 77) * 0.35,
      lean = 0.28 + hash01(i, 2, 77) * 0.25;
    const dir = new T.Vector3(Math.sin(a), 0, Math.cos(a)),
      side = new T.Vector3(Math.cos(a), 0, -Math.sin(a));
    const pts = [0, 1, 2, 3].map((k) => {
      const t = k / 3;
      return new T.Vector3(0, 0, 0)
        .addScaledVector(dir, lean * len * t * t + 0.03)
        .setY(len * (t - 0.25 * t * t));
    });
    b.ribbon(pts, [0.02, 0.018, 0.012, 0.002], side, PART.BLADE, 0.05, 0.2);
  }
  for (let i = 0; i < 5; i++) {
    const a = i * 2.399963 + 0.7,
      h = 0.78 + hash01(i, 3, 77) * 0.22,
      lean = 0.08 + hash01(i, 4, 77) * 0.12;
    const dir = new T.Vector3(Math.sin(a), 0, Math.cos(a)),
      side = new T.Vector3(Math.cos(a), 0, -Math.sin(a));
    const top = new T.Vector3().addScaledVector(dir, lean).setY(h);
    b.ribbon(
      [
        new T.Vector3(0, 0, 0),
        top
          .clone()
          .multiplyScalar(0.5)
          .setY(h * 0.5),
        top,
      ],
      [0.007, 0.006, 0.004],
      side,
      PART.BLADE,
      0.05,
      0.2,
    );
    // Plume: two crossed cards nodding away from the stalk.
    const nod = new T.Vector3().addScaledVector(dir, 0.35).setY(1).normalize();
    for (const turn of [0, Math.PI / 2]) {
      const s = side.clone().applyAxisAngle(new T.Vector3(0, 1, 0), turn);
      b.card(
        top.clone().addScaledVector(nod, -0.02),
        nod,
        s,
        0.26,
        0.055,
        PART.PLUME,
        [0.27, 0.48, 0, 1],
        1,
        1,
        new T.Vector3(0, 1, 0),
      );
    }
  }
  return b.geometry();
}

/** Wildflower tuft (unit height ~ 0.5 m): leaves, stems and heads. */
function flowerGeometry() {
  const b = new Parts();
  for (let i = 0; i < 5; i++) {
    const a = i * 2.399963,
      dir = new T.Vector3(Math.sin(a), 0, Math.cos(a)),
      side = new T.Vector3(Math.cos(a), 0, -Math.sin(a));
    const len = 0.3 + hash01(i, 5, 78) * 0.2;
    b.ribbon(
      [
        new T.Vector3(0, 0, 0),
        new T.Vector3().addScaledVector(dir, 0.08).setY(len * 0.6),
        new T.Vector3().addScaledVector(dir, 0.18).setY(len * 0.75),
      ],
      [0.025, 0.02, 0.003],
      side,
      PART.BLADE,
      0.05,
      0.2,
    );
  }
  for (let i = 0; i < 6; i++) {
    const a = i * 2.399963 + 0.4,
      r = 0.05 + hash01(i, 6, 78) * 0.12,
      h = 0.6 + hash01(i, 7, 78) * 0.4;
    const top = new T.Vector3(Math.sin(a) * r, h, Math.cos(a) * r),
      side = new T.Vector3(Math.cos(a), 0, -Math.sin(a));
    b.ribbon([new T.Vector3(0, 0, 0), top], [0.005, 0.004], side, PART.BLADE, 0.05, 0.2);
    // Head: a card tilted to face up and out.
    const face = new T.Vector3(Math.sin(a) * 0.5, 1, Math.cos(a) * 0.5).normalize();
    const across = new T.Vector3().crossVectors(face, side).normalize();
    b.card(
      top.clone().addScaledVector(across, -0.06),
      across,
      side,
      0.12,
      0.06,
      PART.PETAL,
      [0.76, 0.99, 0.385, 0.615],
      1,
      1,
      face,
    );
  }
  return b.geometry();
}

/** Bamboo clump (unit: metres): eleven culms 9-13 m with node rings implied
 * by the shader and drooping leaf sprays on the upper half. */
function bambooGeometry() {
  const parts: T.BufferGeometry[] = [];
  const sprays = new Parts();
  for (let i = 0; i < 11; i++) {
    const a = i * 2.399963,
      r = 0.25 + hash01(i, 8, 79) * 1.6,
      h = 9 + hash01(i, 9, 79) * 4,
      lean = 0.03 + hash01(i, 10, 79) * 0.06;
    const base = new T.Vector3(Math.sin(a) * r, 0, Math.cos(a) * r),
      dir = new T.Vector3(Math.sin(a) * lean, 1, Math.cos(a) * lean).normalize();
    const culm = new T.CylinderGeometry(0.035, 0.05, h, 3, 3, true);
    culm.translate(0, h / 2, 0);
    culm.applyQuaternion(new T.Quaternion().setFromUnitVectors(new T.Vector3(0, 1, 0), dir));
    culm.translate(base.x, 0, base.z);
    const n = culm.getAttribute('position').count,
      attr = new Float32Array(n * 2),
      p = culm.getAttribute('position');
    for (let k = 0; k < n; k++) {
      attr[k * 2] = PART.CULM;
      attr[k * 2 + 1] = Math.min(1, p.getY(k) / 13);
    }
    culm.setAttribute('floraPart', new T.BufferAttribute(attr, 2));
    const uv = culm.getAttribute('uv') as T.BufferAttribute;
    for (let k = 0; k < uv.count; k++) uv.setXY(k, 0.1, p.getY(k) / 0.45);
    parts.push(culm);
    // Leaf sprays from 45 % of the height to the tip, drooping outward.
    for (let s = 0; s < 3; s++) {
      const t = 0.5 + s * 0.17 + hash01(i, s, 80) * 0.05,
        at = base.clone().addScaledVector(dir, h * t);
      const out = a + s * 1.9;
      const side = new T.Vector3(Math.cos(out), 0, -Math.sin(out)),
        down = new T.Vector3(Math.sin(out) * 0.6, -0.8, Math.cos(out) * 0.6).normalize();
      const len = 1.5 + hash01(i, s, 81) * 0.9;
      sprays.card(
        at,
        down,
        side,
        len,
        len * 0.4,
        PART.LEAF,
        [0.52, 0.73, 0, 1],
        t,
        Math.min(1, t + 0.15),
        new T.Vector3(Math.sin(out) * 0.4, 1, Math.cos(out) * 0.4).normalize(),
      );
    }
  }
  parts.push(sprays.geometry());
  const merged = mergeGeometries(parts, false)!;
  parts.forEach((g) => g.dispose());
  merged.computeBoundingSphere();
  return merged;
}

const FLORA_VERTEX = /* glsl */ `
attribute vec2 floraPart;
uniform float floraRange;
varying vec2 vFlora;
${SEASON_DECL_GLSL}
`;
/** Wind sway (bend²), the distance fade and seasonal visibility. */
const FLORA_BEGIN = /* glsl */ `{
  vec3 fo = (modelMatrix * instanceMatrix * vec4(0.0, 0.0, 0.0, 1.0)).xyz;
  float fd = distance(cameraPosition.xz, fo.xz);
  float vis = 1.0 - smoothstep(floraRange * 0.72, floraRange, fd);
  float part = floraPart.x, bend = floraPart.y;
  // Plumes open in late summer, peak in autumn (036), none in spring.
  if (part > 0.5 && part < 1.5) vis *= owSeason.y * 0.75 + owSeason.z + owSeason.w * 0.9;
  // Flowers in spring and early summer only.
  if (part > 3.5) vis *= owSeason.x + owSeason.y;
  transformed *= vis;
  // Winter: grass pressed and buried.
  if (part < 1.5) transformed.y *= 1.0 - 0.45 * owSnowCover;
  vec2 wind = studioWind.xy;
  float speed = length(wind);
  vec2 dir = speed > 1e-3 ? wind / speed : vec2(0.7071, 0.7071);
  float phase = dot(fo.xz, vec2(0.37, 0.61));
  float t = studioWind.z;
  float amp = clamp(speed / 10.0, 0.15, 1.6) * (0.6 + 0.4 * studioWind.w);
  float sway = bend * bend * amp * (part < 1.5 ? 0.12 : (part > 1.5 && part < 3.5 ? 0.35 : 0.05))
    * (sin(1.3 * t + phase) + 0.4 * sin(3.1 * t + phase * 1.7) + 0.25 * sin(7.0 * t + phase * 3.1));
  mat3 basis = mat3(modelMatrix) * mat3(instanceMatrix);
  transformed += transpose(basis) * vec3(dir.x, 0.0, dir.y) * sway / max(dot(basis[0], basis[0]), 1e-6);
  vFlora = floraPart;
}`;

const FLORA_FRAGMENT = /* glsl */ `
varying vec2 vFlora;
${SEASON_DECL_GLSL}
vec3 floraSeason(vec3 spring, vec3 summer, vec3 autumn, vec3 winter) {
  return owSeason.x * spring + owSeason.y * summer + owSeason.z * autumn + owSeason.w * winter;
}
/** Colour of a flora part; \`seed\`: instance (hash, brightness, variant). */
vec3 floraColour(float part, float bend, vec3 seed) {
  vec3 c;
  if (part < 0.5) {
    vec3 base = mix(vec3(0.035, 0.055, 0.016), vec3(0.085, 0.15, 0.032), bend);
    c = floraSeason(mix(base, vec3(0.1, 0.19, 0.035), 0.5), base,
      mix(vec3(0.16, 0.11, 0.045), vec3(0.42, 0.32, 0.15), bend),
      mix(vec3(0.1, 0.085, 0.06), vec3(0.3, 0.26, 0.2), bend));
  } else if (part < 1.5) {
    vec3 gold = mix(vec3(0.5, 0.37, 0.2), vec3(0.68, 0.58, 0.42), seed.z);
    c = floraSeason(vec3(0.34, 0.16, 0.12), mix(vec3(0.36, 0.15, 0.11), gold, 0.3), gold, vec3(0.56, 0.52, 0.46));
  } else if (part < 2.5) {
    c = mix(vec3(0.05, 0.075, 0.025), vec3(0.11, 0.14, 0.05), seed.z) * (0.85 + 0.3 * bend);
    c = mix(c, vec3(0.13, 0.12, 0.07), owSeason.w * 0.3);
  } else if (part < 3.5) {
    c = floraSeason(vec3(0.11, 0.14, 0.04), vec3(0.06, 0.12, 0.035), vec3(0.07, 0.12, 0.035), vec3(0.06, 0.1, 0.035));
  } else {
    float v = seed.z;
    c = v < 0.3 ? vec3(0.5, 0.04, 0.03) : (v < 0.45 ? vec3(0.55, 0.2, 0.02) : (v < 0.65 ? vec3(0.7, 0.7, 0.64) : (v < 0.8 ? vec3(0.6, 0.45, 0.03) : (v < 0.9 ? vec3(0.25, 0.07, 0.4) : vec3(0.65, 0.22, 0.36)))));
  }
  return c * seed.y;
}
`;

function floraMaterial(atlas: T.Texture, range: { value: number }, depth: boolean) {
  const hookVertex = (shader: T.WebGLProgramParametersWithUniforms) => {
    shader.uniforms.floraRange = range;
    bindSeasonUniforms(shader);
    useStudioUniforms(shader, ['studioWind'], 'vertex');
    injectAfter(shader, 'common', FLORA_VERTEX, 'vertex');
    injectAfter(shader, 'begin_vertex', FLORA_BEGIN, 'vertex');
  };
  if (depth) {
    const material = new T.MeshDepthMaterial({
      depthPacking: T.RGBADepthPacking,
      map: atlas,
      alphaTest: 0.45,
      side: T.DoubleSide,
    });
    chainShaderHook(material, 'festival-flora-v1', hookVertex);
    return material;
  }
  const material = new T.MeshStandardMaterial({
    name: 'Festival flora',
    map: atlas,
    alphaTest: 0.45,
    side: T.DoubleSide,
    roughness: 0.82,
    metalness: 0,
  });
  chainShaderHook(material, 'festival-flora-v1', (shader) => {
    hookVertex(shader);
    injectAfter(shader, 'common', FLORA_FRAGMENT, 'fragment');
    injectAfter(
      shader,
      'map_fragment',
      'float floraLum = dot(diffuseColor.rgb, vec3(0.2126, 0.7152, 0.0722));',
      'fragment',
    );
    injectAfter(
      shader,
      'color_fragment',
      /* glsl */ `{
  // USE_COLOR: the instance colour (no vertex colours on this material).
  #ifdef USE_COLOR
    vec3 seed = vColor;
  #else
    vec3 seed = vec3(0.5, 1.0, 0.5);
  #endif
  vec3 c = floraColour(vFlora.x, vFlora.y, seed) * floraLum;
  // Culm node rings every ~0.45 m (uv.y carries metres / 0.45).
  #ifdef USE_MAP
  if (vFlora.x > 1.5 && vFlora.x < 2.5) c *= 1.0 - 0.35 * smoothstep(0.9, 0.97, fract(vMapUv.y));
  #endif
  diffuseColor.rgb = c;
}`,
      'fragment',
    );
    injectAfter(
      shader,
      'normal_fragment_maps',
      /* glsl */ `{
  float up = dot(normal, normalize((viewMatrix * vec4(0.0, 1.0, 0.0, 0.0)).xyz));
  float hold = vFlora.x > 2.5 && vFlora.x < 3.5 ? 0.6 : (vFlora.x < 1.5 ? 0.35 : 0.0);
  diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.8, 0.82, 0.86), owSnowCover * hold * smoothstep(0.2, 0.7, up * vFlora.y));
}`,
      'fragment',
    );
  });
  return material;
}

export interface FloraPlant {
  x: number;
  y: number;
  z: number;
  yaw: number;
  width: number;
  height: number;
  seed: [number, number, number];
}
interface Chunk {
  key: number;
  centre: T.Vector3;
  meshes: { mesh: T.InstancedMesh; bamboo: boolean }[];
}
const chunkKey = (cx: number, cz: number) => (cx + 512) * 1024 + (cz + 512);

/** Clear distance (m) from (x, z) to the nearest road's usable edge. */
function roadClearance(world: OpenWorld, x: number, z: number, point: TrackPoint) {
  const net = world.network,
    lateral = net.nearest(x, z, point),
    e = net.edges[net.edgeOf[net.lastSegment]];
  return Math.abs(lateral) - (e.spec.halfWidth + e.spec.shoulder);
}
/** Minimum clearance (m) from the usable road edge per kind. */
export const FLORA_CLEARANCE = Object.freeze({ ground: 2.2, bamboo: 7 });

/** Deterministic plants of one flora chunk (pure: unit-tested). */
export function planFloraChunk(world: OpenWorld, grid: StructureGrid, cx: number, cz: number) {
  const point: TrackPoint = {
    s: 0,
    x: 0,
    y: 0,
    z: 0,
    tx: 0,
    tz: 1,
    nx: 1,
    nz: 0,
    curvature: 0,
    width: 0,
    bank: 0,
    gradient: 0,
  };
  const field = world.field,
    region = world.region,
    size = FLORA.chunk,
    cell = FLORA.cell,
    n = Math.round(size / cell);
  const susuki: FloraPlant[] = [],
    flowers: FloraPlant[] = [],
    bamboo: FloraPlant[] = [];
  for (let j = 0; j < n; j++)
    for (let i = 0; i < n; i++) {
      const gx = cx * n + i,
        gz = cz * n + j,
        r0 = hash01(gx, gz, 0x5a51),
        r1 = hash01(gz, gx, 0x7c1);
      const x = cx * size + (i + 0.1 + 0.8 * r0) * cell,
        z = cz * size + (j + 0.1 + 0.8 * r1) * cell;
      if (Math.abs(x) > region.half || Math.abs(z) > region.half) continue;
      const pick = hash01(gx, gz, 0x3d9),
        susukiZ = floraZone(x, z, SUSUKI_SEED),
        flowerZ = floraZone(x, z, FLOWER_SEED),
        bambooZ = floraZone(x, z, BAMBOO_SEED);
      // Cheap rejection before the field queries.
      // Bamboo: small groves (about one clump per 50 m² inside a grove zone).
      const bambooHere = bambooZ > 0.74 && pick < 0.2;
      const flowerHere = flowerZ > 0.62 && pick < 0.22;
      if (!bambooHere && !flowerHere && pick > 0.62) continue;
      const h = field.height(x, z);
      if (h < region.seaLevel + 2 || h > field.snowLine(x, z) - 60) continue;
      const slope = Math.hypot(field.height(x + 2, z) - h, field.height(x, z + 2) - h) / 2;
      if (slope > 0.55) continue;
      const biome = field.biome(x, z, h, slope);
      if (biome !== BIOME.MEADOW && biome !== BIOME.FOREST && biome !== BIOME.FARMLAND) continue;
      const clear = roadClearance(world, x, z, point);
      if (clear < FLORA_CLEARANCE.ground || grid.blocks(x, z, 2.5)) continue;
      const forest = field.forestDensity(x, z);
      const yaw = hash01(gx, gz, 0x91) * Math.PI * 2;
      const seed: [number, number, number] = [r0, 0.85 + 0.3 * r1, hash01(gx, gz, 0x2b7)];
      if (
        bambooHere &&
        clear > FLORA_CLEARANCE.bamboo &&
        h < 320 &&
        forest > 0.15 &&
        forest < 0.85
      ) {
        const s = 0.8 + 0.4 * r1;
        bamboo.push({
          x,
          y: carvedGroundHeight(world.carver, x, z) - 0.1,
          z,
          yaw,
          width: s,
          height: s,
          seed,
        });
        continue;
      }
      if (biome !== BIOME.MEADOW) continue;
      const verge = clear < 10 && pick < 0.22;
      const meadow = susukiZ > 0.52 && pick < 0.36 * Math.min(1, (susukiZ - 0.52) * 8);
      if (verge || meadow) {
        const s = 0.9 + 0.5 * r0;
        susuki.push({
          x,
          y: carvedGroundHeight(world.carver, x, z) - 0.04,
          z,
          yaw,
          width: 1.1 * s,
          height: 1.7 * s,
          seed,
        });
        continue;
      }
      if (flowerHere)
        flowers.push({
          x,
          y: carvedGroundHeight(world.carver, x, z) - 0.03,
          z,
          yaw,
          width: 0.9 + 0.4 * r0,
          height: 0.45 + 0.25 * r1,
          seed,
        });
    }
  return { susuki, flowers, bamboo };
}

export class FestivalFlora {
  readonly root = new T.Group();
  readonly stats = { chunks: 0, susuki: 0, flowers: 0, bamboo: 0 };
  private readonly chunks = new Map<number, Chunk>();
  private readonly grid: StructureGrid;
  private readonly atlas = floraAtlas();
  private readonly range = { value: FLORA.range.medium as number };
  private readonly bambooRange = { value: FLORA.bamboo.medium as number };
  private readonly material: T.MeshStandardMaterial;
  private readonly bambooMaterial: T.MeshStandardMaterial;
  private readonly bambooDepth: T.MeshDepthMaterial;
  private readonly geometry = {
    susuki: susukiGeometry(),
    flower: flowerGeometry(),
    bamboo: bambooGeometry(),
  };
  private readonly eye = new T.Vector3();
  constructor(
    readonly world: OpenWorld,
    structures: readonly Structure[],
  ) {
    this.root.name = 'Festival flora (susuki, flowers, bamboo)';
    this.grid = new StructureGrid(structures);
    this.material = floraMaterial(this.atlas, this.range, false) as T.MeshStandardMaterial;
    this.bambooMaterial = floraMaterial(
      this.atlas,
      this.bambooRange,
      false,
    ) as T.MeshStandardMaterial;
    this.bambooDepth = floraMaterial(this.atlas, this.bambooRange, true) as T.MeshDepthMaterial;
  }

  private build(cx: number, cz: number): Chunk {
    const { susuki, flowers, bamboo } = planFloraChunk(this.world, this.grid, cx, cz);
    const chunk: Chunk = {
      key: chunkKey(cx, cz),
      centre: new T.Vector3((cx + 0.5) * FLORA.chunk, 0, (cz + 0.5) * FLORA.chunk),
      meshes: [],
    };
    const transform = new T.Object3D(),
      color = new T.Color();
    const add = (
      plants: FloraPlant[],
      geometry: T.BufferGeometry,
      material: T.Material,
      isBamboo: boolean,
    ) => {
      if (!plants.length) return;
      const mesh = new T.InstancedMesh(geometry, material, plants.length);
      plants.forEach((p, i) => {
        transform.position.set(p.x, p.y, p.z);
        transform.rotation.set(0, p.yaw, 0);
        transform.scale.set(p.width, p.height, p.width);
        transform.updateMatrix();
        mesh.setMatrixAt(i, transform.matrix);
        mesh.setColorAt(i, color.setRGB(p.seed[0], p.seed[1], p.seed[2]));
      });
      mesh.computeBoundingSphere();
      chunk.centre.y = mesh.boundingSphere!.center.y;
      mesh.matrixAutoUpdate = false;
      mesh.receiveShadow = true;
      mesh.castShadow = isBamboo;
      if (isBamboo) mesh.customDepthMaterial = this.bambooDepth;
      mesh.name = `Festival flora ${isBamboo ? 'bamboo' : 'ground'} ${cx},${cz}`;
      this.root.add(mesh);
      chunk.meshes.push({ mesh, bamboo: isBamboo });
    };
    add(susuki, this.geometry.susuki, this.material, false);
    add(flowers, this.geometry.flower, this.material, false);
    add(bamboo, this.geometry.bamboo, this.bambooMaterial, true);
    this.stats.susuki += susuki.length;
    this.stats.flowers += flowers.length;
    this.stats.bamboo += bamboo.length;
    return chunk;
  }

  private drop(chunk: Chunk) {
    for (const { mesh } of chunk.meshes) {
      this.root.remove(mesh);
      mesh.dispose();
    }
    this.chunks.delete(chunk.key);
  }

  /** Per frame: stream chunks around the camera, cull by distance. */
  update(camera: T.Camera, preset: QualityPreset) {
    camera.getWorldPosition(this.eye);
    const range = FLORA.range[preset],
      bamboo = FLORA.bamboo[preset],
      reach = Math.max(range, bamboo);
    this.range.value = range;
    this.bambooRange.value = bamboo;
    this.root.visible = reach > 0;
    if (reach <= 0) return;
    const size = FLORA.chunk;
    for (const chunk of [...this.chunks.values()])
      if (Math.hypot(chunk.centre.x - this.eye.x, chunk.centre.z - this.eye.z) > reach + size * 1.5)
        this.drop(chunk);
    let builds = FLORA.buildsPerFrame;
    const c0x = Math.floor((this.eye.x - reach) / size),
      c1x = Math.floor((this.eye.x + reach) / size),
      c0z = Math.floor((this.eye.z - reach) / size),
      c1z = Math.floor((this.eye.z + reach) / size);
    const wanted: [number, number, number][] = [];
    for (let cz = c0z; cz <= c1z; cz++)
      for (let cx = c0x; cx <= c1x; cx++) {
        const d = Math.hypot((cx + 0.5) * size - this.eye.x, (cz + 0.5) * size - this.eye.z);
        if (d < reach + size * 0.71 && !this.chunks.has(chunkKey(cx, cz))) wanted.push([d, cx, cz]);
      }
    wanted.sort((a, b) => a[0] - b[0]);
    for (const [, cx, cz] of wanted) {
      if (builds-- <= 0) break;
      this.chunks.set(chunkKey(cx, cz), this.build(cx, cz));
    }
    for (const chunk of this.chunks.values()) {
      const d = Math.hypot(chunk.centre.x - this.eye.x, chunk.centre.z - this.eye.z) - size * 0.71;
      for (const { mesh, bamboo: isBamboo } of chunk.meshes)
        mesh.visible = d < (isBamboo ? bamboo : range);
    }
    this.stats.chunks = this.chunks.size;
  }

  dispose() {
    for (const chunk of [...this.chunks.values()]) this.drop(chunk);
    for (const g of Object.values(this.geometry)) g.dispose();
    this.material.dispose();
    this.bambooMaterial.dispose();
    this.bambooDepth.dispose();
    this.atlas.dispose();
    this.root.removeFromParent();
  }
}
