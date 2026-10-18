import type * as T from 'three';

export interface RetroUniforms {
  /** Headlight state: 0 by day, 1 at night (the session's night amount). */
  owRetroNight: { value: number };
}
export function retroUniforms(): RetroUniforms {
  return { owRetroNight: { value: 0 } };
}

/** Retroreflective sheeting and reflectors (guardrail delineators, chevron
 * boards, signs): at night they return the headlights toward the eye. The
 * camera stands in for the headlamps (the chase rig is 6 m behind them), so
 * the return grows as the face turns to the viewer (cos^6, a ~25° cone) and
 * falls with the inverse square of distance beyond `reach` m. By day the
 * term vanishes and the material is an ordinary painted surface.
 * `gain` scales the albedo-tinted return (sheeting ~3, prismatic lens ~12). */
export function retroReflective(
  material: T.MeshStandardMaterial,
  uniforms: RetroUniforms,
  gain: number,
  reach = 22,
  key = 'festival-retro',
) {
  const previous = material.onBeforeCompile;
  material.onBeforeCompile = (shader, renderer) => {
    previous.call(material, shader, renderer);
    shader.uniforms.owRetroNight = uniforms.owRetroNight;
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', '#include <common>\nuniform float owRetroNight;')
      .replace(
        '#include <emissivemap_fragment>',
        `#include <emissivemap_fragment>
{
  float owEye = length(vViewPosition);
  float owFacing = max(dot(normal, vViewPosition / max(owEye, 1e-4)), 0.0);
  float owFacing2 = owFacing * owFacing;
  float owFall = min(1.0, (${reach.toFixed(1)} * ${reach.toFixed(1)}) / max(owEye * owEye, 1.0));
  totalEmissiveRadiance += diffuseColor.rgb * owRetroNight * owFacing2 * owFacing2 * owFacing2 * owFall * ${gain.toFixed(2)};
}`,
      );
  };
  const cacheKey = material.customProgramCacheKey.bind(material);
  material.customProgramCacheKey = () => `${cacheKey()}|${key}-${gain}-${reach}`;
  return material;
}
