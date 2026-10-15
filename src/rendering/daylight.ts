import * as T from 'three';
import type { Sky } from 'three/addons/objects/Sky.js';
import { FullScreenQuad } from 'three/addons/postprocessing/Pass.js';
import { clamp, lerp } from '../core/math.ts';
import { ATMOSPHERE, LIMB_DARKENING } from './atmosphere.ts';
import { circuitLightColors } from './lighting-coherence.ts';
import {
  SKY_LIGHT,
  SUN_OFFSET,
  SUNSET_OFFSET,
  skyAtmospheres,
  skyDeckAmount,
  skyLight,
  skyLightDirection,
  skySunKey,
  skyVeil,
  type LightingMode,
} from './sky-light.ts';
import { BRIGHT_STARS, liveCelestial, presetCelestial, starVector } from './sky-ephemeris.ts';
import { aerialFogColor, setAerialPerspective } from './studio/aerial-perspective.ts';
import { setCloudShadow } from './studio/cloud-shadow.ts';
import {
  SKY_CLOUD_LIGHTING,
  SKY_CLOUD_SAMPLE,
  SKY_CLOUD_UNIFORMS,
  cloudDomeTerms,
  createSkyCloudUniforms,
  skyCloudLight,
  type SkyClouds,
} from './studio/sky-clouds.ts';
import {
  IBL_ENERGY,
  SKY_IRRADIANCE_SATURATION,
  SKY_GROUND_GLSL,
  SKY_GROUND_UNIFORMS,
  groundIrradiance,
} from './studio/ibl-energy.ts';

export { SUN_OFFSET, SUNSET_OFFSET, type LightingMode };
export function lightingMode(value: boolean | LightingMode): LightingMode {
  if (value === true) return 'night';
  if (value === false) return 'day';
  if (value === 'day' || value === 'sunset' || value === 'night') return value;
  throw new Error('Invalid circuit lighting mode');
}
export function lightingDirection(mode: boolean | LightingMode) {
  return skyLightDirection(lightingMode(mode));
}
function basis(direction: T.Vector3) {
  const forward = direction.clone().normalize(),
    right = new T.Vector3(0, 1, 0).cross(forward).normalize();
  return { forward, right, up: forward.clone().cross(right).normalize() };
}
const presetBases = { day: basis(SUN_OFFSET), sunset: basis(SUNSET_OFFSET) };
let liveBasis = { key: '', value: presetBases.day };
/** The fixed light-space basis of a lighting's sun (re-derived only when a
 * LIVE sun re-aims). */
function lightBasis(mode: LightingMode) {
  const key = skySunKey();
  if (!key || mode === 'night') return mode === 'sunset' ? presetBases.sunset : presetBases.day;
  if (liveBasis.key !== key) liveBasis = { key, value: basis(skyLightDirection(mode)) };
  return liveBasis.value;
}

/** Haze colours of the aerial perspective, read from the sky the camera sees:
 * the clear horizon away from and toward the sun, and the deck's own grey. */
export function skyFogPalette(cover: number, mode: LightingMode) {
  const light = skyLight(cover, mode);
  return {
    antiSun: skyVeil(light.horizonAntiSun, light.cover),
    sunSide: skyVeil(light.horizonSunSide, light.cover),
    overcast: light.deck,
  };
}

/** Daylight from the physical sky (sky-light.ts). The key is the sun through
 * the atmosphere (its clear-sky irradiance, 3.86 at the 52 degree day sun),
 * attenuated by the cloud it shines through. The sky light is the PMREM of
 * the very dome the camera sees, so `environment` is 1: diffuse and specular
 * sky light both equal the visible dome. The small hemisphere `fill` adds a
 * sky/ground colour bias and, under a deck, the extra wrap-around light of a
 * uniformly bright sky.
 * Exposure stays an authored camera decision. */
export function daylightState(cloud: number, rain: number, skyMode: LightingMode = 'day') {
  if (![cloud, rain].every(Number.isFinite)) throw new Error('Non-finite daylight state');
  // `skyMode` only picks which baked sky the shared terms read (the golden
  // hour must not bake the day sky); circuitLightState overrides the rest.
  const cover = clamp(cloud, 0, 1),
    precipitation = clamp(rain, 0, 60),
    sky = skyLight(cover, skyMode),
    fog = aerialFogColor(cover, precipitation, skyMode, skyFogPalette(cover, skyMode));
  return {
    cover,
    sun: sky.sunIrradiance * (1 - 0.94 * cover ** 1.45),
    fill: 0.06 + cover * 0.2,
    environment: 1,
    exposure: 0.92 + cover * 0.12,
    /** Aerosol haze of the sky (multiples of Hillaire's reference aerosols). */
    haze: lerp(SKY_LIGHT.haze.day[0], SKY_LIGHT.haze.day[2], cover),
    /** Sky-view radiance scale: the dome in scene units. */
    skyRadiance: sky.skyScale,
    // FogExp2 density for materials without the local atmosphere (unlit signs
    // and screens near the track): clear 0.00055, overcast 0.0008, the 24 mm/h
    // rain preset about 0.0017. The local atmosphere's aerial perspective uses
    // the sky's own extinction instead (studio/aerial-perspective.ts, from
    // `haze` and the rain). The colour is the sky's own horizon radiance away
    // from the sun (greying to the deck and rain); the sun side adds its glow.
    fogDensity: 0.00055 + cover * 0.00025 + precipitation * 0.0000375,
    fogRed: fog[0],
    fogGreen: fog[1],
    fogBlue: fog[2],
  };
}

function fogChannels([fogRed, fogGreen, fogBlue]: readonly number[]) {
  return { fogRed, fogGreen, fogBlue };
}

/** Shared circuit/night profile for the renderer and its evidence fixtures.
 * Day and golden hour are lit by the physical sky; night is an authored
 * floodlit venue. Keep a low ambient floor so unlit carbon remains readable
 * between mast pools. */
export function circuitLightState(
  cloud: number,
  rain: number,
  value: boolean | LightingMode = false,
) {
  const mode = lightingMode(value);
  const light = daylightState(cloud, rain, mode === 'sunset' ? 'sunset' : 'day');
  if (mode === 'sunset') {
    const sky = skyLight(light.cover, 'sunset');
    Object.assign(light, {
      // P2 golden hour: the 10 degree sun through 5.6 air masses of hazy air
      // (about 1.9, deep gold), dimmed by the cloud in front of it.
      sun: sky.sunIrradiance * (1 - light.cover * 0.88),
      fill: 0.09 + light.cover * 0.12,
      environment: 1,
      // A camera opens up about 0.8 EV for the golden hour: the low sun puts
      // half the noon light on what faces it and far less on the ground; a
      // little more again under a dusk deck.
      exposure: 1.62 + light.cover * 0.1,
      haze: lerp(SKY_LIGHT.haze.sunset[0], SKY_LIGHT.haze.sunset[2], light.cover),
      skyRadiance: sky.skyScale,
      fogDensity: light.fogDensity * 1.18,
      ...fogChannels(
        aerialFogColor(
          light.cover,
          clamp(rain, 0, 60),
          'sunset',
          skyFogPalette(light.cover, 'sunset'),
        ),
      ),
    });
  }
  if (mode === 'night')
    Object.assign(light, {
      // Floodlit circuit: the directional key stands for the aggregate of the
      // circuit's floodlight masts (still well below overcast daylight), and
      // the skylight fill is low so the surroundings fall away to dark instead
      // of the whole scene reading as a flat blue-grey. The bounded photometric
      // pass can adapt without turning night into daylight.
      // D28: the floodlights' share on vertical faces (cars, walls); the road's
      // own pools come from the analytic lamp rows (studio/light-pools.ts).
      sun: 0.6 * (1 - light.cover * 0.55),
      fill: 0.085 + light.cover * 0.03,
      environment: 0.07 + light.cover * 0.01,
      exposure: 1.12 - clamp(rain, 0, 60) * 0.001,
      fogDensity: light.fogDensity * 0.75,
      // Night haze #0e141c, a little lighter under cloud.
      ...fogChannels(aerialFogColor(light.cover, clamp(rain, 0, 60), 'night')),
    });
  return light;
}

