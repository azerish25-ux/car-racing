import * as T from 'three';
import type { LightingMode } from '../daylight.ts';
import { SKY_CLOUDS, cloudLayer } from './sky-clouds.ts';

/**
 * Cloud shadows: the same cumulus field the sky bakes, cast on the circuit.
 *
 * Every material that carries the local atmosphere (LocalAtmosphere: the
 * circuit, terrain, forest, cars and stands) multiplies the sun's incident
 * light (directional light 0, diffuse and specular alike) by the field's
 * footprint at the point where the sun ray from the fragment crosses the
 * cloud layer. Shaded patches keep their sky light (IBL, hemisphere), so a
 * cloud shadow reads as the cool, soft-edged dimming of a real one. The
 * field drifts with the wind (8.9 m/s, from presented simulation time via the
 * dome's `cloudDrift`, so pause and replay hold it); its wrap every three hours
 * is a whole number of field periods, so the shadows never jump.
 *
 * Cost: two texture fetches and a few ALU per lit fragment; no draw, no
 * render target. Fades out toward a closed deck, where the sun term is
 * already the diffuse light under it, and at night.
 */
export const CLOUD_SHADOW = Object.freeze({
  /** Share of the sun removed under a cloud's footprint. */
  strength: 0.9,
  /** Penumbra: field-value span over which the shadow edge fades. */
  softness: 0.045,
  /** Wind along the field's street axis, metres per second. */
  windSpeed: (SKY_CLOUDS.fieldPeriod * 4) / 10800,
  /** Fraction of the layer depth at which the sun ray samples the field. */
  layerHeight: 0.3,
});

export interface CloudShadowUniforms {
  /** The baked cloud field (SkyClouds), or null before the first bake. */
  apexCloudField: T.IUniform<T.Texture | null>;
  /** (threshold, strength, layer altitude above the datum, 1 / field period). */
  apexCloudShadow: T.IUniform<T.Vector4>;
  /** World direction toward the sun. */
  apexCloudShadowSun: T.IUniform<T.Vector3>;
  /** Wind offset of the field, metres. */
  apexCloudShadowOffset: T.IUniform<T.Vector2>;
}
export function createCloudShadowUniforms(): CloudShadowUniforms {
  return {
    apexCloudField: { value: null },
    apexCloudShadow: { value: new T.Vector4(2, 0, 1500, 1 / SKY_CLOUDS.fieldPeriod) },
    apexCloudShadowSun: { value: new T.Vector3(0, 1, 0) },
    apexCloudShadowOffset: { value: new T.Vector2() },
  };
}
/** Shared by every installed material, bound by identity. */
export const cloudShadowUniforms: CloudShadowUniforms = createCloudShadowUniforms();

function smooth(a: number, b: number, x: number) {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
}
/** Shadow strength for a cover and lighting: full for scattered cumulus,
 * fading out as the deck closes (0.5-0.9) and absent at night. */
export function cloudShadowStrength(cover: number, mode: LightingMode) {
  if (!Number.isFinite(cover)) throw new Error('Non-finite cloud cover');
  if (mode === 'night' || cloudLayer(cover).threshold >= 1) return 0;
  return CLOUD_SHADOW.strength * (1 - smooth(0.5, 0.9, cover));
}
/** Write this frame's cloud shadow state (SkyEnvironment.update). `drift` is
 * the dome's cloudDrift in turns (presented time / 3 h). */
export function setCloudShadow(
  field: T.Texture | null,
  cover: number,
  mode: LightingMode,
  sun: T.Vector3,
  drift: number,
  uniforms: CloudShadowUniforms = cloudShadowUniforms,
) {
  const layer = cloudLayer(cover);
  uniforms.apexCloudField.value = field;
  uniforms.apexCloudShadow.value.set(
    layer.threshold,
    field ? cloudShadowStrength(cover, mode) : 0,
    layer.baseAltitude + layer.thickness * CLOUD_SHADOW.layerHeight,
    1 / SKY_CLOUDS.fieldPeriod,
  );
  uniforms.apexCloudShadowSun.value.copy(sun).normalize();
  const metres = (Number.isFinite(drift) ? drift : 0) * 10800 * CLOUD_SHADOW.windSpeed;
  uniforms.apexCloudShadowOffset.value.set(-metres, 0);
}

/** Fragment declarations (once per program). `apexCloudShadow(viewPosition)`
 * returns the sun's transmitted share at a view-space point. */
export const CLOUD_SHADOW_PARS = `
#ifndef APEX_CLOUD_SHADOW_DECLARED
#define APEX_CLOUD_SHADOW_DECLARED
uniform sampler2D apexCloudField;
uniform vec4 apexCloudShadow;
uniform vec3 apexCloudShadowSun;
uniform vec2 apexCloudShadowOffset;
float apexCloudShadowAt(vec3 viewPosition) {
  if (apexCloudShadow.y <= 0.0) return 1.0;
  // View space back to world: the view matrix is a rigid transform.
  vec3 world = cameraPosition + transpose(mat3(viewMatrix)) * viewPosition;
  vec3 s = apexCloudShadowSun;
  vec2 xz = world.xz + s.xz * ((apexCloudShadow.z - world.y) / max(s.y, 0.08)) + apexCloudShadowOffset;
  vec2 uv = xz * apexCloudShadow.w;
  // As the sky's density: the field, broken by a rotated, rescaled view.
  float broad = texture2D(apexCloudField, mat2(0.8, -0.6, 0.6, 0.8) * uv * 0.37 + vec2(0.31, 0.67)).r;
  float base = texture2D(apexCloudField, uv).r * mix(0.97, 1.03, broad);
  float cover = smoothstep(apexCloudShadow.x - ${(CLOUD_SHADOW.softness * 0.3).toFixed(4)},
    apexCloudShadow.x + ${CLOUD_SHADOW.softness.toFixed(4)}, base);
  return 1.0 - apexCloudShadow.y * cover;
}
#endif
`;
/** The sun's line in three's directional light loop, and its replacement. */
export const CLOUD_SHADOW_ANCHOR = 'getDirectionalLightInfo( directionalLight, directLight );';
export const CLOUD_SHADOW_LIGHT = `${CLOUD_SHADOW_ANCHOR}
		#if UNROLLED_LOOP_INDEX == 0
		directLight.color *= apexCloudShadowAt( geometryPosition );
		#endif`;

/** Inject into a compiling Standard/Physical/Lambert/Phong shader (after any
 * hook that inlined `lights_fragment_begin`). Returns false when the light
 * loop is not in the expected form (a custom lighting path): no shadow. */
export function injectCloudShadow(
  shader: { fragmentShader: string; uniforms: Record<string, T.IUniform> },
  uniforms: CloudShadowUniforms = cloudShadowUniforms,
) {
  let source = shader.fragmentShader;
  if (source.includes('#include <lights_fragment_begin>'))
    source = source.replace(
      '#include <lights_fragment_begin>',
      T.ShaderChunk.lights_fragment_begin,
    );
  if (source.split(CLOUD_SHADOW_ANCHOR).length !== 2 || !source.includes('#include <common>'))
    return false;
  shader.fragmentShader = source
    .replace('#include <common>', `#include <common>\n${CLOUD_SHADOW_PARS}`)
    .replace(CLOUD_SHADOW_ANCHOR, CLOUD_SHADOW_LIGHT);
  Object.assign(shader.uniforms, uniforms);
  return true;
}
