import type { Championship, RoundSpec } from '../core/championship.ts';
import type { WeatherPreset } from '../simulation/config.ts';
import type { EventDefinition } from '../simulation/events.ts';
import { LICENCE_TESTS, medalAtLeast, type LicenceId, type Medal } from './licences.ts';
import {
  DISCIPLINES,
  DISCIPLINE_IDS,
  disciplineStatus,
  disciplineVehicles,
  rulesetsFor,
  surveyedJumps,
  vehicleDiscipline,
  venueAdmits,
  type CareerRegistry,
  type CareerVehicle,
  type CareerVenue,
  type DisciplineId,
} from './registry.ts';

/** A rung on a discipline's ladder (GAME_DESIGN §3): licences, then
 * invitational events, then a championship. Tiers name vehicle classes, so a
 * newly registered car of a listed class appears in its tier; a class no
 * tier names joins its discipline's open tier automatically. */
export interface TierDefinition {
  id: string;
  discipline: DisciplineId;
  name: string;
  classes: readonly string[];
  licences: readonly { id: LicenceId; medal: Medal }[];
  /** Discipline reputation needed for invitationals / the championship. */
  reputation: number;
  championshipReputation: number;
  /** Multiplies the race payment lines (higher tiers pay more). */
  payScale: number;
  laps: number;
}
const tier = (t: TierDefinition) => Object.freeze(t);
export const TIERS: readonly TierDefinition[] = Object.freeze([
  tier({
    id: 'club',
    discipline: 'circuit-cars',
    name: 'Club and touring',
    classes: ['kart', 'club', 'vintage', 'touring'],
    licences: [{ id: 'braking', medal: 'bronze' }],
    reputation: 0,
    championshipReputation: 6,
    payScale: 0.5,
    laps: 3,
  }),
  tier({
    id: 'gt',
    discipline: 'circuit-cars',
    name: 'Grand touring',
    classes: ['gt-sport', 'gt'],
    licences: [
      { id: 'braking', medal: 'bronze' },
      { id: 'cornering', medal: 'bronze' },
    ],
    reputation: 18,
    championshipReputation: 26,
    payScale: 0.75,
    laps: 4,
  }),
  tier({
    id: 'formula',
    discipline: 'circuit-cars',
    name: 'Formula ladder',
    classes: [
      'formula-entry',
      'formula-feeder',
      'formula-junior',
      'historic',
      'historic-aero',
      'historic-turbo',
      'formula',
    ],
    licences: [
      { id: 'braking', medal: 'silver' },
      { id: 'cornering', medal: 'bronze' },
      { id: 'wet', medal: 'bronze' },
    ],
    reputation: 30,
    championshipReputation: 42,
    payScale: 1,
    laps: 5,
  }),
  tier({
    id: 'endurance',
    discipline: 'circuit-cars',
    name: 'Endurance prototypes',
    classes: ['historic-prototype', 'prototype', 'hypercar'],
    licences: [
      { id: 'cornering', medal: 'silver' },
      { id: 'wet', medal: 'silver' },
    ],
    reputation: 55,
    championshipReputation: 65,
    payScale: 1.25,
    laps: 6,
  }),
  tier({
    id: 'experimental',
    discipline: 'circuit-cars',
    name: 'Unlimited experimental',
    classes: ['experimental'],
    licences: [
      { id: 'braking', medal: 'gold' },
      { id: 'cornering', medal: 'silver' },
      { id: 'wet', medal: 'silver' },
    ],
    reputation: 70,
    championshipReputation: 80,
    payScale: 1.4,
    laps: 4,
  }),
  tier({
    id: 'superbike',
    discipline: 'road-bikes',
    name: 'Superbike',
    classes: ['supersport', 'classic-bike', 'superbike'],
    licences: [{ id: 'lean', medal: 'bronze' }],
    reputation: 0,
    championshipReputation: 8,
    payScale: 0.6,
    laps: 3,
  }),
  tier({
    id: 'gp-bike',
    discipline: 'road-bikes',
    name: 'GP prototype',
    classes: ['gp-bike', 'gp-prototype'],
    licences: [{ id: 'lean', medal: 'silver' }],
    reputation: 30,
    championshipReputation: 42,
    payScale: 1,
    laps: 4,
  }),
  tier({
    id: 'motocross',
    discipline: 'off-road',
    name: 'Motocross and supercross',
    classes: ['motocross', 'supercross', 'supermoto', 'dirt-bike'],
    licences: [{ id: 'jump', medal: 'bronze' }],
    reputation: 0,
    championshipReputation: 8,
    payScale: 0.6,
    laps: 4,
  }),
  tier({
    id: 'rallycross',
    discipline: 'off-road',
    name: 'Rallycross',
    classes: ['rallycross'],
    licences: [{ id: 'jump', medal: 'bronze' }],
    reputation: 10,
    championshipReputation: 20,
    payScale: 0.8,
    laps: 4,
  }),
  tier({
    id: 'rally',
    discipline: 'off-road',
    name: 'Rally and trophy trucks',
    classes: ['rally', 'historic-rally', 'offroad', 'off-road', 'trophy-truck', 'enduro'],
    licences: [{ id: 'jump', medal: 'silver' }],
    reputation: 25,
    championshipReputation: 40,
    payScale: 1,
    laps: 3,
  }),
  tier({
    id: 'festival-road',
    discipline: 'festival',
    name: 'Festival road series',
    classes: ['road', 'supercar', 'electric-hypercar', 'road-car', 'road-bike'],
    licences: [],
    reputation: 0,
    championshipReputation: 10,
    payScale: 0.7,
    laps: 2,
  }),
]);
/** The ladder of a discipline: authored tiers plus an open tier holding any
 * registered class that no authored tier names. */