/** Snap in LIGHT space, not world X/Z. The rotation is fixed, so translation
 * smaller than one shadow texel cannot swim across static geometry. */
export function shadowAnchor(
  target: T.Vector3,
  size: number,
  halfExtent: number,
  out: T.Vector3,
  mode: boolean | LightingMode = false,
) {
  if (
    ![target.x, target.y, target.z, size, halfExtent].every(Number.isFinite) ||
    size < 1 ||
    halfExtent <= 0
  )
    throw new Error('Invalid shadow grid');
  const { forward: lightForward, right: lightRight, up: lightUp } = lightBasis(lightingMode(mode));
  const texel = (2 * halfExtent) / size;
  const x = target.dot(lightRight),
    y = target.dot(lightUp),
    z = target.dot(lightForward);
  return out
    .copy(lightRight)
    .multiplyScalar(Math.round(x / texel) * texel)
    .addScaledVector(lightUp, Math.round(y / texel) * texel)
    .addScaledVector(lightForward, z);
}

/** The physical sky dome (atmosphere.ts, sky-light.ts) on three's Sky mesh.
 *
 * three's Preetham fit is replaced outright: the fragment shader samples the
 * baked sky view (two haze levels, blended by cover), adds a limb-darkened sun
 * disc whose radiance is the top-of-atmosphere sun through the same
 * transmittance that colours the scene's key, veils and closes the dome with
 * cloud cover, then composites the baked cumulus and cirrus lit by the same
 * sun and sky. Per pixel: two sky-view and two cloud fetches. */
export const SKY_DOME = Object.freeze({
  /** Sky-view texel layout (see atmosphere.ts skyViewU / skyViewV). */
  size: ATMOSPHERE.skyViewSize,
  sunAngularRadius: ATMOSPHERE.sunAngularRadius,
});
const vec3 = (c: readonly number[]) => `vec3(${c.map((v) => v.toFixed(4)).join(',')})`;

/** Urban skyglow over catalogue night city venues (linear radiance): a warm
 * grey dome brightest at the horizon, which leaves only the brightest stars
 * (`stars` of their light) and lifts the night haze to the same glow. */
export const URBAN_SKYGLOW = Object.freeze({
  horizon: 0.03,
  zenith: 0.004,
  /** Exponential falloff with elevation (radians): ~0.0043 at 30 degrees. */
  falloff: 0.12,
  colour: Object.freeze([1, 0.86, 0.7] as const),
  stars: 0.05,
});
/** Night haze colour of an urban venue: the skyglow's horizon. */
export function urbanFogColor(out: T.Color) {
  const [r, g, b] = URBAN_SKYGLOW.colour;
  return out.setRGB(
    Math.max(out.r, URBAN_SKYGLOW.horizon * r),
    Math.max(out.g, URBAN_SKYGLOW.horizon * g),
    Math.max(out.b, URBAN_SKYGLOW.horizon * b),
  );
}

/**
 * The celestial sky (sky-ephemeris.ts): moon, stars, Milky Way and twilight,
 * on the visible dome only (cube captures keep the measured night dome).
 *
 *  - Moon: a 0.26 degree disc shaded by the true sun with Lommel-Seeliger
 *    reflectance (the flat, limb-bright full moon of the real thing; the
 *    terminator and phase follow the actual sun), the major maria and Tycho at
 *    their places with lunar north toward the celestial pole, earthshine on
 *    the dark limb near new moon and a forward-scattering aureole. It is
 *    reddened and dimmed by the same air-mass extinction as the stars, and
 *    in a LIVE daylight sky it shows as the pale daytime moon.
 *  - Stars: the catalogue's brightest stars and asterisms at their J2000
 *    places, then two procedural layers to magnitude 8 with the observed
 *    magnitude distribution (N ~ 10^0.45m), B-V colours, denser toward the
 *    galactic plane; each a one-pixel Gaussian whose peak follows its
 *    magnitude, extinguished and scintillating with air mass.
 *  - Milky Way: brightness in galactic coordinates, a bulge toward
 *    Sagittarius, clumped star clouds and the dark Great Rift.
 *  - Twilight (LIVE only): horizon glow toward the set sun, the blue
 *    upper sky, the Belt of Venus and the earth's shadow opposite, fading by
 *    about 0.45 magnitude per degree of solar depression.
 */
