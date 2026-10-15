import {
  EVENT_KIND_LABEL,
  FESTIVAL_RESULT_VERSION,
  isRace,
  type FestivalResult,
} from '../simulation/open-world/festival-result.ts';
import type { FestivalEventKind } from '../simulation/open-world/region-data.ts';
import { festivalDefaultVehicle } from '../simulation/open-world/festival-machines.ts';
import { book, markPaid, type Payout, type PayoutLine } from './economy.ts';
import {
  disciplineTiers,
  tierEntry,
  tierOf,
  tierVehicles,
  vehiclePrice,
  type ProgressView,
} from './ladder.ts';
import {
  DISCIPLINES,
  disciplineStatus,
  machineCanRace,
  vehicleDiscipline,
  type CareerFestivalEvent,
  type CareerFestivalRegion,
  type CareerRegistry,
  type CareerVehicle,
} from './registry.ts';
import type { CareerSave, FestivalBest, FestivalRecord } from './save.ts';

/** The festival discipline of the career (GAME_DESIGN §3–§4): the open-world
 * region is the venue, its authored events are the ladder, and the typed
 * `festival-result` the festival dispatches for every finished run is paid
 * here, once per run id. Unlocks are rules over the registry data: an
 * event's kind sets the festival reputation it needs, an event must have
 * been discovered in free roam before the career sends the player to it,
 * and payment needs a festival machine from the garage (or the loaned one,
 * entered from the career). Nothing names an event id. */

/** Unlock and pay rules per event kind (reputation needed, completion pay at
 * stakes 1). An event added to the region data takes its kind's rule. */
export const FESTIVAL_RULES: Readonly<
  Record<FestivalEventKind, { reputation: number; completion: number }>
> = Object.freeze({
  'speed-trap': { reputation: 0, completion: 1200 },
  'speed-zone': { reputation: 0, completion: 1500 },
  'drift-zone': { reputation: 0, completion: 1500 },
  sprint: { reputation: 0, completion: 4000 },
  'road-race': { reputation: 6, completion: 6000 },
  circuit: { reputation: 12, completion: 7000 },
  showcase: { reputation: 20, completion: 5000 },
});
export const FESTIVAL_PAY = Object.freeze({
  /** Per rival beaten in a race. */
  rivalBeaten: 1000,
  /** Per star above your best on the event. */
  star: 1500,
  firstCompletion: 1000,
  personalBest: 600,
  /** Off the route at most this long (s) for the clean line. */
  cleanSeconds: 1,
  clean: 500,
  /** Reputation per new star, and for a first completion. */
  starReputation: 2,
  firstReputation: 1,
});
/** A loaned machine pays at the recovery rate. */
export const FESTIVAL_LOANER_STAKES = 0.25;
/** Discovery radius of the festival (session.ts) for the hint text. */
const DISCOVERY_METRES = 380;

export const festivalKey = (region: string, event: string) => `festival.${region}.${event}`;
export const festivalRoamKey = (region: string) => `festival.${region}.roam`;
export const festivalRunKey = (runId: string) => `festival:${runId}`;

export interface FestivalCareerEvent {
  key: string;
  region: CareerFestivalRegion;
  event: CareerFestivalEvent;
  status: 'open' | 'locked' | 'coming';
  reasons: string[];
  discovered: boolean;
  record: FestivalRecord | null;
  /** The machine the career sends: the active festival machine, else the loaner. */
  vehicle: string | null;
  loaner: boolean;
  stakes: number;
  reputation: number;
}
/** The machine a festival career run uses and its pay rate. */
export function festivalMachine(registry: CareerRegistry, view: ProgressView) {
  const owned = registry.vehicles.filter(
    (v) => vehicleDiscipline(v) === 'festival' && view.owned.some((o) => o.id === v.id),
  );
  const active = owned.find((v) => v.id === view.active.festival) ?? owned[0] ?? null;
  if (active) return { vehicle: active, loaner: false, stakes: stakesFor(registry, active) };
  const loaner = festivalLoaner(registry);
  return { vehicle: loaner, loaner: true, stakes: FESTIVAL_LOANER_STAKES };
}
/** The machine the career lends for the festival, chosen deliberately rather
 * than by price alone (the cheapest festival machine is a road motorcycle):
 * in the lowest festival tier that has a machine, the festival's own default
 * machine (what the festival opens with outside the career), else that
 * tier's cheapest car, else its cheapest machine. */
