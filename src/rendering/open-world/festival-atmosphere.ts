import * as T from 'three';
import { ATMOSPHERE } from '../atmosphere.ts';
import type { GradeProfile } from '../broadcast-grade.ts';
import { lightingDirection, type LightingMode } from '../daylight.ts';
import { aerialFogColor, aerialSunGlow, AERIAL_PERSPECTIVE } from '../studio/aerial-perspective.ts';
import { chainShaderHook } from '../studio/shader-hooks.ts';
import { studioUniforms } from '../studio/studio-frame.ts';

/**
 * Aerial perspective of the festival region (render only).
 *
 * The references (FH6 006-098) show clean air on a clear day: a cone 26-37 km
 * away keeps its snow and its blue-grey flank, ridges 5-15 km out step back in
 * layers, each lighter and bluer (measured: ridge colour = ground x T + horizon
 * x (1 - T) with optical depths close to the Rayleigh air alone, blue/red
 * about 5:1). three's FogExp2 squares the optical depth, so it left near
 * ridges crisp, turned 8 km grey (82 % at the old density) and would have
 * erased anything at 25 km.
 *
 * Here every festival material (and the distant landscape) uses single
 * scattering of two exponential layers: Rayleigh (8 km scale height, the
 * atmosphere's own coefficients) and aerosol (1.2 km, Angstrom 1.3) at a
 * festival haze level per lighting and cloud; per channel
 * T = exp(-d (bR fR + bM fM)), fR/fM the mean density along the sightline in
 * closed form, and in-scatter = the art-bible horizon away from the sun plus
 * its forward glow toward the sun. Rain adds grey extinction.
 *
 * The photographed dome's own land (South-African mesas in the clear-day
 * photo, hills in the overcast one) would stand above the Japanese ranges, so
 * the festival raises those photos' skyline and fades the band under it into
 * the same horizon colour (`festivalSkyline`).
 */
export const FESTIVAL_AIR = Object.freeze({
  /** Rayleigh multiplier over the atmosphere's: 1.15 puts the cone's flank
   * at 26 km at the references' blue/red ratio (3.5-4, 021/036). */
  rayleigh: 1.15,
  rayleighScaleHeight: ATMOSPHERE.rayleighScaleHeight,
  mieScaleHeight: ATMOSPHERE.mieScaleHeight,
  /** Aerosol level (multiples of the atmosphere's reference aerosol) per
   * lighting at cover 0 and the increase to cover 1. Day 1.6 matches the
   * clear references; golden hour carries the warm forward-scattering veil
   * of 017/029/098; night a little moist air. */
  haze: Object.freeze({ day: [1.6, 9], sunset: [5.5, 7], night: [2.5, 6] } as const),
  /** Breadth of the sun-side glow over distant ground (cosine power). */
  sunPower: 9,
  /** Golden-hour haze away from the sun, relative colour (linear R:G:B):
   * the pink-lilac of refs 044 (#c6b5c7) and 051 (#ceb6b2), at the
   * luminance of the art-bible's golden-hour horizon. */
  goldenHaze: Object.freeze([1, 0.78, 0.85] as const),
  /** Skyline (degrees) the festival imposes on photographed skies whose own
   * land would otherwise rise above the region's horizon. */
  skyline: Object.freeze({ 'kiara-5-noon': 9.8, 'waterbuck-trail': 11.5 } as Record<
    string,
    number
  >),
});

const MIE_SPECTRUM = [680, 550, 440].map((nm) => (nm / 550) ** -ATMOSPHERE.mieAngstrom);
const luminance = (c: readonly number[]) => 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];

/** Shared uniforms of the festival air (bound by identity). */
export const festivalAirUniforms = Object.freeze({
  fhApRayleigh: { value: new T.Vector3(...ATMOSPHERE.rayleighScattering) },
  fhApMie: { value: new T.Vector3() },
  fhApInvScale: {
    value: new T.Vector2(1 / ATMOSPHERE.rayleighScaleHeight, 1 / ATMOSPHERE.mieScaleHeight),
  },
  fhApInscatter: { value: new T.Vector3(0.26, 0.41, 0.69) },
  fhApSunGlow: { value: new T.Vector3() },
  fhApSunDir: { value: new T.Vector3(0, 1, 0) },
  fhApSunPower: { value: FESTIVAL_AIR.sunPower },
});

