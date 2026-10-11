import { LIGHT_FOOTPRINT_GLSL } from './light-footprint.ts';
import { roadWeatherUniform } from './weather-presentation.ts';
import { WET_REFLECTION_GLSL, type WetReflectionUniforms } from './wet-reflection.ts';
import { ROAD_MACRO_APPLY, ROAD_MACRO_GLSL } from './road-macro.ts';
import { MeshPhysicalMaterial, MeshStandardMaterial, ShaderChunk, type DataTexture } from 'three';
import wetRoad from '../shaders/wetRoad.frag?raw';
export { treadMaterial } from './tire-finish.ts';
import carbonRoughness from '../shaders/carbon.frag?raw';
import carbonNormal from '../shaders/carbon-normal.frag?raw';

// Approximate visible-light water IOR used only by the presentation lobe.
// The physical track-water field and tire equations are untouched.
export const ROAD_FILM_IOR = 1.333;
export const ROAD_FILM_F0 = ((ROAD_FILM_IOR - 1) / (ROAD_FILM_IOR + 1)) ** 2;

/** Carbon finishes (ART_BIBLE_A §6.2, D06): lacquered bodywork carbon under a
 * clear coat with a +-18 % weave, and raw satin carbon (floor underside) with
 * no coat and a +-8 % weave. */
export const CARBON_FINISHES = Object.freeze({
  lacquered: Object.freeze({
    color: 0x0e1012,
    roughness: 0.36,
    clearcoat: 0.85,
    clearcoatRoughness: 0.07,
    specularIntensity: 1,
    weave: 0.18,
  }),
  // Raw resin scatters: a weaker sheen than lacquer (scales F0 and F90).
  satin: Object.freeze({
    color: 0x121417,
    roughness: 0.55,
    clearcoat: 0,
    clearcoatRoughness: 0,
    specularIntensity: 0.6,
    weave: 0.08,
  }),
});
/** Peak anisotropy of a resolved carbon tow's base lobe. */
export const CARBON_TOW_SHEEN = 0.55;
export function carbonMaterial(finish: keyof typeof CARBON_FINISHES = 'lacquered') {
  const f = CARBON_FINISHES[finish];
  const material = new MeshPhysicalMaterial({
    color: f.color,
    metalness: 0,
    roughness: f.roughness,
    clearcoat: f.clearcoat,
    clearcoatRoughness: f.clearcoatRoughness,
    specularIntensity: f.specularIntensity,
  });
  // Enables the anisotropic base lobe; the shader drives it per tow.
  material.anisotropy = CARBON_TOW_SHEEN;
  material.onBeforeCompile = (shader) => {
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec2 vCarbonUv;')
      .replace(
        '#include <begin_vertex>',
        '#include <begin_vertex>\nvCarbonUv = vec2(position.x + position.z * 0.7071, position.y + position.z * 0.7071) * 333.0;',
      );
    shader.fragmentShader = shader.fragmentShader
      .replace(
        '#include <common>',
        `#include <common>\nvarying vec2 vCarbonUv;\n#define CARBON_WEAVE ${f.weave.toFixed(3)}`,
      )
      .replace(
        '#include <roughnessmap_fragment>',
        '#include <roughnessmap_fragment>\n' + carbonRoughness,
      )
      .replace(
        '#include <normal_fragment_maps>',
        '#include <normal_fragment_maps>\n' + carbonNormal,
      )
      .replace(
        '#include <lights_physical_fragment>',
        `#include <lights_physical_fragment>
        #ifdef USE_ANISOTROPY
          // Tow sheen: the base lobe stretches along each bundle's fibres,
          // alternating warp/weft per twill cell, so the weave flips light to
          // dark as the view moves. Unresolved weave falls back to isotropic.
          material.anisotropy = 0.0;
          if (carbonLength > 0.000001 && carbonResolved > 0.0) {
            vec3 towT = carbonTangent - normal * dot(normal, carbonTangent);
            vec3 towB = cross(normal, towT);
            vec3 tow = normalize(mix(towT, towB, twillWarp) + 1e-6);
            material.anisotropy = ${CARBON_TOW_SHEEN.toFixed(3)} * carbonResolved;
            material.alphaT = mix(pow2(material.roughness), 1.0, pow2(material.anisotropy));
            material.anisotropyT = tow;
            material.anisotropyB = cross(normal, tow);
          }
          if (material.anisotropy == 0.0) material.alphaT = pow2(material.roughness);
        #endif`,
      );
  };
  material.customProgramCacheKey = () =>
    finish === 'lacquered'
      ? 'apex-metre-carbon-v5-tow-sheen-coat'
      : 'apex-metre-carbon-v5-tow-sheen-satin';
  material.userData.carbonFinish = finish;
  return material;
}

/** Pit water uses the same edge cell as Track.sample; laid rubber and marbles
 * are excluded there because the physics marks PIT as a deposit-free surface. */