export const CELESTIAL = Object.freeze({
  moonAngularRadius: 0.004536,
  /** Normal albedo of the lunar disc. */
  moonAlbedo: 0.13,
  /** Floodlit-venue night exposure suits the track, not the sky: the moon is
   * lifted to how the dark-adapted eye sees it. */
  nightMoonGain: 6,
  /** Peak radiance of a magnitude 0 star, scene units. */
  starZeroPoint: 0.9,
  /** Optical depth per air mass (Rayleigh and clear-night aerosol, R G B). */
  extinction: Object.freeze([0.08, 0.14, 0.27] as const),
  milkyWay: 0.008,
});
const CELESTIAL_GLSL = `
uniform vec3 moonDirection;
uniform vec3 trueSunDirection;
uniform vec3 moonRadiance;
uniform float moonAmount;
uniform float starAmount;
uniform float twilightAmount;
uniform mat3 worldToCelestial;
uniform vec4 brightStars[${BRIGHT_STARS.length}];
uniform float brightStarColours[${BRIGHT_STARS.length}];
vec3 celestialHash(vec3 p3) {
  p3 = fract(p3 * vec3(.1031, .1030, .0973));
  p3 += dot(p3, p3.yxz + 33.33);
  return fract((p3.xxy + p3.yxx) * p3.zyx);
}
float celestialNoise(vec3 p) {
  vec3 i = floor(p), f = fract(p);
  f = f * f * (3.0 - 2.0 * f);
  return mix(
    mix(mix(celestialHash(i).x, celestialHash(i + vec3(1, 0, 0)).x, f.x),
        mix(celestialHash(i + vec3(0, 1, 0)).x, celestialHash(i + vec3(1, 1, 0)).x, f.x), f.y),
    mix(mix(celestialHash(i + vec3(0, 0, 1)).x, celestialHash(i + vec3(1, 0, 1)).x, f.x),
        mix(celestialHash(i + vec3(0, 1, 1)).x, celestialHash(i + vec3(1, 1, 1)).x, f.x), f.y),
    f.z);
}
float celestialFbm(vec3 p) {
  float sum = 0.0, amplitude = 0.5;
  for (int i = 0; i < 4; i++) {
    sum += amplitude * celestialNoise(p);
    p = p * 2.03 + 17.1;
    amplitude *= 0.5;
  }
  return sum / 0.9375;
}
// Kasten & Young (1989) relative air mass for a sine of elevation.
float celestialAirMass(float sinElevation) {
  float h = degrees(asin(clamp(sinElevation, 0.0, 1.0)));
  return 1.0 / (sinElevation + 0.50572 * pow(h + 6.07995, -1.6364));
}
vec3 celestialExtinction(float sinElevation) {
  return exp(-${vec3(CELESTIAL.extinction)} * celestialAirMass(max(sinElevation, 0.0)));
}
// B-V colour index to a luminance-normalised star colour (Ballesteros 2012).
vec3 starColour(float bv) {
  float kelvin = 4600.0 * (1.0 / (0.92 * bv + 1.7) + 1.0 / (0.92 * bv + 0.62));
  float x = clamp((kelvin - 3000.0) / 9000.0, 0.0, 1.0);
  vec3 c = mix(vec3(1.0, 0.6, 0.34), vec3(1.0, 0.93, 0.86), smoothstep(0.0, 0.3, x));
  c = mix(c, vec3(0.66, 0.77, 1.0), smoothstep(0.3, 1.0, x));
  return c / dot(c, vec3(0.2126, 0.7152, 0.0722));
}
vec3 starPoint(vec3 cel, vec3 star, float magnitude, float bv, float pixel, float twinkle) {
  // Chord length squared from the difference (1 - dot loses the precision a
  // sub-milliradian point needs in 32-bit floats).
  vec3 offset = cel - star;
  float d2 = dot(offset, offset);
  float sigma = 0.62 * pixel;
  return starColour(bv) * (${CELESTIAL.starZeroPoint.toFixed(3)} * exp2(-1.3288 * magnitude) * twinkle) *
    exp(-d2 / (2.0 * sigma * sigma));
}
// Galactic (l, b) of an equatorial direction (J2000 rotation).
vec2 galactic(vec3 cel) {
  vec3 g = vec3(dot(vec3(-0.0548756, -0.8734371, -0.4838350), cel),
                dot(vec3(0.4941094, -0.4448296, 0.7469822), cel),
                dot(vec3(-0.8676661, -0.1980764, 0.4559838), cel));
  return vec2(atan(g.y, g.x), asin(clamp(g.z, -1.0, 1.0)));
}
vec3 milkyWay(vec3 cel) {
  vec2 lb = galactic(cel);
  float bulge = exp(-lb.x * lb.x / 0.5);
  float width = 0.1 + 0.13 * bulge;
  float band = exp(-lb.y * lb.y / (width * width)) * (0.32 + 0.68 * bulge);
  float clumps = celestialFbm(cel * 9.0);
  float lane = exp(-pow((lb.y + 0.012) / (0.03 + 0.035 * bulge), 2.0)) *
    smoothstep(-0.7, -0.3, lb.x) * (1.0 - smoothstep(1.2, 1.6, lb.x)) *
    smoothstep(0.32, 0.7, celestialFbm(cel * 14.0 + 3.1));
  float light = band * (0.45 + 1.1 * clumps * clumps) * (1.0 - 0.8 * lane);
  return light * mix(vec3(0.84, 0.88, 1.0), vec3(1.0, 0.87, 0.7), bulge);
}
vec3 proceduralStars(vec3 cel, float pixel, float scale, float density, float faintest, float twinkleRate) {
  vec3 p = cel * scale, cell = floor(p);
  vec3 h = celestialHash(cell);
  vec2 lb = galactic(cel);
  float plane = exp(-lb.y * lb.y / 0.06) * (0.6 + 0.4 * exp(-lb.x * lb.x / 0.6));
  if (h.x > density * (0.55 + 1.6 * plane)) return vec3(0.0);
  vec3 star = normalize(cell + 0.15 + 0.7 * celestialHash(cell + 71.3)) * scale;
  vec3 local = star - cell;
  if (any(lessThan(local, vec3(0.08))) || any(greaterThan(local, vec3(0.92)))) return vec3(0.0);
  float magnitude = max(faintest - 6.0, faintest + 2.2 * log(max(h.y, 1e-4)) / log(10.0));
  float bv = -0.25 + 1.8 * pow(h.z, 1.5);
  float twinkle = 1.0 + twinkleRate * sin(cloudDrift * 2.0e5 * (0.7 + 0.6 * h.y) + 6.2832 * h.z);
  return starPoint(cel, star / scale, magnitude, bv, pixel, twinkle);
}
vec3 starField(vec3 cel, float pixel, float scintillation) {
  vec3 light = vec3(0.0);
  for (int i = 0; i < ${BRIGHT_STARS.length}; i++) {
    vec4 s = brightStars[i];
    if (dot(cel, s.xyz) < 0.99995) continue;
    float twinkle = 1.0 + scintillation * sin(cloudDrift * 2.0e5 * (0.8 + 0.03 * float(i)) + float(i));
    light += starPoint(cel, s.xyz, s.w, brightStarColours[i], pixel, twinkle);
  }
  light += proceduralStars(cel, pixel, 40.0, 0.32, 6.4, scintillation);
  light += proceduralStars(cel, pixel, 110.0, 0.22, 8.0, scintillation);
  return light;
}
float mare(vec2 p, vec2 centre, vec2 radius) {
  vec2 d = (p - centre) / radius;
  return exp(-dot(d, d));
}
// Disc albedo, sky-projected (x west on the sky, y lunar north): the maria
// as one irregular, domain-warped field that merges like the real basins,
// bright highlands, and the young ray craters.
vec3 moonAlbedo(vec2 p) {
  vec2 q = p + 0.09 * vec2(celestialFbm(vec3(p * 3.0, 1.0)), celestialFbm(vec3(p * 3.0, 7.0))) - 0.045;
  float field =
    1.0 * mare(q, vec2(-0.27, 0.52), vec2(0.27, 0.22)) +   // Imbrium
    0.9 * mare(q, vec2(0.22, 0.43), vec2(0.15, 0.14)) +    // Serenitatis
    0.95 * mare(q, vec2(0.42, 0.14), vec2(0.2, 0.17)) +    // Tranquillitatis
    1.0 * mare(q, vec2(0.73, 0.31), vec2(0.1, 0.085)) +    // Crisium
    0.8 * mare(q, vec2(0.6, -0.14), vec2(0.11, 0.17)) +    // Fecunditatis
    0.75 * mare(q, vec2(0.38, -0.3), vec2(0.09, 0.08)) +   // Nectaris
    0.9 * mare(q, vec2(-0.62, 0.18), vec2(0.24, 0.42)) +   // Procellarum
    0.75 * mare(q, vec2(-0.42, -0.12), vec2(0.2, 0.18)) +  // Procellarum south, Cognitum
    0.75 * mare(q, vec2(-0.16, -0.36), vec2(0.15, 0.1)) +  // Nubium
    0.75 * mare(q, vec2(-0.55, -0.38), vec2(0.09, 0.085)) + // Humorum
    0.7 * mare(q, vec2(-0.08, 0.2), vec2(0.13, 0.08)) +    // Vaporum, Insularum
    0.65 * mare(q, vec2(-0.05, 0.74), vec2(0.38, 0.06));   // Frigoris
  float mask = smoothstep(0.38, 0.72, field + 0.32 * (celestialFbm(vec3(p * 6.0, 3.0)) - 0.5));
  float highland = 0.9 + 0.22 * celestialFbm(vec3(p * 13.0, 2.3));
  float albedo = mix(highland, 0.56 + 0.1 * celestialFbm(vec3(p * 9.0, 5.0)), mask);
  // Ray craters: Tycho, Copernicus, Kepler, Aristarchus.
  vec2 tycho = p - vec2(-0.08, -0.72);
  albedo += 0.45 * smoothstep(0.04, 0.0, length(tycho));
  albedo += 0.12 * smoothstep(0.72, 0.95, celestialNoise(vec3(atan(tycho.y, tycho.x) * 11.0, 0.0, 4.0))) *
    smoothstep(1.0, 0.05, length(tycho));
  albedo += 0.3 * smoothstep(0.035, 0.0, distance(p, vec2(-0.27, 0.27)));
  albedo += 0.25 * smoothstep(0.025, 0.0, distance(p, vec2(-0.55, 0.2)));
  albedo += 0.5 * smoothstep(0.022, 0.0, distance(p, vec2(-0.7, 0.4)));
  // Highlands a neutral warm grey, maria faintly bluer.
  return clamp(albedo, 0.3, 1.5) * mix(vec3(1.0, 0.97, 0.92), vec3(0.92, 0.95, 1.0), mask);
}
vec3 moonLight(vec3 direction, float moonCos, float pixel) {
  float radius = ${CELESTIAL.moonAngularRadius.toFixed(6)};
  vec3 north = vec3(worldToCelestial[0][2], worldToCelestial[1][2], worldToCelestial[2][2]);
  vec3 up = north - moonDirection * dot(north, moonDirection);
  up = dot(up, up) > 1e-8 ? normalize(up) : vec3(0.0, 1.0, 0.0);
  vec3 west = cross(moonDirection, up);
  vec2 p = vec2(dot(direction, west), dot(direction, up)) / sin(radius);
  float rho = length(p);
  vec3 extinction = celestialExtinction(moonDirection.y) * step(0.0, direction.y);
  // Forward-scattering aureole round the disc.
  float illumination = 0.5 - 0.5 * dot(trueSunDirection, moonDirection);
  vec3 light = moonRadiance * extinction * illumination * 1.2e-6 /
    max(1.00002 - moonCos, 2e-5) * vec3(1.0, 0.97, 0.92) * smoothstep(1.0, 1.15, rho);
  if (rho > 1.2) return light;
  float z = sqrt(max(0.0, 1.0 - min(rho * rho, 1.0)));
  vec3 normal = west * p.x + up * p.y - moonDirection * z;
  float mu0 = dot(normal, trueSunDirection);
  float lit = mu0 > 0.0 ? 2.0 * mu0 / (mu0 + z + 1e-4) : 0.0;
  float earthshine = 0.004 * smoothstep(-0.3, 1.0, dot(trueSunDirection, moonDirection));
  float edge = pixel / sin(radius);
  float disc = 1.0 - smoothstep(1.0 - edge, 1.0 + edge, rho);
  return mix(light, moonRadiance * extinction * moonAlbedo(p) * (lit + earthshine), disc);
}
vec3 twilightGlow(vec3 direction) {
  float depression = -degrees(asin(clamp(trueSunDirection.y, -1.0, 1.0)));
  float fade = exp(-0.4 * max(depression, 0.0));
  if (fade < 1e-4) return vec3(0.0);
  float elevation = asin(clamp(direction.y, 0.0, 1.0));
  vec2 h = direction.xz, s = trueSunDirection.xz;
  float sunSide = 0.5 + 0.5 * dot(h, s) / max(length(h) * length(s), 1e-5);
  float early = exp(-max(depression, 0.0) / 2.5);
  vec3 c = vec3(1.0, 0.42, 0.16) * 1.6 * exp(-elevation / 0.09) * pow(sunSide, 4.0);
  c += vec3(1.0, 0.75, 0.45) * 0.6 * exp(-elevation / 0.25) * pow(sunSide, 6.0);
  c += vec3(0.16, 0.27, 0.62) * (0.4 + 0.6 * exp(-elevation / 0.7)) * (0.65 + 0.35 * sunSide);
  c += vec3(0.85, 0.5, 0.62) * 0.35 * exp(-pow((elevation - 0.09) / 0.06, 2.0)) * pow(1.0 - sunSide, 3.0) * early;
  c *= 1.0 - 0.45 * exp(-elevation / 0.05) * pow(1.0 - sunSide, 3.0) * early;
  return c * 0.12 * fade;
}
`;
const SKY_FRAGMENT = `
varying vec3 vWorldPosition;
varying vec3 vSunDirection;
uniform sampler2D skyViewLow;
uniform sampler2D skyViewHigh;
uniform float skyViewWeight;
uniform float skyRadiance;
uniform vec3 sunDiscRadiance;
uniform float sunDiscAmount;
uniform vec3 skyDeckRadiance;
uniform float cloudCover;
uniform float probeSkyIntensity;
uniform float nightAmount;
uniform float sunsetAmount;
uniform float urbanGlow;
${SKY_CLOUD_UNIFORMS}${SKY_CLOUD_SAMPLE}${SKY_CLOUD_LIGHTING}${SKY_GROUND_UNIFORMS}${CELESTIAL_GLSL}
const float SKY_PI = 3.141592653589793;
const vec2 SKY_VIEW_SIZE = vec2(${SKY_DOME.size[0].toFixed(1)}, ${SKY_DOME.size[1].toFixed(1)});
// Sky view: u = azimuth from the sun / pi, v = sqrt(elevation / 90 degrees);
// below the horizon the dome continues the horizon (terrain covers it).
vec3 skyView(vec3 direction) {
  float elevation = asin(clamp(direction.y, 0.0, 1.0));
  vec2 h = direction.xz, s = vSunDirection.xz;
  float hs = length(h) * length(s);
  float cosAzimuth = hs > 1e-6 ? dot(h, s) / hs : 1.0;
  vec2 uv = vec2(acos(clamp(cosAzimuth, -1.0, 1.0)) / SKY_PI, sqrt(elevation / (0.5 * SKY_PI)));
  uv = (uv * (SKY_VIEW_SIZE - 1.0) + 0.5) / SKY_VIEW_SIZE;
  return mix(texture2D(skyViewLow, uv).rgb, texture2D(skyViewHigh, uv).rgb, skyViewWeight);
}
void main() {
  vec3 direction = normalize(vWorldPosition - cameraPosition);
  vec3 radiance = skyView(direction) * skyRadiance;
  // Unresolved thin cloud whitens the clear dome toward a blue grey of its own
  // luminance; a closing deck replaces it with the deck's diffuse radiance.
  float veil = cloudCover * 0.3;
  float veilLuma = dot(radiance, vec3(0.2126, 0.7152, 0.0722)) * 1.12;
  radiance = mix(radiance, veilLuma * vec3(0.94, 1.0, 1.1), veil);
  float deck = smoothstep(0.55, 0.95, cloudCover) * 0.9;
  radiance = mix(radiance, skyDeckRadiance, deck);
  // Sun disc: radius ${SKY_DOME.sunAngularRadius} rad, Neckel & Labs limb
  // darkening, antialiased over one pixel. Off in cube captures (PMREM, local
  // probe): the directional light already carries the sun's energy and its
  // specular highlight; a 6e3 disc would only add fireflies to rough lobes.
  float sunCos = dot(direction, vSunDirection);
  float discEdge = max(fwidth(sunCos), 1e-7);
  // Angular size of a pixel (radians), for the moon's edge and star points.
  float pixelAngle = max(length(fwidth(direction)), 1e-6);
  float moonCos = dot(direction, moonDirection);
  vec3 moon = vec3(0.0);
  if (moonAmount > 0.0 && sunDiscAmount > 0.0 && moonCos > 0.9986)
    moon = moonLight(direction, moonCos, pixelAngle) * moonAmount * sunDiscAmount;
  float discCos = cos(${SKY_DOME.sunAngularRadius.toFixed(6)});
  float disc = smoothstep(discCos - discEdge, discCos + discEdge, sunCos);
  if (disc > 0.0 && sunDiscAmount > 0.0) {
    float rho = clamp(sqrt(max(0.0, 1.0 - sunCos * sunCos)) / sin(${SKY_DOME.sunAngularRadius.toFixed(6)}), 0.0, 1.0);
    vec3 limb = pow(vec3(sqrt(1.0 - rho * rho)), ${vec3(LIMB_DARKENING.alpha)});
    radiance += sunDiscRadiance * limb * disc * sunDiscAmount * (1.0 - deck) * step(0.0, direction.y);
  }
  // Baked cumulus and cirrus (premultiplied sun, sky and ground terms,
  // opacity): flat bases, billowed tops, self-shadow, powder and a silver
  // lining; over the sun disc too.
  vec4 clouds = skyCloudTerms(direction);
  float cover = clouds.a;
  // The moon lies behind the air's in-scatter (added) and behind the deck.
  radiance += moon * (1.0 - deck);
  radiance = radiance * (1.0 - cover) + skyCloudLight(clouds);
  if (nightAmount > 0.5) {
    // D28: a near-black floodlit-venue night (#06090d-#0b0d14), not blue,
    // with the real night sky over it: stars, Milky Way, moon and, in a LIVE
    // sky, the twilight of the actual sun below the horizon.
    float elevation = max(0.0, direction.y);
    float horizon = pow(1.0 - clamp(elevation, 0.0, 1.0), 3.0);
    vec3 nightSky = mix(vec3(.0085, .0115, .0175), vec3(.012, .014, .02), horizon);
    // Faint green airglow ten degrees up; warm venue glow on the horizon.
    nightSky += vec3(.0003, .0009, .0002) * exp(-pow((elevation - .17) / .12, 2.0));
    nightSky += vec3(.004, .003, .002) * pow(1.0 - elevation, 10.0);
    // Urban skyglow over a night city venue: warm grey light pollution,
    // ${URBAN_SKYGLOW.horizon} at the horizon falling to ~${URBAN_SKYGLOW.zenith} by 30 degrees.
    nightSky += ${vec3(URBAN_SKYGLOW.colour)} * urbanGlow * (${URBAN_SKYGLOW.zenith.toFixed(4)} +
      ${(URBAN_SKYGLOW.horizon - URBAN_SKYGLOW.zenith).toFixed(4)} * exp(-asin(elevation) / ${URBAN_SKYGLOW.falloff.toFixed(3)}));
    if (sunDiscAmount > 0.0 && direction.y > 0.0) {
      nightSky += twilightGlow(direction) * twilightAmount;
      // Moonlight scattered by the air: a faint blue dome under a bright moon.
      nightSky += vec3(.22, .33, .6) * .004 * moonAmount *
        (0.5 - 0.5 * dot(trueSunDirection, moonDirection)) * sqrt(max(0.0, moonDirection.y));
      if (starAmount > 0.0) {
        vec3 cel = normalize(worldToCelestial * direction);
        float airMass = celestialAirMass(direction.y);
        float scintillation = 0.12 + 0.35 * clamp((airMass - 1.0) / 6.0, 0.0, 1.0);
        vec3 stars = starField(cel, pixelAngle, scintillation) +
          milkyWay(cel) * ${CELESTIAL.milkyWay.toFixed(4)};
        nightSky += stars * celestialExtinction(direction.y) * starAmount *
          (1.0 - 0.85 * cloudCover) * mix(1.0, ${URBAN_SKYGLOW.stars.toFixed(3)}, urbanGlow);
      }
    }
    nightSky += moon * (1.0 - 0.85 * cloudCover);
    // Moonlit tops from the same bake's sun (moon) term per unit opacity.
    float moonLit = clouds.r / max(clouds.a, 0.02);
    vec3 nightCloud = mix(vec3(.0075, .0092, .0135), vec3(.02, .022, .027),
      clamp(.25 + .3 * moonLit + .35 * max(0.0, moonCos) * moonAmount, 0.0, 1.0));
    nightSky = mix(nightSky, nightCloud, cover);
    // Unresolved cloud veils the stars and moon and catches the venue glow.
    nightSky = mix(nightSky, vec3(.014, .016, .021), cloudCover * .45 * (1.0 - cover));
    radiance = mix(vec3(.008, .0095, .014), nightSky, smoothstep(-.05, .10, direction.y));
  }
  ${SKY_GROUND_GLSL}
  gl_FragColor=vec4(radiance * probeSkyIntensity,1.0);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}
`;

