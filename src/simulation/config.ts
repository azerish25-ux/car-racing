import { circuitDefinition, type CircuitId } from './circuits.ts';
import { clamp } from '../core/math.ts';
import { FORMULA_APX01, VEHICLES } from './vehicles.ts';
import { RULESETS, TIMED_LIMITS } from './events.ts';
export type Compound = 'soft' | 'medium' | 'hard' | 'intermediate' | 'wet';
export type WeatherPreset = 'clear' | 'changeable' | 'rain';
export type Assist = 'sport' | 'raw';
export interface Setup {
  frontWing: number;
  rearWing: number;
  brakeBias: number;
  diffPower: number;
  diffCoast: number;
  frontSpring: number;
  rearSpring: number;
  frontARB: number;
  rearARB: number;
  frontRide: number;
  rearRide: number;
  frontPressure: number;
  rearPressure: number;
  frontCamber: number;
  rearCamber: number;
  frontToe: number;
  rearToe: number;
  /** Motorcycles (BikeVehicle; cars never expose these). Spring preload
   * beyond the machine's calibrated base (m): less sag and a higher centre
   * of mass in the dynamics. */
  frontPreload: number;
  rearPreload: number;
  /** Damping clicks, 0 soft .. 1 firm; 0.5 is the calibrated base. */
  frontDamping: number;
  rearDamping: number;
  /** Steering damper, 0 off .. 1 firm; 0.5 is the calibrated base. */
  steeringDamper: number;
  /** Final-drive (sprocket) ratio multiplier; 1 is the calibrated gearing. */
  gearing: number;
  /** Rider-aid maps (Sport rider aids): 1 least .. 6 (traction) / 5 (wheelie)
   * most intervention; 3 is the calibrated map. */
  tractionMap: number;
  wheelieMap: number;
  /** Closed-throttle engine braking map: 0 free-wheel (as calibrated) .. 3 strong. */
  engineBrakeMap: number;
}
export const DEFAULT_SETUP: Setup = {
  frontWing: 0.55,
  rearWing: 0.58,
  brakeBias: 0.56,
  diffPower: 0.5,
  diffCoast: 0.25,
  frontSpring: 115000,
  rearSpring: 125000,
  frontARB: 26000,
  rearARB: 21000,
  frontRide: 0.065,
  rearRide: 0.075,
  frontPressure: 155,
  rearPressure: 148,
  frontCamber: -0.044,
  rearCamber: -0.023,
  frontToe: -0.001,
  rearToe: 0.002,
  frontPreload: 0,
  rearPreload: 0,
  frontDamping: 0.5,
  rearDamping: 0.5,
  steeringDamper: 0.5,
  gearing: 1,
  tractionMap: 3,
  wheelieMap: 3,
  engineBrakeMap: 0,
};
export const SETUP_LIMITS: Record<keyof Setup, readonly [number, number]> = {
  frontWing: [0, 1],
  rearWing: [0, 1],
  brakeBias: [0.48, 0.68],
  diffPower: [0, 1],
  diffCoast: [0, 1],
  frontSpring: [85000, 165000],
  rearSpring: [85000, 175000],
  frontARB: [0, 55000],
  rearARB: [0, 55000],
  frontRide: [0.045, 0.1],
  rearRide: [0.045, 0.11],
  frontPressure: [130, 190],
  rearPressure: [130, 190],
  frontCamber: [-0.07, 0],
  rearCamber: [-0.05, 0],
  frontToe: [-0.005, 0.005],
  rearToe: [-0.005, 0.005],
  frontPreload: [-0.005, 0.01],
  rearPreload: [-0.005, 0.01],
  frontDamping: [0, 1],
  rearDamping: [0, 1],
  steeringDamper: [0, 1],
  gearing: [0.92, 1.08],
  tractionMap: [1, 6],
  wheelieMap: [1, 5],
  engineBrakeMap: [0, 3],
};
export function validateSetup(value: unknown): Setup {
  if (!value || typeof value !== 'object') throw new Error('Setup must be an object');
  const out = { ...DEFAULT_SETUP };
  for (const key of Object.keys(out) as (keyof Setup)[]) {
    const n = (value as Record<string, unknown>)[key];
    if (n === undefined) continue;
    if (typeof n !== 'number' || !Number.isFinite(n)) throw new Error(`Invalid setup ${key}`);
    const [a, b] = SETUP_LIMITS[key];
    out[key] = clamp(n, a, b);
  }
  return out;
}
export const COMPOUNDS: Record<
  Compound,
  { mu: number; ideal: number; lifeJ: number; waterTolerance: number; color: number }
