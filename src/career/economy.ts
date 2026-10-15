import {
  complete,
  newChampionship,
  recordRound,
  standings,
  type RoundResult,
  type RoundSpec,
} from '../core/championship.ts';
import { DEFAULT_SETUP, SETUP_LIMITS, validateSetup, type Setup } from '../simulation/config.ts';
import { rewardIncome } from '../storage/team-career.ts';
import type { CareerEvent } from './ladder.ts';
import { purchaseReasons, vehiclePrice } from './ladder.ts';
import {
  LICENCE_TESTS,
  MEDALS,
  MEDAL_RANK,
  formatMetric,
  type LicenceOutcome,
  type Medal,
} from './licences.ts';
import {
  vehicleDiscipline,
  type CareerRegistry,
  type CareerVehicle,
  type DisciplineId,
} from './registry.ts';
import { MAX_PRESETS, type CareerSave } from './save.ts';

/** Transparent career payments (GAME_DESIGN §4): completion, improvement on
 * the player's own previous result, clean racing and event objectives. The
 * completion lines are `rewardIncome` (the team ledger's calculation) scaled
 * by the event's stakes; every line is shown on the results screen and a
 * session is paid at most once. Nothing here is purchasable with money. */
export const CLEAN_CONTACT_J = 5000;
export interface PayoutLine {
  label: string;
  amount: number;
}
export interface Payout {
  lines: PayoutLine[];
  total: number;
  reputation: number;
  /** False when nothing was booked (already paid, AI drove, did not finish). */
  paid: boolean;
  reason: string | null;
  awarded: string | null;
}
export interface RaceOutcome {
  session: string;
  position: number;
  cars: number;
  classified: boolean;
  /** The AI driver drove part of the player's session. */
  demonstration: boolean;
  penalties: number;
  /** Contact energy absorbed by the player's car (J), from the snapshot. */
  contactEnergy: number;
  /** 0-based starting slot. */
  gridSlot: number;
  bestLap: number;
  round?: RoundResult;
}
const scale = (amount: number, stakes: number) => Math.round((amount * stakes) / 10) * 10;
const kJ = (j: number) => `${(j / 1000).toFixed(1)} kJ`;
export function racePayout(
  event: Pick<CareerEvent, 'stakes' | 'objectives' | 'kind' | 'key'>,
  outcome: RaceOutcome,
  previous?: CareerSave['results'][string],
): Payout {
  const none = (reason: string): Payout => ({
    lines: [],
    total: 0,
    reputation: 0,
    paid: false,
    reason,
    awarded: null,
  });
  if (outcome.demonstration)
    return none('The AI driver drove part of this session; career payments need your own driving.');
  if (!outcome.classified)
    return none('Not classified: completion, improvement and objective payments need a finish.');
  if (
    !Number.isInteger(outcome.position) ||
    !Number.isInteger(outcome.cars) ||
    outcome.cars < 1 ||
    outcome.position < 1 ||
    outcome.position > outcome.cars
  )
    return none('The classification could not be read.');
  const base = rewardIncome(outcome);
  const lines: PayoutLine[] = base.lines.map((l) => ({
    label: event.stakes === 1 ? l.label : `${l.label} × ${event.stakes}`,
    amount: scale(l.amount, event.stakes),
  }));
  const clean = outcome.contactEnergy <= CLEAN_CONTACT_J;
  lines.push({
    label: clean
      ? `Low contact (${kJ(outcome.contactEnergy)} ≤ ${kJ(CLEAN_CONTACT_J)})`
      : `Contact ${kJ(outcome.contactEnergy)} above the ${kJ(CLEAN_CONTACT_J)} clean limit`,
    amount: clean ? scale(1500, event.stakes) : 0,
  });
  if (previous && previous.starts > 0) {
    const gained = previous.bestPosition - outcome.position;
    lines.push({
      label:
        gained > 0
          ? `Improved on your best here (P${previous.bestPosition} → P${outcome.position})`
          : `No improvement on your best here (P${previous.bestPosition})`,
      amount: gained > 0 ? scale(gained * 1200, event.stakes) : 0,
    });
    if (previous.bestLap > 0 && outcome.bestLap > 0 && outcome.bestLap < previous.bestLap)
      lines.push({
        label: `Personal best lap here (−${(previous.bestLap - outcome.bestLap).toFixed(3)} s)`,
        amount: scale(800, event.stakes),
      });
  } else lines.push({ label: 'First start here: this result is your benchmark', amount: 0 });
  for (const o of event.objectives) {
    const met =
      o.id === 'top'
        ? outcome.position <= o.value
        : o.id === 'gain'
          ? outcome.gridSlot + 1 - outcome.position >= o.value
          : outcome.bestLap > 0;
    lines.push({
      label: `Objective: ${o.label}${met ? '' : ' (not met)'}`,
      amount: met ? scale(o.amount, event.stakes) : 0,
    });
  }
  const cleanRace = outcome.penalties === 0 && clean;
  const earned =
    Math.round((6 * (outcome.cars - outcome.position + 1)) / outcome.cars) + (cleanRace ? 2 : 0);
  return {
    lines,
    total: lines.reduce((sum, l) => sum + l.amount, 0),
    reputation: event.kind === 'recovery' ? Math.min(1, earned) : earned,
    paid: true,
    reason: null,
    awarded: null,
  };
}
const book = (save: CareerSave, label: string, amount: number) => {
  save.credits = Math.max(0, save.credits + amount);
  save.ledger.push({ label, amount });
  save.ledger = save.ledger.slice(-48);
};
const markPaid = (save: CareerSave, session: string) => {
  save.paidSessions.push(session);
  save.paidSessions = save.paidSessions.slice(-200);
};
/** Begin the championship of `event`, or restart it after completion. A
 * season in progress is never replaced here: it continues in the machine it
 * started in (an empty season, with nothing raced, may change machine), and
 * ending it early is `abandonChampionship`, which the player confirms. */