/** Install the physical sky on a three Sky mesh. Its vertex shader (world
 * position, sun direction, far-plane depth) is kept; the fragment shader is
 * replaced. The dome starts on the clear day sky; SkyEnvironment binds the
 * presented weather and lighting every frame. */
export function configureSky(sky: Sky) {
  const material = sky.material;
  const u = material.uniforms;
  u.cloudCover = { value: 0 };
  u.nightAmount = { value: 0 };
  u.sunsetAmount = { value: 0 };
  u.urbanGlow = { value: 0 };
  u.skyRadiance = { value: daylightState(0, 0).skyRadiance };
  u.skyViewLow = { value: null };
  u.skyViewHigh = { value: null };
  u.skyViewWeight = { value: 0 };
  u.sunDiscRadiance = { value: new T.Vector3() };
  u.skyDeckRadiance = { value: new T.Vector3() };
  // One in the visible sky/PMREM. The local scene probe temporarily applies the
  // authored IBL gain here, without attenuating captured lamps a second time.
  u.probeSkyIntensity = { value: 1 };
  // 1 for the visible dome and planar mirrors; 0 in any cube capture.
  u.sunDiscAmount = { value: 1 };
  sky.onBeforeRender = (renderer) => {
    const target = renderer.getRenderTarget() as { isWebGLCubeRenderTarget?: boolean } | null;
    material.uniforms.sunDiscAmount.value = target?.isWebGLCubeRenderTarget ? 0 : 1;
  };
  // Cloud panoramas: unbound (no baked clouds) until a SkyClouds binds them.
  Object.assign(u, createSkyCloudUniforms());
  // Ground hemisphere: 0 for the visible dome, set only by SkyEnvironment.capture.
  u.groundAmount = { value: 0 };
  u.groundAlbedo = { value: new T.Vector3(...IBL_ENERGY.groundAlbedo) };
  u.groundIrradiance = { value: new T.Vector3() };
  // Moon, stars and twilight (bindSkyCelestial).
  u.moonDirection = { value: new T.Vector3(0, 1, 0) };
  u.trueSunDirection = { value: new T.Vector3(0, 1, 0) };
  u.moonRadiance = { value: new T.Vector3() };
  u.moonAmount = { value: 0 };
  u.starAmount = { value: 0 };
  u.twilightAmount = { value: 0 };
  u.worldToCelestial = { value: new T.Matrix3() };
  u.brightStars = {
    value: BRIGHT_STARS.map(([ra, dec, magnitude]) => {
      const v = starVector(ra, dec);
      return new T.Vector4(v.x, v.y, v.z, magnitude);
    }),
  };
  u.brightStarColours = { value: BRIGHT_STARS.map(([, , , bv]) => bv) };
  u.sunPosition.value.copy(SUN_OFFSET);
  bindSkyCelestial(material, 'day');
  bindSkyAtmosphere(material, 0, 'day');
  material.fragmentShader = SKY_FRAGMENT;
  material.needsUpdate = true;
}

