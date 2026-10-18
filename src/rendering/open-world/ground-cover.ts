import * as T from 'three';
import {
  gridHeight,
  TILE_RES,
  TILE_SIZE,
  TILE_STEP,
} from '../../simulation/open-world/terrain-tiles.ts';
import { hash01, smoothstep } from '../../simulation/open-world/noise.ts';
import type { TileMeshData } from '../../workers/open-world-protocol.ts';
import { canvasTexture } from '../geometry.ts';
import type { QualityPreset } from '../options.ts';
import { chainShaderHook, injectAfter } from '../studio/shader-hooks.ts';
import { useStudioUniforms } from '../studio/studio-frame.ts';
import { FLORA_ZONE_GLSL } from './flora-roles.ts';
import { bindSeasonUniforms } from './season.ts';
import { SEASON_DECL_GLSL } from './season-flora.ts';
import { OW_MEADOW_GLSL, OW_NOISE_GLSL } from './terrain-material.ts';

/**
 * Ground cover of the festival meadows and woods (MEDIUM and above): a
 * continuous carpet of grass blades and seed heads around the camera (021,
 * 032, 036, 098: blades 30-55 cm, tan panicles, dark at the base, lit tips)
 * and an understory ring of ferns and sasa under the trees, shrub bands at
 * road edges and forest margins and tall weeds on the verges (019, 026, 039,
 * 052, 093). No colliders and nothing on the carriageway or shoulder.
 *
 * Everything is placed on the GPU: square patches of clumps aligned to the
 * 4 m terrain grid are instanced around the camera (CPU frustum culling per
 * patch, one draw per ring: near grass, far grass, understory). The vertex
 * shader reads the finest terrain tiles around the camera from one float
 * texture (`groundWindow`: carved height on the physics triangles, grass
 * density, clear distance beyond the road edge, forest and paddy weights),
 * so every clump stands on the drawn ground, follows the masks per clump and
 * varies in the world (patch symmetry and clump hashes), not per patch.
 * Wind through the shared studio wind, season through the shared season
 * uniforms, grass pressed flat under the player's car, clumps shrinking into
 * the terrain (whose meadow colour they share) at the end of their ring.
 */
export const GROUND_COVER = Object.freeze({
  /** Grass patch edge (m): one terrain cell. */
  patch: TILE_STEP,
  /** Understory patch edge (m). */
  understoryPatch: TILE_STEP * 2,
  /** Grass carpet reach (m) per preset; LOW draws none. */
  grass: Object.freeze({ low: 0, medium: 46, high: 64, ultra: 80 }),
  /** Full clump density out to this distance (m); thinner and larger
   * clumps beyond it, on the sparse far geometry from full / farShare. */
  full: Object.freeze({ low: 0, medium: 13, high: 17, ultra: 21 }),
  /** Clump density per preset (grass, understory). */
  density: Object.freeze({
    low: [0, 0],
    medium: [0.85, 0.8],
    high: [1, 1],
    ultra: [1, 1],
  } as Record<QualityPreset, readonly [number, number]>),
  /** Understory reach (m). */
  understory: Object.freeze({ low: 0, medium: 105, high: 150, ultra: 190 }),
  /** Clumps per patch (near grass, far grass, understory). */
  clumps: Object.freeze([96, 30, 14] as const),
  /** Window of finest tiles held in the ground texture (tiles per side). */
  window: 3,
});

/** Atlas tiles (2048 x 512: eight 256 x 512 columns). */
export const COVER_TILE = Object.freeze({
  GRASS: 0,
  SEED: 1,
  CLOVER: 2,
  FERN: 3,
  SHRUB: 4,
  WEEDS: 5,
  SASA: 6,
  DRY: 7,
});
const TILES = 8;

/** Seeded pseudo-random stream for the atlas painting. */
function stream(seed: number) {
  let s = seed;
  return () => (s = (s * 16807) % 2147483647) / 2147483647;
}

/** Canvas atlas. Green = blade/leaf shading, red = accent (seed heads,
 * flowers), alpha = coverage; colours come from the shader per season. */