export function startChampionship(
  save: CareerSave,
  key: string,
  vehicle: string,
  rounds: readonly RoundSpec[],
  cars: number,
): CareerSave {
  const current = save.championships[key];
  if (current && !complete(current.season)) {
    if (current.vehicle === vehicle) return save;
    if (current.season.results.length)
      throw new Error(
        `This season is being raced in ${current.vehicle} (${current.season.results.length} of ${current.season.rounds.length} rounds recorded). Finish it in that machine, or abandon the season first.`,
      );
  }
  const next = structuredClone(save);
  next.championships[key] = { vehicle, season: newChampionship(cars, rounds), sessions: [] };
  return next;
}
/** End a season early at the player's confirmed request. Payments already
 * made stay paid; the recorded rounds are discarded. */
export function abandonChampionship(save: CareerSave, key: string): CareerSave {
  const current = save.championships[key];
  if (!current) throw new Error('There is no season to abandon.');
  const next = structuredClone(save);
  delete next.championships[key];
  next.ledger.push({
    label: `Season abandoned after ${current.season.results.length} of ${current.season.rounds.length} rounds`,
    amount: 0,
  });
  next.ledger = next.ledger.slice(-48);
  return next;
}
/** Rounds (1-based) of a season the AI driver drove any part of. */
export const demonstrationRounds = (season: { results: readonly RoundResult[] }) =>
  season.results.flatMap((r, i) => (r.demonstration ? [i + 1] : []));
/** Pay a finished career race exactly once per session id. Returns the
 * unchanged save object when the session was already paid. */
