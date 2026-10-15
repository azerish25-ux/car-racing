import { CIRCUITS, CIRCUIT_IDS } from '../simulation/circuits.ts';
import { EVENTS, RULESETS, type EventDefinition } from '../simulation/events.ts';
import * as protocol from '../simulation/protocol.ts';
import { VEHICLES, VEHICLE_IDS, type VehicleDefinition } from '../simulation/vehicles.ts';

/** What the career reads from the content registries (GAME_DESIGN §2–§4).
 * Everything the career shows is derived from these lists, so a vehicle,
 * circuit, ruleset or snapshot channel added elsewhere appears without a
 * career change, and a discipline with no content says so instead of
 * pretending. Tests pass synthetic registries through the same functions. */
export interface CareerVehicle {
  id: string;
  name: string;
  classId: string;
  /** 'four-wheel' today; motorcycles add their own adapter kind. */
  dynamicsKind: string;
  /** Optional explicit machine family; otherwise derived from dynamics and class. */
  family?: string;
  setupKeys: readonly string[];
  /** Straight-line target (m/s) and lateral grip (m/s²) from the AI envelope:
   * the licence pace gates are fractions of what the machine can do. */
  ai?: { topSpeed: number; lateralBase: number };
}
export interface CareerVenue {
  id: string;
  name: string;
  short: string;
  corners: readonly { s: number; name: string }[];
  /** Optional venue metadata other content may declare. */
  bikeSafe?: boolean;
  surface?: string;
  venueKind?: string;
  catalogue?: { group?: string; bikeSafe?: boolean };
  /** Surveyed jumps (off-road venues), for the landing licence. Read through
   * `surveyedJumps`, which keeps only entries that declare the geometry. */
  jumps?: readonly unknown[];
}
/** A jump the landing licence can score: where it is and the slope of its
 * landing face. Lap distances in m; `landingPitch` is the landing face's
 * pitch along the direction of travel in rad (nose-up +, so a downslope
 * landing is negative), the same convention as the snapshot pitch. */
export interface SurveyedJump {
  name: string;
  takeoff: number;
  landing: number;
  /** Length of the landing zone along the lap (m), centred on `landing`. */
  landingLength: number;
  landingPitch: number;
}
const finiteNumber = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);
/** The jumps of a venue that declare take-off, landing and landing slope.
 * Anything else (a bare marker, a crest without a survey) is ignored, so the
 * landing licence never scores against a slope nobody measured. */
export function surveyedJumps(venue: { jumps?: readonly unknown[] }): SurveyedJump[] {
  if (!Array.isArray(venue.jumps)) return [];
  return venue.jumps.flatMap((raw, i) => {
    if (!raw || typeof raw !== 'object') return [];
    const j = raw as Record<string, unknown>;
    if (!finiteNumber(j.takeoff) || !finiteNumber(j.landing) || !finiteNumber(j.landingPitch))
      return [];
    if (j.takeoff < 0 || j.landing < 0 || Math.abs(j.landingPitch) > Math.PI / 4) return [];
    const landingLength =
      finiteNumber(j.landingLength) && j.landingLength >= 4 && j.landingLength <= 200
        ? j.landingLength
        : 40;
    return [
      {
        name: typeof j.name === 'string' && j.name ? j.name.slice(0, 40) : `JUMP ${i + 1}`,
        takeoff: j.takeoff,
        landing: j.landing,
        landingLength,
        landingPitch: j.landingPitch,
      },
    ];
  });
}
export interface CareerRuleset {
  id: string;
  name: string;
  sessions: readonly string[];
  allowedClasses: readonly string[];
  tires: { allowed: readonly string[] };
  classification: string;
  points: readonly number[];
}
export interface CareerRegistry {
  vehicles: readonly CareerVehicle[];
  venues: readonly CareerVenue[];
  rulesets: readonly CareerRuleset[];
  events: readonly EventDefinition[];
  /** Snapshot channels a licence can measure (see `snapshotChannels`). */
  channels: readonly string[];
}
/** Channels in the live snapshot protocol. Car channels are the F block;
 * a two-wheel block (lean) is detected by name when the protocol exports it,
 * so the lean licence opens the day the motorcycle slice publishes it. */