function coverAtlas() {
  const w = 256,
    h = 512;
  const texture = canvasTexture(w * TILES, h, (c) => {
    c.clearRect(0, 0, w * TILES, h);
    const leaf = (shade: number, accent = 0) => `rgb(${accent},${Math.round(90 + 165 * shade)},0)`;
    /** Tapered, curving blade from (x, bottom) of length `len` (px). */
    const blade = (x: number, len: number, lean: number, width: number, shade: number) => {
      const tx = x + lean,
        ty = h - len;
      c.fillStyle = leaf(shade);
      c.beginPath();
      c.moveTo(x - width, h);
      c.quadraticCurveTo(x - width * 0.6 + lean * 0.2, h - len * 0.55, tx, ty);
      c.quadraticCurveTo(x + width * 0.6 + lean * 0.25, h - len * 0.5, x + width, h);
      c.fill();
    };
    const tile = (k: number, paint: (rnd: () => number) => void) => {
      c.save();
      c.translate(k * w, 0);
      c.beginPath();
      c.rect(2, 0, w - 4, h);
      c.clip();
      paint(stream(911 + k * 131));
      c.restore();
    };
    // Meadow grass: ~70 blades, most 55-95 % of the card, leaning both ways.
    const meadow = (rnd: () => number, n: number, minLen: number) => {
      for (let i = 0; i < n; i++) {
        const x = 24 + rnd() * (w - 48),
          len = h * (minLen + (1 - minLen) * rnd() ** 0.7),
          lean = (rnd() - 0.5) * 120 * (len / h);
        blade(x, len, lean, 2.2 + rnd() * 3.2, 0.25 + 0.75 * rnd());
      }
    };
    tile(COVER_TILE.GRASS, (rnd) => meadow(rnd, 72, 0.45));
    tile(COVER_TILE.SEED, (rnd) => {
      meadow(rnd, 46, 0.35);
      // Panicles: thin stems nodding over at the top, loose branches with
      // fine hanging spikelets (032, 021, 098).
      for (let i = 0; i < 8; i++) {
        const x = 36 + rnd() * (w - 72),
          top = 18 + rnd() * 90,
          lean = (rnd() - 0.5) * 60,
          nod = (rnd() < 0.5 ? -1 : 1) * (14 + rnd() * 18);
        c.strokeStyle = leaf(0.55 + 0.4 * rnd());
        c.lineWidth = 1.5;
        c.beginPath();
        c.moveTo(x, h);
        c.quadraticCurveTo(x + lean * 0.3, (h + top) / 2, x + lean, top);
        c.quadraticCurveTo(x + lean + nod * 0.6, top - 6, x + lean + nod, top + 22);
        c.stroke();
        c.strokeStyle = leaf(0.75, 255);
        c.lineWidth = 1.2;
        for (let k = 0; k < 26; k++) {
          const t = rnd(),
            bx = x + lean + nod * t,
            by = top + 22 * t * t - 6 * t * (1 - t) * 4 + 2,
            len = 5 + 9 * rnd(),
            a = Math.PI / 2 + (rnd() - 0.5) * 1.3;
          c.beginPath();
          c.moveTo(bx, by);
          c.lineTo(bx + Math.cos(a) * len, by + Math.sin(a) * len);
          c.stroke();
        }
      }
    });
    tile(COVER_TILE.CLOVER, (rnd) => {
      meadow(rnd, 24, 0.3);
      // Low broad-leaved cover on short stalks (021 foreground).
      for (let i = 0; i < 46; i++) {
        const x = 20 + rnd() * (w - 40),
          y = h - 30 - rnd() * 210,
          r = 9 + rnd() * 9;
        c.strokeStyle = leaf(0.3);
        c.lineWidth = 2;
        c.beginPath();
        c.moveTo(x + (rnd() - 0.5) * 20, h);
        c.lineTo(x, y);
        c.stroke();
        for (let k = 0; k < 3; k++) {
          const a = (k / 3) * Math.PI * 2 + rnd();
          c.fillStyle = leaf(0.35 + 0.65 * rnd());
          c.beginPath();
          c.ellipse(
            x + Math.cos(a) * r * 0.7,
            y + Math.sin(a) * r * 0.45,
            r,
            r * 0.62,
            a,
            0,
            Math.PI * 2,
          );
          c.fill();
        }
        if (rnd() < 0.18) {
          c.fillStyle = leaf(0.9, 255);
          c.beginPath();
          c.arc(x, y - r * 1.2, 7, 0, Math.PI * 2);
          c.fill();
        }
      }
    });
    tile(COVER_TILE.FERN, (rnd) => {
      // Arching fronds with paired pinnae (052).
      for (let f = 0; f < 7; f++) {
        const x0 = w / 2 + (rnd() - 0.5) * 60,
          side = f % 2 ? 1 : -1,
          reach = 70 + rnd() * 50,
          top = 60 + rnd() * 150;
        const px = (t: number) => x0 + side * reach * t * (0.4 + 0.6 * t),
          py = (t: number) => h - (h - top) * Math.sin(t * Math.PI * 0.62);
        c.strokeStyle = leaf(0.35);
        c.lineWidth = 2.5;
        c.beginPath();
        c.moveTo(px(0), py(0));
        for (let t = 0.05; t <= 1.001; t += 0.05) c.lineTo(px(t), py(t));
        c.stroke();
        for (let t = 0.12; t < 0.98; t += 0.045) {
          const len = 34 * Math.sin(Math.PI * t) * (0.7 + 0.3 * rnd()),
            x = px(t),
            y = py(t);
          for (const s of [-1, 1]) {
            c.fillStyle = leaf(0.35 + 0.6 * rnd());
            c.beginPath();
            c.ellipse(
              x + s * len * 0.15,
              y + s * len * 0.5 - 2,
              3.5,
              len * 0.5,
              side * 0.6,
              0,
              Math.PI * 2,
            );
            c.fill();
          }
        }
      }
    });
    tile(COVER_TILE.SHRUB, (rnd) => {
      // Dense small-leaved bush, rounded crown on a few stems (019, 039).
      c.strokeStyle = leaf(0.15);
      c.lineWidth = 4;
      for (let i = 0; i < 5; i++) {
        c.beginPath();
        c.moveTo(w / 2 + (rnd() - 0.5) * 40, h);
        c.lineTo(w / 2 + (rnd() - 0.5) * 150, h - 120 - rnd() * 140);
        c.stroke();
      }
      for (let i = 0; i < 520; i++) {
        const a = rnd() * Math.PI * 2,
          rr = Math.sqrt(rnd()),
          x = w / 2 + Math.cos(a) * rr * 118,
          y = h - 190 + Math.sin(a) * rr * 175 * (Math.sin(a) > 0 ? 0.95 : 1.05);
        const lit = 0.25 + 0.75 * rnd() * (0.6 + 0.4 * (1 - (y - 120) / 400));
        c.fillStyle = leaf(Math.min(1, lit));
        c.beginPath();
        c.ellipse(x, y, 7 + rnd() * 5, 4 + rnd() * 3, rnd() * Math.PI, 0, Math.PI * 2);
        c.fill();
      }
    });
    tile(COVER_TILE.WEEDS, (rnd) => {
      // Tall verge weeds: leafy stems with flower clusters at the top.
      for (let i = 0; i < 11; i++) {
        const x = 30 + rnd() * (w - 60),
          top = 20 + rnd() * 160,
          lean = (rnd() - 0.5) * 40;
        c.strokeStyle = leaf(0.4 + 0.4 * rnd());
        c.lineWidth = 2.4;
        c.beginPath();
        c.moveTo(x, h);
        c.quadraticCurveTo(x + lean * 0.2, (h + top) / 2, x + lean, top);
        c.stroke();
        for (let k = 0; k < 7; k++) {
          const y = h - (h - top) * (0.15 + 0.12 * k),
            s = k % 2 ? 1 : -1;
          c.fillStyle = leaf(0.3 + 0.6 * rnd());
          c.beginPath();
          c.ellipse(
            x + lean * (1 - (y - top) / (h - top)) + s * 12,
            y,
            15,
            5,
            s * 0.6,
            0,
            Math.PI * 2,
          );
          c.fill();
        }
        c.fillStyle = leaf(0.85, 255);
        for (let k = 0; k < 14; k++) {
          c.beginPath();
          c.arc(x + lean + (rnd() - 0.5) * 34, top + rnd() * 42, 3.5 + rnd() * 3, 0, Math.PI * 2);
          c.fill();
        }
      }
      meadow(rnd, 20, 0.3);
    });
    tile(COVER_TILE.SASA, (rnd) => {
      // Sasa (kumazasa): broad lanceolate leaves fanning from short canes.
      for (let i = 0; i < 9; i++) {
        const x = 30 + rnd() * (w - 60),
          top = 120 + rnd() * 170;
        c.strokeStyle = leaf(0.25);
        c.lineWidth = 2.5;
        c.beginPath();
        c.moveTo(x, h);
        c.lineTo(x + (rnd() - 0.5) * 20, top);
        c.stroke();
        for (let k = 0; k < 6; k++) {
          const a = -0.9 + (k / 5) * 1.8 + (rnd() - 0.5) * 0.3,
            len = 58 + rnd() * 30,
            bx = x + (rnd() - 0.5) * 10,
            by = top + rnd() * 40;
          const tx = bx + Math.sin(a) * len,
            ty = by - Math.cos(a) * len * 0.35 + len * 0.25;
          c.fillStyle = leaf(0.3 + 0.7 * rnd());
          c.beginPath();
          c.moveTo(bx, by);
          c.quadraticCurveTo((bx + tx) / 2 - Math.cos(a) * 11, (by + ty) / 2 - 9, tx, ty);
          c.quadraticCurveTo((bx + tx) / 2 + Math.cos(a) * 11, (by + ty) / 2 + 9, bx, by);
          c.fill();
        }
      }
    });
    tile(COVER_TILE.DRY, (rnd) => {
      // Winter tufts: thin bleached blades, many broken and bent over.
      for (let i = 0; i < 48; i++) {
        const x = 24 + rnd() * (w - 48),
          len = h * (0.2 + 0.6 * rnd()),
          lean = (rnd() - 0.5) * 220 * (len / h);
        blade(x, len, lean, 1.6 + rnd() * 1.8, 0.5 + 0.5 * rnd());
      }
    });
  });
  // Data channels, not colour: no sRGB decode.
  texture.colorSpace = T.NoColorSpace;
  texture.anisotropy = 4;
  return texture;
}

