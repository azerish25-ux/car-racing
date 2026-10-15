import { RACE_BASE, R, carBase } from '../simulation/protocol.ts';
import { vehicleAt, type VehicleDefinition } from '../simulation/vehicles.ts';

/** Powertrain sound families (masterplan §20.2, WP26). Each family is an
 * original synthesis brief — firing order, harmonic emphasis, rev range,
 * induction and transmission character — never a recording. A vehicle picks
 * its family by id; unknown vehicles fall back by class and hybrid flag. */
export type SoundFamily =
  | 'v6-turbo-hybrid'
  | 'i4-turbo'
  | 'v8-na'
  | 'v8-crossplane-turbo'
  | 'v10-na'
  | 'v12-na'
  | 'flat6-na'
  | 'i4-na'
  | 'v4-bike'
  | 'i4-bike'
  | 'single-mx'
  | 'two-stroke-kart'
  | 'electric'
  // Catalogue growth: each a further original synthesis brief.
  | 'v6-na'
  | 'v6-turbo'
  | 'i5-turbo'
  | 'i6-turbo'
  | 'flat4-turbo'
  | 'flat12-na'
  | 'v12-turbo'
  | 'fuel-cell'
  | 'i3-bike'
  | 'two-stroke-bike';

export interface SoundProfile {
  family: SoundFamily;
  /** Combustion events per crankshaft revolution (cylinders / 2 for four-stroke). */
  firingsPerRev: number;
  /** Harmonic band centres as fractions of the limiter. */
  bandCentres: readonly [number, number, number];
  bandWidth: number;
  bandGain: readonly [number, number, number];
  /** Spectral shape per band: odd-harmonic weight, every-third weight, roll-off. */
  odd: number;
  third: number;
  rolloff: number;
  /** Uneven firing (cross-plane V8, big-bang V4) adds sub-harmonic burble. */
  burble: number;
  turbo: { minHz: number; spanHz: number; gain: number; fromRPM: number } | null;
  /** Gear mesh whine per m/s of road speed; straight-cut boxes are louder. */
  whineHzPerMS: number;
  whineGain: number;
  /** Overrun crackle above this fraction of the limiter (Infinity: none). */
  crackleFraction: number;
  crackleMaxRate: number;
  /** Electric motor/inverter whine per m/s (0: none). */
  motorHzPerMS: number;
  motorGain: number;
  /** Load normaliser override (Nm); null uses the torque-curve peak. */
  loadTorqueNm: number | null;
}

const base = {
  bandCentres: [0.33, 0.62, 0.91] as const,
  bandWidth: 0.31,
  bandGain: [0.26, 0.22, 0.085] as const,
  odd: 0.35,
  third: 0.6,
  rolloff: 1.8,
  burble: 0,
  turbo: null,
  whineHzPerMS: 41,
  whineGain: 0.004,
  crackleFraction: Infinity,
  crackleMaxRate: 0,
  motorHzPerMS: 0,
  motorGain: 0,
  loadTorqueNm: null,
} satisfies Partial<SoundProfile>;