export function settleRace(
  save: CareerSave,
  event: Pick<CareerEvent, 'stakes' | 'objectives' | 'kind' | 'key' | 'discipline' | 'name'>,
  outcome: RaceOutcome,
  prize: string | null = null,
): { save: CareerSave; payout: Payout } {
  if (!outcome.session || outcome.session.length > 100)
    return {
      save,
      payout: {
        lines: [],
        total: 0,
        reputation: 0,
        paid: false,
        reason: 'No session identity.',
        awarded: null,
      },
    };
  if (save.paidSessions.includes(outcome.session))
    return {
      save,
      payout: {
        lines: [],
        total: 0,
        reputation: 0,
        paid: false,
        reason: 'This session has already been paid.',
        awarded: null,
      },
    };
  const previous = save.results[event.key];
  const payout = racePayout(event, outcome, previous);
  const next = structuredClone(save);
  markPaid(next, outcome.session);
  if (payout.paid) {
    book(next, `${event.name}: P${outcome.position} of ${outcome.cars}`, payout.total);
    next.reputation[event.discipline] = Math.min(
      100,
      next.reputation[event.discipline] + payout.reputation,
    );
    next.results[event.key] = {
      bestPosition: Math.min(previous?.bestPosition ?? 99, outcome.position),
      bestLap:
        outcome.bestLap > 0 && (!previous?.bestLap || outcome.bestLap < previous.bestLap)
          ? outcome.bestLap
          : (previous?.bestLap ?? 0),
      starts: (previous?.starts ?? 0) + 1,
    };
  }
  const entry = next.championships[event.key];
  if (event.kind === 'championship' && outcome.round && entry && !complete(entry.season)) {
    if (!entry.sessions.includes(outcome.session)) {
      entry.season = recordRound(entry.season, outcome.round);
      entry.sessions.push(outcome.session);
      if (complete(entry.season)) {
        const table = standings(entry.season);
        // The title is the player's only when every round was the player's
        // own driving: AI-driven rounds score for the table, never a title.
        const ai = demonstrationRounds(entry.season);
        if (table[0].id === 0 && ai.length)
          payout.lines.push({
            label: `Season led on points, but the AI driver drove round${ai.length === 1 ? '' : 's'} ${ai.join(', ')}: no title, bonus or prize`,
            amount: 0,
          });
        if (table[0].id === 0 && !ai.length) {
          const bonus = scale(20000, event.stakes);
          payout.lines.push({ label: 'Championship won', amount: bonus });
          payout.total += bonus;
          payout.reputation += 8;
          book(next, `${event.name}: champion`, bonus);
          next.reputation[event.discipline] = Math.min(100, next.reputation[event.discipline] + 8);
          if (prize && !next.owned.some((o) => o.id === prize)) {
            next.owned.push({ id: prize, source: 'award' });
            payout.awarded = prize;
            next.ledger.push({ label: `${event.name}: prize machine ${prize}`, amount: 0 });
          }
        }
      }
    }
  }
  return { save: next, payout };
}
const LICENCE_MEDAL_PAY: Readonly<Record<Medal, number>> = Object.freeze({
  bronze: 3000,
  silver: 3000,
  gold: 4000,
});
const LICENCE_MEDAL_REPUTATION: Readonly<Record<Medal, number>> = Object.freeze({
  bronze: 3,
  silver: 2,
  gold: 3,
});
/** Record a licence attempt and pay newly reached medals once. */
export function settleLicence(
  save: CareerSave,
  outcome: LicenceOutcome,
  session: string,
  demonstration: boolean,
): { save: CareerSave; payout: Payout } {
  const test = LICENCE_TESTS[outcome.test];
  if (!session || save.paidSessions.includes(session))
    return {
      save,
      payout: {
        lines: [],
        total: 0,
        reputation: 0,
        paid: false,
        reason: 'This attempt has already been recorded.',
        awarded: null,
      },
    };
  const next = structuredClone(save);
  markPaid(next, session);
  const record = (next.licences[test.id] ??= { medal: null, best: null, attempts: 0 });
  record.attempts++;
  if (demonstration)
    return {
      save: next,
      payout: {
        lines: [],
        total: 0,
        reputation: 0,
        paid: false,
        reason: 'The AI driver drove during the attempt; licences need your own driving.',
        awarded: null,
      },
    };
  if (!outcome.valid || outcome.value === null)
    return {
      save: next,
      payout: {
        lines: [],
        total: 0,
        reputation: 0,
        paid: false,
        reason: outcome.detail,
        awarded: null,
      },
    };
  const lines: PayoutLine[] = [];
  let reputation = 0;
  const better =
    record.best === null ||
    (test.metric.better === 'lower' ? outcome.value < record.best : outcome.value > record.best);
  if (better && record.best !== null)
    lines.push({
      label: `Improved your best (${formatMetric(test, record.best)} → ${formatMetric(test, outcome.value)})`,
      amount: 500,
    });
  if (better) record.best = outcome.value;
  const before = record.medal ? MEDAL_RANK[record.medal] : 0,
    after = outcome.medal ? MEDAL_RANK[outcome.medal] : 0;
  for (const medal of MEDALS)
    if (MEDAL_RANK[medal] > before && MEDAL_RANK[medal] <= after) {
      lines.push({ label: `${test.name}: ${medal} licence`, amount: LICENCE_MEDAL_PAY[medal] });
      reputation += LICENCE_MEDAL_REPUTATION[medal];
    }
  if (after > before) record.medal = outcome.medal;
  const total = lines.reduce((s, l) => s + l.amount, 0);
  if (total) book(next, `${test.name} licence attempt`, total);
  next.reputation[test.discipline] = Math.min(100, next.reputation[test.discipline] + reputation);
  return {
    save: next,
    payout: { lines, total, reputation, paid: true, reason: null, awarded: null },
  };
}
/** Buy a registered vehicle with career credits; prices follow class. */
export function buyVehicle(save: CareerSave, registry: CareerRegistry, id: string): CareerSave {
  const vehicle = registry.vehicles.find((v) => v.id === id);
  if (!vehicle) throw new Error('That machine is not registered in this build.');
  if (save.owned.some((o) => o.id === id)) throw new Error(`You already own the ${vehicle.name}.`);
  const blocked = purchaseReasons(registry, vehicle);
  if (blocked.length)
    throw new Error(`The ${vehicle.name} cannot race in this build yet: ${blocked.join(' ')}`);
  const price = vehiclePrice(registry, vehicle);
  if (save.credits < price)
    throw new Error(
      `The ${vehicle.name} costs ¤${price.toLocaleString('en')}; you have ¤${save.credits.toLocaleString('en')}. The club meeting always runs.`,
    );
  const next = structuredClone(save);
  book(next, `Bought ${vehicle.name}`, -price);
  next.owned.push({ id, source: 'purchase' });
  const discipline = vehicleDiscipline(vehicle);
  next.active[discipline] ??= id;
  return next;
}
export function setActive(
  save: CareerSave,
  registry: CareerRegistry,
  discipline: DisciplineId,
  id: string,
): CareerSave {
  const vehicle = registry.vehicles.find((v) => v.id === id);
  if (!vehicle || !save.owned.some((o) => o.id === id))
    throw new Error('Choose a machine you own.');
  if (vehicleDiscipline(vehicle) !== discipline)
    throw new Error(`The ${vehicle.name} does not race in this discipline.`);
  const next = structuredClone(save);
  next.active[discipline] = id;
  return next;
}
/** Only parameters the machine exposes (the `setupFor` keys). */
export function exposedValues(
  vehicle: Pick<CareerVehicle, 'setupKeys'>,
  setup: Setup,
): Partial<Setup> {
  const out: Partial<Setup> = {};
  for (const key of vehicle.setupKeys)
    if (Object.hasOwn(DEFAULT_SETUP, key)) out[key as keyof Setup] = setup[key as keyof Setup];
  return out;
}
export function savePreset(
  save: CareerSave,
  vehicle: CareerVehicle,
  setup: Setup,
  name: string,
): CareerSave {
  if (!save.owned.some((o) => o.id === vehicle.id))
    throw new Error('Presets are saved for machines you own.');
  const list = save.presets[vehicle.id] ?? [];
  if (list.length >= MAX_PRESETS) throw new Error(`Delete a preset first (limit ${MAX_PRESETS}).`);
  const next = structuredClone(save);
  next.presets[vehicle.id] = [
    ...list,
    { name: name.slice(0, 40), values: exposedValues(vehicle, validateSetup(setup)) },
  ];
  next.selected[vehicle.id] = next.presets[vehicle.id].length - 1;
  return next;
}
export function selectPreset(save: CareerSave, vehicle: string, index: number): CareerSave {
  const list = save.presets[vehicle] ?? [];
  if (index !== -1 && !list[index]) throw new Error('Unknown preset.');
  const next = structuredClone(save);
  next.selected[vehicle] = index;
  return next;
}
export function deletePreset(save: CareerSave, vehicle: string, index: number): CareerSave {
  const list = save.presets[vehicle] ?? [];
  if (!list[index]) throw new Error('Unknown preset.');
  const next = structuredClone(save);
  next.presets[vehicle] = list.filter((_, i) => i !== index);
  const selected = next.selected[vehicle] ?? -1;
  next.selected[vehicle] = selected === index ? -1 : selected > index ? selected - 1 : selected;
  if (!next.presets[vehicle].length) delete next.presets[vehicle];
  return next;
}
/** Setup for a career session in `vehicle`: the selected preset over the
 * defaults (exposed keys only), or null for the Garage & Settings setup. */
