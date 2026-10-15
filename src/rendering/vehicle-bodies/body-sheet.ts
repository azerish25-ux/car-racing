import type { PaintFinish } from '../paint-finish.ts';
import type { VehicleDefinition } from '../../simulation/vehicles.ts';
import type { WheelSheet } from './wheel.ts';

/** Body sheets (WP30): the exterior design of each catalogue machine as data,
 * read by the family-aware generator. Wheelbase, track, wheel radius and
 * rest heights come from the VehicleDefinition so the body always matches
 * the simulated machine; the sheet adds what the solver does not know:
 * overhangs, section heights, cabin stations, aero furniture, lamps, intakes,
 * mirrors, numbers and wheel styling. Stations along the car are fractions
 * of the wheelbase measured from the FRONT axle (0) to the rear axle (1);
 * negative is ahead of the front axle, above 1 behind the rear. Heights are
 * metres above the road at rest. */
export type BodyKind = 'closed' | 'open-wheel' | 'kart';
export type ClosedStyle =
  | 'gt'
  | 'prototype'
  | 'saloon'
  | 'roadster'
  | 'rally'
  | 'truck'
  | 'supercar';
export type WingKind =
  | 'none'
  | 'lip'
  | 'ducktail'
  | 'pedestal'
  | 'swan-neck'
  | 'roof'
  | 'full-width';
export interface WingSheet {
  kind: WingKind;
  /** Station (fraction) of the wing's leading edge, height above the road. */
  at: number;
  height: number;
  chord: number;
  /** Span as a fraction of body width. */
  span: number;
  /** Second element (flap). */
  flap: boolean;
}
export interface LampSheet {
  front: 'slim' | 'round' | 'twin' | 'bar' | 'pod';
  rear: 'bar' | 'twin' | 'round' | 'strip';
}
export interface ClosedSheet {
  kind: 'closed';
  style: ClosedStyle;
  /** Bodywork beyond the axles (m). */
  overhang: readonly [number, number];
  /** Overall body width (m) at the wheel flares. */
  width: number;
  /** Section heights above the road (m). */
  floor: number;
  nose: number;
  bonnet: number;
  cowl: number;
  roof: number;
  deck: number;
  tail: number;
  belt: number;
  /** Greenhouse stations (fractions): windscreen base, roof front, roof rear,
   * rear-window base. A roadster has no roof (roofFront === roofRear). */
  cabin: readonly [number, number, number, number];
  /** Roof half width as a share of the body half width. */
  roofWidth: number;
  /** Extra half width over each axle (wheel-arch flares, m). */
  flare: readonly [number, number];
  wing: WingSheet | null;
  splitter: number;
  diffuser: number;
  mirrors: boolean;
  lamps: LampSheet;
  grille: number;
  sideIntake: boolean;
  roofScoop: boolean;
  bonnetVents: boolean;
  numbers: 'door' | 'none';
  extras: readonly (
    | 'lightbar'
    | 'spare'
    | 'bullbar'
    | 'exhaust-side'
    | 'exhaust-rear'
    | 'fin'
    | 'mudflaps'
    | 'snorkel'
    | 'cage'
  )[];
  stripe: 'none' | 'centre' | 'side';
  paint: PaintFinish;
  wheels: WheelSheet;
}
export interface OpenWheelSheet {
  kind: 'open-wheel';
  era: 'modern' | 'historic';
  overhang: readonly [number, number];
  /** Monocoque half width and height (m). */
  tub: readonly [number, number];
  /** Sidepod half width (0: none) and cockpit station (fraction). */
  sidepod: number;
  cockpit: number;
  noseHeight: number;
  frontWing: boolean;
  rearWing: boolean;
  halo: boolean;
  airbox: boolean;
  paint: PaintFinish;
  stripe: 'none' | 'centre' | 'side';
  wheels: WheelSheet;
}
export interface KartSheet {
  kind: 'kart';
  paint: PaintFinish;
  wheels: WheelSheet;
}
export type BodySheet = ClosedSheet | OpenWheelSheet | KartSheet;

const RACE_WHEEL: WheelSheet = Object.freeze({
  width: [0.3, 0.32] as const,
  rimRadius: 0.229,
  spokes: 10,
  style: 'split' as const,
  rimColor: 0x1d1f22,
  caliperColor: 0xc8102e,
  tread: 'slick' as const,
  centreLock: true,
  disc: 0.86,
});
const wheel = (patch: Partial<WheelSheet>): WheelSheet =>
  Object.freeze({ ...RACE_WHEEL, ...patch });