export function snapshotChannels(module: Record<string, unknown> = protocol): string[] {
  const channels = new Set<string>();
  const f = module.F as Record<string, number> | undefined;
  if (f) {
    for (const key of Object.keys(f)) channels.add(key);
    // Derived channels computed from existing fields.
    if ('QX' in f && 'VX' in f) channels.add('SIDESLIP').add('PITCH');
  }
  const b = module.B as Record<string, number> | undefined;
  if (b && typeof module.BIKE_BASE === 'number' && 'LEAN' in b) channels.add('LEAN');
  if (typeof module.WHEEL_BASE === 'number' && module.W && 'LOAD' in (module.W as object))
    channels.add('AIRBORNE');
  return [...channels];
}
export function liveRegistry(): CareerRegistry {
  return {
    vehicles: VEHICLE_IDS.map((id) => VEHICLES[id] as VehicleDefinition),
    venues: CIRCUIT_IDS.map((id) => CIRCUITS[id] as CareerVenue),
    rulesets: Object.values(RULESETS),
    events: EVENTS,
    channels: snapshotChannels(),
  };
}

export const DISCIPLINE_IDS = ['circuit-cars', 'road-bikes', 'off-road', 'festival'] as const;
export type DisciplineId = (typeof DISCIPLINE_IDS)[number];
export type MachineFamily = 'car' | 'bike' | 'off-road' | 'road';
export type VenueKind = 'circuit' | 'dirt' | 'festival';
/** Classes that belong to loose-surface disciplines, and road (festival)
 * machines. Any other class is a circuit car by default. */
const OFF_ROAD_CLASSES = new Set([
  'rally',
  'historic-rally',
  'rallycross',
  'offroad',
  'off-road',
  'trophy-truck',
  'motocross',
  'supercross',
  'dirt-bike',
  'enduro',
]);
const ROAD_CLASSES = new Set(['road', 'supercar', 'electric-hypercar', 'road-car']);
const FAMILY_ALIASES: Readonly<Record<string, MachineFamily>> = Object.freeze({
  car: 'car',
  'circuit-car': 'car',
  'four-wheel': 'car',
  bike: 'bike',
  motorcycle: 'bike',
  'road-bike': 'bike',
  'off-road': 'off-road',
  dirt: 'off-road',
  'dirt-bike': 'off-road',
  road: 'road',
  festival: 'road',
});
/** Machine family from registry fields: an explicit `family` wins, then the
 * dynamics adapter (two-wheel), then the class. */
export function vehicleFamily(vehicle: CareerVehicle): MachineFamily {
  if (typeof vehicle.family === 'string' && Object.hasOwn(FAMILY_ALIASES, vehicle.family))
    return FAMILY_ALIASES[vehicle.family];
  const twoWheel = /bike|two-wheel|motorcycle/.test(vehicle.dynamicsKind);
  if (OFF_ROAD_CLASSES.has(vehicle.classId)) return 'off-road';
  if (twoWheel) return 'bike';
  if (ROAD_CLASSES.has(vehicle.classId)) return 'road';
  return 'car';
}
export function venueKind(venue: CareerVenue): VenueKind {
  const declared = [venue.venueKind, venue.surface, venue.catalogue?.group].filter(
    (v): v is string => typeof v === 'string',
  );
  if (declared.some((v) => /dirt|gravel|terrain|off-?road|rallycross|motocross|mixed/.test(v)))
    return 'dirt';
  if (declared.some((v) => /festival|open-?world|region/.test(v))) return 'festival';
  return 'circuit';
}
export interface DisciplineDefinition {
  id: DisciplineId;
  name: string;
  short: string;
  family: MachineFamily;
  venue: VenueKind;
  skill: string;
  /** What the discipline needs from the registries, in plain words. */
  machineNoun: string;
  venueNoun: string;
}
export const DISCIPLINES: Readonly<Record<DisciplineId, DisciplineDefinition>> = Object.freeze({
  'circuit-cars': {
    id: 'circuit-cars',
    name: 'Circuit cars',
    short: 'CIRCUIT',
    family: 'car',
    venue: 'circuit',
    skill: 'Braking points, tyre management and racecraft.',
    machineNoun: 'four-wheel circuit machine',
    venueNoun: 'paved circuit',
  },
  'road-bikes': {
    id: 'road-bikes',
    name: 'Road motorcycles',
    short: 'BIKES',
    family: 'bike',
    venue: 'circuit',
    skill: 'Lean angle, trail braking and the front/rear brake split.',
    machineNoun: 'two-wheel road machine',
    venueNoun: 'bike-safe circuit',
  },
  'off-road': {
    id: 'off-road',
    name: 'Off-road',
    short: 'OFF-ROAD',
    family: 'off-road',
    venue: 'dirt',
    skill: 'Throttle on loose ground, jump take-off and landing, ruts and berms.',
    machineNoun: 'off-road machine (rally, rallycross, motocross or truck)',
    venueNoun: 'dirt or mixed-surface venue',
  },
  festival: {
    id: 'festival',
    name: 'Festival',
    short: 'FESTIVAL',
    family: 'road',
    venue: 'festival',
    skill: 'Exploration, point-to-point, speed traps and drift zones.',
    machineNoun: 'road machine',
    venueNoun: 'open festival region',
  },
});
export function vehicleDiscipline(vehicle: CareerVehicle): DisciplineId {
  const family = vehicleFamily(vehicle);
  return DISCIPLINE_IDS.find((id) => DISCIPLINES[id].family === family) ?? 'circuit-cars';
}
export function disciplineVehicles(registry: CareerRegistry, discipline: DisciplineId) {
  return registry.vehicles.filter((v) => vehicleDiscipline(v) === discipline);
}
const declaresBikeSafety = (v: CareerVenue) =>
  typeof v.bikeSafe === 'boolean' || typeof v.catalogue?.bikeSafe === 'boolean';