export function festivalLoaner(registry: CareerRegistry): CareerVehicle | null {
  const byPrice = (a: CareerVehicle, b: CareerVehicle) =>
    vehiclePrice(registry, a) - vehiclePrice(registry, b) || a.id.localeCompare(b.id);
  for (const t of disciplineTiers(registry, 'festival')) {
    const machines = tierVehicles(registry, t).filter((v) => machineCanRace(registry, v));
    if (!machines.length) continue;
    const preferred = machines.find((v) => v.id === festivalDefaultVehicle());
    if (preferred) return preferred;
    const cars = machines.filter((v) => v.dynamicsKind === 'four-wheel');
    return [...(cars.length ? cars : machines)].sort(byPrice)[0];
  }
  return null;
}
const stakesFor = (registry: CareerRegistry, v: CareerVehicle) => tierOf(registry, v)?.payScale ?? 0.7;
/** Every festival event the career lists, with its status and the exact
 * reasons it is locked (reputation, discovery) or coming (no content). */
export function festivalEvents(
  registry: CareerRegistry,
  view: ProgressView & { festival?: CareerSave['festival'] },
  discovered: ReadonlySet<string>,
): FestivalCareerEvent[] {
  const status = disciplineStatus(registry, 'festival'),
    rep = view.reputation.festival ?? 0,
    machine = festivalMachine(registry, view);
  return (registry.festival ?? []).flatMap((region) =>
    region.events.map((event) => {
      const rule = FESTIVAL_RULES[event.kind],
        key = festivalKey(region.id, event.id),
        found = discovered.has(event.id),
        reasons = [...status.reasons];
      const coming = reasons.length > 0;
      if (!coming) {
        if (!machine.vehicle) reasons.push('A festival machine (see Dealership).');
        if (rep < rule.reputation)
          reasons.push(`${rule.reputation} festival reputation (you have ${rep})`);
        if (!found)
          reasons.push(
            `Discover it first: drive within ${DISCOVERY_METRES} m of its marker in free roam.`,
          );
      }
      return {
        key,
        region,
        event,
        status: coming ? 'coming' : reasons.length ? 'locked' : 'open',
        reasons,
        discovered: found,
        record: view.festival?.[key] ?? null,
        vehicle: machine.vehicle?.id ?? null,
        loaner: machine.loaner,
        stakes: machine.stakes,
        reputation: rule.reputation,
      } satisfies FestivalCareerEvent;
    }),
  );
}
const finite = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);
const nullableFinite = (v: unknown) => v === null || finite(v);
const text = (v: unknown, max = 100): v is string =>
  typeof v === 'string' && v.length > 0 && v.length <= max;
/** The typed festival result, or null when the detail is not one this build
 * can trust (wrong kind or version, missing run id, out-of-range numbers).
 * Only the fields the career reads are checked. */
export function validateFestivalResult(value: unknown): FestivalResult | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const r = value as Record<string, unknown>;
  if (r.kind !== 'festival-result' || r.version !== FESTIVAL_RESULT_VERSION) return null;
  if (!text(r.runId) || !text(r.regionId, 64) || !text(r.eventId, 64) || !text(r.vehicleId, 64))
    return null;
  if (typeof r.eventName !== 'string' || !Object.hasOwn(EVENT_KIND_LABEL, String(r.eventKind)))
    return null;
  if (
    typeof r.completed !== 'boolean' ||
    typeof r.abandoned !== 'boolean' ||
    typeof r.assisted !== 'boolean'
  )
    return null;
  if (!Number.isInteger(r.entrants) || (r.entrants as number) < 1 || (r.entrants as number) > 16)
    return null;
  if (
    r.position !== null &&
    (!Number.isInteger(r.position) ||
      (r.position as number) < 1 ||
      (r.position as number) > (r.entrants as number))
  )
    return null;
  if (!Number.isInteger(r.stars) || (r.stars as number) < 0 || (r.stars as number) > 3) return null;
  for (const k of ['time', 'trapKmh', 'averageKmh', 'driftScore'])
    if (!nullableFinite(r[k]) || (finite(r[k]) && (r[k] as number) < 0)) return null;
  if (!finite(r.offRouteSeconds) || (r.offRouteSeconds as number) < 0) return null;
  return value as FestivalResult;
}
const scale = (amount: number, stakes: number) => Math.round((amount * stakes) / 10) * 10;
/** Stars as words: ledger and payment lines are read aloud and logged. */
export const starWords = (n: number) => `${n} of 3 star${n === 1 ? '' : 's'}`;
const none = (reason: string): Payout => ({
  lines: [],
  total: 0,
  reputation: 0,
  paid: false,
  reason,
  awarded: null,
});
/** The measure a skill challenge is scored on (higher is better), if any. */
const measureOf = (r: FestivalResult) => r.trapKmh ?? r.averageKmh ?? r.driftScore ?? null;
/** Festival reputation an event has to give: two per star and one for
 * completing it (seven at most). */
export const eventReputation = (stars: number, completed: boolean) =>
  stars * FESTIVAL_PAY.starReputation + (completed ? FESTIVAL_PAY.firstReputation : 0);
