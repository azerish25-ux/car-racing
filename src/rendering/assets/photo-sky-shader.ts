import * as T from 'three';

/**
 * Photographed sky in the sky dome's fragment shader (daylight.ts).
 *
 * A shipped Ultra HDR sky is two textures: the sRGB base (full size, decoded
 * by the GPU's sRGB sampler) and a half-size scalar gain map (R8, log2 over
 * [0, gainMax]), so linear radiance = base * 2^(gain * gainMax). Decoding in
 * the shader keeps a 4k sky at 8-bit cost (no half-float copy) and lets the
 * dome crossfade two skies per pixel. Directions map to the photo through
 * three's equirectangular convention, rotated about +y so the photo's sun
 * sits under the scene's key light; texture gradients come from a seam-free
 * longitude so the wrap column never selects the smallest mip.
 *
 * Per sky `photoA` / `photoB` = (rotation rad, gainMax, radiance scale,
 * skyline rad). Below the skyline the photo's land gives way to a blurred
 * band of the sky above it (the circuit's own terrain stands there).
 * `photoAmount` 0 leaves the procedural sky untouched (and skips sampling);
 * 1 replaces it. `photoHorizon` (rgb, amount; 0 by default) lets a renderer
 * fade that band into its own horizon colour. Cube captures (PMREM bins, local probes: `sunDiscAmount`
 * 0) clamp radiance to `photoCaptureClamp`, since the directional light
 * already carries the sun, and keep `photoCaptureSaturation` of its chroma
 * (renderers without the IBL colour balance of `ibl-energy.ts`).
 * `photoClouds` (0 by default; the festival's cloud-free photos) lays the
 * dome's baked cumulus and cirrus (sky-clouds.ts) over the photograph, lit by
 * the same sun and sky as on the procedural dome (daylight.ts SKY_FRAGMENT).
 * `photoTone` (chroma gain, ramp in radians, luminance gain; gains 1 by
 * default) and `photoTint` (rgb gain, white by default) grade the visible
 * photograph from its skyline upward (the festival's dome; captures keep the
 * photo's own colour).
 */