/** Declarations and the aerial term (guarded: one copy per shader). */
export const FESTIVAL_AIR_GLSL = /* glsl */ `
#ifndef FH_AIR_DECLARED
#define FH_AIR_DECLARED
uniform vec3 fhApRayleigh;
uniform vec3 fhApMie;
uniform vec2 fhApInvScale;
uniform vec3 fhApInscatter;
uniform vec3 fhApSunGlow;
uniform vec3 fhApSunDir;
uniform float fhApSunPower;
// Mean of exp(-h / H) along a sightline from height h0 rising by dh.
float fhApMean(float h0, float dh, float inverseScale) {
  float b = dh * inverseScale;
  float shape = abs(b) > 1e-3 ? (1.0 - exp(-b)) / b : 1.0 - 0.5 * b;
  return exp(-max(h0, -50.0) * inverseScale) * shape;
}
// Transmittance and in-scatter of the festival air along a world-space ray.
vec3 fhAerial(vec3 color, vec3 ray) {
  float d = length(ray);
  float h0 = cameraPosition.y;
  vec3 tau = d * (fhApRayleigh * fhApMean(h0, ray.y, fhApInvScale.x)
    + fhApMie * fhApMean(h0, ray.y, fhApInvScale.y));
  vec3 t = exp(-min(tau, vec3(30.0)));
  float toSun = max(dot(ray / max(d, 1e-3), fhApSunDir), 0.0);
  vec3 inscatter = fhApInscatter + fhApSunGlow * pow(toSun, fhApSunPower);
  return color * t + inscatter * (1.0 - t);
}
#endif
`;

/** Bind the festival air into a compiling shader. */
export function bindFestivalAir(shader: { uniforms: Record<string, T.IUniform> }) {
  Object.assign(shader.uniforms, festivalAirUniforms);
}

/** Extinction (1/m at 680/550/440 nm, sea level) of the festival air. */
export function festivalExtinction(mode: LightingMode, cover: number, rain: number) {
  const [clear, overcast] = FESTIVAL_AIR.haze[mode],
    c = Math.min(1, Math.max(0, cover)),
    haze = clear + overcast * c,
    mie = (ATMOSPHERE.mieScattering + ATMOSPHERE.mieAbsorption) * haze,
    wet = AERIAL_PERSPECTIVE.rainExtinction * Math.min(60, Math.max(0, rain));
  const r = ATMOSPHERE.rayleighScattering.map((b) => b * FESTIVAL_AIR.rayleigh);
  return {
    rayleigh: r as [number, number, number],
    mie: MIE_SPECTRUM.map((k) => mie * k + wet) as [number, number, number],
  };
}

/** CPU reference of the shader: fraction of the ground colour left (per
 * channel) for a camera height, a point height and a distance (m). */
export function festivalTransmittance(
  mode: LightingMode,
  cover: number,
  rain: number,
  cameraHeight: number,
  pointHeight: number,
  distance: number,
) {
  const { rayleigh, mie } = festivalExtinction(mode, cover, rain),
    mean = (inverse: number) => {
      const b = (pointHeight - cameraHeight) * inverse,
        shape = Math.abs(b) > 1e-3 ? -Math.expm1(-b) / b : 1 - 0.5 * b;
      return Math.exp(-Math.max(cameraHeight, -50) * inverse) * shape;
    },
    fR = mean(1 / FESTIVAL_AIR.rayleighScaleHeight),
    fM = mean(1 / FESTIVAL_AIR.mieScaleHeight);
  return [0, 1, 2].map((k) =>
    Math.exp(-Math.min(30, distance * (rayleigh[k] * fR + mie[k] * fM))),
  ) as [number, number, number];
}

/**
 * The festival's photographed dome: raise the skyline of photos whose own
 * land would stand above the region (FESTIVAL_AIR.skyline) and fade the band
 * under it into the festival horizon (`photoHorizon`), so the distant ranges
 * dissolve into the same colour as their haze. Call after each visible bind.
 */
