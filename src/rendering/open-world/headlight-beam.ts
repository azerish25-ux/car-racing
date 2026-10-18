import * as T from 'three';

/** Dipped (low) beam of the followed car, as a projected light pattern on
 * its SpotLight (refs 069, 086: cars ahead lit below their belt, a bright
 * pool on the road, no glare above the cut-off). Measured on a Japanese /
 * UN R112 left-hand-traffic beam:
 *
 * - cut-off 0.57 deg below the lamp's horizontal, flat towards oncoming
 *   traffic (right), rising 15 deg on the kerb side (left) to +1 deg;
 * - hot spot 0.6-2.4 deg below the cut-off, a little towards the kerb;
 * - above the cut-off about 2 % of the hot spot (R112 B50L <= 350 cd
 *   against >= 20 000 cd at the hot spot);
 * - below it the intensity falls slowly with the depression (a foreground
 *   pool from ~3 m, nothing steeper than ~22 deg), spreading wider as it
 *   nears the road under the nose.
 *
 * The pattern is angular only. `DIPPED_BEAM.peak` is the hot-spot intensity
 * (cd, the festival's light scale) chosen against the fixed night exposure:
 * a white bumper 6 m ahead peaks near display white without clipping. */
export const DIPPED_BEAM = Object.freeze({
  /** Cone half angle (rad) and the projected pattern's half field. */
  angle: 0.62,
  peak: 230,
  range: 90,
  cutOff: -0.57,
  kerbStep: 15,
  kerbTop: 1.0,
  glare: 0.022,
});
const DEG = Math.PI / 180;

/** Relative intensity (0..1) at azimuth `az` (deg, + right) and elevation
 * `el` (deg, + up) from the lamp axis. */
export function dippedBeamIntensity(az: number, el: number) {
  const b = DIPPED_BEAM;
  // Cut-off line: flat to the right, a 15 deg rising step to the left.
  const cut = az >= 0 ? b.cutOff : Math.min(b.kerbTop, b.cutOff - az * Math.tan(b.kerbStep * DEG));
  const below = cut - el;
  // Sharp but anti-aliased transition over ~0.35 deg.
  const edge = T.MathUtils.smoothstep(below, -0.12, 0.25);
  const depth = Math.max(0, below);
  // Below the hot spot the reflector still floods the foreground road (a
  // pool from ~3 m), and throws nothing steeper than ~22 deg.
  const vertical =
    depth < 2.4
      ? 0.82 + 0.18 * T.MathUtils.smoothstep(depth, 0, 0.6)
      : (2.4 / depth) ** 0.75 * (1 - T.MathUtils.smoothstep(depth, 10, 22));
  // Horizontal spread: a hot core a little to the kerb side and a wide
  // flood that widens towards the foreground.
  const spread = 1 + depth / 6;
  const x = az + 2;
  const horizontal =
    0.62 * Math.exp(-((x / (9 * spread)) ** 2)) + 0.38 * Math.exp(-((x / (27 * spread)) ** 2));
  const fade = 1 - T.MathUtils.smoothstep(Math.hypot(az, el), 31, 35);
  return (b.glare + (1 - b.glare) * edge) * vertical * horizontal * fade;
}

/** The pattern as a light map over the SpotLight's square projection
 * (u right, v up, tangent space of the cone's half angle). */
export function dippedBeamTexture(width = 128, height = 512) {
  const data = new Uint8Array(width * height * 4),
    t = Math.tan(DIPPED_BEAM.angle);
  for (let j = 0; j < height; j++) {
    const el = Math.atan(((j + 0.5) / height) * 2 * t - t) / DEG;
    for (let i = 0; i < width; i++) {
      const az = Math.atan(((i + 0.5) / width) * 2 * t - t) / DEG;
      const v = Math.round(T.MathUtils.clamp(dippedBeamIntensity(az, el), 0, 1) * 255);
      const k = (j * width + i) * 4;
      data[k] = data[k + 1] = data[k + 2] = v;
      data[k + 3] = 255;
    }
  }
  const texture = new T.DataTexture(data, width, height, T.RGBAFormat);
  texture.name = 'Dipped beam pattern';
  texture.minFilter = texture.magFilter = T.LinearFilter;
  texture.wrapS = texture.wrapT = T.ClampToEdgeWrapping;
  texture.generateMipmaps = false;
  texture.needsUpdate = true;
  return texture;
}

/** Install the pattern on a SpotLight aimed along the lamp's horizontal. */
export function installDippedBeam(light: T.SpotLight) {
  light.angle = DIPPED_BEAM.angle;
  light.penumbra = 0.05;
  light.decay = 2;
  light.distance = DIPPED_BEAM.range;
  light.map = dippedBeamTexture();
  // The map is projected through the shadow camera (no shadow is rendered).
  light.shadow.camera.near = 0.2;
  light.shadow.aspect = 1;
  return light.map;
}