/** Clump layout of one patch geometry: `count` clumps on a jittered grid
 * over `size` metres, `cards` crossed cards each. */
function patchGeometry(size: number, count: number, cards: number, salt: number) {
  const n = Math.ceil(Math.sqrt(count)),
    position: number[] = [],
    uv: number[] = [],
    clump: number[] = [],
    normal: number[] = [],
    index: number[] = [];
  let made = 0;
  for (let j = 0; j < n && made < count; j++)
    for (let i = 0; i < n && made < count; i++, made++) {
      const x = ((i + 0.15 + 0.7 * hash01(i, j, salt)) / n) * size,
        z = ((j + 0.15 + 0.7 * hash01(j, i, salt + 1)) / n) * size,
        yaw = hash01(i, j, salt + 2) * Math.PI,
        seed = hash01(i, j, salt + 3);
      for (let k = 0; k < cards; k++) {
        const base = position.length / 3;
        for (const [u, v] of [
          [0, 0],
          [1, 0],
          [0, 1],
          [1, 1],
        ]) {
          position.push(x, v, z);
          uv.push(u, v);
          normal.push(0, 1, 0);
          clump.push(yaw + (k * Math.PI) / cards, seed, k, 0);
        }
        index.push(base, base + 1, base + 2, base + 1, base + 3, base + 2);
      }
    }
  const g = new T.InstancedBufferGeometry();
  g.setAttribute('position', new T.Float32BufferAttribute(position, 3));
  g.setAttribute('uv', new T.Float32BufferAttribute(uv, 2));
  g.setAttribute('normal', new T.Float32BufferAttribute(normal, 3));
  g.setAttribute('gcClump', new T.Float32BufferAttribute(clump, 4));
  g.setIndex(index);
  return g;
}

/** Texels per side of the ground window. */
export const WINDOW_TEXELS = GROUND_COVER.window * TILE_RES + 1;

/** Fill the ground window (RGBA per texel: carved height, clear metres
 * beyond the road edge, grass density, and forest, farm and flat-paddy
 * weights packed as forest·31 + 32·farm·31 + paddy) from the finest tiles.
 * A tile still streaming leaves its texels bare (no cover). */
export function fillGroundWindow(
  out: Float32Array,
  tiles: readonly (TileMeshData | null)[],
  perSide = GROUND_COVER.window,
) {
  const side = TILE_RES + 1,
    texels = perSide * TILE_RES + 1;
  out.fill(0);
  for (let tz = 0; tz < perSide; tz++)
    for (let tx = 0; tx < perSide; tx++) {
      const data = tiles[tz * perSide + tx];
      if (!data || data.cover.length < side * side * 2) continue;
      for (let j = 0; j < side; j++)
        for (let i = 0; i < side; i++) {
          const o = ((tz * TILE_RES + j) * texels + tx * TILE_RES + i) * 4,
            v = j * side + i;
          const field = data.shade[v * 4 + 2],
            flat = smoothstep(0.95, 0.985, data.normals[v * 3 + 1]),
            rock = data.splat[v * 4],
            sand = data.splat[v * 4 + 2];
          const farm = smoothstep(0.42, 0.5, field) * (1 - rock) * (1 - sand),
            forest = Math.min(1, data.shade[v * 4 + 1]);
          out[o] = data.heights[v];
          out[o + 1] = data.cover[v * 2 + 1];
          out[o + 2] = data.cover[v * 2];
          out[o + 3] =
            Math.round(forest * 31) + 32 * Math.round(farm * 31) + Math.min(0.99, farm * flat);
        }
    }
  return texels;
}

