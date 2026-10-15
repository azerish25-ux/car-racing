import * as T from 'three';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { readRegister, sourceDirectory, validateRegister } from '../scripts/assets/register.ts';
import {
  meanLinear,
  normalFromColor,
  recentreNormal,
  synthesizeTile,
  type RgbImage,
} from '../scripts/assets/texture-ops.ts';
import { thirdPartyAsset, thirdPartyManifest } from '../src/rendering/assets/third-party.ts';
import type { PbrSet } from '../src/rendering/assets/texture-loader.ts';
import {
  SCAN_LAYER_IDS,
  SCAN_LAYERS,
  ScanStore,
  scannedGround,
  scanLayerCall,
  scanUniformDeclarations,
} from '../src/rendering/ground/scan-store.ts';
import {
  installScannedAsphalt,
  installScannedGravel,
  installScannedKerb,
  installScannedMaps,
  installScannedTurf,
  SCANNED_GROUND,
} from '../src/rendering/ground/scanned-ground.ts';
import {
  soilSlots,
  soilSlotOf,
  SOIL_SCAN,
  writeSoilSlot,
} from '../src/rendering/ground/soil-splat.ts';
import { installCircuitFinish } from '../src/rendering/circuit-finish.ts';
import { installKerbFinish } from '../src/rendering/studio/kerb-runoff-finish.ts';
import { installGravelFinish } from '../src/rendering/studio/grass-gravel-finish.ts';
import { installRoadDetail } from '../src/rendering/studio/road-detail.ts';
import { installWetRoad } from '../src/rendering/materials.ts';
import { studioHookKeys } from '../src/rendering/studio/shader-hooks.ts';
import { surfaceMaterial } from '../src/rendering/surface-detail.ts';
import { materials } from '../src/rendering/materials/index.ts';

function stubCanvas() {
  class Canvas {
    width = 300;
    height = 150;
    getContext() {
      return new Proxy(
        { canvas: this },
        {
          get: (t, k) =>
            k === 'createImageData'
              ? (w: number, h: number) => ({ data: new Uint8ClampedArray(w * h * 4) })
              : (Reflect.get(t, k) ?? (() => {})),
        },
      );
    }
  }
  vi.stubGlobal('document', { createElement: () => new Canvas() });
}
afterEach(() => vi.unstubAllGlobals());

const compile = (material: T.Material) => {
  const shader = {
    uniforms: {},
    vertexShader: T.ShaderLib.physical.vertexShader,
    fragmentShader: T.ShaderLib.physical.fragmentShader,
  } as unknown as T.WebGLProgramParametersWithUniforms;
  material.onBeforeCompile(shader, {} as T.WebGLRenderer);
  return shader;
};
const fakeSet = (id: string): PbrSet => {
  const texture = () => new T.DataTexture(new Uint8Array([128, 128, 255, 255]), 1, 1);
  return {
    id,
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
  };
};

