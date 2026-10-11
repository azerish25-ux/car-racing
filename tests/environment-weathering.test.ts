import { afterEach, describe, expect, it, vi } from 'vitest';
import * as T from 'three';
import { Track } from '../src/simulation/track.ts';
import { downloadAuthoredAsset } from '../src/rendering/authored-download.ts';
import {
  TRACKSIDE_WEATHERING_HOOK,
  WEATHERING_ATTRIBUTE,
  installTracksideWeathering,
  rubberWear,
  weatheringStream,
} from '../src/rendering/trackside-weathering.ts';
import {
  VINYL,
  bridgeGeometry,
  vinylGeometry,
  vinylModules,
} from '../src/rendering/studio/trackside-branding.ts';
import { plainPanel } from '../src/rendering/studio/branding-plan.ts';
import { conformTracksideGeometry } from '../src/rendering/trackside-module-conformance.ts';
import {
  FACADE_WEATHERING_HOOK,
  installFacadeWeathering,
} from '../src/rendering/facade-weathering.ts';
import {
  CANOPY_VOLUME,
  CANOPY_VOLUME_HOOK,
  bakeCanopyVolume,
  installCanopyVolume,
  withCanopyShell,
} from '../src/rendering/canopy-volume.ts';
import { WeatherPresentation, tagWeatherSurface } from '../src/rendering/weather-presentation.ts';
import { brandingMaterial } from '../src/rendering/studio/trackside-branding.ts';
import { studioHookKeys, type StudioShader } from '../src/rendering/studio/shader-hooks.ts';

function compile(material: T.Material) {
  const source = T.ShaderLib.standard;
  const shader = {
    uniforms: T.UniformsUtils.clone(source.uniforms),
    vertexShader: source.vertexShader,
    fragmentShader: source.fragmentShader,
  } as unknown as StudioShader;
  material.onBeforeCompile(shader, {} as T.WebGLRenderer);
  return shader;
}
const aborted = () => new DOMException('test cancelled', 'AbortError');
function streamed(chunks: Uint8Array[], gapMs: number, headers: HeadersInit = {}) {
  return async (_url: RequestInfo | URL, init?: RequestInit) =>
    new Response(
      new ReadableStream<Uint8Array>({
        async pull(controller) {
          await new Promise((resolve) => setTimeout(resolve, gapMs));
          if (init?.signal?.aborted) return controller.error(init.signal.reason);
          const next = chunks.shift();
          if (next) controller.enqueue(next);
          else controller.close();
        },
      }),
      { headers },
    );
}
const download = (fetcher: typeof fetch, bytes = 8, stallMs = 1000) =>
  downloadAuthoredAsset({
    label: 'A99',
    title: 'A99 test',
    bytes,
    url: 'https://asset.invalid/a99.glb',
    cancelled: () => false,
    fetcher,
    aborted,
    stallMs,
  });

describe('authored asset download', () => {
  it('lets a slow but live transfer finish past the stall window', async () => {
    const chunks = Array.from({ length: 8 }, (_, i) => new Uint8Array([i]));
    const bytes = await download(streamed(chunks, 40) as typeof fetch, 8, 100);
    expect(Array.from(bytes)).toEqual([0, 1, 2, 3, 4, 5, 6, 7]);
  });
  it('abandons a stalled transfer with a stall message, not a truncation', async () => {
    await expect(
      download(streamed([new Uint8Array(4)], 300) as typeof fetch, 8, 100),
    ).rejects.toThrow('stalled');
  });
  it('calls the fetcher unbound, as window.fetch requires', async () => {
    const fetcher = function (this: unknown) {
      if (this !== undefined && this !== globalThis) throw new TypeError('Illegal invocation');
      return Promise.resolve(new Response(new Uint8Array(8)));
    };
    expect((await download(fetcher as typeof fetch)).length).toBe(8);
  });
  it('names an SPA/HTML fallback instead of reporting a truncated download', async () => {
    const html = async () =>
      new Response('<!doctype html><title>app</title>', {
        headers: { 'content-type': 'text/html' },
      });
    await expect(download(html as typeof fetch)).rejects.toThrow('HTML page');
  });
  it('still rejects short, oversized and failed responses', async () => {
    await expect(
      download((async () => new Response(new Uint8Array(7))) as typeof fetch),
    ).rejects.toThrow('Truncated A99 download');
    await expect(
      download((async () => new Response(new Uint8Array(9))) as typeof fetch),
    ).rejects.toThrow('exceeds byte budget');
    await expect(
      download(
        (async () =>
          new Response(new Uint8Array(4), { headers: { 'content-length': '4' } })) as typeof fetch,
      ),
    ).rejects.toThrow('server offers 4 of 8');
    await expect(
      download((async () => new Response(null, { status: 404 })) as typeof fetch),
    ).rejects.toThrow('Unable to load A99 test (404)');
  });
});

