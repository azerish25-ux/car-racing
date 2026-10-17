import * as T from 'three';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { CircuitScene } from '../src/rendering/circuit.ts';
import { RacingRenderer } from '../src/rendering/renderer.ts';
import { scannedGround } from '../src/rendering/ground/scan-store.ts';
import { rigTrack } from '../src/simulation/offroad/jump-rig.ts';

class Canvas {
  width = 300;
  height = 150;
  getContext() {
    const noop = () => {};
    return new Proxy(
      {
        canvas: this,
        measureText: () => ({ width: 40 }),
        createLinearGradient: () => ({ addColorStop: noop }),
        createRadialGradient: () => ({ addColorStop: noop }),
        createPattern: () => ({ setTransform: noop }),
        createImageData: (w: number, h: number) => ({ data: new Uint8ClampedArray(w * h * 4) }),
        getImageData: (_x: number, _y: number, w: number, h: number) => ({
          data: new Uint8ClampedArray(w * h * 4),
        }),
      },
      { get: (target, key) => Reflect.get(target, key) ?? noop },
    );
  }
}

/** Run the real renderer teardown with a real constructed venue and scene.
 * GPU pass owners are inert: no WebGL context is needed to observe resource
 * dispose events or the global scanned-ground registration lifecycle. */
function rendererOwner(circuit: CircuitScene) {
  const renderer = Object.create(RacingRenderer.prototype) as RacingRenderer;
  const owners = Object.fromEntries(
    [
      'renderer',
      'textures',
      'pitCrew',
      'gridPerformance',
      'reflection',
      'shadowProxies',
      'farShadow',
      'gpuTimer',
      'gpuFrames',
      'motionBlur',
      'exposure',
      'weatherPresentation',
      'bloom',
      'fxaa',
      'scenePass',
      'grade',
      'ultra',
      'environment',
      'composer',
    ].map((key) => [key, { dispose: vi.fn() }]),
  );
  const sun = new T.DirectionalLight();
  sun.shadow.map = new T.WebGLRenderTarget(16, 16);
  sun.shadow.mapPass = new T.WebGLRenderTarget(8, 8);
  Object.assign(renderer, owners, {
    circuit,
    scene: new T.Scene().add(circuit.group, sun),
    sun,
    cars: [],
  });
  return { renderer, sun };
}

beforeEach(() => {
  vi.stubGlobal('document', { createElement: () => new Canvas() });
  vi.stubGlobal('HTMLCanvasElement', Canvas);
  const texture = () => new T.DataTexture(new Uint8Array([128, 128, 255, 255]), 1, 1);
  // Feed the real shared store a resident set without requesting a decoder
  // or WebGL context. Closing either venue must retain these shared images.
  scannedGround.adopt('wetEarth', {
    id: 'ground-wet-earth',
    metres: 2,
    maps: {
      map: texture(),
      normalMap: texture(),
      roughnessMap: texture(),
      metalnessMap: null,
      aoMap: null,
    },
    formats: { color: 'ktx2', normal: 'ktx2', orm: 'ktx2' },
    dispose() {},
  });
});
afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe('complete terrain-venue resource ownership', () => {
  it.each(['valley-ridge-mx', 'arena-nord-sx'] as const)(
    '%s releases unused palette registrations, textures and both main-shadow targets once',
    (id) => {
      const baseline = scannedGround.diagnostics().materials;
      const register = vi.spyOn(scannedGround, 'register');
      const circuit = new CircuitScene(rigTrack(id));
      const attached = new Set<T.Material>();
      circuit.group.traverse((object) => {
        if (object instanceof T.Mesh || object instanceof T.Points || object instanceof T.Line)
          for (const material of Array.isArray(object.material)
            ? object.material
            : [object.material])
            attached.add(material);
      });
      const registered = new Set(register.mock.calls.map(([material]) => material));
      const orphaned = [...registered].filter((material) => !attached.has(material));
      // Negative control: scene traversal alone misses actual, registered
      // templates. The renderer must include their owner palette explicitly.
      expect(orphaned.length).toBeGreaterThan(0);
      const owned = circuit.disposalMaterials();
      for (const material of orphaned) expect(owned.has(material)).toBe(true);
      const orphanDisposals = orphaned.map((material) => vi.spyOn(material, 'dispose'));

      // Unused facade templates also own image maps even if no scanned hook
      // is installed on them. Verify cleanup covers their texture resources.
      const unusedTextures = new Set<T.Texture>();
      for (const material of owned)
        if (!attached.has(material))
          for (const value of Object.values(material))
            if (value instanceof T.Texture) unusedTextures.add(value);
      expect(unusedTextures.size).toBeGreaterThan(0);
      const textureDisposals = [...unusedTextures].map((texture) => vi.spyOn(texture, 'dispose'));
      const residentBefore = scannedGround.diagnostics().resident;
      const sharedMaps = Object.values(scannedGround.uniforms)
        .flatMap((layer) => [layer.color.value, layer.normal.value, layer.orm.value])
        .filter((texture): texture is T.Texture => texture instanceof T.Texture);
      expect(sharedMaps).toHaveLength(3);
      const sharedDisposals = [...new Set(sharedMaps)].map((texture) =>
        vi.spyOn(texture, 'dispose'),
      );
      const { renderer, sun } = rendererOwner(circuit);
      const shadow = vi.spyOn(sun.shadow.map!, 'dispose');
      const shadowPass = vi.spyOn(sun.shadow.mapPass!, 'dispose');

      renderer.dispose();
      expect(scannedGround.diagnostics().materials).toBe(baseline);
      expect(scannedGround.diagnostics().resident).toEqual(residentBefore);
      for (const dispose of orphanDisposals) expect(dispose).toHaveBeenCalledTimes(1);
      for (const dispose of textureDisposals) expect(dispose).toHaveBeenCalledTimes(1);
      for (const dispose of sharedDisposals) expect(dispose).not.toHaveBeenCalled();
      expect(shadow).toHaveBeenCalledTimes(1);
      expect(shadowPass).toHaveBeenCalledTimes(1);

      renderer.dispose();
      for (const dispose of orphanDisposals) expect(dispose).toHaveBeenCalledTimes(1);
      expect(shadow).toHaveBeenCalledTimes(1);
      expect(shadowPass).toHaveBeenCalledTimes(1);
    },
    120000,
  );
});
