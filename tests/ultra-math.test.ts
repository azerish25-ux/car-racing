import { describe, expect, it } from 'vitest';
import * as T from 'three';
import { TEMPORAL_AA, jitterOffset } from '../src/rendering/studio/temporal-aa.ts';
import { casPeak, casSharpen } from '../src/rendering/ultra/taa-sharpen.ts';
import {
  AO_TEMPORAL,
  accumulateAo,
  aoNoiseOffset,
  reprojectUv,
  viewZFromDepth,
} from '../src/rendering/ultra/ao-temporal.ts';
import { balancedMidExtent, cascadeSplits, cascadeTexel } from '../src/rendering/ultra/cascades.ts';
import {
  HIZ,
  SSR,
  buildDepthPyramid,
  cubeUvDefines,
  fresnelRoughness,
  hizLevelSizes,
  raySeed,
  sampleGgx,
  traceHiz,
} from '../src/rendering/ultra/ssr.ts';
import {
  SSR_MASK,
  decodeSsrRoughness,
  encodeSsrRoughness,
  ssrLayerRoughness,
} from '../src/rendering/ultra/ssr-mask.ts';
import {
  REPLAY_LENS,
  circleOfConfusion,
  focalLength,
  thinLensScale,
} from '../src/rendering/ultra/replay-lens.ts';
import {
  henyeyGreenstein,
  shaftStrength,
  sunScreenPosition,
} from '../src/rendering/ultra/light-shafts.ts';

describe('jitter sequences', () => {
  it('cycles the TAA Halton jitter with a stratified, zero-mean pattern', () => {
    const seen = new Set<string>();
    for (let i = 0; i < TEMPORAL_AA.samples; i++) seen.add(jitterOffset(i).toArray().join());
    expect(seen.size).toBe(TEMPORAL_AA.samples);
  });
  it('rotates SSR rays by a 16-frame Halton(2,3) seed in [0, 1)', () => {
    const seeds = Array.from({ length: 16 }, (_, i) => raySeed(i));
    expect(new Set(seeds.map((s) => s.join())).size).toBe(16);
    for (const [u, v] of seeds) {
      expect(u).toBeGreaterThanOrEqual(0);
      expect(u).toBeLessThan(1);
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThan(1);
    }
    expect(raySeed(16)).toEqual(raySeed(0));
    expect(raySeed(-1)).toEqual(raySeed(15));
    // Stratified: every quarter of [0, 1) holds 4 of the 16 first coordinates.
    const quarters = [0, 0, 0, 0];
    for (const [u] of seeds) quarters[Math.floor(u * 4)]++;
    expect(quarters).toEqual([4, 4, 4, 4]);
  });
  it('offsets the GTAO noise by a low-discrepancy R2 sequence, frame 0 at the origin', () => {
    expect(aoNoiseOffset(0).toArray()).toEqual([0, 0]);
    const offsets = Array.from({ length: 32 }, (_, i) => aoNoiseOffset(i + 1));
    expect(new Set(offsets.map((o) => o.toArray().join())).size).toBe(32);
    for (const o of offsets) {
      expect(o.x).toBeGreaterThanOrEqual(0);
      expect(o.x).toBeLessThan(64);
      expect(o.y).toBeGreaterThanOrEqual(0);
      expect(o.y).toBeLessThan(64);
    }
  });
});