/** CPU twin of the shader's ground read (tests): carved height on the
 * physics triangles and the interpolated masks at (x, z). */
export function sampleGroundWindow(
  window: Float32Array,
  x0: number,
  z0: number,
  x: number,
  z: number,
  texels = WINDOW_TEXELS,
) {
  const fx = (x - x0) / TILE_STEP,
    fz = (z - z0) / TILE_STEP;
  const heights = new Float32Array(4),
    i = Math.min(texels - 2, Math.max(0, Math.floor(fx))),
    j = Math.min(texels - 2, Math.max(0, Math.floor(fz)));
  const at = (di: number, dj: number) => ((j + dj) * texels + i + di) * 4;
  heights[0] = window[at(0, 0)];
  heights[1] = window[at(1, 0)];
  heights[2] = window[at(0, 1)];
  heights[3] = window[at(1, 1)];
  const height = gridHeight(heights, 2, fx - i, fz - j, TILE_STEP);
  const u = fx - i,
    v = fz - j;
  const lerp = (k: number) =>
    (window[at(0, 0) + k] * (1 - u) + window[at(1, 0) + k] * u) * (1 - v) +
    (window[at(0, 1) + k] * (1 - u) + window[at(1, 1) + k] * u) * v;
  return { height, edge: lerp(1), grass: lerp(2) };
}