export function disciplineTiers(registry: CareerRegistry, discipline: DisciplineId) {
  const authored = TIERS.filter((t) => t.discipline === discipline);
  const named = new Set(authored.flatMap((t) => t.classes));
  const extra = [
    ...new Set(
      disciplineVehicles(registry, discipline)
        .map((v) => v.classId)
        .filter((c) => !named.has(c)),
    ),
  ];
  if (!extra.length) return authored;
  const top = authored.at(-1);
  return [
    ...authored,
    Object.freeze<TierDefinition>({
      id: `${discipline}-open`,
      discipline,
      name: `Open ${DISCIPLINES[discipline].name.toLowerCase()}`,
      classes: extra,
      licences: authored[0]?.licences ?? [],
      reputation: top ? Math.round(top.reputation / 2) : 0,
      championshipReputation: top ? Math.round(top.championshipReputation / 2) : 10,
      payScale: 0.8,
      laps: 3,
    }),
  ];
}
export function allTiers(registry: CareerRegistry) {
  return DISCIPLINE_IDS.flatMap((d) => disciplineTiers(registry, d));
}
export function tierOf(registry: CareerRegistry, vehicle: CareerVehicle) {
  return disciplineTiers(registry, vehicleDiscipline(vehicle)).find((t) =>
    t.classes.includes(vehicle.classId),
  );
}
export function tierVehicles(registry: CareerRegistry, tier: TierDefinition) {
  return registry.vehicles.filter(
    (v) => vehicleDiscipline(v) === tier.discipline && tier.classes.includes(v.classId),
  );
}

/** Credits per class (GAME_DESIGN §4: prices follow class, not raw power).
 * A class without an entry is priced from its tier's position on the ladder. */
export const CLASS_PRICES: Readonly<Record<string, number>> = Object.freeze({
  kart: 14000,
  club: 22000,
  touring: 30000,
  'gt-sport': 48000,
  gt: 72000,
  'formula-junior': 64000,
  historic: 85000,
  formula: 125000,
  prototype: 160000,
  hypercar: 210000,
  superbike: 42000,
  'gp-bike': 115000,
  motocross: 18000,
  supermoto: 21000,
  rallycross: 52000,
  rally: 60000,
  offroad: 75000,
  road: 90000,
  // Catalogue growth: priced by class, between their neighbours on the ladder.
  'formula-entry': 38000,
  'formula-feeder': 52000,
  'historic-aero': 110000,
  'historic-turbo': 140000,
  'historic-prototype': 180000,
  vintage: 26000,
  'historic-rally': 68000,
  experimental: 260000,
  supersport: 30000,
  'classic-bike': 36000,
  'road-bike': 16000,
});
export function vehiclePrice(registry: CareerRegistry, vehicle: CareerVehicle) {
  if (Object.hasOwn(CLASS_PRICES, vehicle.classId)) return CLASS_PRICES[vehicle.classId];
  const tiers = disciplineTiers(registry, vehicleDiscipline(vehicle));
  const index = Math.max(
    0,
    tiers.findIndex((t) => t.classes.includes(vehicle.classId)),
  );
  return 30000 * (index + 1);
}
/** The machine a discipline lends for licences and the recovery series: the
 * cheapest registered vehicle of its lowest tier that has one. */