describe('reprojection', () => {
  function camera(position: T.Vector3, target: T.Vector3) {
    const c = new T.PerspectiveCamera(50, 16 / 9, 0.045, 7000);
    c.position.copy(position);
    c.lookAt(target);
    c.updateMatrixWorld(true);
    c.updateProjectionMatrix();
    return c;
  }
  it('inverts three’s perspective depth', () => {
    const c = camera(new T.Vector3(), new T.Vector3(0, 0, -1));
    for (const z of [0.2, 3, 40, 900]) {
      const clip = new T.Vector4(0, 0, -z, 1).applyMatrix4(c.projectionMatrix);
      const depth = (clip.z / clip.w) * 0.5 + 0.5;
      expect(viewZFromDepth(depth, c.near, c.far)).toBeCloseTo(-z, z > 100 ? 1 : 4);
    }
  });
  it('maps a static world point to its previous screen position under camera motion', () => {
    const before = camera(new T.Vector3(0, 1.3, 6), new T.Vector3(0, 0.6, 0));
    const now = camera(new T.Vector3(0.6, 1.25, 5.2), new T.Vector3(0.1, 0.6, 0));
    const previousViewProjection = new T.Matrix4().multiplyMatrices(
      before.projectionMatrix,
      before.matrixWorldInverse,
    );
    for (const point of [
      new T.Vector3(0.4, 0.5, 0.2),
      new T.Vector3(-3, 0, -12),
      new T.Vector3(1, 2, -40),
    ]) {
      const projected = point.clone().project(now);
      const uv = new T.Vector2(projected.x * 0.5 + 0.5, projected.y * 0.5 + 0.5);
      const depth = projected.z * 0.5 + 0.5;
      const expected = point.clone().project(before);
      const result = reprojectUv(uv, depth, now, previousViewProjection)!;
      expect(result.x).toBeCloseTo(expected.x * 0.5 + 0.5, 4);
      expect(result.y).toBeCloseTo(expected.y * 0.5 + 0.5, 4);
    }
  });
  it('rejects points behind the previous camera', () => {
    const before = camera(new T.Vector3(0, 1, 0), new T.Vector3(0, 1, -10));
    // Turned around: the point ahead of the current view was behind the previous one.
    const now = camera(new T.Vector3(0, 1, -30), new T.Vector3(0, 1, 0));
    const previous = new T.Matrix4().multiplyMatrices(
      before.projectionMatrix,
      before.matrixWorldInverse,
    );
    const behind = new T.Vector3(0, 1, 5).project(now);
    expect(Math.abs(behind.z)).toBeLessThan(1);
    const uv = new T.Vector2(behind.x * 0.5 + 0.5, behind.y * 0.5 + 0.5);
    expect(reprojectUv(uv, behind.z * 0.5 + 0.5, now, previous)).toBeNull();
    const shared = new T.Vector3(0, 1, -20).project(now);
    expect(
      reprojectUv(
        new T.Vector2(shared.x * 0.5 + 0.5, shared.y * 0.5 + 0.5),
        shared.z * 0.5 + 0.5,
        now,
        previous,
      ),
    ).not.toBeNull();
  });
  it('accumulates AO towards the signal, clamped to the current neighbourhood', () => {
    let value = 0.4;
    for (let i = 0; i < 60; i++) value = accumulateAo(0.8, value, 0.75, 0.85, 0);
    expect(value).toBeCloseTo(0.8, 3);
    // A stale history far outside the neighbourhood is clamped first (no ghost).
    expect(accumulateAo(0.8, 0.1, 0.75, 0.85, 0)).toBeGreaterThan(0.72);
    // Moving pixels trust the history less.
    const still = accumulateAo(0.5, 0.6, 0.4, 0.6, 0),
      moving = accumulateAo(0.5, 0.6, 0.4, 0.6, AO_TEMPORAL.movingPixels);
    expect(Math.abs(moving - 0.5)).toBeLessThan(Math.abs(still - 0.5));
  });
});