const COVER_VERTEX = /* glsl */ `
attribute vec4 gcPatch;
attribute vec4 gcClump;
uniform highp sampler2D gcGround;
uniform vec4 gcWindow;
uniform vec3 gcEye;
uniform vec4 gcRings;
uniform vec4 gcTier;
uniform vec4 gcCar;
varying vec4 vGc;
varying vec3 vGcTint;
varying vec3 vGcAccent;
${SEASON_DECL_GLSL}
${OW_NOISE_GLSL}
${FLORA_ZONE_GLSL}
${OW_MEADOW_GLSL}
vec3 gcPos;
vec3 gcNormal;
vec4 gcFetch(ivec2 c) {
  int n = int(gcWindow.w) - 1;
  return texelFetch(gcGround, clamp(c, ivec2(0), ivec2(n)), 0);
}
// (grass, edge clearance, forest, paddy) of one texel; farm in gcFarm.
float gcFarm;
vec4 gcMasks(vec4 t) {
  float f = floor(t.w);
  return vec4(t.z, t.y, mod(f, 32.0) / 31.0, fract(t.w));
}
float gcFarmOf(vec4 t) { return floor(floor(t.w) / 32.0) / 31.0; }
void gcGroundAt(vec2 xz, out float h, out vec3 n, out vec4 m) {
  vec2 f = (xz - gcWindow.xy) / gcWindow.z;
  vec2 i = floor(f), u = f - i;
  ivec2 c = ivec2(i);
  vec4 a = gcFetch(c), b = gcFetch(c + ivec2(1, 0)), e = gcFetch(c + ivec2(0, 1)), d = gcFetch(c + ivec2(1, 1));
  // The physics triangles: quads split along the (i, j)-(i+1, j+1) diagonal.
  float gx, gz;
  if (u.x >= u.y) { gx = b.x - a.x; gz = d.x - b.x; } else { gx = d.x - e.x; gz = e.x - a.x; }
  h = a.x + gx * u.x + gz * u.y;
  n = normalize(vec3(-gx / gcWindow.z, 1.0, -gz / gcWindow.z));
  m = mix(mix(gcMasks(a), gcMasks(b), u.x), mix(gcMasks(e), gcMasks(d), u.x), u.y);
  gcFarm = mix(mix(gcFarmOf(a), gcFarmOf(b), u.x), mix(gcFarmOf(e), gcFarmOf(d), u.x), u.y);
  if (f.x < 0.0 || f.y < 0.0 || f.x > gcWindow.w - 1.0 || f.y > gcWindow.w - 1.0) m.x = 0.0;
}
vec3 gcSeason(vec3 spring, vec3 summer, vec3 autumn, vec3 winter) {
  return owSeason.x * spring + owSeason.y * summer + owSeason.z * autumn + owSeason.w * winter;
}
float gcSeasonF(float spring, float summer, float autumn, float winter) {
  return dot(owSeason, vec4(spring, summer, autumn, winter));
}
vec2 gcUv;
void gcPlace() {
  float ring = gcPatch.w;
  float size = ring > 1.5 ? ${GROUND_COVER.understoryPatch.toFixed(1)} : ${GROUND_COVER.patch.toFixed(1)};
  // One of the eight symmetries of the square per patch: the clump layout
  // never repeats on a visible grid.
  vec2 local = position.xz;
  float r = gcPatch.z;
  if (mod(r, 2.0) >= 1.0) local = local.yx;
  if (mod(floor(r * 0.5), 2.0) >= 1.0) local.x = size - local.x;
  if (r >= 4.0) local.y = size - local.y;
  vec2 xz = gcPatch.xy + local;
  float hg; vec3 tn; vec4 m;
  gcGroundAt(xz, hg, tn, m);
  float seed = fract(gcClump.y + owHash(gcPatch.xy * 0.25 + r * 7.1));
  float seed2 = owHash(xz * 3.7 + 1.3), seed3 = owHash(xz * 5.3 + 7.9);
  float dist = distance(gcEye.xz, xz);
  float grass = m.x, edge = m.y, forest = m.z, paddy = m.w;
  // Farm plots (terrain-material): paddies on the flat and crops elsewhere
  // grow no grass; their bunds and the fallow plots do.
  vec2 g = vec2(xz.x / 34.0, xz.y / 61.0);
  vec2 cell = floor(g), fp = fract(g);
  float edgeM = min(min(fp.x, 1.0 - fp.x) * 34.0, min(fp.y, 1.0 - fp.y) * 61.0);
  float paddies = paddy * step(owHash(cell + 17.0), 0.82) * smoothstep(0.3, 0.55, edgeM);
  float crops = gcFarm * step(owHash(cell + 29.0), 0.7) * smoothstep(0.4, 0.8, edgeM);
  grass *= 1.0 - max(paddies, crops);
  float macro = owFbm(xz * 0.0021, 1.0), meso = owFbm(xz * 0.019, 1.0);
  vec3 meadow = owMeadowColour(xz, macro, meso, forest);
  float tile, height, width, keep, lean = 0.12;
  vec3 tint, accent = vec3(0.0);
  if (ring < 1.5) {
    // Grass carpet: off the carriageway and shoulder, mown short on the
    // first metres of the verge, thin under the trees, patchy in the open.
    grass *= smoothstep(0.2, 0.8, edge);
    grass *= 1.0 - 0.75 * smoothstep(0.3, 0.75, forest);
    grass *= smoothstep(0.12, 0.42, owFbm(xz * 0.13 + 3.1, 1.0) + 0.18 - 0.25 * owSnowCover);
    float mown = mix(0.45, 1.0, smoothstep(0.6, 3.2, edge));
    // Fewer, larger clumps beyond the full-density radius (the far ring's
    // geometry carries gcTier.z of the near ring's clumps).
    float rel = ring > 0.5 ? gcTier.z : 1.0;
    float thin = clamp(gcRings.x / max(dist, 1e-3), 0.0, 1.0) / rel;
    keep = grass * gcTier.x * min(1.0, thin) * (1.0 - 0.8 * owSnowCover);
    float grow = inversesqrt(clamp(thin * rel, 0.08, 1.0));
    float seedShare = gcSeasonF(0.06, 0.22, 0.5, 0.0) * smoothstep(0.8, 3.5, edge);
    tile = owSnowCover > 0.5 ? ${COVER_TILE.DRY}.0 :
      (seed2 < seedShare ? ${COVER_TILE.SEED}.0 : (seed2 > 0.9 && forest < 0.3 ? ${COVER_TILE.CLOVER}.0 : ${COVER_TILE.GRASS}.0));
    float lush = 0.75 + 0.5 * smoothstep(0.3, 0.7, meso);
    height = (0.3 + 0.24 * seed3) * lush * mown * gcSeasonF(0.78, 1.0, 1.08, 0.55);
    if (tile == ${COVER_TILE.SEED}.0) height *= 1.25;
    width = (0.5 + 0.18 * seed) * grow;
    height *= mix(1.0, 1.25, smoothstep(1.0, 2.5, grow));
    tint = meadow;
    accent = gcSeason(vec3(0.17, 0.2, 0.07), vec3(0.3, 0.22, 0.11), vec3(0.42, 0.33, 0.18), vec3(0.34, 0.3, 0.24));
    if (tile == ${COVER_TILE.CLOVER}.0) accent = vec3(0.62, 0.62, 0.56);
    if (tile == ${COVER_TILE.DRY}.0) tint = vec3(0.3, 0.25, 0.17);
  } else {
    // Understory: ferns and sasa on the forest floor, shrub bands at road
    // edges and forest margins, tall weeds on the meadow verges.
    float floorW = smoothstep(0.3, 0.7, forest);
    float margin = smoothstep(0.06, 0.3, forest) * (1.0 - smoothstep(0.6, 0.9, forest));
    float verge = smoothstep(1.4, 2.6, edge) * (1.0 - smoothstep(6.0, 10.0, edge));
    float ground = smoothstep(0.05, 0.3, grass) * smoothstep(1.0, 1.8, edge);
    float sasaZ = smoothstep(0.45, 0.6, owFloraZone(xz, 3.3));
    float want = floorW * 0.9 + verge * (0.3 + 0.5 * smoothstep(0.05, 0.3, forest)) + margin * 0.45 + 0.05;
    keep = ground * want * gcTier.y;
    if (seed2 < floorW) tile = seed3 < sasaZ ? ${COVER_TILE.SASA}.0 : ${COVER_TILE.FERN}.0;
    else if (seed2 < floorW + (verge + margin) * 0.7) tile = forest > 0.08 || seed3 < 0.35 ? ${COVER_TILE.SHRUB}.0 : ${COVER_TILE.WEEDS}.0;
    else tile = ${COVER_TILE.WEEDS}.0;
    float grow = 1.0 + 0.6 * smoothstep(gcRings.z * 0.5, gcRings.z, dist);
    if (tile == ${COVER_TILE.SHRUB}.0) {
      height = 0.75 + 0.7 * seed3;
      width = height * (1.1 + 0.4 * seed);
      tint = gcSeason(vec3(0.07, 0.12, 0.035), vec3(0.05, 0.09, 0.03), mix(vec3(0.3, 0.06, 0.025), vec3(0.32, 0.16, 0.03), seed3), vec3(0.09, 0.07, 0.055));
      lean = 0.02;
    } else if (tile == ${COVER_TILE.SASA}.0) {
      height = (0.6 + 0.5 * seed3) * gcSeasonF(0.95, 1.0, 1.0, 0.8);
      width = 0.9 + 0.5 * seed;
      tint = gcSeason(vec3(0.06, 0.11, 0.03), vec3(0.045, 0.09, 0.025), vec3(0.06, 0.09, 0.03), vec3(0.07, 0.085, 0.04));
      // Kumazasa leaves whiten at the edges in winter.
      accent = vec3(0.4, 0.38, 0.3);
    } else if (tile == ${COVER_TILE.FERN}.0) {
      height = (0.5 + 0.45 * seed3) * gcSeasonF(0.8, 1.0, 0.95, 0.45);
      width = height * 1.5;
      tint = gcSeason(vec3(0.09, 0.16, 0.035), vec3(0.06, 0.12, 0.03), vec3(0.3, 0.17, 0.05), vec3(0.14, 0.08, 0.04));
    } else {
      height = (0.55 + 0.5 * seed3) * gcSeasonF(0.6, 1.0, 1.05, 0.5);
      width = 0.6 + 0.3 * seed;
      tint = gcSeason(meadow * 1.05, meadow * vec3(1.0, 1.05, 0.9), vec3(0.3, 0.22, 0.09), vec3(0.24, 0.19, 0.12));
      float hue = owHash(cell * 3.1 + floor(xz * 0.05));
      accent = gcSeason(hue < 0.5 ? vec3(0.62, 0.6, 0.55) : vec3(0.55, 0.42, 0.04),
        hue < 0.4 ? vec3(0.62, 0.48, 0.03) : (hue < 0.7 ? vec3(0.62, 0.6, 0.55) : vec3(0.3, 0.12, 0.4)),
        vec3(0.36, 0.24, 0.12), vec3(0.3, 0.25, 0.18));
    }
    width *= grow;
    height *= mix(1.0, 1.15, grow - 1.0);
  }
  // Pressed flat and pushed aside under the player's car.
  if (gcCar.w > 0.5) {
    vec2 dp = xz - gcCar.xy;
    float s = sin(gcCar.z), c = cos(gcCar.z);
    float along = dp.x * s + dp.y * c, across = dp.x * c - dp.y * s;
    float under = (1.0 - smoothstep(2.4, 3.1, abs(along))) * (1.0 - smoothstep(0.85, 1.35, abs(across)));
    height *= 1.0 - 0.85 * under;
  }
  float fadeEnd = ring > 1.5 ? gcRings.z : gcRings.y;
  float fade = 1.0 - smoothstep(fadeEnd * 0.72, fadeEnd, dist);
  float vis = step(seed, keep) * fade;
  height *= vis;
  width *= vis;
  // Card: across its own yaw, up the card with a lean that grows to the tip.
  float yaw = gcClump.x + seed * 6.2832;
  vec2 across = vec2(cos(yaw), sin(yaw));
  vec2 leanDir = vec2(cos(seed3 * 6.2832), sin(seed3 * 6.2832));
  float v = uv.y;
  vec2 wind = studioWind.xy;
  float speed = length(wind);
  vec2 wdir = speed > 1e-3 ? wind / speed : vec2(0.7071, 0.7071);
  float amp = clamp(speed / 10.0, 0.15, 1.6) * (0.6 + 0.4 * studioWind.w) * (ring > 1.5 ? 0.05 : 0.12);
  float sway = amp * (sin(1.7 * studioWind.z + dot(xz, vec2(0.37, 0.61))) + 0.35 * sin(4.3 * studioWind.z + dot(xz, vec2(1.3, 0.9))));
  vec2 bend = (leanDir * lean + wdir * sway) * height * v * v;
  gcPos = vec3(xz.x, hg - 0.03, xz.y);
  gcPos.xz += across * (uv.x - 0.5) * width + bend;
  gcPos.y += v * height * (1.0 - 0.5 * dot(bend, bend) / max(height * height, 1e-4));
  // Lit like the ground under it, leaning a little toward the card's face.
  gcNormal = normalize(tn + vec3(-across.y, 0.0, across.x) * (uv.x - 0.5) * 0.4 + vec3(0.0, 0.25, 0.0));
  float col = mod(tile, ${TILES}.0);
  vGc = vec4(tile, v, seed, smoothstep(12.0, 40.0, dist));
  vGcTint = tint * (0.85 + 0.3 * seed2);
  vGcAccent = accent;
  // Atlas window of the tile (2 px gutter).
  gcUv = vec2((col + 0.008 + uv.x * 0.984) / ${TILES}.0, uv.y);
}
`;

