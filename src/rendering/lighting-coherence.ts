import * as T from 'three';
import type { LightingMode } from './daylight.ts';
import { clamp } from '../core/math.ts';
import { skyLight } from './sky-light.ts';

// Day and golden-hour keys are the sun through the physical atmosphere
// (sky-light.ts): about 5000 K at the 52 degree day sun, deep gold at the
// 10 degree golden-hour sun, both normalised to a peak channel of 1. The
// hemisphere is the minor part of the fill; the sky IBL (environment) carries
// most of it, so shadows take the colour of the sky. Its sky colour is the
// clear dome's own mean, desaturated halfway (it stands for bounce too).
const night = {
  // Metal-halide floodlight white, only slightly cool.
  direct: new T.Color(0xe2e9f6),
  diffuse: new T.Color(0x9eaec8),
};
function physicalKey(mode: 'day' | 'sunset', out: { sun: T.Color; sky: T.Color }) {
  const light = skyLight(0, mode);
  out.sun.setRGB(...light.sunColor);
  const m = light.skyMean,
    peak = Math.max(...m),
    y = (0.2126 * m[0] + 0.7152 * m[1] + 0.0722 * m[2]) / peak;
  out.sky.setRGB(...(m.map((c) => (c / peak + y) * 0.5) as [number, number, number]));
}
// Warm bounce from asphalt and verges.
const ground = {
  day: new T.Color(0x4a4237),
  sunset: new T.Color(0x3b3027),
  night: new T.Color(0x242a33),
};
const cloudDirect = new T.Color(0xdce3eb),
  cloudSky = new T.Color(0xbfcbd5);

// A type-only import of daylight.ts keeps this palette importable by daylight's
// PMREM ground capture without a module cycle.
function checkedMode(mode: LightingMode) {
  if (mode !== 'day' && mode !== 'sunset' && mode !== 'night')
    throw new Error('Invalid circuit lighting mode');
  return mode;
}

/** The key (sun), hemisphere sky and hemisphere ground colours of `mode` under
 * `cloud` cover, written into `out` (linear working space). */
export function circuitLightColors(
  cloud: number,
  value: LightingMode,
  out = { sun: new T.Color(), sky: new T.Color(), ground: new T.Color() },
) {
  if (!Number.isFinite(cloud)) throw new Error('Invalid lighting coverage');
  const mode = checkedMode(value);
  const cover = clamp(cloud, 0, 1);
  if (mode === 'night') {
    out.sun.copy(night.direct);
    out.sky.copy(night.diffuse);
  } else physicalKey(mode, out);
  out.sun.lerp(cloudDirect, mode === 'night' ? cover * 0.12 : cover * 0.88);
  out.sky.lerp(cloudSky, mode === 'night' ? cover * 0.08 : cover * 0.64);
  out.ground.copy(ground[mode]);
  return out;
}

/** Every car/person/environment shader receives the same actual lights. Heavy
 * overcast attenuates sunset warmth instead of retaining an orange key light
 * below grey clouds: light through a deck is diffuse and grey. */
export function applyCircuitLightPalette(
  sun: T.DirectionalLight,
  hemisphere: T.HemisphereLight,
  cloud: number,
  mode: LightingMode,
) {
  circuitLightColors(cloud, mode, {
    sun: sun.color,
    sky: hemisphere.color,
    ground: hemisphere.groundColor,
  });
  // The lower solar elevation otherwise offsets contact shadows away from thin
  // aero/kerb geometry. Keep the original light-space texel-snapped projection.
  sun.shadow.normalBias = mode === 'sunset' ? 0.004 : 0.008;
}