export const SOUND_PROFILES: Readonly<Record<SoundFamily, SoundProfile>> = Object.freeze({
  // The original APX-01 voice: values equal the former constants exactly.
  'v6-turbo-hybrid': {
    ...base,
    family: 'v6-turbo-hybrid',
    firingsPerRev: 3,
    bandCentres: [4500 / 13700, 8500 / 13700, 12500 / 13700],
    bandWidth: 4300 / 13700,
    turbo: { minHz: 2600, spanHz: 5400, gain: 0.022, fromRPM: 4000 },
    whineGain: 0.009,
    crackleFraction: 7500 / 13700,
    crackleMaxRate: 14,
    // Engine plus deployed motor torque reaches ~650 Nm at the crank.
    loadTorqueNm: 650,
  },
  'i4-turbo': {
    ...base,
    family: 'i4-turbo',
    firingsPerRev: 2,
    bandGain: [0.3, 0.2, 0.06],
    odd: 0.2,
    third: 0.8,
    rolloff: 2,
    turbo: { minHz: 1900, spanHz: 3600, gain: 0.03, fromRPM: 2200 },
    whineGain: 0.003,
    crackleFraction: 0.72,
    crackleMaxRate: 6,
  },
  'v8-na': {
    ...base,
    family: 'v8-na',
    firingsPerRev: 4,
    bandGain: [0.32, 0.22, 0.07],
    odd: 0.55,
    rolloff: 1.6,
    whineGain: 0.006,
    crackleFraction: 0.7,
    crackleMaxRate: 9,
  },
  'v8-crossplane-turbo': {
    ...base,
    family: 'v8-crossplane-turbo',
    firingsPerRev: 4,
    bandGain: [0.34, 0.2, 0.06],
    odd: 0.7,
    rolloff: 1.5,
    burble: 0.5,
    turbo: { minHz: 1700, spanHz: 3000, gain: 0.018, fromRPM: 2500 },
    whineGain: 0.003,
    crackleFraction: 0.62,
    crackleMaxRate: 10,
  },
  'v10-na': {
    ...base,
    family: 'v10-na',
    firingsPerRev: 5,
    bandGain: [0.22, 0.24, 0.11],
    odd: 0.3,
    rolloff: 1.4,
    whineGain: 0.006,
    crackleFraction: 0.74,
    crackleMaxRate: 8,
  },
  'v12-na': {
    ...base,
    family: 'v12-na',
    firingsPerRev: 6,
    bandGain: [0.2, 0.24, 0.12],
    odd: 0.25,
    rolloff: 1.3,
    whineGain: 0.004,
    crackleFraction: 0.78,
    crackleMaxRate: 5,
  },
  'flat6-na': {
    ...base,
    family: 'flat6-na',
    firingsPerRev: 3,
    bandGain: [0.26, 0.24, 0.09],
    odd: 0.45,
    third: 0.9,
    rolloff: 1.6,
    whineGain: 0.005,
    crackleFraction: 0.75,
    crackleMaxRate: 6,
  },
  'i4-na': {
    ...base,
    family: 'i4-na',
    firingsPerRev: 2,
    bandGain: [0.28, 0.2, 0.08],
    odd: 0.2,
    third: 0.75,
    whineGain: 0.002,
    crackleFraction: 0.8,
    crackleMaxRate: 4,
  },
  'v4-bike': {
    ...base,
    family: 'v4-bike',
    firingsPerRev: 2,
    bandGain: [0.3, 0.22, 0.09],
    odd: 0.65,
    rolloff: 1.5,
    burble: 0.45,
    whineGain: 0.002,
    crackleFraction: 0.68,
    crackleMaxRate: 12,
  },
  'i4-bike': {
    ...base,
    family: 'i4-bike',
    firingsPerRev: 2,
    bandGain: [0.22, 0.24, 0.12],
    odd: 0.2,
    third: 0.7,
    rolloff: 1.3,
    whineGain: 0.002,
    crackleFraction: 0.72,
    crackleMaxRate: 10,
  },
  'single-mx': {
    ...base,
    family: 'single-mx',
    firingsPerRev: 0.5,
    bandCentres: [0.25, 0.55, 0.85],
    bandGain: [0.36, 0.2, 0.08],
    odd: 0.9,
    third: 0.5,
    rolloff: 1.2,
    burble: 0.3,
    whineGain: 0.001,
    crackleFraction: 0.6,
    crackleMaxRate: 7,
  },
  'two-stroke-kart': {
    ...base,
    family: 'two-stroke-kart',
    firingsPerRev: 1,
    bandGain: [0.2, 0.26, 0.14],
    odd: 0.5,
    third: 0.4,
    rolloff: 1.1,
    whineGain: 0.001,
  },
  electric: {
    ...base,
    family: 'electric',
    firingsPerRev: 0,
    bandGain: [0, 0, 0],
    whineGain: 0.004,
    motorHzPerMS: 95,
    motorGain: 0.03,
  },
  // Naturally aspirated V6: three firings per revolution, a hard-edged
  // mid band and a dry overrun.
  'v6-na': {
    ...base,
    family: 'v6-na',
    firingsPerRev: 3,
    bandGain: [0.28, 0.24, 0.09],
    odd: 0.45,
    rolloff: 1.6,
    whineGain: 0.005,
    crackleFraction: 0.75,
    crackleMaxRate: 7,
  },
  // Turbo V6: the NA voice muffled by the turbine, with a spool whistle.
  'v6-turbo': {
    ...base,
    family: 'v6-turbo',
    firingsPerRev: 3,
    bandGain: [0.3, 0.2, 0.07],
    odd: 0.4,
    rolloff: 1.8,
    turbo: { minHz: 2200, spanHz: 4200, gain: 0.026, fromRPM: 2500 },
    whineGain: 0.004,
    crackleFraction: 0.7,
    crackleMaxRate: 8,
  },
  // Turbo five: 2.5 firings per revolution (the warble of an odd count),
  // anti-lag bangs on the overrun.
  'i5-turbo': {
    ...base,
    family: 'i5-turbo',
    firingsPerRev: 2.5,
    bandGain: [0.3, 0.22, 0.08],
    odd: 0.5,
    third: 0.7,
    rolloff: 1.7,
    burble: 0.15,
    turbo: { minHz: 2000, spanHz: 3800, gain: 0.03, fromRPM: 3000 },
    whineGain: 0.005,
    crackleFraction: 0.6,
    crackleMaxRate: 12,
  },
  // Straight-six turbo: perfectly balanced, smooth harmonics, soft whistle.
  'i6-turbo': {
    ...base,
    family: 'i6-turbo',
    firingsPerRev: 3,
    bandGain: [0.24, 0.24, 0.1],
    odd: 0.25,
    third: 0.9,
    rolloff: 1.5,
    turbo: { minHz: 1800, spanHz: 3200, gain: 0.024, fromRPM: 2000 },
    whineGain: 0.003,
    crackleFraction: 0.75,
    crackleMaxRate: 6,
  },
  // Boxer four turbo: unequal-length headers give an uneven rumble.
  'flat4-turbo': {
    ...base,
    family: 'flat4-turbo',
    firingsPerRev: 2,
    bandGain: [0.32, 0.2, 0.07],
    odd: 0.6,
    rolloff: 1.7,
    burble: 0.4,
    turbo: { minHz: 1700, spanHz: 3000, gain: 0.032, fromRPM: 2400 },
    whineGain: 0.003,
    crackleFraction: 0.7,
    crackleMaxRate: 8,
  },
  // Air-cooled flat-12: six firings per revolution, fan whir in the top band.
  'flat12-na': {
    ...base,
    family: 'flat12-na',
    firingsPerRev: 6,
    bandGain: [0.24, 0.24, 0.1],
    odd: 0.4,
    third: 0.85,
    rolloff: 1.35,
    burble: 0.1,
    whineGain: 0.006,
    crackleFraction: 0.75,
    crackleMaxRate: 6,
  },
  // Twin-turbo V12: the V12 smoothness, muffled, with a low whistle.
  'v12-turbo': {
    ...base,
    family: 'v12-turbo',
    firingsPerRev: 6,
    bandGain: [0.22, 0.22, 0.1],
    odd: 0.25,
    rolloff: 1.4,
    turbo: { minHz: 1600, spanHz: 2800, gain: 0.016, fromRPM: 1800 },
    whineGain: 0.003,
    crackleFraction: 0.8,
    crackleMaxRate: 3,
  },
  // Fuel-cell electric: inverter whine plus the stack's air compressor,
  // which follows motor speed under load.
  'fuel-cell': {
    ...base,
    family: 'fuel-cell',
    firingsPerRev: 0,
    bandGain: [0, 0, 0],
    turbo: { minHz: 2600, spanHz: 5200, gain: 0.02, fromRPM: 0 },
    whineGain: 0.004,
    motorHzPerMS: 70,
    motorGain: 0.026,
  },
  // Motorcycle triple: 1.5 firings per revolution, a growl between twin
  // and four.
  'i3-bike': {
    ...base,
    family: 'i3-bike',
    firingsPerRev: 1.5,
    bandGain: [0.28, 0.24, 0.1],
    odd: 0.6,
    third: 0.5,
    rolloff: 1.4,
    burble: 0.2,
    whineGain: 0.002,
    crackleFraction: 0.7,
    crackleMaxRate: 9,
  },
  // Two-stroke triple: every cylinder fires every revolution; a shrill,
  // buzzing expansion-chamber voice with no overrun crackle.
  'two-stroke-bike': {
    ...base,
    family: 'two-stroke-bike',
    firingsPerRev: 3,
    bandCentres: [0.3, 0.6, 0.88],
    bandGain: [0.2, 0.26, 0.15],
    odd: 0.45,
    third: 0.35,
    rolloff: 1.05,
    whineGain: 0.001,
  },
} satisfies Record<SoundFamily, SoundProfile>);