/** Bind the sky view, sun disc, deck and cloud lighting of a cover and
 * lighting to a configured sky material (the visible dome or a capture). */
export function bindSkyAtmosphere(material: T.ShaderMaterial, cloud: number, mode: LightingMode) {
  const u = material.uniforms,
    light = skyLight(cloud, mode),
    { low, high, weight } = skyAtmospheres(light.cover, mode);
  u.skyViewLow.value = low.skyViewTexture;
  u.skyViewHigh.value = high.skyViewTexture;
  u.skyViewWeight.value = weight;
  u.skyRadiance.value = light.skyScale;
  (u.sunDiscRadiance.value as T.Vector3).fromArray(light.sunDisc);
  (u.skyDeckRadiance.value as T.Vector3).fromArray(light.deck);
  if (u.cloudKey) {
    (u.cloudKey.value as T.Vector3).fromArray(light.cloudKey);
    (u.cloudAmbient.value as T.Vector3).fromArray(light.cloudAmbient);
    (u.cloudBounce.value as T.Vector3).fromArray(light.cloudBounce);
  }
  return light;
}
const presetSky = presetCelestial(SUN_OFFSET);
/** Bind the moon, stars and twilight of a lighting: the LIVE ephemeris when
 * one is set (sky-ephemeris.ts), else the preset's fixed sky (night only: a
 * waxing gibbous moon where the day key stands, no moon in preset daylight,
 * whose sun is not the real one). */
