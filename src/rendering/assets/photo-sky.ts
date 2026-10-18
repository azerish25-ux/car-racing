import * as T from 'three';
import { skyCosineRadiance, type PhotoSkyBinding } from '../daylight.ts';
import { detailTier, type QualityPreset } from '../options.ts';
import { skyLightDirection, type LightingMode } from '../sky-light.ts';
import type { AerialPalette } from '../studio/aerial-perspective.ts';
import { SKY_IRRADIANCE_SATURATION } from '../studio/ibl-energy.ts';
import { loadGainMapTextures, gainMapSupported, type GainMapTextures } from './gain-map.ts';
import type { PhotoSkyUniforms } from './photo-sky-shader.ts';
import { SKY_RAMPS, skyBlend, skyRotation, type SkyPalette } from './sky-catalogue.ts';
import { thirdPartyAsset, type HdriInfo, type ShippedAsset } from './third-party.ts';

/** Shipped variant per preset: Low keeps the procedural sky. */
export const PHOTO_SKY_VARIANT: Readonly<Record<QualityPreset, '4k' | '2k' | null>> = Object.freeze(
  {
    low: null,
    medium: '2k',
    high: '4k',
    ultra: '4k',
  },
);
/** In cube captures (PMREM bins, local probes) radiance above this multiple
 * of the dome's mean is clipped: the directional light carries the sun. */
export const PHOTO_CAPTURE_CLAMP = 16;
/** Decoded skies kept resident (two crossfading plus one in flight). */
const RESIDENT = 4;

interface Entry {
  id: string;
  asset: ShippedAsset;
  info: HdriInfo;
  variant: '4k' | '2k';
  textures: GainMapTextures | null;
  promise: Promise<GainMapTextures | null>;
  failed: boolean;
  used: number;
}

/** Procedural sky only, no texture left on the samplers. */
function unbind(u: PhotoSkyUniforms) {
  u.photoAmount.value = 0;
  u.photoWeight.value = 0;
  u.photoBaseA.value = u.photoGainA.value = u.photoBaseB.value = u.photoGainB.value = null;
}
const Y = (c: readonly number[]) => 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];

/**
 * The photographed sky of one renderer (circuit or festival): picks the
 * HDRIs of the venue's palette and the current lighting and cloud cover,
 * loads them on demand, and binds them to the sky dome for the visible frame
 * and for every PMREM bin (SkyEnvironment), so scene.background and
 * scene.environment are the same photograph.
 *
 * Radiometry: a shipped sky's dome has unit mean luminance; it is scaled to
 * the cosine-weighted mean radiance of the physical sky it replaces
 * (`skyCosineRadiance`), so the sun, exposure and IBL calibration of the
 * lighting model hold, and only the sky's spatial content and colour come
 * from the photograph. The photo is rotated about +y so its sun (or moon /
 * brightest glow) stands under the scene's key light.
 *
 * Failure keeps the procedural path: a sky that cannot load (no decoder,
 * network, quota) is marked failed and the dome shows the physical sky.
 */
export class PhotoSky implements PhotoSkyBinding {
  private entries = new Map<string, Entry>();
  private variant: '4k' | '2k' | null = null;
  private clock = 0;
  private version = 0;
  private disposed = false;
  /** Bound pair of the last visible bind (diagnostics). */
  private shown: { a: string; b: string; weight: number; amount: number } | null = null;
  /** Materials this sky has bound (the dome), so a released texture is
   * never left on a sampler. */
  private bound = new Set<T.ShaderMaterial>();
  /** `balanceCaptures`: a renderer whose materials lack the diffuse IBL colour
   * balance (`irradianceSaturation`, circuit renderer) gets it in the PMREM
   * captures instead (festival renderer). */
  constructor(
    public palette: SkyPalette,
    private readonly balanceCaptures = false,
  ) {}

  /** Free an entry's textures and unbind them from every dome first. */
  private release(entry: Entry) {
    const textures = entry.textures;
    if (!textures) return;
    for (const material of this.bound) {
      const u = material.uniforms as unknown as PhotoSkyUniforms;
      if (
        [u.photoBaseA.value, u.photoGainA.value, u.photoBaseB.value, u.photoGainB.value].some(
          (t) => t === textures.base || t === textures.gain,
        )
      )
        unbind(u);
    }
    textures.dispose();
    entry.textures = null;
  }

