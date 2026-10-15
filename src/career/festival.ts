import {
  EVENT_KIND_LABEL,
  FESTIVAL_RESULT_VERSION,
  isRace,
  type FestivalResult,
} from '../simulation/open-world/festival-result.ts';
import type { FestivalEventKind } from '../simulation/open-world/region-data.ts';
import { book, markPaid, type Payout, type PayoutLine } from './economy.ts';
import { disciplineTiers, loanerVehicle, tierEntry, tierOf, type ProgressView } from './ladder.ts';
import {
  DISCIPLINES,
  disciplineStatus,
  vehicleDiscipline,
  type CareerFestivalEvent,
  type CareerFestivalRegion,
  type CareerRegistry,
  type CareerVehicle,
} from './registry.ts';
import type { CareerSave, FestivalRecord } from './save.ts';

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
  const loaner = loanerVehicle(registry, 'festival');
  return { vehicle: loaner, loaner: true, stakes: FESTIVAL_LOANER_STAKES };
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
const starText = (n: number) => `${'★'.repeat(n)}${'☆'.repeat(Math.max(0, 3 - n))}`;
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
/** Who may be paid for a festival run: a festival machine the player owns,
 * or the machine the career lent when it started this festival session. */
export interface FestivalContext {
  loaner: string | null;
}
/**
 * Settle one festival run: paid at most once per run id (an unpaid run — AI
 * driven, not finished, a machine not in the garage, a locked event — is
 * recorded as settled too, so it can never be paid later). Payment lines:
 * completion (races: plus each rival beaten), new stars above your best on
 * the event, a first completion, a personal best, staying on the route.
 * Reputation comes from new stars and first completions only, so repeating
 * an event pays credits but does not farm reputation. Returns the unchanged
 * save object when the run was already settled.
 */
export function settleFestival(
  save: CareerSave,
  registry: CareerRegistry,
  raw: unknown,
  context: FestivalContext = { loaner: null },
): { save: CareerSave; payout: Payout; result: FestivalResult | null } {
  const result = validateFestivalResult(raw);
  if (!result)
    return { save, payout: none('The festival result could not be read.'), result: null };
  const runKey = festivalRunKey(result.runId);
  if (save.paidSessions.includes(runKey))
    return { save, payout: none('This festival run has already been paid.'), result };
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
  const vehicle = registry.vehicles.find((v) => v.id === result.vehicleId);
  const owned =
    !!vehicle &&
    vehicleDiscipline(vehicle) === 'festival' &&
    save.owned.some((o) => o.id === vehicle.id);
  const loaned = !!vehicle && context.loaner === vehicle.id;
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
    previous = save.festival[key] ?? null,
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
  const before = previous?.stars ?? 0,
    gained = Math.max(0, result.stars - before);
  lines.push({
    label: gained
      ? `New star${gained === 1 ? '' : 's'} ${starText(result.stars)} (best was ${starText(before)})`
      : `${starText(result.stars)}: no star above your best (${starText(before)})`,
    amount: scale(gained * FESTIVAL_PAY.star, stakes),
  });
  const first = !previous || previous.runs === 0;
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
  let reputation = gained * FESTIVAL_PAY.starReputation + (first ? FESTIVAL_PAY.firstReputation : 0);
  if (!owned) reputation = Math.min(1, reputation);
  const total = lines.reduce((sum, l) => sum + l.amount, 0);
  const next = structuredClone(save);
  markPaid(next, runKey);
  book(next, `Festival · ${event.name}: ${starText(result.stars)}`, total);
  next.reputation.festival = Math.min(100, next.reputation.festival + reputation);
  next.festival[key] = {
    stars: Math.max(before, result.stars),
    bestTime:
      result.time !== null && (previous?.bestTime == null || result.time < previous.bestTime)
        ? result.time
        : (previous?.bestTime ?? null),
    bestValue:
      measure !== null && (previous?.bestValue == null || measure > previous.bestValue)
        ? measure
        : (previous?.bestValue ?? null),
    bestPosition:
      race && result.position !== null
        ? Math.min(previous?.bestPosition ?? 99, result.position)
        : (previous?.bestPosition ?? null),
    runs: (previous?.runs ?? 0) + 1,
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