const NO_BEST: FestivalBest = Object.freeze({
  stars: 0,
  bestTime: null,
  bestValue: null,
  bestPosition: null,
  runs: 0,
});
const lower = (a: number | null, b: number | null) => (a === null ? b : b === null ? a : Math.min(a, b));
const higher = (a: number | null, b: number | null) => (a === null ? b : b === null ? a : Math.max(a, b));
/** The better of two records, field by field. */
function bestOf(a: FestivalBest, b: FestivalBest): FestivalBest {
  return {
    stars: Math.max(a.stars, b.stars),
    bestTime: lower(a.bestTime, b.bestTime),
    bestValue: higher(a.bestValue, b.bestValue),
    bestPosition: lower(a.bestPosition, b.bestPosition),
    runs: a.runs + b.runs,
  };
}
/** Who may be paid for a festival run: a festival machine the player owns,
 * or the machine the career lent when it started this festival session.
 * `career` is set when the session was entered from CAREER (a loaner implies
 * it); a run from SESSION select in a machine the career does not own is not
 * a career run at all and is left alone. */
export interface FestivalContext {
  loaner: string | null;
  career?: boolean;
}
/**
 * Settle one festival run: paid at most once per run id (an unpaid run — AI
 * driven, not finished, a machine not in the garage, a locked event — is
 * recorded as settled too, so it can never be paid later). Payment lines:
 * completion (races: plus each rival beaten), new stars above your best on
 * the event, a first completion, a personal best, staying on the route.
 * Reputation comes from new stars and first completions only, so repeating
 * an event pays credits but does not farm reputation.
 *
 * Runs in your own machine are measured against your own-machine record
 * only; runs in the loaned machine (a quarter of the rate, at most one
 * reputation) against both, and they keep their own record, so a loaned run
 * never takes the star, first-completion or reputation pay of a later run in
 * your own machine. An event pays at most `eventReputation` in all.
 *
 * Returns the unchanged save object when the run was already settled, and
 * with `ignored` when the run is not a career run (started outside the
 * career, in a machine the career does not own).
 */