describe('scanned ground sets', () => {
  it('registers the ground fragment under its own area and ships every layer', () => {
    const register = readRegister(process.cwd());
    expect(validateRegister(register)).toEqual([]);
    const ground = register.sources.filter((s) => s.area === 'ground');
    expect(ground.length).toBeGreaterThanOrEqual(9);
    for (const source of ground) {
      expect(source.id.startsWith('ground-')).toBe(true);
      expect(sourceDirectory(source)).toBe(`ground/${source.id}`);
    }
    for (const layer of SCAN_LAYER_IDS) {
      const asset = thirdPartyAsset(SCAN_LAYERS[layer])!;
      expect(asset, layer).not.toBeNull();
      expect(asset.kind).toBe('texture');
      const info = asset.texture!;
      // Means the shaders normalise by: physical albedos and roughness.
      expect(info.meanColor!.every((v) => v > 0.01 && v < 0.95)).toBe(true);
      expect(info.meanRoughness!).toBeGreaterThan(0.3);
      expect(info.metres).toBeGreaterThan(0.5);
      if (asset.area === 'ground')
        for (const file of asset.files)
          expect(file.path.startsWith(`assets/third-party/ground/${asset.id}/`)).toBe(true);
    }
    // 1K sets with KTX2 and a WebP fallback, within the shared budget.
    const bytes = thirdPartyManifest.assets
      .filter((a) => a.area === 'ground')
      .flatMap((a) => a.files)
      .reduce((s, f) => s + f.bytes, 0);
    expect(bytes).toBeLessThan(32 * 1024 * 1024);
  });

  it('re-synthesises seamless tiles and recentres normals (texture-ops)', () => {
    const size = 96;
    const source: RgbImage = { width: size, height: size, data: new Float32Array(size * size * 3) };
    for (let y = 0; y < size; y++)
      for (let x = 0; x < size; x++)
        for (let c = 0; c < 3; c++)
          source.data[(y * size + x) * 3 + c] = 0.4 + 0.2 * Math.sin(x * 0.7 + y * 1.3 + c);
    const [tile] = synthesizeTile([source], {
      size: 64,
      patch: 32,
      regions: [[0, 0, 96, 96]],
      seed: 7,
    });
    expect(tile.width).toBe(64);
    // Seamless: the wrap step is no larger than the steps inside the tile.
    let inner = 0,
      wrap = 0;
    for (let y = 0; y < 64; y++) {
      const at = (x: number) => tile.data[(y * 64 + x) * 3];
      inner = Math.max(inner, Math.abs(at(31) - at(30)));
      wrap = Math.max(wrap, Math.abs(at(0) - at(63)));
    }
    expect(wrap).toBeLessThan(Math.max(inner, 0.05) * 2.5);
    // Flat colour -> flat normal; a tilted normal map recentres to flat on average.
    const flat: RgbImage = { width: 8, height: 8, data: new Float32Array(8 * 8 * 3).fill(0.5) };
    const n = normalFromColor(flat, 3);
    expect(n.data[0]).toBeCloseTo(0.5, 5);
    expect(n.data[2]).toBeCloseTo(1, 5);
    const tilted: RgbImage = { width: 4, height: 4, data: new Float32Array(48) };
    for (let p = 0; p < 16; p++) tilted.data.set([0.6, 0.55, 0.95], p * 3);
    recentreNormal(tilted);
    expect(tilted.data[0]).toBeCloseTo(0.5, 4);
    expect(tilted.data[1]).toBeCloseTo(0.5, 4);
    expect(meanLinear(flat)[0]).toBeCloseTo(0.214, 2);
  });
});