const COVER_FRAGMENT = /* glsl */ `
varying vec4 vGc;
varying vec3 vGcTint;
varying vec3 vGcAccent;
${SEASON_DECL_GLSL}
`;

/** Lit cover material: atlas coverage, season colours, ground-like normals,
 * sun through the blades when looking toward it. */
function coverMaterial(uniforms: Record<string, T.IUniform>, map: T.Texture) {
  const material = new T.MeshStandardMaterial({
    name: 'Festival ground cover',
    map,
    alphaTest: 0.5,
    side: T.DoubleSide,
    roughness: 0.86,
    metalness: 0,
  });
  chainShaderHook(material, 'festival-ground-cover-v1', (shader) => {
    Object.assign(shader.uniforms, uniforms);
    bindSeasonUniforms(shader);
    useStudioUniforms(shader, ['studioWind'], 'vertex');
    useStudioUniforms(shader, ['studioSunDir'], 'fragment');
    injectAfter(shader, 'common', COVER_VERTEX, 'vertex');
    injectAfter(
      shader,
      'beginnormal_vertex',
      'gcPlace();\nobjectNormal = gcNormal;\nvMapUv = gcUv;',
      'vertex',
    );
    injectAfter(shader, 'begin_vertex', 'transformed = gcPos;', 'vertex');
    injectAfter(shader, 'common', COVER_FRAGMENT, 'fragment');
    injectAfter(
      shader,
      'map_fragment',
      /* glsl */ `{
  vec4 tex = diffuseColor;
  // Dark at the base, lit at the tips; far clumps average toward the
  // ground's own tone (the carpet fades into the terrain colour).
  float base = mix(mix(0.38, 1.16, smoothstep(0.0, 0.85, vGc.y)), 0.92, vGc.w * 0.65);
  vec3 blade = vGcTint * base * (0.55 + 0.75 * tex.g);
  float accent = clamp(tex.r * 1.4, 0.0, 1.0);
  // Sasa: pale withered leaf margins in winter.
  if (abs(vGc.x - ${COVER_TILE.SASA}.0) < 0.5) accent = owSeason.w * smoothstep(0.75, 0.95, tex.g) * 0.6;
  diffuseColor.rgb = mix(blade, vGcAccent * (0.7 + 0.45 * tex.g), accent);
  // Thin blades keep their coverage when minified.
  diffuseColor.a = tex.a * (1.0 + 1.3 * smoothstep(6.0, 40.0, length(vViewPosition)));
}`,
      'fragment',
    );
    // No back-face flip: both faces are lit like the ground under them.
    injectAfter(shader, 'normal_fragment_begin', 'normal = normalize(vNormal);', 'fragment');
    injectAfter(
      shader,
      'lights_fragment_end',
      /* glsl */ `
#if NUM_DIR_LIGHTS > 0
{
  vec3 sunView = normalize((viewMatrix * vec4(studioSunDir, 0.0)).xyz);
  float back = pow(saturate(dot(-normalize(vViewPosition), sunView)), 4.0);
  reflectedLight.directDiffuse += 0.55 * back * vGc.y * diffuseColor.rgb * directionalLights[0].color;
}
#endif`,
      'fragment',
    );
  });
  return material;
}