export function loanerVehicle(registry: CareerRegistry, discipline: DisciplineId) {
  for (const t of disciplineTiers(registry, discipline)) {
    const machines = tierVehicles(registry, t).filter(
      (v) => rulesetsFor(registry, v.classId, 'race').length,
    );
    if (machines.length)
      return [...machines].sort(
        (a, b) => vehiclePrice(registry, a) - vehiclePrice(registry, b) || a.id.localeCompare(b.id),
      )[0];
  }
  return null;
}

/** What the unlock logic reads from a save (kept structural for tests). */
export interface ProgressView {
  credits: number;
  reputation: Readonly<Record<DisciplineId, number>>;
  licences: Readonly<Partial<Record<LicenceId, { medal: Medal | null }>>>;
  owned: readonly { id: string }[];
  active: Readonly<Partial<Record<DisciplineId, string>>>;
  /** Seasons in progress: a season keeps its calendar and its machine. */
  championships?: Readonly<Record<string, { vehicle: string; season: Championship }>>;
}
export function licenceMissing(view: ProgressView, t: TierDefinition) {
  return t.licences
    .filter((need) => !medalAtLeast(view.licences[need.id]?.medal, need.medal))
    .map((need) => `${LICENCE_TESTS[need.id].name} licence (${need.medal})`);
}
/** The owned vehicle the player races in a tier: the discipline's active
 * vehicle when it belongs to the tier, else the first owned one that does. */
export function tierEntry(registry: CareerRegistry, view: ProgressView, t: TierDefinition) {
  const eligible = tierVehicles(registry, t).filter((v) => view.owned.some((o) => o.id === v.id));
  const active = view.active[t.discipline];
  return eligible.find((v) => v.id === active) ?? eligible[0] ?? null;
}
export type EventKind = 'recovery' | 'invitational' | 'championship';
export interface Objective {
  id: 'top' | 'gain' | 'clean-lap';
  label: string;
  amount: number;
  /** Finish at or above this position ('top'), gain this many places ('gain'). */
  value: number;
}
export interface CareerEvent {
  key: string;
  kind: EventKind;
  discipline: DisciplineId;
  tier: string;
  name: string;
  description: string;
  status: 'open' | 'locked' | 'coming';
  reasons: string[];
  /** Built with the player's vehicle in slot 0 when open. */
  definition: EventDefinition | null;
  /** Player starts from this grid slot (0-based) in an 8-car field. */
  startSlot: number;
  objectives: Objective[];
  /** Pay multiplier: tier scale, halved again for the recovery series. */
  stakes: number;
  vehicle: string | null;
  loaner: boolean;
  /** Championship only: the season's calendar and the round raced next. */
  calendar: readonly RoundSpec[];
  round: number;
}
/** Why a machine cannot be bought: its discipline or class cannot race in
 * this build, so credits spent on it would buy nothing usable. */
export function purchaseReasons(registry: CareerRegistry, vehicle: CareerVehicle): string[] {
  const status = disciplineStatus(registry, vehicleDiscipline(vehicle));
  if (status.state !== 'open') return status.reasons;
  return rulesetsFor(registry, vehicle.classId, 'race').length
    ? []
    : [`No race ruleset admits ${vehicle.classId} yet.`];
}
/** Championship prize: the cheapest machine of a higher tier the player does
 * not own and can race in this build (a machine still waiting for its race
 * ruleset or discipline is never awarded). */
