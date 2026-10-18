import * as T from 'three';
import { injectCloudShadow } from '../studio/cloud-shadow.ts';
import { chainShaderHook } from '../studio/shader-hooks.ts';

/**
 * Cloud shadows over the festival landscape (render only): the shared
 * cloud-shadow term (studio/cloud-shadow.ts, the same field the sky bakes)
 * on the sun light of the region's lit materials. The references show them
 * as darker patches on the forested ridges and plains (036, 047, 001).
 *
 * The cars (excluded from the festival air, so they never receive the term)
 * and the street around the camera stay out of them: the shadow fades in
 * from `near` to `far` metres from the camera, so a passing cloud never
 * leaves a sunlit car on a shaded road; the landscape beyond carries them.
 */
export const FESTIVAL_CLOUD_SHADOW = Object.freeze({
  near: 250,
  far: 900,
});

const KEY = 'festival-cloud-shadow-v1';
const FADE_FROM = 'return 1.0 - apexCloudShadow.y * cover;';
const FADE_TO = `return 1.0 - apexCloudShadow.y * cover *
    smoothstep(${FESTIVAL_CLOUD_SHADOW.near.toFixed(1)}, ${FESTIVAL_CLOUD_SHADOW.far.toFixed(1)}, length(viewPosition));`;

/** Chain the faded cloud shadow on one lit festival material. Returns false
 * when it does not apply (unlit, custom lighting) or is already chained. */
export function installFestivalCloudShadow(material: T.Material) {
  if (
    !(
      material instanceof T.MeshStandardMaterial ||
      material instanceof T.MeshLambertMaterial ||
      material instanceof T.MeshPhongMaterial
    )
  )
    return false;
  return chainShaderHook(material, KEY, (shader) => {
    // A circuit material already carries it (local atmosphere): leave it.
    if (shader.fragmentShader.includes('APEX_CLOUD_SHADOW_DECLARED')) return;
    if (!injectCloudShadow(shader)) return;
    shader.fragmentShader = shader.fragmentShader.replace(FADE_FROM, FADE_TO);
  });
}