export function bindSkyCelestial(material: T.ShaderMaterial, value: boolean | LightingMode) {
  const u = material.uniforms,
    mode = lightingMode(value),
    live = liveCelestial(),
    night = mode === 'night';
  if (!u.moonDirection) return;
  const sky = live ?? presetSky;
  (u.moonDirection.value as T.Vector3).copy(sky.moon);
  (u.trueSunDirection.value as T.Vector3).copy(sky.sun);
  (u.worldToCelestial.value as T.Matrix3).copy(sky.worldToCelestial);
  const depression = live ? -live.sunAltitude : 90;
  u.moonAmount.value = live ? (sky.moon.y > -0.01 ? 1 : 0) : night ? 1 : 0;
  // Stars come out from the end of civil twilight to nautical darkness.
  u.starAmount.value = night ? clamp((depression - 4) / 10, 0, 1) : 0;
  u.twilightAmount.value = night && live ? 1 : 0;
  // Full-moon disc radiance: the sun's irradiance reflected at the normal albedo.
  const radiance = (ATMOSPHERE.sceneIrradiance * CELESTIAL.moonAlbedo) / Math.PI;
  (u.moonRadiance.value as T.Vector3).setScalar(radiance * (night ? CELESTIAL.nightMoonGain : 1));
}
const SKY_BINDING = [
  'skyViewLow',
  'skyViewHigh',
  'skyViewWeight',
  'skyRadiance',
  'sunDiscRadiance',
  'skyDeckRadiance',
  'cloudKey',
  'cloudAmbient',
  'cloudBounce',
] as const;
function saveSkyBinding(material: T.ShaderMaterial) {
  const u = material.uniforms;
  const saved = SKY_BINDING.filter((k) => u[k]).map((k) => {
    const value = u[k].value as unknown;
    return [k, value instanceof T.Vector3 ? value.clone() : value] as const;
  });
  return () => {
    for (const [k, value] of saved) {
      if (value instanceof T.Vector3) (u[k].value as T.Vector3).copy(value);
      else u[k].value = value;
    }
  };
}

/** Piecewise-linear radiance between neighbouring, identically packed PMREMs.
 * Coverage and interpolation are functions of this snapshot, not wall time. */
export function skyBlendPlan(cover: number) {
  if (!Number.isFinite(cover)) throw new Error('Non-finite sky coverage');
  const value = clamp(cover, 0, 1),
    position = value * 8;
  return {
    cover: value,
    lower: Math.floor(position),
    upper: Math.ceil(position),
    weight: position % 1,
  };
}

/** No colour conversion or tone map here: the two sources are linear HDR CubeUV
 * atlases of the same size, and their mip tiles must retain their packed layout. */
export function skyBlendMaterial() {
  return new T.RawShaderMaterial({
    name: 'Snapshot-linear sky radiance',
    glslVersion: T.GLSL3,
    depthTest: false,
    depthWrite: false,
    blending: T.NoBlending,
    toneMapped: false,
    uniforms: {
      lowSky: { value: null as T.Texture | null },
      highSky: { value: null as T.Texture | null },
      skyWeight: { value: 0 },
    },
    vertexShader: `precision highp float;
      in vec3 position; in vec2 uv; out vec2 atlasUV;
      void main() { atlasUV=uv; gl_Position=vec4(position,1.); }`,
    fragmentShader: `precision highp float;
      precision highp sampler2D;
      uniform sampler2D lowSky; uniform sampler2D highSky; uniform float skyWeight;
      in vec2 atlasUV; out vec4 radiance;
      void main() { radiance=mix(texture(lowSky,atlasUV),texture(highSky,atlasUV),skyWeight); }`,
  });
}

/** Protect the caller even when capture/blend throws partway through a pass. */
function preserveSkyRenderState(renderer: T.WebGLRenderer) {
  const target = renderer.getRenderTarget(),
    face = renderer.getActiveCubeFace(),
    mip = renderer.getActiveMipmapLevel(),
    viewport = renderer.getViewport(new T.Vector4()),
    scissor = renderer.getScissor(new T.Vector4()),
    scissorTest = renderer.getScissorTest(),
    xr = renderer.xr.enabled,
    autoClear = renderer.autoClear,
    toneMapping = renderer.toneMapping;
  return () => {
    renderer.xr.enabled = xr;
    renderer.autoClear = autoClear;
    renderer.toneMapping = toneMapping;
    renderer.setViewport(viewport);
    renderer.setScissor(scissor);
    renderer.setScissorTest(scissorTest);
    // Restore the target LAST. Its viewport/scissor are already physical
    // pixels; applying canvas-logical dimensions after binding it would scale
    // them again on high-DPI displays and crop a caller's offscreen pass.
    renderer.setRenderTarget(target, face, mip);
  };
}

/** PMREM face size of the sky capture by tier. Each doubling adds one mip level,
 * i.e. two blur draws per capture, so Medium and Low keep 128 px (draw-neutral
 * in the cold-frame budget); High resolves a 0.04 clearcoat's horizon line at
 * 256 px. Below roughness ~0.075 three samples the top mip, so only the
 * glossiest finishes see the difference. */