/** Explicit family per catalogue id; extended as vehicles are added. */
const BY_VEHICLE: Readonly<Record<string, SoundFamily>> = {
  apx01: 'v6-turbo-hybrid',
  tc1: 'i4-turbo',
  gpr1: 'v4-bike',
  sbk1000: 'i4-bike',
  jf2: 'v6-turbo-hybrid',
  hf67: 'v8-na',
  hy9: 'v6-turbo-hybrid',
  pr2: 'v8-na',
  gt8f: 'v8-crossplane-turbo',
  gt10m: 'v10-na',
  gs4: 'flat6-na',
  tc2: 'i4-turbo',
  cr1: 'i4-na',
  rl2: 'i4-turbo',
  rcx6: 'i4-turbo',
  dx8: 'v8-na',
  sk125: 'two-stroke-kart',
  eh3: 'electric',
  sc7: 'v12-na',
  // Catalogue growth (CONTENT_PIPELINE.md §1.3 sound column).
  fx26: 'v6-turbo-hybrid',
  fr3: 'v6-na',
  fe4: 'i4-turbo',
  hf76: 'v8-na',
  hf86: 'v6-turbo',
  hy11: 'v8-crossplane-turbo',
  pr3: 'v6-turbo',
  sp71: 'flat12-na',
  gt6r: 'flat6-na',
  gt6s: 'i6-turbo',
  gs6m: 'v6-na',
  tc3: 'i4-turbo',
  hh2: 'i4-turbo',
  vc62: 'i4-na',
  rl7: 'i4-na',
  gb4: 'i5-turbo',
  rxe: 'electric',
  bg2: 'v6-turbo',
  dk100: 'two-stroke-kart',
  xf2: 'v8-na',
  xe1: 'electric',
  xh3: 'fuel-cell',
  xt1: 'v12-na',
  rh3: 'i4-turbo',
  rs5: 'i6-turbo',
  rm8: 'v8-na',
  rg63: 'v12-na',
  rp6: 'v6-turbo',
  rr4: 'flat4-turbo',
  lx12: 'v12-turbo',
  rd2: 'i4-na',
  gpr2: 'i4-bike',
  ss600: 'i4-bike',
  nr900: 'i3-bike',
  cr750: 'two-stroke-bike',
};
/** The family a vehicle id names explicitly, or null when it would fall back
 * by class (content checks require every registered machine to name one). */