const isBikeSafe = (v: CareerVenue) => v.bikeSafe === true || v.catalogue?.bikeSafe === true;
/** Venues a discipline may race at. Road bikes use circuits flagged
 * bike-safe; while no venue declares the flag at all, every paved circuit is
 * admitted and `venueCaveat` says the assessment has not been made. */
export function disciplineVenues(registry: CareerRegistry, discipline: DisciplineId) {
  const def = DISCIPLINES[discipline];
  const kind = registry.venues.filter((v) => venueKind(v) === def.venue);
  if (discipline !== 'road-bikes' || !kind.some(declaresBikeSafety)) return kind;
  return kind.filter(isBikeSafe);
}
export function venueCaveat(registry: CareerRegistry, discipline: DisciplineId): string | null {
  if (discipline !== 'road-bikes') return null;
  return registry.venues.some(declaresBikeSafety)
    ? null
    : 'No circuit has been assessed for bike safety (run-off, kerb profile) yet; bike events use the paved circuits.';
}
/** Rulesets that can run `session` for a vehicle class, most specific first
 * (fewest admitted classes), so a touring car gets the touring rules. */
export function rulesetsFor(registry: CareerRegistry, classId: string, session: string) {
  return registry.rulesets
    .filter((r) => r.sessions.includes(session) && r.allowedClasses.includes(classId))
    .sort((a, b) => a.allowedClasses.length - b.allowedClasses.length || a.id.localeCompare(b.id));
}
export interface DisciplineStatus {
  id: DisciplineId;
  state: 'open' | 'coming';
  /** Every missing piece, derived from the registries. */
  reasons: string[];
  vehicles: CareerVehicle[];
  venues: CareerVenue[];
  caveat: string | null;
}
/** Whether a discipline has the content to run, and if not, exactly what is
 * missing. Never hard-coded: a bike registered with a race ruleset opens the
 * bike career. */
export function disciplineStatus(registry: CareerRegistry, id: DisciplineId): DisciplineStatus {
  const def = DISCIPLINES[id],
    vehicles = disciplineVehicles(registry, id),
    venues = disciplineVenues(registry, id),
    reasons: string[] = [];
  if (!vehicles.length) reasons.push(`No ${def.machineNoun} is registered yet.`);
  if (!venues.length) reasons.push(`No ${def.venueNoun} is registered yet.`);
  if (vehicles.length && !vehicles.some((v) => rulesetsFor(registry, v.classId, 'race').length))
    reasons.push(
      `No race ruleset admits ${[...new Set(vehicles.map((v) => v.classId))].join(', ')} yet.`,
    );
  return {
    id,
    state: reasons.length ? 'coming' : 'open',
    reasons,
    vehicles,
    venues,
    caveat: venueCaveat(registry, id),
  };
}