export const PHOTO_SKY_UNIFORMS = `
uniform sampler2D photoBaseA;
uniform sampler2D photoGainA;
uniform vec4 photoA;
uniform sampler2D photoBaseB;
uniform sampler2D photoGainB;
uniform vec4 photoB;
uniform float photoWeight;
uniform float photoAmount;
uniform float photoCaptureClamp;
uniform float photoCaptureSaturation;
uniform vec4 photoHorizon;
uniform float photoClouds;
uniform vec4 photoTone;
uniform vec3 photoTint;
`;
export const PHOTO_SKY_SAMPLE = `
vec3 photoSkyDecode(vec4 base, float gain, vec4 photo) {
  return base.rgb * exp2(gain * photo.y);
}
vec3 photoSkySample(sampler2D base, sampler2D gain, vec4 photo, vec3 direction) {
  const float TAU = 6.283185307179586;
  const float PI = 3.141592653589793;
  const float DEGREE = 0.017453292519943295;
  float azimuth = atan(direction.z, direction.x) - photo.x;
  float u = fract(azimuth / TAU + 0.5);
  float elevation = asin(clamp(direction.y, -1.0, 1.0));
  float v = 0.5 - elevation / PI;
  // Seam-free derivatives: the same longitude wrapped half a turn away.
  float uAlt = fract(azimuth / TAU) - 0.5;
  vec2 dx = vec2(dFdx(u), dFdx(v)), dy = vec2(dFdy(u), dFdy(v));
  float ax = dFdx(uAlt), ay = dFdy(uAlt);
  if (abs(ax) < abs(dx.x)) dx.x = ax;
  if (abs(ay) < abs(dy.x)) dy.x = ay;
  vec2 uv = vec2(u, v);
  vec3 radiance = photoSkyDecode(textureGrad(base, uv, dx, dy), textureGrad(gain, uv, dx, dy).r, photo);
  // Under the skyline (photo.w) the photographer's land is replaced by the
  // sky just above it, blurred across azimuth: a haze band the venue's own
  // terrain and aerial perspective stand in front of.
  float haze = 1.0 - smoothstep(photo.w - DEGREE, photo.w, elevation);
  if (haze > 0.0) {
    float lod = log2(float(textureSize(base, 0).x) / 64.0);
    vec2 h = vec2(u, 0.5 - (max(photo.w, 0.0) + 0.75 * DEGREE) / PI);
    vec3 fill = photoSkyDecode(textureLod(base, h, lod), textureLod(gain, h, lod - 1.0).r, photo);
    radiance = mix(radiance, fill, haze);
  }
  radiance *= photo.z;
  // Opt-in (festival): the band under the skyline fades toward the aerial
  // horizon colour (scene units), so distant relief dissolves into it.
  if (photoHorizon.w > 0.0 && haze > 0.0) {
    float low = 1.0 - smoothstep(0.0, max(photo.w, 1e-3), max(elevation, 0.0));
    radiance = mix(radiance, photoHorizon.rgb, photoHorizon.w * haze * low);
  }
  return radiance;
}
vec3 photoSky(vec3 direction, bool capture) {
  vec3 photo = photoSkySample(photoBaseA, photoGainA, photoA, direction);
  if (photoWeight > 0.0)
    photo = mix(photo, photoSkySample(photoBaseB, photoGainB, photoB, direction), photoWeight);
  if (!capture) {
    if (photoTone.x != 1.0 || photoTone.z != 1.0 || photoTint != vec3(1.0)) {
      // Chroma about the luminance, the luminance itself and a tint, rising
      // from the skyline over photoTone.y.
      float skyline = mix(photoA.w, photoB.w, photoWeight);
      float k = smoothstep(skyline, skyline + photoTone.y, asin(clamp(direction.y, -1.0, 1.0)));
      float y = dot(photo, vec3(0.2126, 0.7152, 0.0722));
      photo = max(mix(vec3(y), photo, mix(1.0, photoTone.x, k)), 0.0) *
        mix(vec3(1.0), photoTint * photoTone.z, k);
    }
    return photo;
  }
  photo = mix(vec3(dot(photo, vec3(0.2126, 0.7152, 0.0722))), photo, photoCaptureSaturation);
  return min(photo, vec3(photoCaptureClamp));
}
`;

export interface PhotoSkyUniforms {
  photoBaseA: { value: T.Texture | null };
  photoGainA: { value: T.Texture | null };
  photoA: { value: T.Vector4 };
  photoBaseB: { value: T.Texture | null };
  photoGainB: { value: T.Texture | null };
  photoB: { value: T.Vector4 };
  photoWeight: { value: number };
  photoAmount: { value: number };
  photoCaptureClamp: { value: number };
  photoCaptureSaturation: { value: number };
  photoHorizon: { value: T.Vector4 };
  photoClouds: { value: number };
  photoTone: { value: T.Vector4 };
  photoTint: { value: T.Vector3 };
}
export const PHOTO_SKY_UNIFORM_NAMES = Object.freeze([
  'photoBaseA',
  'photoGainA',
  'photoA',
  'photoBaseB',
  'photoGainB',
  'photoB',
  'photoWeight',
  'photoAmount',
  'photoCaptureClamp',
  'photoCaptureSaturation',
  'photoClouds',
] as const);
/** Unbound: the procedural sky only. */
export function createPhotoSkyUniforms(): PhotoSkyUniforms {
  return {
    photoBaseA: { value: null },
    photoGainA: { value: null },
    photoA: { value: new T.Vector4() },
    photoBaseB: { value: null },
    photoGainB: { value: null },
    photoB: { value: new T.Vector4() },
    photoWeight: { value: 0 },
    photoAmount: { value: 0 },
    photoCaptureClamp: { value: 65504 },
    photoCaptureSaturation: { value: 1 },
    photoHorizon: { value: new T.Vector4(0, 0, 0, 0) },
    photoClouds: { value: 0 },
    photoTone: { value: new T.Vector4(1, 0.35, 1, 0) },
    photoTint: { value: new T.Vector3(1, 1, 1) },
  };
}