export function explicitSoundFamily(id: string): SoundFamily | null {
  return Object.hasOwn(BY_VEHICLE, id) ? BY_VEHICLE[id] : null;
}

export function soundFamilyFor(definition: VehicleDefinition): SoundFamily {
  const explicit = BY_VEHICLE[definition.id];
  if (explicit) return explicit;
  if (definition.classId === 'formula') return definition.hybrid ? 'v6-turbo-hybrid' : 'v8-na';
  if (definition.classId === 'gt') return 'v8-crossplane-turbo';
  if (definition.classId === 'club') return 'i4-na';
  if (definition.classId === 'gp-bike') return 'v4-bike';
  if (definition.classId === 'superbike') return 'i4-bike';
  return 'i4-turbo';
}

/** What the synthesis needs from a vehicle: its family, rev range and the
 * torque that counts as full load. */
export interface EngineCharacter {
  profile: SoundProfile;
  limiterRPM: number;
  loadTorque: number;
}

const characters = new Map<string, EngineCharacter>();
export function engineCharacter(definition: VehicleDefinition): EngineCharacter {
  let character = characters.get(definition.id);
  if (!character) {
    const profile = SOUND_PROFILES[soundFamilyFor(definition)];
    let peak = 1;
    for (const [, torque] of definition.spec.torqueCurve) peak = Math.max(peak, torque);
    character = Object.freeze({
      profile,
      limiterRPM: definition.spec.limiterRPM,
      loadTorque: profile.loadTorqueNm ?? peak,
    });
    characters.set(definition.id, character);
  }
  return character;
}

/** The recorded vehicle's character for `car` (live play and replays alike). */
export const frameCharacter = (frame: Float32Array, car: number) =>
  engineCharacter(vehicleAt(Math.round(frame[carBase(car) + RACE_BASE + R.VEHICLE])));