export function championshipPrize(
  registry: CareerRegistry,
  discipline: DisciplineId,
  tierId: string,
  owned: readonly { id: string }[],
): string | null {
  const tiers = disciplineTiers(registry, discipline),
    index = tiers.findIndex((t) => t.id === tierId);
  for (const t of tiers.slice(index + 1)) {
    const prize = tierVehicles(registry, t)
      .filter((v) => !owned.some((o) => o.id === v.id) && !purchaseReasons(registry, v).length)
      .sort((a, b) => vehiclePrice(registry, a) - vehiclePrice(registry, b))[0];
    if (prize) return prize.id;
  }
  return null;
}
const seedOf = (text: string) => {
  let h = 2166136261;
  for (let i = 0; i < text.length; i++) h = Math.imul(h ^ text.charCodeAt(i), 16777619);
  return ((h >>> 0) % 900000) + 1000;
};
/** A field for `player`: rivals are other registered machines of its class,
 * cycling, so a class with one model races identical cars. */
function field(registry: CareerRegistry, player: CareerVehicle, cars: number) {
  const rivals = registry.vehicles.filter((v) => v.classId === player.classId);
  const others = rivals.filter((v) => v.id !== player.id);
  const pool = others.length ? others : rivals;
  return [player.id, ...Array.from({ length: cars - 1 }, (_, i) => pool[i % pool.length].id)];
}
const allowedCompound = (allowed: readonly string[], weather: WeatherPreset) =>
  (weather === 'rain' && allowed.includes('wet')
    ? 'wet'
    : allowed.includes('medium')
      ? 'medium'
      : allowed[0]) as EventDefinition['compound'];
/** Does a venue admit a machine class? (Terrain venues name theirs.) */
export function venueTakes(venue: { classes?: readonly string[] }, classId: string) {
  return !venue.classes || venue.classes.includes(classId);
}
/** Rulesets for a class at a venue: one with a format only where the venue
 * is built for it, and the venue's own formats first. */
function venueRulesets(
  registry: CareerRegistry,
  classId: string,
  mode: string,
  venue: CareerVenue | undefined,
) {
  const formats = venue?.formats ?? [];
  return rulesetsFor(registry, classId, mode)
    .filter((r) => !r.format || formats.includes(r.format.kind))
    .sort((a, b) => Number(!!b.format) - Number(!!a.format));
}
/** Build an event definition for `player` at a venue; null with a reason
 * when no ruleset can run it. */
export function buildEvent(
  registry: CareerRegistry,
  spec: {
    id: string;
    name: string;
    venue: string;
    player: CareerVehicle;
    mode: 'race' | 'practice';
    laps: number;
    cars: number;
    weather: WeatherPreset;
  },
): { definition: EventDefinition | null; reason: string | null } {
  const venue = registry.venues.find((v) => v.id === spec.venue);
  if (venue && !venueTakes(venue, spec.player.classId))
    return {
      definition: null,
      reason: `${venue.short ?? venue.name} does not admit ${spec.player.classId} machines.`,
    };
  const rules =
    venueRulesets(registry, spec.player.classId, spec.mode, venue)[0] ??
    // A solo licence session may run under a race ruleset when no practice one admits the class.
    (spec.mode === 'practice'
      ? venueRulesets(registry, spec.player.classId, 'race', venue)[0]
      : undefined);
  if (!rules)
    return { definition: null, reason: `No ${spec.mode} ruleset admits ${spec.player.classId}.` };
  const mode = rules.sessions.includes(spec.mode) ? spec.mode : 'race';
  return {
    reason: null,
    definition: Object.freeze({
      id: spec.id,
      version: 1,
      name: spec.name,
      circuit: spec.venue as EventDefinition['circuit'],
      mode,
      ruleset: rules.id,
      laps: spec.laps,
      opponents: spec.cars - 1,
      weather: spec.weather,
      vehicles: field(registry, spec.player, spec.cars),
      compound: allowedCompound(rules.tires.allowed, spec.weather),
      seed: seedOf(spec.id),
    }),
  };
}
/** Spread `count` venues across the registry deterministically per tier. */
export function tierVenues<T>(venues: readonly T[], tierIndex: number, count: number) {
  if (venues.length <= count) return [...venues];
  const step = venues.length / count;
  return Array.from(
    { length: count },
    (_, i) => venues[Math.floor(tierIndex + i * step) % venues.length],
  );
}
export const INVITATIONALS_PER_TIER = 6;
export const CHAMPIONSHIP_ROUNDS = { min: 4, max: 6 } as const;
const WEATHER_CYCLE: readonly WeatherPreset[] = ['clear', 'changeable', 'clear', 'rain'];
/** Every event the career offers in a discipline, open or with the exact
 * reasons it is locked or coming. The recovery series comes first and is
 * open whenever the discipline has content, whatever the player owns. */