export function careerSetup(
  save: CareerSave,
  vehicle: Pick<CareerVehicle, 'id' | 'setupKeys'>,
): Setup | null {
  const index = save.selected[vehicle.id] ?? -1,
    preset = save.presets[vehicle.id]?.[index];
  if (!preset) return null;
  const merged = { ...DEFAULT_SETUP };
  for (const key of vehicle.setupKeys)
    if (Object.hasOwn(preset.values, key))
      merged[key as keyof Setup] = preset.values[key as keyof Setup]!;
  return validateSetup(merged);
}
/** Plain-language effect of moving each exposed parameter (GAME_DESIGN §5).
 * `up` describes a numerically larger value. */
export const SETUP_EFFECTS: Readonly<
  Record<keyof Setup, { name: string; up: string; down: string }>
> = Object.freeze({
  frontWing: {
    name: 'Front wing',
    up: 'more front grip in fast corners, more drag',
    down: 'less drag, more understeer at speed',
  },
  rearWing: {
    name: 'Rear wing',
    up: 'a steadier rear in fast corners, lower top speed',
    down: 'higher top speed, a looser rear in fast corners',
  },
  brakeBias: {
    name: 'Brake bias',
    up: 'fronts lock first: stable braking, more entry understeer',
    down: 'sharper turn-in on the brakes, rear lock-up risk',
  },
  diffPower: {
    name: 'Differential on throttle',
    up: 'better traction out of slow corners, more exit understeer',
    down: 'freer rotation on throttle, more inside-wheel spin',
  },
  diffCoast: {
    name: 'Differential off throttle',
    up: 'calmer when lifting and turning in',
    down: 'more rotation when you lift, less stable entry',
  },
  frontSpring: {
    name: 'Front springs',
    up: 'sharper response, less grip over bumps and kerbs',
    down: 'rides kerbs better, slower response',
  },
  rearSpring: {
    name: 'Rear springs',
    up: 'quicker rear response, less traction over bumps',
    down: 'more rear traction, slower response',
  },
  frontARB: {
    name: 'Front anti-roll bar',
    up: 'less roll, more understeer',
    down: 'more front grip mid-corner, more roll',
  },
  rearARB: {
    name: 'Rear anti-roll bar',
    up: 'less roll, more oversteer',
    down: 'more rear grip mid-corner and on exit',
  },
  frontRide: {
    name: 'Front ride height',
    up: 'safer over kerbs, less floor grip',
    down: 'more floor grip, more bottoming',
  },
  rearRide: {
    name: 'Rear ride height',
    up: 'more rake: keener front, less stability',
    down: 'more stable, less rotation',
  },
  frontPressure: {
    name: 'Front tyre pressure',
    up: 'quicker steering, less peak grip',
    down: 'more grip, lazier steering, more heat',
  },
  rearPressure: {
    name: 'Rear tyre pressure',
    up: 'livelier rear, less traction',
    down: 'more traction, more heat build-up',
  },
  frontCamber: {
    name: 'Front camber',
    up: 'less camber: better braking, less mid-corner grip',
    down: 'more camber: more mid-corner grip, less braking grip',
  },
  rearCamber: {
    name: 'Rear camber',
    up: 'less camber: better traction, less cornering grip',
    down: 'more camber: more cornering grip, less traction',
  },
  frontToe: {
    name: 'Front toe',
    up: 'toward toe-in: calmer straights, lazier turn-in',
    down: 'toward toe-out: sharper turn-in, nervous straights',
  },
  rearToe: {
    name: 'Rear toe',
    up: 'more toe-in: a planted rear, more drag and heat',
    down: 'less toe-in: freer rotation, less stable',
  },
});
/** The differences from the default setup, explained for each exposed key. */
export function presetEffects(vehicle: Pick<CareerVehicle, 'setupKeys'>, values: Partial<Setup>) {
  const lines: string[] = [];
  for (const key of vehicle.setupKeys) {
    if (!Object.hasOwn(SETUP_EFFECTS, key) || !Object.hasOwn(values, key)) continue;
    const k = key as keyof Setup,
      delta = values[k]! - DEFAULT_SETUP[k],
      [lo, hi] = SETUP_LIMITS[k];
    if (Math.abs(delta) <= (hi - lo) * 0.005) continue;
    const effect = SETUP_EFFECTS[k];
    lines.push(
      `${effect.name} ${delta > 0 ? 'up' : 'down'} ${Math.round((Math.abs(delta) / (hi - lo)) * 100)}% of range: ${delta > 0 ? effect.up : effect.down}.`,
    );
  }
  return lines;
}
