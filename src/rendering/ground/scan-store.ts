import * as T from 'three';
import { loadPbrSet, type PbrSet } from '../assets/texture-loader.ts';
import { thirdPartyAsset } from '../assets/third-party.ts';
import type { QualityPreset } from '../options.ts';

/**
 * Photographed ground sets (assets/third-party/sources/ground.json, plus the
 * Foundation's gravel) and the materials that use them.
 *
 * Materials register the layers they sample (scanned-ground.ts installers).
 * Once a renderer is attached and the preset is Medium or above, the store
 * loads the layers registered so far (KTX2, WebP fallback), binds them to
 * shared uniforms and switches every registered material whose layers are all
 * resident to the scanned path (`APEX_SCAN`, plus `APEX_SCAN_HEX` on High and
 * Ultra). Low, node (unit tests) and any load failure keep the procedural
 * surfaces. A preset change re-defines the registered materials.
 */
export const SCAN_LAYERS = Object.freeze({
  lawn: 'ground-lawn',
  meadow: 'ground-meadow',
  forest: 'ground-forest-floor',
  dryEarth: 'ground-dry-earth',
  asphalt: 'ground-asphalt',
  wetEarth: 'ground-wet-earth',
  concrete: 'ground-concrete',
  rock: 'ground-rock',
  snow: 'ground-snow',
  gravel: 'sandy-gravel-01',
});
export type ScanLayer = keyof typeof SCAN_LAYERS;
export const SCAN_LAYER_IDS = Object.freeze(Object.keys(SCAN_LAYERS) as ScanLayer[]);

export interface ScanLayerUniforms {
  color: T.IUniform<T.Texture | null>;
  normal: T.IUniform<T.Texture | null>;
  orm: T.IUniform<T.Texture | null>;
  /** (1 / metres, 1 / mean linear colour). */
  info: T.IUniform<T.Vector4>;
  /** Mean roughness (ORM G) of the set. */
  rough: T.IUniform<number>;
}
const glslName = (layer: ScanLayer) => `apexScan${layer[0].toUpperCase()}${layer.slice(1)}`;

/** GLSL uniform names of a layer: colour, normal, ORM, info, mean roughness. */
export function scanUniformNames(layer: ScanLayer) {
  const n = glslName(layer);
  return { color: `${n}C`, normal: `${n}N`, orm: `${n}O`, info: `${n}I`, rough: `${n}R` };
}
/** Uniform declarations of the given layers (compiled only under APEX_SCAN). */
export function scanUniformDeclarations(layers: readonly ScanLayer[]) {
  return [...new Set(layers)]
    .map((layer) => {
      const u = scanUniformNames(layer);
      return `uniform sampler2D ${u.color};\nuniform sampler2D ${u.normal};\nuniform sampler2D ${u.orm};\nuniform vec4 ${u.info};\nuniform float ${u.rough};`;
    })
    .join('\n');
}
/** GLSL call sampling `layer` at planar `world` (metres) with its gradients. */
export function scanLayerCall(
  layer: ScanLayer,
  world: string,
  dx: string,
  dy: string,
  density = 1.6,
  orm = true,
) {
  const u = scanUniformNames(layer);
  return `apexScanLayer( ${u.color}, ${u.normal}, ${orm ? u.orm : u.color}, ${orm}, ${u.info}, ${u.rough}, ${world}, ${dx}, ${dy}, ${density.toFixed(3)} )`;
}
/** A layer's macro colour ratio at `scale` x its tile frequency. */
export function scanMacroCall(layer: ScanLayer, world: string, scale: number) {
  const u = scanUniformNames(layer);
  return `apexScanMacro( ${u.color}, ${u.info}, ${world}, ${scale.toFixed(4)} )`;
}

interface Registration {
  layers: ScanLayer[];
  swap?: (scanned: boolean) => void;
  on: boolean;
}

function proceduralRequested() {
  try {
    return (
      typeof location !== 'undefined' &&
      new URLSearchParams(location.search).get('ground') === 'procedural'
    );
  } catch {
    return false;
  }
}