export function disciplineEvents(
  registry: CareerRegistry,
  view: ProgressView,
  discipline: DisciplineId,
): CareerEvent[] {
  const status = disciplineStatus(registry, discipline);
  const events: CareerEvent[] = [];
  const venues = status.venues;
  const loaner = loanerVehicle(registry, discipline);
  const tiers = disciplineTiers(registry, discipline);
  // Recovery: reduced stakes, loaned machine, no requirements.
  {
    const venue =
      (loaner
        ? venues.find((v) => venueTakes(v, loaner.classId) && venueAdmits(v, loaner))
        : undefined) ?? venues[0];
    const built =
      loaner && venue
        ? buildEvent(registry, {
            id: `career-${discipline}-recovery`,
            name: `${DISCIPLINES[discipline].short} CLUB MEETING`,
            venue: venue.id,
            player: loaner,
            mode: 'race',
            laps: 2,
            cars: 4,
            weather: 'clear',
          })
        : { definition: null, reason: null };
    const reasons = [...status.reasons, ...(built.reason ? [built.reason] : [])];
    events.push({
      key: `${discipline}.recovery`,
      kind: 'recovery',
      discipline,
      tier: tiers[0]?.id ?? discipline,
      name: `${DISCIPLINES[discipline].short} CLUB MEETING`,
      description:
        'Reduced-stakes club meeting on a loaned machine. No licence, reputation or ownership needed; pays a quarter of the full rate so a driver with no credits can always rebuild.',
      status: reasons.length || !built.definition ? 'coming' : 'open',
      reasons,
      definition: built.definition,
      startSlot: 2,
      objectives: [],
      stakes: 0.25,
      vehicle: loaner?.id ?? null,
      loaner: true,
      calendar: [],
      round: -1,
    });
  }
  tiers.forEach((t, tierIndex) => {
    const machines = tierVehicles(registry, t);
    // Generated events run where the tier's classes are admitted (terrain
    // venues name theirs) and every machine of the tier is cleared to race
    // (a motorcycle class rides only the circuits it has passed).
    const tierVenueList = venues.filter(
      (v) => t.classes.some((c) => venueTakes(v, c)) && machines.every((m) => venueAdmits(v, m)),
    );
    const coming = [...status.reasons];
    if (!machines.length) coming.push(`No ${t.classes.join(' / ')} machine is registered yet.`);
    else if (!machines.some((m) => rulesetsFor(registry, m.classId, 'race').length))
      coming.push(
        `No race ruleset admits ${[...new Set(machines.map((m) => m.classId))].join(' / ')} yet.`,
      );
    const entry = tierEntry(registry, view, t);
    const locked = [...licenceMissing(view, t)];
    const rep = view.reputation[discipline] ?? 0;
    if (rep < t.reputation)
      locked.push(
        `${t.reputation} ${DISCIPLINES[discipline].short.toLowerCase()} reputation (you have ${rep})`,
      );
    if (!entry && machines.length)
      locked.push(
        `an owned ${t.classes.filter((c) => machines.some((m) => m.classId === c)).join(' / ')} machine (see Dealership)`,
      );
    const add = (
      key: string,
      kind: EventKind,
      name: string,
      description: string,
      make: (player: CareerVehicle) => ReturnType<typeof buildEvent>,
      extraLocks: string[] = [],
      season?: { entry: CareerVehicle | null; calendar: readonly RoundSpec[]; round: number },
    ) => {
      const machine = season ? season.entry : entry;
      const built = machine ? make(machine) : { definition: null, reason: null };
      const reasons = coming.length
        ? coming
        : [...locked, ...extraLocks, ...(built.reason ? [built.reason] : [])];
      events.push({
        key,
        kind,
        discipline,
        tier: t.id,
        name,
        description,
        status: coming.length ? 'coming' : reasons.length ? 'locked' : 'open',
        reasons,
        definition: reasons.length ? null : built.definition,
        startSlot: 4,
        objectives:
          kind === 'championship'
            ? []
            : [
                { id: 'top', label: 'Finish on the podium', amount: 2500, value: 3 },
                {
                  id: 'gain',
                  label: 'Gain two places from your grid slot',
                  amount: 1500,
                  value: 2,
                },
              ],
        stakes: t.payScale,
        vehicle: machine?.id ?? null,
        loaner: false,
        calendar: season?.calendar ?? [],
        round: season?.round ?? -1,
      });
    };
    // Authored events (events.ts) with an entrant of this tier's classes. A
    // grid of several classes (per-class scoring, multi-class racing) is
    // filed under every tier it has entrants in and admits each of them: the
    // player takes the place of the first entrant of their own class.
    for (const e of registry.events) {
      const ids = typeof e.vehicles === 'string' ? [e.vehicles] : e.vehicles;
      const entrants = ids.map((id) => registry.vehicles.find((v) => v.id === id));
      const classes = [
        ...new Set(
          entrants
            .filter((m): m is CareerVehicle => !!m && vehicleDiscipline(m) === discipline)
            .map((m) => m.classId)
            .filter((c) => t.classes.includes(c)),
        ),
      ];
      if (!classes.length) continue;
      if (!venues.some((v) => v.id === e.circuit)) continue;
      add(
        `${discipline}.${t.id}.event.${e.id}`,
        'invitational',
        e.name,
        'Authored event with its own rules, raced in your machine.',
        (player) => {
          const slot = entrants.findIndex((m) => m?.classId === player.classId);
          if (slot < 0)
            return {
              definition: null,
              reason: `${e.name} is for ${classes.join(' / ')} machines.`,
            };
          const vehicles =
            typeof e.vehicles === 'string'
              ? [player.id, ...Array.from({ length: e.opponents }, () => e.vehicles as string)]
              : [player.id, ...e.vehicles.filter((_, i) => i !== slot)];
          return { definition: Object.freeze({ ...e, vehicles }), reason: null };
        },
      );
    }
    // Generated invitationals on venues spread across the registry.
    tierVenues(tierVenueList, tierIndex, INVITATIONALS_PER_TIER).forEach((venue, i) => {
      const weather = WEATHER_CYCLE[(tierIndex + i) % 2];
      add(
        `${discipline}.${t.id}.inv.${venue.id}`,
        'invitational',
        `${venue.short} ${t.name.toUpperCase()} INVITATIONAL`,
        `${t.laps} laps at ${venue.name}, ${weather === 'clear' ? 'dry' : 'rain expected'}. Eight cars of your class; you start fifth.`,
        (player) =>
          buildEvent(registry, {
            id: `career-${t.id}-${venue.id}`,
            name: `${venue.short} ${t.name.toUpperCase()} INVITATIONAL`,
            venue: venue.id,
            player,
            mode: 'race',
            laps: t.laps,
            cars: 8,
            weather,
          }),
      );
    });
    // The tier championship: a calendar across the registry's venues. A
    // season in progress keeps its own calendar and the machine it started
    // in, so changing the active machine never restarts it.
    if (tierVenueList.length) {
      const key = `${discipline}.${t.id}.championship`;
      const saved = view.championships?.[key];
      const running =
        saved && saved.season.results.length < saved.season.rounds.length ? saved : null;
      const calendar = running
        ? running.season.rounds
        : championshipCalendar(tierVenueList, tierIndex, t);
      const round = running ? running.season.results.length : 0;
      const spec = calendar[round];
      const extra =
        rep < t.championshipReputation
          ? [`${t.championshipReputation} reputation for the championship (you have ${rep})`]
          : [];
      // A season with rounds recorded races in its own machine; an empty one
      // (started, nothing raced) takes the current tier machine.
      let seasonEntry: CareerVehicle | null = entry;
      if (running && running.season.results.length) {
        const machine = machines.find((m) => m.id === running.vehicle) ?? null;
        const owned = view.owned.some((o) => o.id === running.vehicle);
        seasonEntry = machine && owned ? machine : null;
        if (!seasonEntry)
          extra.push(
            `your season machine, the ${machine?.name ?? running.vehicle}, which is ${machine ? 'not in your garage' : 'not in this build'} (abandon the season to start again)`,
          );
      }
      if (!venues.some((v) => v.id === spec.circuit))
        extra.push(`round ${round + 1} venue ${spec.circuit}, which is not in this build`);
      else if (seasonEntry && !venueAdmits(venues.find((v) => v.id === spec.circuit)!, seasonEntry))
        extra.push(
          `round ${round + 1} venue ${spec.circuit}, where your ${seasonEntry.name} class is not cleared to race`,
        );
      add(
        key,
        'championship',
        `${t.name.toUpperCase()} CHAMPIONSHIP`,
        `A season scored 25-18-15-12-10-8-6-4-2-1 across ${calendar.length} rounds.`,
        (player) =>
          buildEvent(registry, {
            id: `career-${t.id}-championship-r${round + 1}`,
            name: `${t.name.toUpperCase()} CHAMPIONSHIP · ROUND ${round + 1}`,
            venue: spec.circuit,
            player,
            mode: 'race',
            laps: spec.laps,
            cars: running?.season.cars ?? 8,
            weather: spec.weather,
          }),
        extra,
        { entry: seasonEntry, calendar, round },
      );
    }
  });
  return events;
}
export function championshipCalendar<T extends { id: string }>(
  venues: readonly T[],
  tierIndex: number,
  t: TierDefinition,
): RoundSpec[] {
  const chosen = tierVenues(venues, tierIndex, CHAMPIONSHIP_ROUNDS.max);
  const rounds = Math.max(CHAMPIONSHIP_ROUNDS.min, chosen.length);
  return Array.from({ length: Math.min(rounds, CHAMPIONSHIP_ROUNDS.max) }, (_, i) => ({
    circuit: chosen[i % chosen.length].id as RoundSpec['circuit'],
    weather: WEATHER_CYCLE[i % WEATHER_CYCLE.length],
    laps: Math.min(10, t.laps),
  }));
}
export interface LicenceAvailability {
  test: LicenceId;
  status: 'open' | 'coming';
  reasons: string[];
  /** The venue and the machine the test runs with (owned active, else loaner). */
  venue: string | null;
  vehicle: string | null;
  loaner: boolean;
  definition: EventDefinition | null;
}
/** Whether a licence test can run now, and with what. Coming states name
 * the missing content or snapshot channel. */