describe('trackside weathering', () => {
  const track = new Track();
  it('writes station, height, track-facing and corner wear per vertex', () => {
    const template = new T.BoxGeometry(0.4, 0.9, 3.8).translate(0, 0.45, 1.9);
    for (const side of [-1, 1]) {
      const g = conformTracksideGeometry(template, track, 1300, 1303.8, side, 3.8);
      const w = g.getAttribute(WEATHERING_ATTRIBUTE),
        n = template.getAttribute('normal');
      expect(w.itemSize).toBe(4);
      for (let i = 0; i < w.count; i++) {
        expect(w.getX(i)).toBeGreaterThanOrEqual(1300 - 1e-3);
        expect(w.getX(i)).toBeLessThanOrEqual(1303.8 + 1e-3);
        expect(w.getY(i)).toBeCloseTo(template.getAttribute('position').getY(i), 6);
        // Template -x is the track-facing face of the mirrored conform.
        expect(w.getZ(i)).toBeCloseTo(-n.getX(i), 6);
        expect(w.getW(i)).toBeCloseTo(rubberWear(track, 1301.9), 6);
      }
    }
    const reversed = weatheringStream(
      template.getAttribute('position'),
      undefined,
      10,
      20,
      3.8,
      1,
      true,
    );
    expect(reversed[0]).toBeGreaterThanOrEqual(10);
    expect(reversed[2]).toBe(0);
  });
  it('collects rubber on corner exits and keeps straights mostly clean', () => {
    const wear = Array.from({ length: 60 }, (_, i) => rubberWear(track, (i / 60) * track.length));
    expect(Math.max(...wear)).toBeGreaterThan(0.9);
    expect(Math.min(...wear)).toBeLessThan(0.05);
    expect(wear.every((v) => v >= 0 && v <= 1)).toBe(true);
  });
  it('chains one versioned hook per kit material and patches albedo, roughness and metal', () => {
    for (const kind of ['concrete', 'galvanised', 'plastic'] as const) {
      const material = new T.MeshStandardMaterial();
      expect(installTracksideWeathering(material, kind)).toBe(true);
      expect(installTracksideWeathering(material, kind)).toBe(false);
      expect(studioHookKeys(material)).toEqual([`${TRACKSIDE_WEATHERING_HOOK}-${kind}-v1`]);
      const shader = compile(material);
      expect(shader.vertexShader).toContain('attribute vec4 weathering;');
      expect(shader.fragmentShader).toContain('float twRubber = ');
      expect(shader.fragmentShader.indexOf('float twRubber = ')).toBeGreaterThan(
        shader.fragmentShader.indexOf('#include <map_fragment>'),
      );
      expect(shader.fragmentShader).toContain('roughnessFactor = ');
      expect(shader.fragmentShader.includes('metalnessFactor *=')).toBe(kind === 'galvanised');
    }
  });
});

describe('sponsor vinyl rubber', () => {
  it('carries station, profile height and wear; bridges sit out of reach', () => {
    const track = new Track();
    const modules = vinylModules(track, () => false).slice(0, 12);
    const w = vinylGeometry(track, modules).getAttribute('brandWeather');
    const heights = new Set(VINYL.profile.map(([, h]) => h));
    for (let i = 0; i < w.count; i++) {
      expect(heights.has(Number(w.getY(i).toFixed(3)))).toBe(true);
      expect(w.getZ(i)).toBeGreaterThanOrEqual(0);
      expect(w.getZ(i)).toBeLessThanOrEqual(1);
    }
    const bridge = bridgeGeometry(track, 100, plainPanel('black')).getAttribute('brandWeather');
    for (let i = 0; i < bridge.count; i++) expect(bridge.getY(i)).toBe(-10);
  });
});

describe('facade weathering', () => {
  it('adds a foot band only where the floor is known', () => {
    const object = new T.MeshStandardMaterial(),
      world = new T.MeshStandardMaterial();
    installFacadeWeathering(object, 'concrete', 'object', 0);
    installFacadeWeathering(world, 'stone', 'world');
    expect(studioHookKeys(object)).toEqual([`${FACADE_WEATHERING_HOOK}-concrete-object-v1`]);
    expect(compile(object).fragmentShader).toContain('fwFoot = (');
    const shader = compile(world);
    expect(shader.fragmentShader).not.toContain('fwFoot = (');
    expect(shader.fragmentShader).toContain('fwStreak');
    expect(shader.vertexShader).toContain('modelMatrix * facadePosition');
  });
});