  /** Preset change: the variant to load (null = procedural only). */
  setQuality(preset: QualityPreset) {
    const variant = PHOTO_SKY_VARIANT[preset] ?? (detailTier(preset) === 'low' ? null : '2k');
    if (variant === this.variant) return;
    this.variant = variant;
    // Another variant is a different texture: drop decoded skies.
    for (const entry of this.entries.values()) this.release(entry);
    this.entries.clear();
    this.version++;
  }
  get enabled() {
    return this.variant !== null && gainMapSupported() && !this.disposed;
  }
  /** Changes whenever the skies a capture would bind change. */
  get key() {
    return this.enabled ? `${this.palette}:${this.variant}:${this.version}` : '';
  }

  private entry(id: string): Entry | null {
    if (!this.enabled || !this.variant) return null;
    const existing = this.entries.get(id);
    if (existing) {
      existing.used = ++this.clock;
      return existing;
    }
    const asset = thirdPartyAsset(id);
    const file = asset?.files.find((f) => f.role === this.variant) ?? asset?.files[0];
    if (!asset || !asset.hdri || !file) return null;
    const variant = this.variant;
    const entry: Entry = {
      id,
      asset,
      info: asset.hdri,
      variant,
      textures: null,
      failed: false,
      used: ++this.clock,
      promise: Promise.resolve(null),
    };
    entry.promise = loadGainMapTextures(file).then(
      (textures) => {
        if (this.disposed || this.entries.get(id) !== entry) {
          textures.dispose();
          return null;
        }
        entry.textures = textures;
        // New content for the captures.
        this.version++;
        this.evict();
        return textures;
      },
      (error: unknown) => {
        entry.failed = true;
        console.warn(`Photographed sky ${id} unavailable, keeping the physical sky:`, error);
        return null;
      },
    );
    this.entries.set(id, entry);
    return entry;
  }
  private evict() {
    const loaded = [...this.entries.values()]
      .filter((e) => e.textures)
      .sort((a, b) => b.used - a.used);
    for (const entry of loaded.slice(RESIDENT)) {
      this.release(entry);
      this.entries.delete(entry.id);
    }
  }

  /** Start loading the skies `mode` needs at `cover` and its ramp neighbours;
   * resolves true once the skies for `cover` are resident (false on timeout,
   * failure or when photographed skies are off). */
  async ready(cover: number, mode: LightingMode, timeoutMs = 20000) {
    if (!this.enabled) return false;
    const blend = skyBlend(SKY_RAMPS[this.palette][mode], cover);
    const wanted = [...new Set([blend.a, blend.b])].map((id) => this.entry(id));
    if (wanted.some((e) => !e)) return false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const timeout = new Promise<null>(
      (resolve) => (timer = setTimeout(() => resolve(null), timeoutMs)),
    );
    try {
      const results = await Promise.all(wanted.map((e) => Promise.race([e!.promise, timeout])));
      return results.every((r) => r !== null);
    } finally {
      clearTimeout(timer);
    }
  }

  /** The resident sky nearest to `id` along the ramp (a sky still loading
   * borrows its loaded neighbour), or null. */
  private resident(stops: readonly { id: string }[], id: string) {
    const index = stops.findIndex((s) => s.id === id);
    const order = stops
      .map((s, i) => ({ s, d: Math.abs(i - index) }))
      .sort((a, b) => a.d - b.d)
      .map((x) => x.s.id);
    for (const candidate of order) {
      const entry = this.entries.get(candidate);
      if (entry?.textures) {
        entry.used = ++this.clock;
        return entry;
      }
    }
    return null;
  }

  /** Radiance scale: the physical dome's cosine-weighted mean luminance. */
  scale(cover: number, mode: LightingMode) {
    return Y(skyCosineRadiance(cover, mode).toArray());
  }