export class ScanStore {
  readonly uniforms: Readonly<Record<ScanLayer, ScanLayerUniforms>>;
  private preset: QualityPreset = 'high';
  private renderer: T.WebGLRenderer | null = null;
  private readonly sets = new Map<ScanLayer, PbrSet>();
  private readonly pending = new Map<ScanLayer, Promise<boolean>>();
  private readonly failed = new Set<ScanLayer>();
  private readonly materials = new Map<T.Material, Registration>();
  constructor() {
    const uniforms = {} as Record<ScanLayer, ScanLayerUniforms>;
    for (const layer of SCAN_LAYER_IDS)
      uniforms[layer] = {
        color: { value: null },
        normal: { value: null },
        orm: { value: null },
        info: { value: new T.Vector4(1, 1, 1, 1) },
        rough: { value: 0.8 },
      };
    this.uniforms = Object.freeze(uniforms);
  }
  /** Uniforms of the given layers under their GLSL names (shared objects). */
  uniformsFor(layers: readonly ScanLayer[]) {
    const out: Record<string, T.IUniform> = {};
    for (const layer of layers) {
      const u = scanUniformNames(layer),
        v = this.uniforms[layer];
      out[u.color] = v.color;
      out[u.normal] = v.normal;
      out[u.orm] = v.orm;
      out[u.info] = v.info;
      out[u.rough] = v.rough;
    }
    return out;
  }
  /** Scanned surfaces on this preset (Medium and above); `?ground=procedural`
   * in the page URL keeps the procedural surfaces for A/B look-dev captures. */
  get enabled() {
    return this.preset !== 'low' && !proceduralRequested();
  }
  get hex() {
    return this.preset === 'high' || this.preset === 'ultra';
  }
  /** The renderer that loads (and owns the GPU copies of) the sets. */
  attach(renderer: T.WebGLRenderer, preset: QualityPreset) {
    this.renderer = renderer;
    this.setPreset(preset);
  }
  /** Forget a disposed renderer (its textures stay cached for the next one). */
  detach(renderer: T.WebGLRenderer) {
    if (this.renderer === renderer) this.renderer = null;
  }
  setPreset(preset: QualityPreset) {
    this.preset = preset;
    this.request(this.wanted());
    for (const material of this.materials.keys()) this.apply(material);
  }
  /** Register a material sampling `layers`; `swap` exchanges its procedural
   * maps when it enters (true) or leaves (false) the scanned path. */
  register(material: T.Material, layers: readonly ScanLayer[], swap?: (scanned: boolean) => void) {
    if (this.materials.has(material)) return;
    this.materials.set(material, { layers: [...new Set(layers)], swap, on: false });
    material.addEventListener('dispose', () => this.materials.delete(material));
    this.request(layers);
    this.apply(material);
  }
  /** Resolve once every requested layer is resident or failed (or after
   * `timeoutMs`); true when the scanned path is live for all of them. */
  async ready(timeoutMs = 15000) {
    if (!this.enabled || !this.renderer || typeof document === 'undefined') return false;
    this.request(this.wanted());
    const all = Promise.all([...this.pending.values()]).then((r) => r.every(Boolean));
    const timeout = new Promise<boolean>((resolve) => setTimeout(() => resolve(false), timeoutMs));
    return Promise.race([all, timeout]);
  }
  /** Registered materials on the scanned path / registered. */
  diagnostics() {
    let on = 0;
    for (const r of this.materials.values()) if (r.on) on++;
    return {
      preset: this.preset,
      enabled: this.enabled,
      hex: this.hex,
      resident: [...this.sets.keys()],
      failed: [...this.failed],
      formats: Object.fromEntries([...this.sets].map(([k, s]) => [k, s.formats])),
      materials: this.materials.size,
      scanned: on,
    };
  }
  private wanted() {
    const layers = new Set<ScanLayer>();
    for (const r of this.materials.values()) for (const l of r.layers) layers.add(l);
    return [...layers];
  }
  private request(layers: readonly ScanLayer[]) {
    if (!this.enabled || !this.renderer || typeof document === 'undefined') return;
    for (const layer of layers) {
      if (this.sets.has(layer) || this.pending.has(layer) || this.failed.has(layer)) continue;
      if (!thirdPartyAsset(SCAN_LAYERS[layer])) {
        this.failed.add(layer);
        continue;
      }
      this.pending.set(layer, this.load(this.renderer, layer));
    }
  }
  private async load(renderer: T.WebGLRenderer, layer: ScanLayer) {
    const id = SCAN_LAYERS[layer];
    try {
      const set = await loadPbrSet(renderer, id, { anisotropy: 16 });
      this.adopt(layer, set);
      return true;
    } catch (error) {
      console.warn(`Scanned ground layer ${layer} unavailable; procedural surface kept:`, error);
      this.failed.add(layer);
      return false;
    } finally {
      this.pending.delete(layer);
    }
  }
  /** Bind a loaded set to its layer's uniforms and switch every material
   * whose layers are now all resident (the loader's last step; tests feed
   * it directly). */
  adopt(layer: ScanLayer, set: PbrSet) {
    const id = SCAN_LAYERS[layer];
    if (!set.maps.map || !set.maps.normalMap) throw new Error(`${id}: colour or normal missing`);
    const info = thirdPartyAsset(id)?.texture;
    const mean = info?.meanColor ?? [0.5, 0.5, 0.5];
    const u = this.uniforms[layer];
    u.color.value = set.maps.map;
    u.normal.value = set.maps.normalMap;
    u.orm.value = set.maps.roughnessMap ?? set.maps.map;
    u.info.value.set(
      1 / (info?.metres ?? 1),
      1 / Math.max(mean[0], 1e-3),
      1 / Math.max(mean[1], 1e-3),
      1 / Math.max(mean[2], 1e-3),
    );
    u.rough.value = info?.meanRoughness ?? 0.8;
    this.sets.set(layer, set);
    for (const material of this.materials.keys()) this.apply(material);
  }
  private apply(material: T.Material) {
    const r = this.materials.get(material);
    if (!r) return;
    const on = this.enabled && r.layers.every((l) => this.sets.has(l));
    const host = material as T.Material & { defines?: Record<string, string> };
    const defines = (host.defines ??= {});
    const hex = on && this.hex;
    const changed =
      on !== r.on || 'APEX_SCAN_HEX' in defines !== hex || 'APEX_SCAN' in defines !== on;
    if (!changed) return;
    if (on) defines.APEX_SCAN = '';
    else delete defines.APEX_SCAN;
    if (hex) defines.APEX_SCAN_HEX = '';
    else delete defines.APEX_SCAN_HEX;
    if (on !== r.on) r.swap?.(on);
    r.on = on;
    material.needsUpdate = true;
  }
}

/** The application's store (one per page; textures are shared by renderers). */
export const scannedGround = new ScanStore();