describe('scanned ground shaders', () => {
  it('keep the procedural surfaces untouched until the sets are resident', () => {
    stubCanvas();
    const road = surfaceMaterial('asphalt', undefined, true);
    installWetRoad(road, new T.DataTexture(new Uint8Array(4), 1, 1), true);
    installRoadDetail(road, 3000);
    expect(installScannedAsphalt(road)).toBe(true);
    expect(installScannedAsphalt(road)).toBe(false);
    expect(studioHookKeys(road)).toEqual(['road-detail-v5', 'scanned-asphalt-v1']);
    // Node: nothing loads, no define, every block compiled out.
    expect('APEX_SCAN' in (road.defines ?? {})).toBe(false);
    const f = compile(road).fragmentShader;
    expect(f).toContain('#ifdef APEX_SCAN');
    // The asphalt scan follows the micro fade it cancels and precedes the
    // colour stage (racing line, rubber and water stay on top).
    const block = f.indexOf('ApexScanSample apexAsphalt');
    expect(block).toBeGreaterThan(f.indexOf('float apexMicro'));
    expect(block).toBeLessThan(f.indexOf('#include <color_fragment>'));
    expect(f).toContain('apexScanPerturb( normalize( tbn[2] ), apexAsphalt.n');
  });

  it('switch materials onto the scanned path by preset, swapping their procedural maps', () => {
    stubCanvas();
    const store = new ScanStore();
    const grass = surfaceMaterial('grass');
    const map = grass.map;
    let swaps = 0;
    store.register(grass, ['lawn', 'meadow'], (on) => {
      swaps++;
      grass.map = on ? null : map;
    });
    expect(store.diagnostics().scanned).toBe(0);
    store.adopt('lawn', fakeSet('ground-lawn'));
    expect(grass.defines?.APEX_SCAN).toBeUndefined();
    store.adopt('meadow', fakeSet('ground-meadow'));
    expect(grass.defines?.APEX_SCAN).toBe('');
    expect(grass.defines?.APEX_SCAN_HEX).toBe('');
    expect(grass.map).toBeNull();
    store.setPreset('medium');
    expect(grass.defines?.APEX_SCAN).toBe('');
    expect(grass.defines?.APEX_SCAN_HEX).toBeUndefined();
    store.setPreset('low');
    expect(grass.defines?.APEX_SCAN).toBeUndefined();
    expect(grass.map).toBe(map);
    expect(swaps).toBe(2);
    // Uniforms carry the set's scale and mean.
    const lawn = thirdPartyAsset('ground-lawn')!.texture!;
    expect(store.uniforms.lawn.info.value.x).toBeCloseTo(1 / lawn.metres, 6);
    expect(store.uniforms.lawn.info.value.y).toBeCloseTo(1 / lawn.meanColor![0], 4);
  });

  it('install on turf, gravel, kerb and library materials with their finishes', () => {
    stubCanvas();
    const grass = surfaceMaterial('grass');
    expect(installScannedTurf(grass)).toBe(true);
    const turf = compile(grass).fragmentShader;
    expect(turf).toContain('ApexScanSample apexLawn');
    expect(turf).toContain(`${SCANNED_GROUND.lawnReach[0].toFixed(4)}`);
    // The procedural tufts give way to the photographed blades.
    expect(turf.indexOf('#ifndef APEX_SCAN')).toBeLessThan(turf.indexOf('float tTuft'));
    const gravel = surfaceMaterial('gravel');
    installGravelFinish(gravel);
    expect(installScannedGravel(gravel)).toBe(true);
    expect(compile(gravel).fragmentShader).toContain('gravelColour * apexRatio');
    const kerb = new T.MeshStandardMaterial({ vertexColors: true, roughness: 0.85 });
    installCircuitFinish(kerb, 'kerb');
    installKerbFinish(kerb);
    expect(installScannedKerb(kerb)).toBe(true);
    const k = compile(kerb).fragmentShader;
    expect(k.indexOf('float apexBare')).toBeGreaterThan(k.indexOf('diffuseColor.rgb = kerbPaint;'));
    const concrete = materials.concrete({ variant: 'rough' });
    expect(installScannedMaps(concrete, 'concrete', [0.3, 0.3, 0.28])).toBe(true);
    expect(installScannedMaps(concrete, 'concrete', [0.3, 0.3, 0.28])).toBe(false);
    expect(scannedGround.diagnostics().materials).toBeGreaterThanOrEqual(4);
  });

  it('generate per-layer uniforms and calls', () => {
    expect(scanUniformDeclarations(['lawn', 'lawn'])).toBe(
      'uniform sampler2D apexScanLawnC;\nuniform sampler2D apexScanLawnN;\nuniform sampler2D apexScanLawnO;\nuniform vec4 apexScanLawnI;\nuniform float apexScanLawnR;',
    );
    expect(scanLayerCall('dryEarth', 'w', 'dx', 'dy', 1.5, false)).toBe(
      'apexScanLayer( apexScanDryEarthC, apexScanDryEarthN, apexScanDryEarthC, false, apexScanDryEarthI, apexScanDryEarthR, w, dx, dy, 1.500 )',
    );
  });
});

describe('off-road soil splat', () => {
  it('maps soil kinds to photographed sets in at most five slots', () => {
    expect(SOIL_SCAN.hardpack).toBe('dryEarth');
    expect(SOIL_SCAN.mud).toBe('wetEarth');
    const slots = soilSlots(['loam', 'turf', 'hardpack', 'sand', 'mud', 'gravel']);
    expect(slots.length).toBe(5);
    expect(new Set(slots).size).toBe(5);
    // Sand and gravel share the gravel set.
    expect(soilSlotOf('sand', slots)).toBe(soilSlotOf('gravel', slots));
    const out = new Float32Array(8);
    writeSoilSlot(out, 0, 1, 3);
    writeSoilSlot(out, 1, 2, 3);
    // Slot 1 one-hot; the last slot is the remainder (all zero).
    expect([...out]).toEqual([0, 1, 0, 0, 0, 0, 0, 0]);
  });
});