> = {
  soft: { mu: 1.92, ideal: 96, lifeJ: 29e6, waterTolerance: 0.09, color: 0xe2262f },
  medium: { mu: 1.84, ideal: 92, lifeJ: 40e6, waterTolerance: 0.1, color: 0xf5c400 },
  hard: { mu: 1.76, ideal: 90, lifeJ: 55e6, waterTolerance: 0.11, color: 0xf2f2ee },
  intermediate: { mu: 1.57, ideal: 70, lifeJ: 30e6, waterTolerance: 1.2, color: 0x2bb04a },
  wet: { mu: 1.43, ideal: 60, lifeJ: 25e6, waterTolerance: 3.2, color: 0x0a6fd0 },
};
/** The Formula APX-01 specification (vehicles.ts owns every definition). */
export const VEHICLE = FORMULA_APX01.spec;
export interface SessionOptions {
  /** Original circuit; Aurel when absent (older saves and callers). */
  circuit?: CircuitId;
  /** Time Trial is a solo practice session whose valid laps set a saved ghost.
   * Qualifying spreads the field around the lap for an out-lap and
   * QUALIFYING_TIMED_LAPS timed laps; its classification is the race grid.
   * Endurance is a long race with the mandatory two-compound stop rule. */
  mode: 'race' | 'practice' | 'time-trial' | 'qualifying' | 'endurance';
  laps: number;
  opponents: number;
  /** Starting order as car ids, pole first. Absent: car order (player on pole). */
  grid?: number[];
  /** Motocross start-gate slot per car id, as a meeting's gate pick chose
   * them (offroad/meeting.ts). Absent: the session picks in `grid` order. */
  gates?: number[];
  /** Per-entry vehicle definition ids (index = car id). Absent: every entrant
   * runs the Formula APX-01 (older saves and callers). WP08. */
  vehicles?: string[];
  /** Sporting ruleset id (events.ts); absent: the ruleset the mode implies. */
  ruleset?: string;
  /** Timed classification length in seconds (timed rulesets only). */
  durationSeconds?: number;
  weather: WeatherPreset;
  assist: Assist;
  compound: Compound;
  setup: Setup;
  seed: number;
}
export const DEFAULT_OPTIONS: SessionOptions = {
  mode: 'race',
  laps: 3,
  opponents: 7,
  weather: 'clear',
  assist: 'sport',
  compound: 'medium',
  setup: { ...DEFAULT_SETUP },
  seed: 73021,
};
export const QUALIFYING_TIMED_LAPS = 2;
export const ENDURANCE_MAX_LAPS = 30;
/** Sessions that start from the lights and classify by finishing order. */
export function racingSession(mode: SessionOptions['mode']) {
  return mode === 'race' || mode === 'endurance';
}
/** Endurance rule: a dry race must use at least two different dry compounds
 * (one real stop). Running intermediates or wets satisfies it. */
export const MANDATORY_STOP_PENALTY_SECONDS = 30;
export function mandatoryStopSatisfied(used: ReadonlySet<Compound>) {
  let dry = 0;
  for (const compound of used) {
    if (compound === 'intermediate' || compound === 'wet') return true;
    dry++;
  }
  return dry >= 2;
}
/** A different dry compound for the mandatory stop. */
export function alternateDryCompound(current: Compound): Compound {
  return current === 'medium' ? 'hard' : 'medium';
}
export type StartSlot = 'pole' | 'midfield' | 'back';
/** Grid order (car id per slot) with the player starting from `slot`; the
 * rivals keep their order around it. Pole keeps the default order. */