export function festivalSkyline(
  material: T.ShaderMaterial,
  shown: { readonly a: string; readonly b: string } | null,
  horizon: T.Color,
  amount: number,
) {
  const u = material.uniforms;
  if (!u.photoA || !u.photoB || !u.photoHorizon) return;
  const raise = (id: string, photo: T.Vector4) => {
    const degrees = FESTIVAL_AIR.skyline[id];
    if (degrees) photo.w = Math.max(photo.w, (degrees * Math.PI) / 180);
  };
  if (shown) {
    raise(shown.a, u.photoA.value as T.Vector4);
    raise(shown.b, u.photoB.value as T.Vector4);
  }
  (u.photoHorizon.value as T.Vector4).set(horizon.r, horizon.g, horizon.b, amount);
}

/**
 * The festival's grade over the shared gameplay profiles (relative, so it
 * holds over ACES and the filmic transforms alike). Measured against the
 * references: the clear-day zenith reads #789cd8-#84addf (HSV saturation
 * 0.41-0.44) where the festival showed #90abdc (0.35), so a little more
 * saturation and vibrance (which lifts the muted sky and foliage, not the
 * already saturated liveries); golden hour keys warmer highlights against
 * cooler shade (017 #f9dbb9 sky, 098 #efc7a8, shadows blue-grey). Night keeps
 * the shared profile.
 */
export const FESTIVAL_GRADE = Object.freeze({
  day: {
    contrast: 0.01,
    saturation: 1.05,
    vibrance: 0.06,
    highlight: [1, 1, 1],
    shadow: [1, 1, 1],
  },
  sunset: {
    contrast: 0,
    saturation: 1.04,
    vibrance: 0.03,
    highlight: [1.02, 0.99, 0.95],
    shadow: [0.98, 0.99, 1.03],
  },
  night: { contrast: 0, saturation: 1, vibrance: 0, highlight: [1, 1, 1], shadow: [1, 1, 1] },
} as const);
const graded = new WeakMap<object, Map<LightingMode, GradeProfile>>();
/** BroadcastGradePass.profileAdjust of the festival (memoised per profile). */
export function festivalGrade(mode: LightingMode, base: Readonly<GradeProfile>): GradeProfile {
  let byMode = graded.get(base);
  if (!byMode) graded.set(base, (byMode = new Map()));
  let profile = byMode.get(mode);
  if (!profile) {
    const a = FESTIVAL_GRADE[mode];
    profile = {
      ...base,
      contrast: base.contrast + a.contrast,
      saturation: base.saturation * a.saturation,
      vibrance: base.vibrance + a.vibrance,
      highlightTint: base.highlightTint.map((v, i) => v * a.highlight[i]) as [
        number,
        number,
        number,
      ],
      shadowTint: base.shadowTint.map((v, i) => v * a.shadow[i]) as [number, number, number],
    };
    byMode.set(mode, profile);
  }
  return profile;
}

/** Materials that keep their own air (or none). */
const SKIP_KEY = 'festival-air-v1';
function eligible(material: T.Material) {
  if (material.userData.festivalAir === false) return false;
  if (!(material as { fog?: boolean }).fog || material instanceof T.RawShaderMaterial) return false;
  // The circuit's local atmosphere already replaced this fog term.
  const key = material.customProgramCacheKey();
  return !key.includes('apex-local-atmosphere');
}

/**
 * The festival's air: per-frame state (extinction, horizon colour, sun glow
 * and direction) and the installer that gives festival materials the aerial
 * term in place of three's FogExp2 fog.
 */