export function licenceAvailability(
  registry: CareerRegistry,
  view: ProgressView,
  id: LicenceId,
): LicenceAvailability {
  const test = LICENCE_TESTS[id],
    status = disciplineStatus(registry, test.discipline),
    reasons = [...status.reasons];
  const missing = test.channels.filter((c) => !registry.channels.includes(c));
  if (missing.length)
    reasons.push(`The session snapshot does not publish ${missing.join(', ')} yet.`);
  const owned = disciplineVehicles(registry, test.discipline).filter((v) =>
    view.owned.some((o) => o.id === v.id),
  );
  const active = view.active[test.discipline];
  const mine = owned.find((v) => v.id === active) ?? owned[0] ?? null;
  const machine = mine ?? loanerVehicle(registry, test.discipline);
  // A venue that suits the test and admits the machine (else any that suits).
  const suits = (v: CareerVenue) => test.needs !== 'jump' || surveyedJumps(v).length > 0;
  const venue =
    status.venues.find((v) => suits(v) && (!machine || venueTakes(v, machine.classId))) ??
    status.venues.find(suits);
  if (!venue && test.needs === 'jump' && status.venues.length)
    reasons.push(
      'No venue declares a surveyed jump (take-off, landing position and landing slope) yet.',
    );
  let definition: EventDefinition | null = null;
  if (!reasons.length && machine && venue) {
    const built = buildEvent(registry, {
      id: `licence-${id}`,
      name: `${test.name.toUpperCase()} LICENCE`,
      venue: venue.id,
      player: machine,
      mode: 'practice',
      laps: 10,
      cars: 1,
      weather: test.weather,
    });
    if (built.reason) reasons.push(built.reason);
    definition = built.definition;
  }
  return {
    test: id,
    status: reasons.length || !definition ? 'coming' : 'open',
    reasons,
    venue: venue?.id ?? null,
    vehicle: machine?.id ?? null,
    loaner: !mine,
    definition: reasons.length ? null : definition,
  };
}
/** The event a broke player can always enter, or null when the discipline
 * has no content at all. */
export function recoveryEvent(
  registry: CareerRegistry,
  view: ProgressView,
  discipline: DisciplineId,
) {
  const event = disciplineEvents(registry, view, discipline).find((e) => e.kind === 'recovery');
  return event?.status === 'open' ? event : null;
}