export function startingGrid(cars: number, slot: StartSlot): number[] | undefined {
  if (!Number.isInteger(cars) || cars < 1) throw new Error('Invalid grid size');
  if (slot === 'pole' || cars === 1) return undefined;
  const index = slot === 'back' ? cars - 1 : Math.floor(cars / 2);
  const rivals = Array.from({ length: cars - 1 }, (_, i) => i + 1);
  return [...rivals.slice(0, index), 0, ...rivals.slice(index)];
}
/** A grid must name every car exactly once; anything else is ignored. */
function validGrid(value: unknown, cars: number): number[] | null {
  if (!Array.isArray(value) || value.length !== cars) return null;
  const seen = new Set<number>();
  for (const id of value) {
    if (!Number.isInteger(id) || id < 0 || id >= cars || seen.has(id)) return null;
    seen.add(id);
  }
  return [...value];
}
/** One distinct gate slot (0..31) per entrant; anything else is ignored. */
function validGates(value: unknown, cars: number): number[] | null {
  if (!Array.isArray(value) || value.length !== cars) return null;
  const seen = new Set<number>();
  for (const slot of value) {
    if (!Number.isInteger(slot) || slot < 0 || slot > 31 || seen.has(slot)) return null;
    seen.add(slot);
  }
  return [...value];
}
/** One known vehicle id per entrant; anything else is ignored (all Formula). */
function validVehicles(value: unknown, cars: number): string[] | null {
  if (!Array.isArray(value) || value.length !== cars) return null;
  for (const id of value) if (typeof id !== 'string' || !Object.hasOwn(VEHICLES, id)) return null;
  return [...value];
}
export function validateOptions(v: unknown): SessionOptions {
  if (!v || typeof v !== 'object') throw new Error('Invalid session options');
  const o = v as Partial<SessionOptions>;
  const opponents =
    o.mode === 'time-trial' ? 0 : clamp(Math.round(Number(o.opponents) || 0), 0, 11);
  const grid = validGrid(o.grid, opponents + 1);
  const gates = validGates(o.gates, opponents + 1);
  const vehicles = validVehicles(o.vehicles, opponents + 1);
  return {
    circuit: circuitDefinition(o.circuit).id,
    mode:
      o.mode === 'practice' ||
      o.mode === 'time-trial' ||
      o.mode === 'qualifying' ||
      o.mode === 'endurance'
        ? o.mode
        : 'race',
    laps: clamp(
      Math.round(Number(o.laps) || 3),
      1,
      o.mode === 'endurance' ? ENDURANCE_MAX_LAPS : 10,
    ),
    opponents,
    ...(grid ? { grid } : {}),
    ...(gates ? { gates } : {}),
    ...(vehicles ? { vehicles } : {}),
    ...(typeof o.ruleset === 'string' && Object.hasOwn(RULESETS, o.ruleset)
      ? { ruleset: o.ruleset }
      : {}),
    ...(Number.isFinite(o.durationSeconds)
      ? {
          durationSeconds: clamp(
            Math.round(o.durationSeconds as number),
            TIMED_LIMITS.min,
            TIMED_LIMITS.max,
          ),
        }
      : {}),
    weather: o.weather === 'rain' || o.weather === 'changeable' ? o.weather : 'clear',
    assist: o.assist === 'raw' ? 'raw' : 'sport',
    compound: o.compound && Object.hasOwn(COMPOUNDS, o.compound) ? o.compound : 'medium',
    setup: validateSetup(o.setup ?? DEFAULT_SETUP),
    seed: Number.isFinite(o.seed) ? (o.seed as number) >>> 0 : 73021,
  };
}
export interface Controls {
  throttle: number;
  brake: number;
  clutch: number;
  manualClutch: boolean;
  steer: number;
  shift: number;
  ers: 0 | 1 | 2;
  pit: boolean;
  reverse: boolean;
  /** Edge: open the DRS flap if race control makes it available. */
  drs?: boolean;
  /** Edge: start the 4 s ERS overtake boost. */
  overtake?: boolean;
}
export const controls = (): Controls => ({
  throttle: 0,
  brake: 0,
  clutch: 0,
  manualClutch: false,
  steer: 0,
  shift: 0,
  ers: 1,
  pit: false,
  reverse: false,
});
export const DRIVERS = [
  'YOU',
  'A. MOREAU',
  'K. SATO',
  'M. VEGA',
  'N. LIND',
  'R. SILVA',
  'J. COLE',
  'E. PARK',
  'L. ROSSI',
  'S. KAYA',
  'D. BELL',
  'T. AZIZ',
];
/** Saturated team bases (ART_BIBLE_A §6.1); secondaries, accents, finishes and
 * sponsors per team live in rendering/car-livery.ts (LIVERY_SCHEMES). */
export const LIVERIES = [
  0xb3121e, 0xf27c1e, 0x0b5e4f, 0x13235e, 0xe9e9eb, 0x1c5bd8, 0xe36fa8, 0x16181b, 0x2bb3a0,
  0x9ea4aa, 0x7fc241, 0xf2c200,
];