  bind(material: T.ShaderMaterial, cover: number, mode: LightingMode, capture: boolean) {
    const u = material.uniforms as unknown as Partial<PhotoSkyUniforms>;
    if (!u.photoAmount) return false;
    this.bound.add(material);
    const off = () => {
      unbind(u as PhotoSkyUniforms);
      if (!capture) this.shown = null;
      return false;
    };
    if (!this.enabled) return off();
    const stops = SKY_RAMPS[this.palette][mode],
      blend = skyBlend(stops, cover);
    // Request what this cover needs (no-op when resident or in flight).
    this.entry(blend.a);
    if (blend.weight > 0) this.entry(blend.b);
    const a = this.resident(stops, blend.a),
      b = blend.weight > 0 ? this.resident(stops, blend.b) : a;
    if (!a?.textures || !b?.textures) return off();
    const scale = this.scale(cover, mode),
      sun = skyLightDirection(mode),
      gain = (id: string) => stops.find((s) => s.id === id)?.gain ?? 1;
    u.photoBaseA!.value = a.textures.base;
    u.photoGainA!.value = a.textures.gain;
    u.photoA!.value.set(
      skyRotation(a.info.sunAzimuth, sun),
      a.textures.gainMax,
      scale * gain(a.id),
      ((a.info.skyline ?? 0) * Math.PI) / 180,
    );
    u.photoBaseB!.value = b.textures.base;
    u.photoGainB!.value = b.textures.gain;
    u.photoB!.value.set(
      skyRotation(b.info.sunAzimuth, sun),
      b.textures.gainMax,
      scale * gain(b.id),
      ((b.info.skyline ?? 0) * Math.PI) / 180,
    );
    u.photoWeight!.value = a === b ? 0 : blend.weight;
    u.photoAmount!.value = 1;
    u.photoCaptureClamp!.value = PHOTO_CAPTURE_CLAMP * scale * Math.max(gain(a.id), gain(b.id));
    if (u.photoCaptureSaturation)
      u.photoCaptureSaturation.value = this.balanceCaptures
        ? (this.balance(a, b, u.photoWeight!.value, cover, mode, SKY_IRRADIANCE_SATURATION[mode]) ??
          1)
        : 1;
    if (!capture) this.shown = { a: a.id, b: b.id, weight: u.photoWeight!.value, amount: 1 };
    return true;
  }

  /** Horizon haze colours of the photographed sky (aerial perspective), in
   * scene units, for the pair shown at `cover`; null when none is resident. */
  fogPalette(cover: number, mode: LightingMode): AerialPalette | null {
    if (!this.enabled) return null;
    const stops = SKY_RAMPS[this.palette][mode],
      blend = skyBlend(stops, cover),
      a = this.resident(stops, blend.a),
      b = blend.weight > 0 ? this.resident(stops, blend.b) : a;
    if (!a || !b) return null;
    const w = a === b ? 0 : blend.weight,
      k = this.scale(cover, mode);
    const mix = (pick: (i: HdriInfo) => readonly number[]) =>
      [0, 1, 2].map((c) => (pick(a.info)[c] * (1 - w) + pick(b.info)[c] * w) * k) as [
        number,
        number,
        number,
      ];
    return {
      antiSun: mix((i) => i.horizonAntiSun),
      sunSide: mix((i) => i.horizonSunSide),
      overcast: mix((i) => i.horizonMean),
    };
  }

  /**
   * Chroma to keep in the diffuse IBL (`apexSkyIrradianceSaturation`) while a
   * photographed dome lights the scene: the same blue/red balance the physical
   * dome has after `base` (its SKY_IRRADIANCE_SATURATION). Clear-sky photos
   * are often bluer than the model (B/R 3-4.5 against 2.4), which would tint
   * sunlit asphalt; a warmer or grey photo keeps its own colour. Null when no
   * photographed sky is shown.
   */
  irradianceSaturation(cover: number, mode: LightingMode, base: number): number | null {
    if (!this.enabled || !this.shown) return null;
    const a = this.entries.get(this.shown.a),
      b = this.entries.get(this.shown.b);
    if (!a || !b) return null;
    return this.balance(a, b, this.shown.weight, cover, mode, base);
  }
  private balance(a: Entry, b: Entry, w: number, cover: number, mode: LightingMode, base: number) {
    const photo = [0, 1, 2].map((c) => a.info.domeMean[c] * (1 - w) + b.info.domeMean[c] * w);
    const physical = skyCosineRadiance(cover, mode).toArray();
    const balance = (rgb: readonly number[], s: number) => {
      const y = Y(rgb);
      return (y + s * (rgb[2] - y)) / Math.max(1e-6, y + s * (rgb[0] - y));
    };
    const target = balance(physical, base),
      y = Y(photo);
    if (balance(photo, 1) <= target) return 1;
    // Solve y + s (B - y) = t (y + s (R - y)) for s.
    const s = ((target - 1) * y) / (photo[2] - y - target * (photo[0] - y));
    return Math.min(1, Math.max(0.25, s));
  }

  /** Ids of the pair the last visible bind showed (null when none). */
  get shownPair(): { readonly a: string; readonly b: string } | null {
    return this.shown;
  }

  diagnostics() {
    return {
      enabled: this.enabled,
      palette: this.palette,
      variant: this.variant,
      key: this.key,
      shown: this.shown,
      resident: [...this.entries.values()].map((e) => ({
        id: e.id,
        loaded: !!e.textures,
        failed: e.failed,
        bytes: e.textures?.bytes ?? 0,
      })),
    };
  }

  dispose() {
    this.disposed = true;
    for (const entry of this.entries.values()) this.release(entry);
    this.entries.clear();
    for (const material of this.bound) unbind(material.uniforms as unknown as PhotoSkyUniforms);
    this.bound.clear();
  }
}