export function installWetRoad(
  material: MeshStandardMaterial,
  stateTexture: DataTexture,
  deposits: boolean,
  lampRadius = 0,
  reflection?: WetReflectionUniforms,
) {
  if (!Number.isFinite(lampRadius) || lampRadius < 0) throw new Error('Invalid road lamp radius');
  const previous = material.onBeforeCompile;
  const previousKey = material.customProgramCacheKey();
  const weather = roadWeatherUniform(material);
  material.onBeforeCompile = (shader, renderer) => {
    previous.call(material, shader, renderer);
    shader.uniforms.roadWeather = weather;
    shader.uniforms.trackState = { value: stateTexture };
    shader.uniforms.surfaceDeposits = { value: deposits ? 1 : 0 };
    shader.uniforms.roadLampRadius = { value: lampRadius };
    if (reflection) Object.assign(shader.uniforms, reflection);
    shader.vertexShader = shader.vertexShader
      .replace(
        '#include <common>',
        '#include <common>\nattribute vec2 trackUV; varying vec2 vTrackUV; varying vec2 vRoadMetres;',
      )
      .replace(
        '#include <begin_vertex>',
        '#include <begin_vertex>\nvTrackUV = trackUV; vRoadMetres = uv * 5.0;',
      );
    shader.fragmentShader = shader.fragmentShader.replace(
      '#include <common>',
      '#include <common>\nuniform sampler2D trackState; uniform float surfaceDeposits; uniform vec4 roadWeather; uniform float roadLampRadius; varying vec2 vTrackUV; varying vec2 vRoadMetres;\n' +
        (reflection
          ? 'uniform sampler2D wetReflection; uniform mat4 wetReflectionMatrix; uniform vec4 wetReflectionState;\n'
          : '') +
        LIGHT_FOOTPRINT_GLSL +
        ROAD_MACRO_GLSL,
    );
    shader.fragmentShader = shader.fragmentShader.replace(
      '#include <map_fragment>',
      '#include <map_fragment>\n' + ROAD_MACRO_APPLY + wetRoad,
    );
    shader.fragmentShader = shader.fragmentShader.replace(
      '#include <roughnessmap_fragment>',
      '#include <roughnessmap_fragment>\nroughnessFactor=mix(roughnessFactor,mix(0.22,0.08,puddle),wet);',
    );
    shader.fragmentShader = shader.fragmentShader.replace(
      '#include <normal_fragment_maps>',
      `vec3 dryRoadNormal = normal;
      #include <normal_fragment_maps>
      // A thin damp film follows aggregate. Only deep standing water levels it.
      // Flattening every wet cell by 90% erased the road in low-angle race views.
      normal = normalize(mix(normal, dryRoadNormal, wet * mix(0.35, 0.9, puddle)));
      vec3 roadFilmNormal = normal;
      // Small filtered ripple slopes use presented simulation time and rain.
      // Dry cells and rain-free standing water do not animate independently.
      vec2 roadRippleP = vRoadMetres * vec2(19.,23.);
      float roadRippleResolved = 1.-smoothstep(.5,2.,length(fwidth(roadRippleP)));
      float roadRippleGain = puddle * min(1.,roadWeather.x/18.) * roadRippleResolved * .009;
      vec2 roadRipple = vec2(sin(roadRippleP.x + roadRippleP.y*.37 - roadWeather.y*7. + roadWeather.z*.07),
        cos(roadRippleP.y - roadRippleP.x*.23 - roadWeather.y*9. + roadWeather.w*.07));
      vec3 roadRippleX = mat3(viewMatrix)*vec3(1.,0.,0.);
      vec3 roadRippleZ = mat3(viewMatrix)*vec3(0.,0.,1.);
      vec3 roadRippleSlope = roadRippleX*roadRipple.x + roadRippleZ*roadRipple.y;
      normal = normalize(normal + roadRippleGain*(roadRippleSlope-normal*dot(normal,roadRippleSlope)));`,
    );
    shader.fragmentShader = shader.fragmentShader.replace(
      '#include <clearcoat_normal_fragment_maps>',
      `#include <clearcoat_normal_fragment_maps>
      #ifdef USE_CLEARCOAT
        // The thin coat conforms to the SAME retained surface normal. Standing
        // water tends to the geometric plane; apply the ripple exactly once.
        clearcoatNormal = normalize(mix(roadFilmNormal, clearcoatNormal, puddle));
        clearcoatNormal = normalize(clearcoatNormal + roadRippleGain *
          (roadRippleSlope - clearcoatNormal * dot(clearcoatNormal, roadRippleSlope)));
      #endif`,
    );
    // MeshPhysicalMaterial road ribbons carry a real dielectric water-film lobe.
    // Dry cells explicitly remove it; standing-water cells sharpen it. Standard
    // materials compile the same hook with the guarded branch removed.
    shader.fragmentShader = shader.fragmentShader.replace(
      '#include <lights_physical_fragment>',
      `#include <lights_physical_fragment>
      #ifdef USE_CLEARCOAT
        material.clearcoat = wet * mix(0.58, 1.0, puddle);
        // Stock clearcoat represents a 1.5-IOR varnish. This lobe is water,
        // whose normal-incidence Fresnel response is approximately half as large.
        material.clearcoatF0 = vec3(${ROAD_FILM_F0.toFixed(9)});
        material.clearcoatRoughness = mix(0.26, mix(0.22, 0.055, puddle), wet);
        // Rain-disturbed film broadens the highlight instead of making every wet
        // cell a perfect mirror. Existing cell water alone still owns coverage.
        material.clearcoatRoughness += min(1.,roadWeather.x/18.)*puddle*.045;
        // Do not erase Three's geometric specular filtering when replacing its
        // coat roughness. Add bounded normal-footprint variance for unresolved
        // aggregate/ripples; no frame history, exposure trick or extra sampling.
        vec3 filmDx = dFdx(clearcoatNormal), filmDy = dFdy(clearcoatNormal);
        float filmVariance = min(.02, .25 * (dot(filmDx,filmDx) + dot(filmDy,filmDy)));
        float filmAlpha = material.clearcoatRoughness * material.clearcoatRoughness;
        material.clearcoatRoughness = min(1., max(
          material.clearcoatRoughness + geometryRoughness,
          sqrt(sqrt(filmAlpha * filmAlpha + filmVariance))));
      #endif`,
    );
    // The four circuit point lights stand in for luminous 3.2 x 1.3 m boards.
    // Broaden ONLY their water-coat lobe, then restore material state before the
    // next light / sun / environment contribution. No new light or render pass,
    // global exposure adjustment, or change to dry asphalt and physical water.
    const direct =
      'RE_Direct( directLight, geometryPosition, geometryNormal, geometryViewDir, geometryClearcoatNormal, material, reflectedLight );';
    const pointLighting = ShaderChunk.lights_fragment_begin.replace(
      direct,
      `{
      #ifdef USE_CLEARCOAT
        float savedRoadCoatRoughness = material.clearcoatRoughness;
        if (wet > 0.) material.clearcoatRoughness = apexLightFootprintRoughness(
          material.clearcoatRoughness, length(pointLight.position - geometryPosition), roadLampRadius);
      #endif
      ${direct}
      #ifdef USE_CLEARCOAT
        material.clearcoatRoughness = savedRoadCoatRoughness;
      #endif
    }`,
    );
    shader.fragmentShader = shader.fragmentShader.replace(
      '#include <lights_fragment_begin>',
      pointLighting,
    );
    // Standing water mirrors the scene: the planar pass replaces the probe
    // radiance in the same water-film lobe (Fresnel, wet and puddle masks).
    if (reflection)
      shader.fragmentShader = shader.fragmentShader.replace(
        '#include <lights_fragment_maps>',
        '#include <lights_fragment_maps>\n' + WET_REFLECTION_GLSL,
      );
  };
  material.customProgramCacheKey = () =>
    `${previousKey}|apex-physical-asphalt-v5-conforming-film|water-fresnel-footprint-v1|venue-lamp-footprint-v1|road-macro-v1${reflection ? '|wet-planar-v1' : ''}`;
}