describe('contrast-adaptive sharpening', () => {
  it('is the identity at strength 0 and on flat areas', () => {
    const edge = [0.2, 0.2, 0.8, 0.2, 0.2, 0.8, 0.2, 0.2, 0.8];
    expect(casSharpen(edge, 0)).toBeCloseTo(0.2, 10);
    expect(casSharpen(new Array(9).fill(0.43), 1)).toBeCloseTo(0.43, 10);
    expect(casPeak(0)).toBe(-0);
    expect(casPeak(1)).toBeCloseTo(-0.2, 10);
  });
  it('increases local contrast without leaving [0, 1]', () => {
    const edge = [0.3, 0.3, 0.6, 0.3, 0.3, 0.6, 0.3, 0.3, 0.6];
    const sharpened = casSharpen(edge, 0.5);
    expect(sharpened).toBeLessThan(0.3);
    expect(sharpened).toBeGreaterThan(0.2);
    for (const s of [0.25, 0.5, 1])
      for (const n of [
        [0, 0, 1, 0, 0, 1, 0, 0, 1],
        [1, 1, 0, 1, 1, 0, 1, 1, 0],
        [0.9, 0.95, 1, 0.9, 1, 1, 0.92, 1, 1],
      ]) {
        const v = casSharpen(n, s);
        expect(v).toBeGreaterThanOrEqual(0);
        expect(v).toBeLessThanOrEqual(1);
      }
  });
  it('backs off near saturated neighbourhoods (adaptive amplitude)', () => {
    const dark = [0.05, 0.05, 0.1, 0.05, 0.05, 0.1, 0.05, 0.05, 0.1];
    const mid = [0.45, 0.45, 0.5, 0.45, 0.45, 0.5, 0.45, 0.45, 0.5];
    const darkChange = Math.abs(casSharpen(dark, 1) - 0.05) / 0.05;
    const midChange = Math.abs(casSharpen(mid, 1) - 0.45) / 0.45;
    expect(darkChange).toBeGreaterThan(0);
    expect(midChange).toBeGreaterThan(0);
  });
});

describe('shadow cascades', () => {
  it('splits monotonically between near and far, uniform at λ=0 and logarithmic at λ=1', () => {
    const s = cascadeSplits(1, 1000, 3);
    expect(s[0]).toBe(1);
    expect(s[3]).toBe(1000);
    for (let i = 1; i < s.length; i++) expect(s[i]).toBeGreaterThan(s[i - 1]);
    expect(cascadeSplits(1, 1000, 3, 0)).toEqual([1, 334, 667, 1000]);
    const log = cascadeSplits(1, 1000, 3, 1);
    expect(log[1]).toBeCloseTo(10, 8);
    expect(log[2]).toBeCloseTo(100, 8);
    expect(() => cascadeSplits(0, 10, 3)).toThrow();
    expect(() => cascadeSplits(5, 4, 3)).toThrow();
  });
  it('balances the mid texel as the geometric mean of the near and far texels', () => {
    // Circuit scale: ±38 m near at 4096 and a 1.8 km far map at 4096.
    const half = balancedMidExtent(38, 4096, 1800, 4096, 2048);
    const near = cascadeTexel(38, 4096),
      mid = cascadeTexel(half, 2048),
      far = 1800 / 4096;
    expect(mid / near).toBeCloseTo(far / mid, 6);
    expect(half).toBeGreaterThan(1.6 * 38);
    // Always covers the near map's hand-over band, never beyond its cap.
    expect(balancedMidExtent(38, 4096, 200, 4096)).toBeCloseTo(60.8, 6);
    expect(balancedMidExtent(38, 512, 20000, 1024)).toBeLessThanOrEqual(260);
  });
});