const GT: Omit<ClosedSheet, 'wheels'> = {
  kind: 'closed',
  style: 'gt',
  overhang: [1.08, 0.86],
  width: 2.04,
  floor: 0.07,
  nose: 0.42,
  bonnet: 0.78,
  cowl: 0.92,
  roof: 1.2,
  deck: 0.96,
  tail: 0.98,
  belt: 0.66,
  cabin: [0.3, 0.5, 0.82, 1.08],
  roofWidth: 0.62,
  flare: [0.07, 0.09],
  wing: { kind: 'swan-neck', at: 1.32, height: 1.22, chord: 0.32, span: 0.88, flap: true },
  splitter: 0.08,
  diffuser: 0.12,
  mirrors: true,
  lamps: { front: 'slim', rear: 'bar' },
  grille: 0.8,
  sideIntake: false,
  roofScoop: false,
  bonnetVents: true,
  numbers: 'door',
  extras: ['exhaust-side'],
  stripe: 'centre',
  paint: 'metallic',
};
/** Exterior sheets by vehicle id (catalogue and TC-1). */
export const BODY_SHEETS: Readonly<Record<string, BodySheet>> = Object.freeze({
  tc1: {
    kind: 'closed',
    style: 'saloon',
    overhang: [0.95, 0.8],
    width: 1.9,
    floor: 0.09,
    nose: 0.45,
    bonnet: 0.86,
    cowl: 0.98,
    roof: 1.38,
    deck: 1.0,
    tail: 1.02,
    belt: 0.72,
    cabin: [0.16, 0.38, 0.86, 1.06],
    roofWidth: 0.7,
    flare: [0.07, 0.06],
    wing: { kind: 'pedestal', at: 1.22, height: 1.1, chord: 0.24, span: 0.8, flap: false },
    splitter: 0.06,
    diffuser: 0.05,
    mirrors: true,
    lamps: { front: 'twin', rear: 'twin' },
    grille: 1,
    sideIntake: false,
    roofScoop: false,
    bonnetVents: false,
    numbers: 'door',
    extras: ['exhaust-rear', 'cage'],
    stripe: 'side',
    paint: 'gloss',
    wheels: wheel({
      width: [0.25, 0.25],
      rimRadius: 0.229,
      spokes: 6,
      style: 'straight',
      centreLock: false,
      caliperColor: 0xe3b100,
    }),
  },
  tc2: {
    kind: 'closed',
    style: 'saloon',
    overhang: [0.95, 0.85],
    width: 1.92,
    floor: 0.08,
    nose: 0.43,
    bonnet: 0.84,
    cowl: 0.97,
    roof: 1.34,
    deck: 1.0,
    tail: 1.02,
    belt: 0.7,
    cabin: [0.24, 0.44, 0.88, 1.08],
    roofWidth: 0.68,
    flare: [0.08, 0.1],
    wing: { kind: 'pedestal', at: 1.24, height: 1.12, chord: 0.26, span: 0.86, flap: true },
    splitter: 0.07,
    diffuser: 0.08,
    mirrors: true,
    lamps: { front: 'bar', rear: 'bar' },
    grille: 0.9,
    sideIntake: false,
    roofScoop: false,
    bonnetVents: true,
    numbers: 'door',
    extras: ['exhaust-side', 'cage'],
    stripe: 'centre',
    paint: 'gloss',
    wheels: wheel({
      width: [0.27, 0.29],
      spokes: 6,
      style: 'straight',
      centreLock: true,
      caliperColor: 0xd4d6d8,
    }),
  },
  gt8f: {
    ...GT,
    overhang: [1.12, 0.84],
    bonnet: 0.8,
    cabin: [0.36, 0.54, 0.84, 1.1],
    extras: ['exhaust-side'],
    wheels: wheel({ rimColor: 0x2a2c2f }),
  },
  gt10m: {
    ...GT,
    style: 'supercar',
    overhang: [1.04, 0.86],
    nose: 0.38,
    bonnet: 0.7,
    cowl: 0.88,
    roof: 1.16,
    deck: 0.98,
    cabin: [0.08, 0.26, 0.52, 0.86],
    sideIntake: true,
    bonnetVents: false,
    lamps: { front: 'slim', rear: 'strip' },
    extras: ['exhaust-rear', 'fin'],
    wheels: wheel({ rimColor: 0x8a6c2c, caliperColor: 0x101114 }),
  },
  gs4: {
    ...GT,
    overhang: [1.0, 0.86],
    floor: 0.09,
    roof: 1.24,
    cabin: [0.34, 0.52, 0.84, 1.12],
    wing: { kind: 'pedestal', at: 1.26, height: 1.16, chord: 0.26, span: 0.84, flap: false },
    flare: [0.05, 0.06],
    splitter: 0.05,
    diffuser: 0.06,
    lamps: { front: 'twin', rear: 'bar' },
    stripe: 'side',
    wheels: wheel({
      width: [0.28, 0.3],
      spokes: 5,
      style: 'straight',
      centreLock: false,
      rimColor: 0x55595e,
      caliperColor: 0x1f4fbf,
    }),
  },
  hy9: {
    kind: 'closed',
    style: 'prototype',
    overhang: [1.15, 0.85],
    width: 2.0,
    floor: 0.055,
    nose: 0.34,
    bonnet: 0.62,
    cowl: 0.82,
    roof: 1.14,
    deck: 0.92,
    tail: 0.96,
    belt: 0.56,
    cabin: [0.1, 0.28, 0.5, 0.74],
    roofWidth: 0.34,
    flare: [0.0, 0.0],
    wing: { kind: 'full-width', at: 1.22, height: 1.0, chord: 0.34, span: 0.96, flap: true },
    splitter: 0.12,
    diffuser: 0.2,
    mirrors: true,
    lamps: { front: 'bar', rear: 'strip' },
    grille: 0.35,
    sideIntake: true,
    roofScoop: true,
    bonnetVents: true,
    numbers: 'door',
    extras: ['fin'],
    stripe: 'centre',
    paint: 'metallic',
    wheels: wheel({
      width: [0.31, 0.34],
      rimRadius: 0.229,
      spokes: 7,
      style: 'straight',
      rimColor: 0x111214,
      caliperColor: 0xf2c200,
    }),
  },
  pr2: {
    kind: 'closed',
    style: 'prototype',
    overhang: [1.05, 0.7],
    width: 1.9,
    floor: 0.055,
    nose: 0.32,
    bonnet: 0.6,
    cowl: 0.8,
    roof: 1.06,
    deck: 0.86,
    tail: 0.9,
    belt: 0.54,
    cabin: [0.12, 0.3, 0.5, 0.72],
    roofWidth: 0.34,
    flare: [0, 0],
    wing: { kind: 'swan-neck', at: 1.2, height: 0.98, chord: 0.3, span: 0.92, flap: true },
    splitter: 0.1,
    diffuser: 0.18,
    mirrors: true,
    lamps: { front: 'pod', rear: 'strip' },
    grille: 0.3,
    sideIntake: true,
    roofScoop: true,
    bonnetVents: true,
    numbers: 'door',
    extras: ['fin'],
    stripe: 'side',
    paint: 'gloss',
    wheels: wheel({
      width: [0.3, 0.33],
      spokes: 9,
      style: 'straight',
      rimColor: 0x24262a,
      caliperColor: 0xc8102e,
    }),
  },
  cr1: {
    kind: 'closed',
    style: 'roadster',
    overhang: [0.66, 0.45],
    width: 1.58,
    floor: 0.1,
    nose: 0.42,
    bonnet: 0.66,
    cowl: 0.76,
    roof: 1.02,
    deck: 0.78,
    tail: 0.74,
    belt: 0.6,
    cabin: [0.42, 0.5, 0.5, 0.82],
    roofWidth: 0.7,
    flare: [0.14, 0.12],
    wing: null,
    splitter: 0,
    diffuser: 0,
    mirrors: true,
    lamps: { front: 'round', rear: 'round' },
    grille: 0.5,
    sideIntake: false,
    roofScoop: false,
    bonnetVents: true,
    numbers: 'door',
    extras: ['exhaust-side', 'cage'],
    stripe: 'centre',
    paint: 'gloss',
    wheels: wheel({
      width: [0.2, 0.22],
      rimRadius: 0.19,
      spokes: 6,
      style: 'straight',
      centreLock: false,
      rimColor: 0xb8bcc1,
      caliperColor: 0x2c2e31,
      tread: 'road',
    }),
  },
  rl2: {
    kind: 'closed',
    style: 'rally',
    overhang: [0.9, 0.7],
    width: 1.84,
    floor: 0.16,
    nose: 0.5,
    bonnet: 0.92,
    cowl: 1.02,
    roof: 1.46,
    deck: 1.08,
    tail: 1.06,
    belt: 0.8,
    cabin: [0.16, 0.36, 0.86, 1.08],
    roofWidth: 0.7,
    flare: [0.1, 0.1],
    wing: { kind: 'roof', at: 1.02, height: 1.4, chord: 0.3, span: 0.9, flap: false },
    splitter: 0.03,
    diffuser: 0,
    mirrors: true,
    lamps: { front: 'twin', rear: 'twin' },
    grille: 1,
    sideIntake: false,
    roofScoop: true,
    bonnetVents: true,
    numbers: 'door',
    extras: ['mudflaps', 'exhaust-rear', 'cage'],
    stripe: 'side',
    paint: 'gloss',
    wheels: wheel({
      width: [0.22, 0.22],
      rimRadius: 0.19,
      spokes: 6,
      style: 'straight',
      centreLock: false,
      rimColor: 0xe9e9e6,
      caliperColor: 0x101114,
      tread: 'block',
      disc: 0.78,
    }),
  },
  rcx6: {
    kind: 'closed',
    style: 'rally',
    overhang: [0.95, 0.75],
    width: 1.94,
    floor: 0.13,
    nose: 0.46,
    bonnet: 0.88,
    cowl: 1.0,
    roof: 1.42,
    deck: 1.08,
    tail: 1.08,
    belt: 0.78,
    cabin: [0.18, 0.38, 0.86, 1.08],
    roofWidth: 0.68,
    flare: [0.14, 0.14],
    wing: { kind: 'roof', at: 1.04, height: 1.42, chord: 0.36, span: 1.0, flap: true },
    splitter: 0.06,
    diffuser: 0.04,
    mirrors: true,
    lamps: { front: 'slim', rear: 'strip' },
    grille: 1,
    sideIntake: true,
    roofScoop: true,
    bonnetVents: true,
    numbers: 'door',
    extras: ['mudflaps', 'exhaust-side', 'cage'],
    stripe: 'centre',
    paint: 'gloss',
    wheels: wheel({
      width: [0.24, 0.24],
      rimRadius: 0.2,
      spokes: 5,
      style: 'straight',
      centreLock: false,
      rimColor: 0x111214,
      caliperColor: 0xff6a00,
      tread: 'block',
    }),
  },
  dx8: {
    kind: 'closed',
    style: 'truck',
    overhang: [1.12, 1.2],
    width: 2.32,
    floor: 0.42,
    nose: 0.82,
    bonnet: 1.36,
    cowl: 1.5,
    roof: 2.02,
    deck: 1.5,
    tail: 1.46,
    belt: 1.28,
    cabin: [0.32, 0.46, 0.7, 0.78],
    roofWidth: 0.66,
    flare: [0.12, 0.12],
    wing: null,
    splitter: 0,
    diffuser: 0,
    mirrors: true,
    lamps: { front: 'round', rear: 'round' },
    grille: 0.7,
    sideIntake: false,
    roofScoop: true,
    bonnetVents: true,
    numbers: 'door',
    extras: ['lightbar', 'spare', 'bullbar', 'snorkel', 'cage'],
    stripe: 'side',
    paint: 'satin',
    wheels: wheel({
      width: [0.32, 0.32],
      rimRadius: 0.216,
      spokes: 0,
      style: 'beadlock',
      centreLock: false,
      rimColor: 0x1a1b1d,
      caliperColor: 0x6a6d72,
      tread: 'block',
      disc: 0.7,
    }),
  },
  eh3: {
    kind: 'closed',
    style: 'supercar',
    overhang: [1.06, 0.95],
    width: 2.04,
    floor: 0.1,
    nose: 0.4,
    bonnet: 0.74,
    cowl: 0.9,
    roof: 1.2,
    deck: 0.98,
    tail: 1.0,
    belt: 0.68,
    cabin: [0.12, 0.3, 0.6, 0.98],
    roofWidth: 0.6,
    flare: [0.06, 0.08],
    wing: { kind: 'ducktail', at: 1.24, height: 1.02, chord: 0.24, span: 0.8, flap: false },
    splitter: 0.04,
    diffuser: 0.1,
    mirrors: true,
    lamps: { front: 'slim', rear: 'strip' },
    grille: 0.2,
    sideIntake: true,
    roofScoop: false,
    bonnetVents: false,
    numbers: 'none',
    extras: [],
    stripe: 'none',
    paint: 'metallic',
    wheels: wheel({
      width: [0.27, 0.33],
      rimRadius: 0.267,
      spokes: 10,
      style: 'mesh',
      centreLock: false,
      rimColor: 0x2b2d30,
      caliperColor: 0x1f6fd0,
      tread: 'road',
    }),
  },
  sc7: {
    kind: 'closed',
    style: 'supercar',
    overhang: [1.04, 0.86],
    width: 1.98,
    floor: 0.1,
    nose: 0.38,
    bonnet: 0.7,
    cowl: 0.86,
    roof: 1.15,
    deck: 0.96,
    tail: 1.0,
    belt: 0.66,
    cabin: [0.06, 0.24, 0.5, 0.86],
    roofWidth: 0.6,
    flare: [0.06, 0.1],
    wing: { kind: 'ducktail', at: 1.22, height: 1.04, chord: 0.22, span: 0.84, flap: false },
    splitter: 0.03,
    diffuser: 0.12,
    mirrors: true,
    lamps: { front: 'slim', rear: 'strip' },
    grille: 0.3,
    sideIntake: true,
    roofScoop: false,
    bonnetVents: true,
    numbers: 'none',
    extras: ['exhaust-rear'],
    stripe: 'none',
    paint: 'metallic',
    wheels: wheel({
      width: [0.25, 0.31],
      rimRadius: 0.254,
      spokes: 5,
      style: 'split',
      centreLock: false,
      rimColor: 0x9ea3a8,
      caliperColor: 0xf2c200,
      tread: 'road',
    }),
  },
  jf2: {
    kind: 'open-wheel',
    era: 'modern',
    overhang: [1.08, 0.78],
    tub: [0.32, 0.62],
    sidepod: 0.62,
    cockpit: 0.42,
    noseHeight: 0.28,
    frontWing: true,
    rearWing: true,
    halo: true,
    airbox: true,
    paint: 'gloss',
    stripe: 'centre',
    wheels: wheel({
      width: [0.27, 0.36],
      rimRadius: 0.229,
      spokes: 10,
      style: 'straight',
      rimColor: 0x17181a,
      caliperColor: 0x2b2d30,
    }),
  },
  hf67: {
    kind: 'open-wheel',
    era: 'historic',
    overhang: [0.8, 0.55],
    tub: [0.3, 0.56],
    sidepod: 0,
    cockpit: 0.5,
    noseHeight: 0.3,
    frontWing: false,
    rearWing: false,
    halo: false,
    airbox: false,
    paint: 'gloss',
    stripe: 'centre',
    wheels: wheel({
      width: [0.17, 0.22],
      rimRadius: 0.19,
      spokes: 6,
      style: 'slotted',
      centreLock: true,
      rimColor: 0xa7a28f,
      caliperColor: 0x2e2f31,
      tread: 'rib',
      disc: 0.7,
    }),
  },
  sk125: {
    kind: 'kart',
    paint: 'gloss',
    wheels: wheel({
      width: [0.12, 0.18],
      rimRadius: 0.064,
      spokes: 6,
      style: 'kart',
      centreLock: false,
      rimColor: 0xc9ccd0,
      caliperColor: 0x2b2d30,
      disc: 0,
    }),
  },
});
/** The sheet for a definition: its own, or a generic one for its family. */
export function bodySheetFor(def: VehicleDefinition): BodySheet | null {
  if (def.dynamicsKind !== 'four-wheel' || def.id === 'apx01') return null;
  const own = BODY_SHEETS[def.id];
  if (own) return own;
  const formula = def.classId === 'formula' || def.classId === 'formula-junior';
  return formula ? BODY_SHEETS.jf2 : BODY_SHEETS.tc1;
}