describe('canopy volume', () => {
  it('bends card normals outward, darkens the interior and keeps clumps bounded', () => {
    const position = new T.Float32BufferAttribute(
        [0, 0.6, 0, 0.5, 0.6, 0, 0, 1, 0, -0.5, 0.2, 0],
        3,
      ),
      // Card normals deliberately facing into the crown.
      normal = new T.Float32BufferAttribute([0, 0, 1, -1, 0, 0, 0, -1, 0, 1, 0, 0], 3);
    const canopy = bakeCanopyVolume(position, normal, [{ start: 0, count: 4 }]);
    const centre = new T.Vector3(0, 0.6, 0);
    for (let i = 1; i < 4; i++) {
      const p = new T.Vector3().fromBufferAttribute(position, i),
        n = new T.Vector3().fromBufferAttribute(normal, i);
      expect(n.length()).toBeCloseTo(1, 5);
      expect(n.dot(p.sub(centre))).toBeGreaterThan(0);
      expect(canopy[i * 3]).toBeGreaterThan(canopy[0]);
    }
    expect(canopy[0]).toBeLessThan(0.5);
    for (let i = 0; i < 4; i++) {
      expect(canopy[i * 3 + 1]).toBeGreaterThanOrEqual(0);
      expect(canopy[i * 3 + 1]).toBeLessThanOrEqual(1);
      expect(Math.abs(canopy[i * 3 + 2])).toBeLessThanOrEqual(1);
    }
  });
  it('adds an inner shell inside the crown and occludes sky light on the leaf material', () => {
    const card = new T.PlaneGeometry(1, 1).translate(0, 0.6, 0.3).toNonIndexed();
    card.computeBoundingBox();
    const shell = withCanopyShell(card);
    expect(shell.getAttribute('position').count).toBe(card.getAttribute('position').count * 2);
    shell.computeBoundingBox();
    expect(card.boundingBox!.containsBox(shell.boundingBox!)).toBe(false);
    const p = new T.Vector3().fromBufferAttribute(shell.getAttribute('position'), 6);
    expect(Math.hypot(p.x, p.z)).toBeLessThan(0.3 * CANOPY_VOLUME.shell.radial + 0.5);
    const material = new T.MeshStandardMaterial();
    installCanopyVolume(material);
    expect(studioHookKeys(material)).toEqual([CANOPY_VOLUME_HOOK]);
    const shader = compile(material);
    expect(shader.fragmentShader).toContain('reflectedLight.indirectDiffuse *= vCanopy.x');
    expect(shader.vertexShader).toContain('mix( canopy, treeCanopy, treeVariant )');
  });
});

describe('composition with the in-game weather presentation', () => {
  /** Every global declaration (varyings, attributes, functions) appears once. */
  function declaredOnce(source: string) {
    const names = [
      ...source.matchAll(/^\s*(?:varying|attribute)\s+\w+\s+(\w+)\s*;/gm),
      ...source.matchAll(/^\s*(?:float|vec[234])\s+(\w+)\s*\(/gm),
    ].map((m) => m[1]);
    const repeated = names.filter((n, i) => names.indexOf(n) !== i);
    expect(repeated).toEqual([]);
  }
  afterEach(() => vi.unstubAllGlobals());
  it('declares nothing twice once dampness is layered over every new hook', () => {
    // The vinyl atlas is drawn, not loaded: accept every 2D call.
    const context = new Proxy({} as Record<string, unknown>, {
      get: (target, key: string) =>
        key in target
          ? target[key]
          : key.startsWith('create') || key === 'measureText'
            ? () => ({ addColorStop() {}, width: 10 })
            : () => undefined,
      set: (target, key: string, value) => ((target[key] = value), true),
    });
    vi.stubGlobal('document', {
      createElement: () => ({ width: 0, height: 0, getContext: () => context }),
    });
    const weather = new WeatherPresentation();
    const materials: T.MeshStandardMaterial[] = [];
    for (const kind of ['concrete', 'galvanised', 'plastic'] as const) {
      const m = tagWeatherSurface(
        new T.MeshStandardMaterial(),
        kind === 'plastic' ? 'paint' : 'metal',
      );
      installTracksideWeathering(m, kind);
      materials.push(m);
    }
    const facade = tagWeatherSurface(new T.MeshStandardMaterial(), 'concrete');
    installFacadeWeathering(facade, 'concrete', 'object', 0);
    const canopy = tagWeatherSurface(new T.MeshStandardMaterial(), 'foliage');
    installCanopyVolume(canopy);
    materials.push(facade, canopy, brandingMaterial());
    for (const m of materials) {
      weather.installMaterial(m);
      const shader = compile(m);
      declaredOnce(shader.vertexShader);
      declaredOnce(shader.fragmentShader);
      expect(shader.fragmentShader).toContain('surfaceWet');
    }
  });
});