describe('screen-space reflection math', () => {
  it('encodes roughness in a band that ordinary opaque output never lands in', () => {
    for (const r of [0, 0.03, 0.2, 0.5, 0.99])
      expect(decodeSsrRoughness(encodeSsrRoughness(r))).toBeCloseTo(r, 6);
    expect(decodeSsrRoughness(1)).toBeNull();
    expect(decodeSsrRoughness(0)).toBeNull();
    // A multisampled edge between glossy paint and an ordinary opaque pixel
    // resolves rough enough that the trace ignores it.
    const edge = decodeSsrRoughness((encodeSsrRoughness(0.03) + 1) / 2);
    expect(edge === null || edge > SSR_MASK.maxRoughness).toBe(true);
    expect(ssrLayerRoughness(0.9, 1, 0.03)).toBeCloseTo(0.03, 10);
    expect(ssrLayerRoughness(0.9, 0, 0.03)).toBe(0.9);
    expect(ssrLayerRoughness(0.9, 0.25, 0.03)).toBeGreaterThan(SSR_MASK.maxRoughness);
  });
  it('sizes a conservative Hi-Z chain from half resolution', () => {
    expect(hizLevelSizes(1920, 1080)).toEqual([
      { width: 960, height: 540 },
      { width: 480, height: 270 },
      { width: 240, height: 135 },
      { width: 120, height: 68 },
      { width: 60, height: 34 },
      { width: 30, height: 17 },
    ]);
    expect(hizLevelSizes(3, 1, 3)).toEqual([
      { width: 2, height: 1 },
      { width: 1, height: 1 },
      { width: 1, height: 1 },
    ]);
    expect(HIZ.levels).toBe(6);
  });
  it('keeps the closest depth of every covered texel, odd edges included', () => {
    const width = 5,
      height = 3;
    const depth = new Float32Array(width * height).fill(0.9);
    depth[2 * width + 4] = 0.3; // bottom-right corner on the odd edge
    const pyramid = buildDepthPyramid(depth, width, height, 3);
    expect(pyramid[0].width).toBe(3);
    expect(pyramid[0].data[1 * 3 + 2]).toBeCloseTo(0.3, 6);
    expect(pyramid[2].data[0]).toBeCloseTo(0.3, 6);
    expect(Math.min(...pyramid[0].data)).toBeCloseTo(0.3, 6);
  });

  // A synthetic view: a floor receding to a wall across the upper half.
  function scene(width: number, height: number) {
    const depth = new Float32Array(width * height);
    for (let y = 0; y < height; y++)
      for (let x = 0; x < width; x++) {
        const v = (y + 0.5) / height;
        // Floor: depth grows toward the horizon (v = 0.5); wall at 0.97 above it.
        depth[y * width + x] = v < 0.5 ? 0.9 + 0.07 * (v / 0.5) : 0.97;
      }
    // A box standing on the floor in front of the wall.
    for (let y = Math.floor(height * 0.35); y < Math.floor(height * 0.6); y++)
      for (let x = Math.floor(width * 0.45); x < Math.floor(width * 0.55); x++)
        depth[y * width + x] = 0.94;
    return depth;
  }
  it('finds the box for an upward reflected ray and agrees with a linear march', () => {
    const width = 256,
      height = 128;
    const depth = scene(width, height);
    const pyramid = buildDepthPyramid(depth, width, height);
    const origin: [number, number, number] = [0.5, 0.2, 0.92];
    const direction: [number, number, number] = [0, 0.6, 0.06];
    const hit = traceHiz(pyramid, origin, direction);
    expect(hit.hit).toBe(true);
    expect(hit.u).toBeCloseTo(0.5, 2);
    expect(hit.v).toBeGreaterThan(0.33);
    expect(hit.v).toBeLessThan(0.4);
    // Reference: march the full-resolution image in single-texel steps.
    let reference = -1;
    for (let t = 0; t <= 1; t += 1 / 4096) {
      const u = origin[0] + direction[0] * t,
        v = origin[1] + direction[1] * t,
        z = origin[2] + direction[2] * t;
      const d = depth[Math.floor(v * height) * width + Math.floor(u * width)];
      if (t > 0.01 && z >= d) {
        reference = v;
        break;
      }
    }
    // Level 0 is half resolution: agree within one coarse texel.
    expect(Math.abs(hit.v - reference)).toBeLessThan(2.5 / height);
    // Hierarchical skipping: far fewer steps than texels crossed.
    expect(hit.iterations).toBeLessThan(((hit.v - origin[1]) * height) / 2);
  });
  it('misses when the ray leaves the screen above every surface', () => {
    const width = 128,
      height = 64;
    const depth = new Float32Array(width * height).fill(0.95);
    const pyramid = buildDepthPyramid(depth, width, height);
    const miss = traceHiz(pyramid, [0.5, 0.5, 0.9], [0.7, 0.2, -0.05]);
    expect(miss.hit).toBe(false);
  });
  it('weights reflections by Schlick-roughness Fresnel and samples a unit GGX lobe', () => {
    expect(fresnelRoughness(1, 0)).toBeCloseTo(SSR.f0, 10);
    expect(fresnelRoughness(0, 0)).toBeCloseTo(1, 10);
    expect(fresnelRoughness(0, 0.6)).toBeCloseTo(0.4, 10);
    let sharp = 0,
      rough = 0;
    for (let i = 0; i < 64; i++) {
      const u1 = (i + 0.5) / 64,
        u2 = ((i * 37) % 64) / 64;
      const a = sampleGgx(0.05, u1, u2),
        b = sampleGgx(0.5, u1, u2);
      expect(Math.hypot(...a)).toBeCloseTo(1, 10);
      expect(Math.hypot(...b)).toBeCloseTo(1, 10);
      sharp += a[2];
      rough += b[2];
    }
    expect(sharp / 64).toBeGreaterThan(0.99);
    expect(rough / 64).toBeLessThan(sharp / 64);
  });
  it('matches three’s CubeUV layout defines', () => {
    const defines = cubeUvDefines(256);
    expect(defines.CUBEUV_MAX_MIP).toBe('6.0');
    expect(defines.CUBEUV_TEXEL_HEIGHT).toBeCloseTo(1 / 256, 12);
    expect(defines.CUBEUV_TEXEL_WIDTH).toBeCloseTo(1 / (3 * 112), 12);
  });
});

