import * as T from 'three';

import type { Season } from '../../session/festival-season.ts';
export { SEASONS, SEASON_LABEL, isSeason, type Season } from '../../session/festival-season.ts';

/**
 * Shared shader uniforms of the season, read by every festival material that
 * reacts to it (declare `uniform vec4 owSeason; uniform float owSnowCover;`
 * and assign these objects in onBeforeCompile).
 *
 * owSeason: one-hot weights (x spring, y summer, z autumn, w winter).
 * owSnowCover: 0 bare ground, 1 full winter cover of upward-facing surfaces.
 */
export const seasonUniforms = Object.freeze({
  owSeason: { value: new T.Vector4(0, 1, 0, 0) },
  owSnowCover: { value: 0 },
});

export function seasonWeights(season: Season, target = new T.Vector4()) {
  return target.set(
    season === 'spring' ? 1 : 0,
    season === 'summer' ? 1 : 0,
    season === 'autumn' ? 1 : 0,
    season === 'winter' ? 1 : 0,
  );
}

/** Set the shared uniforms for a season. */
export function applySeason(season: Season) {
  seasonWeights(season, seasonUniforms.owSeason.value);
  seasonUniforms.owSnowCover.value = season === 'winter' ? 1 : 0;
}

/** GLSL declarations matching seasonUniforms. */
export const SEASON_GLSL = /* glsl */ `
uniform vec4 owSeason;
uniform float owSnowCover;
`;

/** Bind the shared season uniforms to a compiled shader. */
export function bindSeasonUniforms(shader: { uniforms: Record<string, T.IUniform> }) {
  shader.uniforms.owSeason = seasonUniforms.owSeason;
  shader.uniforms.owSnowCover = seasonUniforms.owSnowCover;
}