/** At grazing angles, collapsed screen derivatives can make the stock bump
 * perturbation normalize a zero vector. A single NaN texel contaminates every
 * roughness mip in a local reflection and subsequently the bloom pyramid.
 * Preserve the geometric normal at singularities, not a black/post-FX patch. */
export function installStableSurfaceBump(material: MeshStandardMaterial) {
  const previous = material.onBeforeCompile;
  const chunk = ShaderChunk.bumpmap_pars_fragment
    .replace(
      'vec3 vSigmaX = normalize( dFdx( surf_pos.xyz ) );',
      `
      vec3 surfaceDx = dFdx(surf_pos.xyz);
      vec3 surfaceDy = dFdy(surf_pos.xyz);
      float dx2 = dot(surfaceDx, surfaceDx), dy2 = dot(surfaceDy, surfaceDy);
      if (min(dx2, dy2) < 1e-16) return surf_norm;
      vec3 vSigmaX = surfaceDx * inversesqrt(dx2);`,
    )
    .replace(
      'vec3 vSigmaY = normalize( dFdy( surf_pos.xyz ) );',
      'vec3 vSigmaY = surfaceDy * inversesqrt(dy2);',
    )
    .replace(
      'vec3 vGrad = sign( fDet ) * ( dHdxy.x * R1 + dHdxy.y * R2 );',
      `
      if (abs(fDet) < 1e-7) return surf_norm;
      vec3 vGrad = sign(fDet) * (dHdxy.x * R1 + dHdxy.y * R2);`,
    )
    .replace(
      'return normalize( abs( fDet ) * surf_norm - vGrad );',
      `
      vec3 perturbed = abs(fDet) * surf_norm - vGrad;
      float normal2 = dot(perturbed, perturbed);
      return normal2 > 1e-16 ? perturbed * inversesqrt(normal2) : surf_norm;`,
    );
  material.onBeforeCompile = (shader, renderer) => {
    previous.call(material, shader, renderer);
    shader.fragmentShader = shader.fragmentShader.replace(
      '#include <bumpmap_pars_fragment>',
      chunk,
    );
  };
  material.customProgramCacheKey = () => 'apex-stable-surface-bump-v1';
}