interface Ring {
  mesh: T.Mesh;
  geometry: T.InstancedBufferGeometry;
  attribute: T.InstancedBufferAttribute;
  capacity: number;
}

const scratchBox = new T.Box3();

export class GroundCover {
  readonly root = new T.Group();
  readonly stats = { grass: 0, understory: 0, windowTiles: 0 };
  private readonly atlas = coverAtlas();
  private readonly window = new Float32Array(WINDOW_TEXELS * WINDOW_TEXELS * 4);
  private readonly ground: T.DataTexture;
  private readonly uniforms = {
    gcGround: { value: null as T.Texture | null },
    gcWindow: { value: new T.Vector4(0, 0, TILE_STEP, WINDOW_TEXELS) },
    gcEye: { value: new T.Vector3() },
    gcRings: { value: new T.Vector4() },
    gcTier: { value: new T.Vector4(1, 1, GROUND_COVER.clumps[1] / GROUND_COVER.clumps[0], 0) },
    gcCar: { value: new T.Vector4() },
  };
  private readonly material: T.MeshStandardMaterial;
  private readonly rings: Ring[];
  private windowX0 = NaN;
  private windowZ0 = NaN;
  private windowVersion = -1;
  private readonly windowTiles: (TileMeshData | null)[] = [];
  private readonly eye = new T.Vector3();
  private readonly frustum = new T.Frustum();
  private readonly projection = new T.Matrix4();
  private readonly visible: number[] = [];
  constructor() {
    this.root.name = 'Festival ground cover (grass carpet, understory)';
    this.ground = new T.DataTexture(
      this.window,
      WINDOW_TEXELS,
      WINDOW_TEXELS,
      T.RGBAFormat,
      T.FloatType,
    );
    this.ground.minFilter = this.ground.magFilter = T.NearestFilter;
    this.ground.generateMipmaps = false;
    this.ground.needsUpdate = true;
    this.uniforms.gcGround.value = this.ground;
    this.material = coverMaterial(this.uniforms, this.atlas);
    const [near, far, under] = GROUND_COVER.clumps;
    this.rings = [
      this.ring(patchGeometry(GROUND_COVER.patch, near, 3, 0x6c1), 'near grass', 1300),
      this.ring(patchGeometry(GROUND_COVER.patch, far, 3, 0x6c9), 'far grass', 1700),
      this.ring(patchGeometry(GROUND_COVER.understoryPatch, under, 3, 0x6d3), 'understory', 2600),
    ];
  }
  private ring(geometry: T.InstancedBufferGeometry, name: string, capacity: number): Ring {
    const attribute = new T.InstancedBufferAttribute(new Float32Array(capacity * 4), 4);
    attribute.setUsage(T.DynamicDrawUsage);
    geometry.setAttribute('gcPatch', attribute);
    geometry.instanceCount = 0;
    const mesh = new T.Mesh(geometry, this.material);
    mesh.name = `Festival ground cover ${name}`;
    mesh.frustumCulled = false;
    mesh.matrixAutoUpdate = false;
    mesh.receiveShadow = true;
    mesh.castShadow = false;
    this.root.add(mesh);
    return { mesh, geometry, attribute, capacity };
  }
  /** Re-centre the ground window on the camera's finest tile and refill it
   * when a tile in it arrived or left. */
  private updateWindow(
    x: number,
    z: number,
    version: number,
    tileAt: (x0: number, z0: number) => TileMeshData | null,
  ) {
    const half = Math.floor(GROUND_COVER.window / 2);
    const x0 = (Math.floor(x / TILE_SIZE) - half) * TILE_SIZE,
      z0 = (Math.floor(z / TILE_SIZE) - half) * TILE_SIZE;
    const moved = x0 !== this.windowX0 || z0 !== this.windowZ0;
    if (!moved && version === this.windowVersion) return;
    this.windowVersion = version;
    let changed = moved,
      resident = 0;
    for (let tz = 0, k = 0; tz < GROUND_COVER.window; tz++)
      for (let tx = 0; tx < GROUND_COVER.window; tx++, k++) {
        const data = tileAt(x0 + tx * TILE_SIZE, z0 + tz * TILE_SIZE);
        if (data) resident++;
        if (this.windowTiles[k] !== data) changed = true;
        this.windowTiles[k] = data;
      }
    this.stats.windowTiles = resident;
    if (!changed) return;
    this.windowX0 = x0;
    this.windowZ0 = z0;
    fillGroundWindow(this.window, this.windowTiles);
    this.uniforms.gcWindow.value.set(x0, z0, TILE_STEP, WINDOW_TEXELS);
    this.ground.needsUpdate = true;
  }
  private texel(x: number, z: number) {
    const i = Math.round((x - this.windowX0) / TILE_STEP),
      j = Math.round((z - this.windowZ0) / TILE_STEP);
    if (!(i >= 0 && j >= 0 && i < WINDOW_TEXELS && j < WINDOW_TEXELS)) return -1;
    return (j * WINDOW_TEXELS + i) * 4;
  }
  /** Patches of `size` m whose centre lies in [from, to) metres of the eye,
   * whose ground carries cover and whose box meets the view. Returns
   * (cx, cz, distance) triples. */
  private collect(size: number, from: number, to: number, top: number) {
    const out = this.visible;
    out.length = 0;
    if (to <= from) return out;
    const e = this.eye,
      steps = size / TILE_STEP,
      reach = to + size;
    const c0x = Math.floor((e.x - reach) / size),
      c1x = Math.floor((e.x + reach) / size),
      c0z = Math.floor((e.z - reach) / size),
      c1z = Math.floor((e.z + reach) / size);
    for (let cz = c0z; cz <= c1z; cz++)
      for (let cx = c0x; cx <= c1x; cx++) {
        const x = cx * size,
          z = cz * size,
          d = Math.hypot(x + size / 2 - e.x, z + size / 2 - e.z);
        if (d < from || d >= to) continue;
        let minY = Infinity,
          maxY = -Infinity,
          cover = 0;
        for (let j = 0; j <= steps; j++)
          for (let i = 0; i <= steps; i++) {
            const o = this.texel(x + i * TILE_STEP, z + j * TILE_STEP);
            if (o < 0) continue;
            minY = Math.min(minY, this.window[o]);
            maxY = Math.max(maxY, this.window[o]);
            cover = Math.max(cover, this.window[o + 2]);
          }
        if (cover <= 0.01) continue;
        scratchBox.min.set(x - 1, minY - 0.2, z - 1);
        scratchBox.max.set(x + size + 1, maxY + top, z + size + 1);
        if (!this.frustum.intersectsBox(scratchBox)) continue;
        out.push(cx, cz, d);
      }
    return out;
  }
  private fill(ring: Ring, cells: number[], size: number, code: number) {
    const order: number[] = [];
    for (let k = 0; k < cells.length; k += 3) order.push(k);
    order.sort((a, b) => cells[a + 2] - cells[b + 2]);
    const data = ring.attribute.array as Float32Array,
      n = Math.min(ring.capacity, order.length);
    for (let k = 0; k < n; k++) {
      const c = order[k],
        cx = cells[c],
        cz = cells[c + 1];
      data[k * 4] = cx * size;
      data[k * 4 + 1] = cz * size;
      data[k * 4 + 2] = Math.floor(hash01(cx, cz, 0x5c3) * 8);
      data[k * 4 + 3] = code;
    }
    ring.geometry.instanceCount = n;
    ring.attribute.clearUpdateRanges();
    ring.attribute.addUpdateRange(0, n * 4);
    ring.attribute.needsUpdate = true;
    return n;
  }
  /** Per frame: window, rings and culling. `car` = the player's (x, z,
   * yaw) or null. */
  update(
    camera: T.Camera,
    preset: QualityPreset,
    version: number,
    tileAt: (x0: number, z0: number) => TileMeshData | null,
    car: { x: number; z: number; yaw: number } | null,
  ) {
    const range = GROUND_COVER.grass[preset],
      under = GROUND_COVER.understory[preset];
    this.root.visible = range > 0 || under > 0;
    if (!this.root.visible) return;
    camera.getWorldPosition(this.eye);
    this.updateWindow(this.eye.x, this.eye.z, version, tileAt);
    this.uniforms.gcEye.value.copy(this.eye);
    const full = GROUND_COVER.full[preset],
      share = GROUND_COVER.clumps[1] / GROUND_COVER.clumps[0],
      // The far geometry's density equals the thinned near density here.
      split = Math.min(range, full / share),
      [grassDensity, underDensity] = GROUND_COVER.density[preset];
    this.uniforms.gcRings.value.set(full, range, under, split);
    this.uniforms.gcTier.value.set(grassDensity, underDensity, share, 0);
    if (car) this.uniforms.gcCar.value.set(car.x, car.z, car.yaw, 1);
    else this.uniforms.gcCar.value.w = 0;
    this.projection.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse);
    this.frustum.setFromProjectionMatrix(this.projection);
    // A camera high above the ground sees no blades.
    const below = this.texel(
      Math.round(this.eye.x / TILE_STEP) * TILE_STEP,
      Math.round(this.eye.z / TILE_STEP) * TILE_STEP,
    );
    const height = below >= 0 ? this.eye.y - this.window[below] : Infinity;
    const reach = (r: number) => (height > r * 0.8 ? 0 : r);
    const [nearRing, farRing, underRing] = this.rings,
      patch = GROUND_COVER.patch,
      big = GROUND_COVER.understoryPatch;
    this.stats.grass =
      this.fill(nearRing, this.collect(patch, 0, reach(split), 0.9), patch, 0) +
      this.fill(farRing, this.collect(patch, split, reach(range + 2), 1.1), patch, 1);
    this.stats.understory = this.fill(underRing, this.collect(big, 0, reach(under + 4), 2), big, 2);
  }
  dispose() {
    for (const ring of this.rings) ring.geometry.dispose();
    this.material.dispose();
    this.atlas.dispose();
    this.ground.dispose();
    this.root.removeFromParent();
  }
}
