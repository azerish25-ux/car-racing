import * as T from 'three';

/** Linear-light garment dyes, not a grade applied to skin or the whole scene.
 * Keep the same phase at geometric and impostor LODs. Muted everyday clothes
 * coexist with a smaller bright supporter cohort instead of primary-colour
 * uniforms in every seat. No frame clock, texture or extra draw is required. */
export const CROWD_WARDROBE_GLSL = `
vec3 crowdGarmentColour(vec3 supplied, float phase) {
  vec3 base = clamp(supplied, vec3(0.), vec3(1.));
  float cohort = fract(phase * 9.73);
  float dye = fract(phase * 3.17);
  float lightness = dot(base, vec3(.2126,.7152,.0722));
  if (cohort < .18) return vec3(.035,.042,.051) * (.8 + .8 * dye);
  if (cohort < .31) return mix(vec3(.30,.285,.255), vec3(.58,.56,.515), dye);
  float saturation = cohort > .88 ? .94 : .54 + .22 * dye;
  return mix(vec3(lightness), base, saturation) * (.53 + .27 * dye);
}
`;

/** CPU counterpart for authoring probes and stable-cohort regression tests. */
export function crowdGarmentColour(
  supplied: T.Color,
  phase: number,
  target = new T.Color(),
): T.Color {
  if (!Number.isFinite(phase) || ![supplied.r, supplied.g, supplied.b].every(Number.isFinite))
    throw new Error('Non-finite crowd garment input');
  const fract = (v: number) => v - Math.floor(v);
  const cohort = fract(phase * 9.73),
    dye = fract(phase * 3.17);
  const r = T.MathUtils.clamp(supplied.r, 0, 1),
    g = T.MathUtils.clamp(supplied.g, 0, 1),
    b = T.MathUtils.clamp(supplied.b, 0, 1);
  if (cohort < 0.18) return target.setRGB(0.035, 0.042, 0.051).multiplyScalar(0.8 + 0.8 * dye);
  if (cohort < 0.31)
    return target.setRGB(0.3 + 0.28 * dye, 0.285 + 0.275 * dye, 0.255 + 0.26 * dye);
  const lightness = r * 0.2126 + g * 0.7152 + b * 0.0722;
  const saturation = cohort > 0.88 ? 0.94 : 0.54 + 0.22 * dye;
  const scale = 0.53 + 0.27 * dye;
  return target.setRGB(
    (lightness + (r - lightness) * saturation) * scale,
    (lightness + (g - lightness) * saturation) * scale,
    (lightness + (b - lightness) * saturation) * scale,
  );
}