export const SKY_PMREM_SIZE = Object.freeze({ standard: 128, high: 256 });

/** At most two neighbouring sky captures and two reusable blend outputs are
 * retained. PMREM is captured only at a bin/mode change; a changing fractional
 * cover costs one small atlas blend, not a six-face recapture. A held frame costs
 * neither. Rewind reconstructs the requested sky immediately. */
export class SkyEnvironment {
  private cached = new Map<number, T.WebGLRenderTarget>();
  private cover = NaN;
  private mode: LightingMode = 'day';
  private sunKey = '';
  private size: number = SKY_PMREM_SIZE.standard;
  /** High tier: capture at SKY_PMREM_SIZE.high (the renderer's setQuality). */
  highDetail = false;
  private environmentScene = new T.Scene();
  private blend = skyBlendMaterial();
  private quad = new FullScreenQuad(this.blend);
  private outputs: T.WebGLRenderTarget[] = [];
  private nextOutput = 0;
  private publishedScene: T.Scene | null = null;
  private publishedTexture: T.Texture | null = null;
  captures = 0;
  blends = 0;
  probeRefreshNeeded = false;
  private epoch: object = {};
  /** `clouds` bakes and binds the sky's cloud panoramas (the circuit renderer);
   * without it the dome has no baked clouds. */
  constructor(
    private sky: Sky,
    private clouds?: SkyClouds,
  ) {
    this.environmentScene.add(sky.clone());
  }
  private capture(renderer: T.WebGLRenderer, bin: number, mode: LightingMode, size: number) {
    const restore = preserveSkyRenderState(renderer);
    let generator: T.PMREMGenerator | undefined, unbindClouds: (() => void) | undefined;
    const uniforms = this.sky.material.uniforms;
    const previous = {
      cover: uniforms.cloudCover.value,
      night: uniforms.nightAmount.value,
      sunset: uniforms.sunsetAmount.value,
      sun: uniforms.sunPosition.value.clone() as T.Vector3,
      ground: uniforms.groundAmount?.value as number | undefined,
      disc: uniforms.sunDiscAmount?.value as number | undefined,
      groundIrradiance: (uniforms.groundIrradiance?.value as T.Vector3 | undefined)?.clone(),
    };
    const restoreBinding = saveSkyBinding(this.sky.material);
    try {
      generator = new T.PMREMGenerator(renderer);
      uniforms.cloudCover.value = bin / 8;
      uniforms.nightAmount.value = mode === 'night' ? 1 : 0;
      uniforms.sunsetAmount.value = mode === 'sunset' ? 1 : 0;
      uniforms.sunPosition.value.copy(lightingDirection(mode));
      // This bin's sky view, deck and cloud lighting.
      bindSkyAtmosphere(this.sky.material, bin / 8, mode);
      // The directional light carries the sun; the capture holds only sky.
      if (uniforms.sunDiscAmount) uniforms.sunDiscAmount.value = 0;
      // The lower hemisphere is ground, lit by this bin's sun and sky, not
      // horizon sky: undersides and lower bodywork reflect dark warm asphalt.
      if (uniforms.groundAmount && uniforms.groundIrradiance) {
        uniforms.groundAmount.value = 1;
        groundIrradiance(groundLightState(bin / 8, mode), uniforms.groundIrradiance.value);
      }
      // This bin's cloud panorama, not the visible dome's blend.
      unbindClouds = this.clouds?.bind(renderer, bin, mode);
      // Paid only on a cloud-bin, lighting or tier change.
      const target = generator.fromScene(this.environmentScene, 0.04, 0.1, 700000, { size });
      this.captures++;
      return target;
    } finally {
      unbindClouds?.();
      uniforms.cloudCover.value = previous.cover;
      uniforms.nightAmount.value = previous.night;
      uniforms.sunsetAmount.value = previous.sunset;
      uniforms.sunPosition.value.copy(previous.sun);
      restoreBinding();
      if (previous.ground !== undefined) uniforms.groundAmount.value = previous.ground;
      if (previous.disc !== undefined) uniforms.sunDiscAmount.value = previous.disc;
      if (previous.groundIrradiance)
        uniforms.groundIrradiance.value.copy(previous.groundIrradiance);
      try {
        generator?.dispose();
      } finally {
        restore();
      }
    }
  }
  private interpolate(
    renderer: T.WebGLRenderer,
    low: T.WebGLRenderTarget,
    high: T.WebGLRenderTarget,
    weight: number,
  ) {
    if (
      low.width !== high.width ||
      low.height !== high.height ||
      low.texture.type !== high.texture.type ||
      low.texture.colorSpace !== high.texture.colorSpace
    )
      throw new Error('Mismatched sky radiance atlases');
    if (!this.outputs.length) {
      this.outputs = [0, 1].map(() => {
        const target = new T.WebGLRenderTarget(low.width, low.height, {
          type: low.texture.type,
          minFilter: T.LinearFilter,
          magFilter: T.LinearFilter,
          depthBuffer: false,
          stencilBuffer: false,
          generateMipmaps: false,
        });
        target.texture.mapping = T.CubeUVReflectionMapping;
        target.texture.colorSpace = low.texture.colorSpace;
        target.texture.name = 'Continuous recorded-weather sky';
        return target;
      });
    }
    const output = this.outputs[this.nextOutput];
    if (output.width !== low.width || output.height !== low.height)
      throw new Error('Sky atlas layout changed');
    const restore = preserveSkyRenderState(renderer);
    try {
      renderer.xr.enabled = false;
      renderer.autoClear = true;
      renderer.setRenderTarget(output);
      renderer.setScissorTest(false);
      this.blend.uniforms.lowSky.value = low.texture;
      this.blend.uniforms.highSky.value = high.texture;
      this.blend.uniforms.skyWeight.value = weight;
      this.quad.render(renderer);
      this.blends++;
    } finally {
      this.blend.uniforms.lowSky.value = this.blend.uniforms.highSky.value = null;
      restore();
    }
    // Never overwrite the published atlas: a failed blend keeps the last
    // complete image intact, and the next attempt reuses only the spare output.
    this.nextOutput = 1 - this.nextOutput;
    return output.texture;
  }
  update(
    renderer: T.WebGLRenderer,
    scene: T.Scene,
    cover: number,
    value: boolean | LightingMode = false,
    size: number = this.highDetail ? SKY_PMREM_SIZE.high : SKY_PMREM_SIZE.standard,
  ) {
    const plan = skyBlendPlan(cover),
      mode = lightingMode(value);
    if (!Number.isInteger(Math.log2(size)) || size < 16 || size > 1024)
      throw new Error('Invalid sky PMREM size');
    // The visible dome's clouds (bakes only a missing bin panorama) and the
    // aerial perspective's sun-side glow for this cover and lighting.
    this.clouds?.prepare(renderer, plan.cover, mode);
    // The visible dome's sky view, sun disc, deck and cloud light (cached).
    if (this.sky.material.uniforms.skyViewLow)
      bindSkyAtmosphere(this.sky.material, plan.cover, mode);
    setAerialPerspective(
      plan.cover,
      mode,
      undefined,
      mode === 'night' ? undefined : skyFogPalette(plan.cover, mode),
    );
    // The same field shades the circuit, drifting with the dome's clouds.
    setCloudShadow(
      this.clouds?.fieldTexture ?? null,
      plan.cover,
      mode,
      lightingDirection(mode),
      (this.sky.material.uniforms.cloudDrift?.value as number | undefined) ?? 0,
    );
    this.probeRefreshNeeded = false;
    const sunKey = skySunKey();
    if (
      plan.cover === this.cover &&
      mode === this.mode &&
      sunKey === this.sunKey &&
      size === this.size
    )
      return false;
    const resized = size !== this.size;
    // A re-aimed LIVE sun recaptures like a lighting change.
    const relit = mode !== this.mode || sunKey !== this.sunKey;
    const candidates = new Map<number, T.WebGLRenderTarget>();
    const created: T.WebGLRenderTarget[] = [];
    // A new atlas layout needs new blend outputs. The published texture may be
    // one of the old ones, so they are retired only after the new publish.
    const retiredOutputs = resized ? this.outputs : [];
    if (resized) {
      this.outputs = [];
      this.nextOutput = 0;
    }
    let texture: T.Texture;
    try {
      for (const bin of new Set([plan.lower, plan.upper])) {
        let target = !relit && !resized ? this.cached.get(bin) : undefined;
        if (!target) {
          target = this.capture(renderer, bin, mode, size);
          created.push(target);
        }
        candidates.set(bin, target);
      }
      const low = candidates.get(plan.lower)!;
      const high = candidates.get(plan.upper)!;
      texture =
        plan.lower === plan.upper
          ? low.texture
          : this.interpolate(renderer, low, high, plan.weight);
    } catch (error) {
      created.forEach((target) => target.dispose());
      if (resized) {
        this.outputs.forEach((target) => target.dispose());
        this.outputs = retiredOutputs;
        this.nextOutput = 0;
      }
      throw error;
    }
    // Publish before retiring old resources. A disposal listener must not send
    // an already published complete target down the failed-capture cleanup path.
    const retired = this.cached;
    // A stable epoch lets local reflections honor their normal capture interval
    // while fractional-cloud atlas outputs alternate. Hard changes invalidate
    // immediately, including when the simulation is paused.
    const hardChange =
      !Number.isFinite(this.cover) || relit || resized || Math.abs(plan.cover - this.cover) > 0.25;
    if (hardChange) this.epoch = {};
    texture.userData.aurelSkyEpoch = this.epoch;
    scene.environment = texture;
    this.publishedScene = scene;
    this.publishedTexture = texture;
    // Moving clouds must not force a local six-face reflection every frame.
    // Large weather jumps, mode switches and explicit seeks still invalidate it.
    this.probeRefreshNeeded = hardChange;
    this.cover = plan.cover;
    this.mode = mode;
    this.sunKey = sunKey;
    this.size = size;
    this.cached = candidates;
    for (const [bin, target] of retired) if (candidates.get(bin) !== target) target.dispose();
    retiredOutputs.forEach((target) => target.dispose());
    return true;
  }
  diagnostics() {
    return {
      captures: this.captures,
      blends: this.blends,
      cover: this.cover,
      mode: this.mode,
      cachedBins: [...this.cached.keys()],
      size: this.size,
      retainedTargets: this.cached.size + this.outputs.length,
      interpolation: 'linear-HDR-CubeUV',
      independentAnimation: false,
      clouds: this.clouds?.diagnostics() ?? null,
    };
  }
  dispose() {
    if (this.publishedScene?.environment === this.publishedTexture)
      this.publishedScene.environment = null;
    for (const target of this.cached.values()) target.dispose();
    this.cached.clear();
    this.outputs.forEach((target) => target.dispose());
    this.outputs.length = 0;
    this.blend.dispose();
    this.quad.dispose();
    this.clouds?.dispose();
    this.cover = NaN;
    this.publishedScene = null;
    this.publishedTexture = null;
  }
}