export function settleFestival(
  save: CareerSave,
  registry: CareerRegistry,
  raw: unknown,
  context: FestivalContext = { loaner: null },
): { save: CareerSave; payout: Payout; result: FestivalResult | null; ignored?: true } {
  const result = validateFestivalResult(raw);
  if (!result)
    return { save, payout: none('The festival result could not be read.'), result: null };
  const runKey = festivalRunKey(result.runId);
  if (save.paidSessions.includes(runKey))
    return { save, payout: none('This festival run has already been paid.'), result };
  const vehicle = registry.vehicles.find((v) => v.id === result.vehicleId);
  const owned =
    !!vehicle &&
    vehicleDiscipline(vehicle) === 'festival' &&
    save.owned.some((o) => o.id === vehicle.id);
  const loaned = !owned && !!vehicle && context.loaner === vehicle.id;
  if (!owned && !context.career && context.loaner === null)
    return {
      save,
      payout: none('Not a career run: entered outside the career in a machine the career does not own.'),
      result,
      ignored: true,
    };
  const settle = (reason: string) => {
    const next = structuredClone(save);
    markPaid(next, runKey);
    return { save: next, payout: none(reason), result };
  };
  const region = registry.festival?.find((r) => r.id === result.regionId);
  const event = region?.events.find((e) => e.id === result.eventId);
  if (!region || !event) return settle('This festival event is not a career event in this build.');
  if (disciplineStatus(registry, 'festival').state !== 'open')
    return settle('The festival career is not open in this build.');
  if (result.assisted)
    return settle(
      'The autopilot drove part of this run; festival payments need your own driving.',
    );
  if (!result.completed || result.abandoned)
    return settle('Not completed: festival payments need a finished run.');
  if (!vehicle || (!owned && !loaned))
    return settle(
      `The ${vehicle?.name ?? result.vehicleId} is not a festival machine in your career garage. Buy a road machine in the Dealership, or enter the festival from CAREER for a loaned one.`,
    );
  const rule = FESTIVAL_RULES[event.kind],
    rep = save.reputation.festival;
  if (rep < rule.reputation)
    return settle(
      `${event.name} is locked in the career: ${rule.reputation} festival reputation needed (you have ${rep}).`,
    );
  const stakes = owned ? stakesFor(registry, vehicle) : FESTIVAL_LOANER_STAKES;
  const key = festivalKey(region.id, event.id),
    record = save.festival[key] ?? null,
    own: FestivalBest = record ?? NO_BEST,
    lent: FestivalBest = record?.loaner ?? NO_BEST,
    // What this run is measured against (see above).
    previous = owned ? own : bestOf(own, lent),
    lines: PayoutLine[] = [];
  const label = (s: string) => (stakes === 1 ? s : `${s} × ${stakes}`);
  const race = isRace(event.kind);
  if (race && result.position !== null) {
    lines.push({
      label: label(`${EVENT_KIND_LABEL[event.kind]} finished P${result.position} of ${result.entrants}`),
      amount: scale(rule.completion, stakes),
    });
    const beaten = result.entrants - result.position;
    lines.push({
      label: label(`Rivals beaten (${beaten} × ${FESTIVAL_PAY.rivalBeaten.toLocaleString('en')})`),
      amount: scale(beaten * FESTIVAL_PAY.rivalBeaten, stakes),
    });
  } else
    lines.push({
      label: label(`${EVENT_KIND_LABEL[event.kind]} completed`),
      amount: scale(rule.completion, stakes),
    });
  const before = previous.stars,
    gained = Math.max(0, result.stars - before);
  lines.push({
    label: gained
      ? `New star${gained === 1 ? '' : 's'}: ${starWords(result.stars)} (best was ${starWords(before)})`
      : `${starWords(result.stars)}: no star above your best (${starWords(before)})`,
    amount: scale(gained * FESTIVAL_PAY.star, stakes),
  });
  const first = previous.runs === 0;
  const measure = measureOf(result);
  if (first)
    lines.push({
      label: `First completion of ${event.name}`,
      amount: scale(FESTIVAL_PAY.firstCompletion, stakes),
    });
  else {
    const fasterTime =
      result.time !== null &&
      event.kind !== 'speed-zone' &&
      event.kind !== 'drift-zone' &&
      previous.bestTime !== null &&
      result.time < previous.bestTime;
    const betterMeasure = measure !== null && previous.bestValue !== null && measure > previous.bestValue;
    if (fasterTime || betterMeasure)
      lines.push({
        label: fasterTime
          ? `Personal best (−${(previous.bestTime! - result.time!).toFixed(2)} s)`
          : `Personal best (${Math.round(previous.bestValue!)} → ${Math.round(measure!)})`,
        amount: scale(FESTIVAL_PAY.personalBest, stakes),
      });
  }
  const clean = result.offRouteSeconds <= FESTIVAL_PAY.cleanSeconds;
  lines.push({
    label: clean
      ? 'On the route throughout'
      : `Off the route for ${result.offRouteSeconds.toFixed(1)} s`,
    amount: clean ? scale(FESTIVAL_PAY.clean, stakes) : 0,
  });
  // Reputation already paid by this event (older records: their own stars
  // and first completion, as they were paid).
  const repPaid = record?.reputation ?? eventReputation(own.stars, own.runs > 0);
  const reputation = owned
    ? // Your own machine: what the event gives for your own-machine best,
      // less what it has already paid (a loaned run's share included).
      Math.max(0, eventReputation(Math.max(own.stars, result.stars), true) - repPaid)
    : Math.min(1, gained * FESTIVAL_PAY.starReputation + (first ? FESTIVAL_PAY.firstReputation : 0));
  const total = lines.reduce((sum, l) => sum + l.amount, 0);
  const next = structuredClone(save);
  markPaid(next, runKey);
  book(next, `Festival · ${event.name}: ${starWords(result.stars)}`, total);
  next.reputation.festival = Math.min(100, next.reputation.festival + reputation);
  // The run improves its own kind of record only.
  const base = owned ? own : lent;
  const improved: FestivalBest = {
    stars: Math.max(base.stars, result.stars),
    bestTime:
      result.time !== null && (base.bestTime === null || result.time < base.bestTime)
        ? result.time
        : base.bestTime,
    bestValue:
      measure !== null && (base.bestValue === null || measure > base.bestValue)
        ? measure
        : base.bestValue,
    bestPosition:
      race && result.position !== null
        ? Math.min(base.bestPosition ?? 99, result.position)
        : base.bestPosition,
    runs: base.runs + 1,
  };
  const ownRecord: FestivalBest = owned ? improved : { ...own };
  const loanerRecord = owned ? record?.loaner : improved;
  next.festival[key] = {
    ...ownRecord,
    reputation: repPaid + reputation,
    ...(loanerRecord ? { loaner: { ...loanerRecord } } : {}),
  };
  return {
    save: next,
    payout: { lines, total, reputation, paid: true, reason: null, awarded: null },
    result,
  };
}
/** Discipline facts for the festival tab: the tier the active machine races
 * in and how many events are discovered. */
export function festivalSummary(
  registry: CareerRegistry,
  view: ProgressView,
  discovered: ReadonlySet<string>,
) {
  const regions = registry.festival ?? [],
    events = regions.flatMap((r) => r.events),
    machine = festivalMachine(registry, view),
    tier = disciplineTiers(registry, 'festival')[0];
  return {
    regions,
    discovered: events.filter((e) => discovered.has(e.id)).length,
    events: events.length,
    machine,
    tier,
    entry: tier ? tierEntry(registry, view, tier) : null,
    name: DISCIPLINES.festival.name,
  };
}
