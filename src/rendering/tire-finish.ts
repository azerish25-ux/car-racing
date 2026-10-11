import {
  BufferAttribute,
  Color,
  MeshStandardMaterial,
  Vector2,
  Vector3,
  Vector4,
  type BufferGeometry,
} from 'three';
import { TYRE_ART, TYRE_SIDEWALL_GLSL, tyreLetteringAtlas } from './studio/tyre-letters.ts';
import { PERIODIC_COVERAGE_GLSL } from './periodic-coverage.ts';
import treadShader from '../shaders/tread.frag?raw';

/** Immutable rubber coordinates, independent of glTF UV layout and live carcass
 * deflection. The reduced mesh's local Y axle is rotated to the same X convention.
 * Never change position/normal/UV/index data or the collision/contact geometry. */
export function bindTireSurface(geometry: BufferGeometry, axle: 'x' | 'y' = 'x') {
  if (geometry.hasAttribute('tireBind')) return geometry;
  const position = geometry.getAttribute('position');
  if (!position || position.itemSize !== 3) throw new Error('Missing tyre positions');
  const values = new Float32Array(position.count * 3);
  for (let i = 0; i < position.count; i++) {
    const x = position.getX(i),
      y = position.getY(i),
      z = position.getZ(i);
    if (!Number.isFinite(x + y + z)) throw new Error('Nonfinite tyre coordinates');
    values[i * 3] = axle === 'x' ? x : -y;
    values[i * 3 + 1] = axle === 'x' ? y : x;
    values[i * 3 + 2] = z;
  }
  geometry.setAttribute('tireBind', new BufferAttribute(values, 3));
  return geometry;
}

/** A bounded, instantaneous appearance observation, not a new fluid simulation.
 * Contact water is ignored for unloaded tyres. No wall clock, state accumulation
 * or hidden drying timer: a replay seek reproduces the same material. */
export function tireWetAppearance(rain: number, water: number, load: number, speed: number) {
  if (
    !Number.isFinite(rain) ||
    !Number.isFinite(water) ||
    !Number.isFinite(load) ||
    !Number.isFinite(speed)
  )
    return 0;
  return Math.max(
    0,
    Math.min(
      1,
      Math.max(rain / 14, load > 20 ? (Math.max(0, water) * Math.max(2, Math.abs(speed))) / 25 : 0),
    ),
  );
}

/** Tread surface temperature (deg C) to its appearance: 0 at or below 45 C
 * (cold, matte), 1 at 95 C and above (in the window, tacky). Bounded, and a
 * non-finite reading is treated as cold. */
export function tireHeatAppearance(surfaceTemp: number) {
  if (!Number.isFinite(surfaceTemp)) return 0;
  const t = Math.max(0, Math.min(1, (surfaceTemp - 45) / 50));
  return t * t * (3 - 2 * t);
}

/** Lit rubber with original drainage styling for intermediate/wet compounds.
 * Grooves are filtered material shading, not cut geometry or altered tyre forces. */
export function treadMaterial(halfWidth = 0.155) {
  if (!Number.isFinite(halfWidth) || halfWidth < 0.1 || halfWidth > 0.25)
    throw new Error('Invalid tyre material width');
  const material = new MeshStandardMaterial({
    color: TYRE_ART.tread.color,
    roughness: TYRE_ART.tread.roughness,
  });
  const condition = { value: new Vector4() };
  // wet appearance, drainage style (0 slick / 1 intermediate / 2 wet), half-width
  const surface = { value: new Vector3(0, 0, halfWidth) };
  // Sidewall (D12): compound band colour, rotational blur 0..1 and lettering on/off.
  const band = { value: new Color(0xf5c400) };
  const side = { value: new Vector2(0, 0) };
  const lettering = { value: tyreLetteringAtlas() };
  side.value.y = lettering.value ? 1 : 0;
  const sidewall = { value: new Color(TYRE_ART.sidewall.color) };
  // Tread temperature appearance, 0 cold (matte, greyer) to 1 in the window (darker, tacky sheen).
  const heat = { value: 0 };
  material.onBeforeCompile = (shader) => {
    shader.uniforms.treadCondition = condition;
    shader.uniforms.treadSurface = surface;
    shader.uniforms.treadBandColor = band;
    shader.uniforms.treadSide = side;
    shader.uniforms.tireLettering = lettering;
    shader.uniforms.treadSidewallColor = sidewall;
    shader.uniforms.treadHeat = heat;
    shader.vertexShader = shader.vertexShader
      .replace(
        '#include <common>',
        '#include <common>\nattribute vec3 tireBind; varying vec3 vTireBind;',
      )
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvTireBind=tireBind;');
    shader.fragmentShader = shader.fragmentShader
      .replace(
        '#include <common>',
        `#include <common>
        uniform vec4 treadCondition; uniform vec3 treadSurface;
        uniform vec3 treadBandColor; uniform vec2 treadSide; uniform vec3 treadSidewallColor;
        uniform sampler2D tireLettering;
        uniform float treadHeat;
        varying vec3 vTireBind;
        ${PERIODIC_COVERAGE_GLSL}`,
      )
      .replace(
        '#include <map_fragment>',
        '#include <map_fragment>\n' +
          treadShader +
          TYRE_SIDEWALL_GLSL +
          // A cold slick reads matte and a touch grey; in its window the
          // compound darkens and goes tacky. Crown only, wet film unchanged.
          '\ndiffuseColor.rgb *= mix(1.0, mix(1.07, 0.86, treadHeat), tireCrown * (1. - tireGroove));',
      )
      .replace(
        '#include <normal_fragment_maps>',
        `#include <normal_fragment_maps>
        // Material relief only. The tyre silhouette/contact geometry is unchanged.
        float tireHeight = -.0015 * tireGroove;
        vec3 tireSigmaX = dFdx(-vViewPosition), tireSigmaY = dFdy(-vViewPosition);
        vec3 tireR1 = cross(tireSigmaY, normal), tireR2 = cross(normal, tireSigmaX);
        float tireDet = dot(tireSigmaX, tireR1);
        vec3 tireGradient = sign(tireDet) * (dFdx(tireHeight) * tireR1 + dFdy(tireHeight) * tireR2);
        normal = normalize(max(abs(tireDet), 1.e-10) * normal - tireGradient);`,
      )
      .replace(
        '#include <roughnessmap_fragment>',
        `#include <roughnessmap_fragment>
        // D12: fresh slick .75 rising to .82 scrubbed; sidewall .58; ink a touch glossier.
        roughnessFactor = mix(${TYRE_ART.sidewall.roughness.toFixed(2)}, roughnessFactor + ${(TYRE_ART.tread.scrubbed - TYRE_ART.tread.roughness).toFixed(2)} * clamp(treadCondition.y * 2., 0., 1.), tireCrown) - .08 * tireInk;
        roughnessFactor -= .1 * treadHeat * tireCrown * (1. - tireGroove);
        roughnessFactor = clamp(roughnessFactor - .32 * tireWet * (1. - tireGroove)
          + .07 * tireGroove + .06 * clamp(treadCondition.x, 0., 1.), .4, 1.);`,
      );
  };
  material.customProgramCacheKey = () => 'apex-contact-tread-v4-bind-drainage-sidewall-heat';
  return { material, condition, surface, band, side, heat };
}