const domeCache = new Map<string, T.Color>();
/** Cosine-weighted mean radiance of the upper dome as the sky shader renders it
 * for a PMREM capture (linear, probeSkyIntensity 1, no sun disc): the same
 * sky view, veil and deck, with the baked clouds entering through their
 * measured dome means (`cloudDomeTerms`), as if spread evenly over the
 * hemisphere. It sets the sky part of the PMREM ground's irradiance. */
export function skyCosineRadiance(cloud: number, value: boolean | LightingMode = false) {
  const mode = lightingMode(value),
    cover = clamp(cloud, 0, 1);
  const key = `${mode}${skySunKey()}:${cover}`;
  const cached = domeCache.get(key);
  if (cached) return cached.clone();
  const light = skyLight(cover, mode),
    { low, high, weight } = skyAtmospheres(cover, mode),
    terms = cloudDomeTerms(cover, mode),
    clouds = skyCloudLight(terms, light),
    deck = skyDeckAmount(cover);
  const direction = new T.Vector3(),
    sum = new T.Color(0, 0, 0),
    sample = new T.Color(),
    a: [number, number, number] = [0, 0, 0],
    b: [number, number, number] = [0, 0, 0];
  let weights = 0;
  const N = 12;
  for (let i = 0; i < N; i++)
    for (let j = 0; j < 2 * N; j++) {
      const elevation = ((i + 0.5) / N) * (Math.PI / 2),
        azimuth = ((j + 0.5) / (2 * N)) * 2 * Math.PI;
      direction.set(
        Math.cos(elevation) * Math.cos(azimuth),
        Math.sin(elevation),
        Math.cos(elevation) * Math.sin(azimuth),
      );
      const y = direction.y;
      if (mode === 'night') {
        const horizon = (1 - y) ** 3;
        const night = [
          [0.008, 0.035, 0.014, 0.018],
          [0.014, 0.039, 0.0172, 0.021],
          [0.029, 0.052, 0.0248, 0.03],
        ].map(([zenith, lowSky, cloudy, veil]) =>
          lerp(
            lerp(lerp(zenith, lowSky, horizon), cloudy, terms.opacity),
            veil,
            cover * 0.45 * (1 - terms.opacity),
          ),
        );
        sample.setRGB(night[0], night[1], night[2]);
      } else {
        low.radiance(direction, a);
        high.radiance(direction, b);
        const clear = skyVeil(
          a.map((c, k) => lerp(c, b[k], weight) * light.skyScale),
          cover,
        );
        const rgb = clear.map(
          (c, k) => lerp(c, light.deck[k], deck) * (1 - terms.opacity) + clouds[k],
        );
        sample.setRGB(rgb[0], rgb[1], rgb[2]);
      }
      const w = Math.sin(elevation) * Math.cos(elevation);
      sum.r += sample.r * w;
      sum.g += sample.g * w;
      sum.b += sample.b * w;
      weights += w;
    }
  const result = sum.multiplyScalar(1 / weights);
  if (domeCache.size > 64) domeCache.clear();
  domeCache.set(key, result.clone());
  return result;
}

/** The lights of one PMREM bin, for the ground's irradiance. */
export function groundLightState(cloud: number, value: boolean | LightingMode = false) {
  const mode = lightingMode(value),
    light = circuitLightState(cloud, 0, mode),
    colors = circuitLightColors(light.cover, mode);
  return {
    sunColor: colors.sun,
    sun: light.sun,
    sunDirection: lightingDirection(mode).clone(),
    skyColor: colors.sky,
    fill: light.fill,
    environment: light.environment,
    skyCosineRadiance: skyCosineRadiance(light.cover, mode),
    skySaturation: SKY_IRRADIANCE_SATURATION[mode],
  };
}