export class FestivalAtmosphere {
  private readonly installed = new WeakSet<T.Material>();
  private readonly skipped = new WeakSet<T.Material>();
  /** Linear in-scatter colour (also the scene fog colour). */
  readonly inscatter = new T.Color();
  materialCount = 0;
  /** FogExp2 density that approximates this air for uninstalled materials. */
  fogDensity = 5e-5;
  /** Give the aerial term to every eligible material under `root` (skipping
   * the excluded subtrees). Cheap when nothing is new. */
  install(root: T.Object3D, exclude: readonly T.Object3D[] = []) {
    const skip = new Set(exclude);
    const visit = (object: T.Object3D) => {
      if (skip.has(object)) return;
      const material = (object as Partial<T.Mesh>).material;
      if (material)
        for (const m of Array.isArray(material) ? material : [material]) this.installMaterial(m);
      for (const child of object.children) visit(child);
    };
    visit(root);
  }
  installMaterial(material: T.Material) {
    if (this.installed.has(material) || this.skipped.has(material)) return false;
    if (!eligible(material)) {
      this.skipped.add(material);
      return false;
    }
    this.installed.add(material);
    this.materialCount++;
    return chainShaderHook(material, SKIP_KEY, (shader) => {
      // Only shaders with both of three's fog chunks (custom shaders without
      // them keep whatever they do).
      if (
        !shader.vertexShader.includes('#include <fog_vertex>') ||
        !shader.vertexShader.includes('#include <fog_pars_vertex>') ||
        !shader.fragmentShader.includes('#include <fog_fragment>') ||
        !shader.fragmentShader.includes('#include <fog_pars_fragment>')
      )
        return;
      bindFestivalAir(shader);
      shader.vertexShader = shader.vertexShader
        .replace(
          '#include <fog_pars_vertex>',
          `#include <fog_pars_vertex>
#ifdef USE_FOG
varying vec3 vFhAirRay;
#endif`,
        )
        .replace(
          '#include <fog_vertex>',
          `#include <fog_vertex>
#ifdef USE_FOG
vFhAirRay = transpose(mat3(viewMatrix)) * mvPosition.xyz;
#endif`,
        );
      shader.fragmentShader = shader.fragmentShader
        .replace(
          '#include <fog_pars_fragment>',
          `#include <fog_pars_fragment>
#ifdef USE_FOG
varying vec3 vFhAirRay;
${FESTIVAL_AIR_GLSL}
#endif`,
        )
        .replace(
          '#include <fog_fragment>',
          `#ifdef USE_FOG
gl_FragColor.rgb = fhAerial(gl_FragColor.rgb, vFhAirRay);
#endif`,
        );
    });
  }
  /** This frame's air for the lighting, cloud cover and rain rate. */
  update(mode: LightingMode, cover: number, rain: number) {
    const u = festivalAirUniforms,
      { rayleigh, mie } = festivalExtinction(mode, cover, rain);
    u.fhApRayleigh.value.set(...rayleigh);
    u.fhApMie.value.set(...mie);
    // The art-bible horizon (studio/aerial-perspective.ts colours: clear day
    // #9db8d3 away from the sun, #c9d3dc toward it; golden hour #7d84a0 and
    // #d9a27c), the references' blue (036 #a6c1e6, 021 #b2c0da), rather than
    // the greyer physical horizon (B/R 1.4) or the clear-day photo's brown.
    const colour = aerialFogColor(cover, rain, mode);
    if (mode === 'sunset') {
      // Same luminance, the references' warm veil instead of blue-grey.
      const [r, g, b] = FESTIVAL_AIR.goldenHaze,
        scale = luminance(colour) / luminance([r, g, b]);
      colour[0] = r * scale;
      colour[1] = g * scale;
      colour[2] = b * scale;
    }
    this.inscatter.setRGB(colour[0], colour[1], colour[2], T.LinearSRGBColorSpace);
    u.fhApInscatter.value.set(colour[0], colour[1], colour[2]);
    aerialSunGlow(cover, mode, u.fhApSunGlow.value);
    const sun = lightingDirection(mode);
    u.fhApSunDir.value.copy(sun).normalize();
    // The festival has no studio frame: keep the shared sun direction (foliage
    // translucency, lens flare) on this lighting's key while it draws.
    studioUniforms.studioSunDir.value.copy(u.fhApSunDir.value);
    // FogExp2 for materials outside the installer: equal to the green
    // channel's haze at 8 km along the ground ((rho d)^2 = beta d).
    this.fogDensity = Math.sqrt((rayleigh[1] + mie[1]) / 8000);
  }
}