describe('physically based replay lens', () => {
  it('derives focal length and background blur from the field of view', () => {
    const f = focalLength(50);
    expect(2 * Math.atan(REPLAY_LENS.sensorHeight / (2 * f)) * (180 / Math.PI)).toBeCloseTo(50, 8);
    const k = thinLensScale(6, 80);
    expect(circleOfConfusion(80, 80, k)).toBeCloseTo(0, 12);
    expect(circleOfConfusion(1e6, 80, k, 1)).toBeCloseTo(k, 4);
    expect(circleOfConfusion(200, 80, k)).toBeGreaterThan(0);
    expect(circleOfConfusion(40, 80, k)).toBeLessThan(0);
    // A trackside telephoto separates the subject; a wide chase lens barely does.
    expect(thinLensScale(6, 80)).toBeGreaterThan(4 * thinLensScale(50, 4.5));
    expect(Math.abs(circleOfConfusion(0.5, 80, k))).toBe(REPLAY_LENS.maxBlur);
    expect(() => thinLensScale(50, 0.001)).toThrow();
  });
});

describe('sun shafts', () => {
  it('uses a normalised Henyey-Greenstein forward lobe', () => {
    let integral = 0;
    const n = 20000;
    for (let i = 0; i < n; i++) {
      const c = -1 + (2 * (i + 0.5)) / n;
      integral += henyeyGreenstein(c) * 2 * Math.PI * (2 / n);
    }
    expect(integral).toBeCloseTo(1, 3);
    expect(henyeyGreenstein(1)).toBeGreaterThan(50 * henyeyGreenstein(0));
  });
  it('scatter strength follows the lighting and the air, never at night or overcast', () => {
    expect(shaftStrength('night', 0.3, 0)).toBe(0);
    expect(shaftStrength('studio', 0.3, 0)).toBe(0);
    expect(shaftStrength('day', 1, 0)).toBe(0);
    expect(shaftStrength('sunset', 0.3, 0)).toBeGreaterThan(shaftStrength('day', 0.3, 0));
    expect(shaftStrength('day', 0.3, 1)).toBeGreaterThan(shaftStrength('day', 0.3, 0));
  });
  it('projects the sun direction to the screen and flags it behind the camera', () => {
    const camera = new T.PerspectiveCamera(50, 1.6, 0.1, 1000);
    camera.position.set(3, 2, 1);
    const direction = new T.Vector3(1, 0.4, -0.5).normalize();
    camera.lookAt(camera.position.clone().add(direction));
    camera.updateMatrixWorld(true);
    const p = sunScreenPosition(camera, direction);
    expect(p.z).toBe(1);
    expect(p.x).toBeCloseTo(0.5, 6);
    expect(p.y).toBeCloseTo(0.5, 6);
    expect(sunScreenPosition(camera, direction.clone().negate()).z).toBe(0);
  });
});
