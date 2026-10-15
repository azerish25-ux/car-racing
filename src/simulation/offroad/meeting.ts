import { validateOptions, type SessionOptions, type WeatherPreset } from '../config.ts';
import { rulesetFor, sessionIncompatibilities } from '../events.ts';
import { combineMotos, MOTO_POINTS, pickGates } from './formats.ts';

/** A two-moto motocross meeting (WP42, GAME_DESIGN §2 off-road row) as a
 * session sequence: timed qualifying, the gate pick in qualifying order,
 * moto 1 and moto 2 from those gates, and the combined classification on
 * moto points (ties to the better last-moto result, `combineMotos`). Pure
 * data: the application runs each session and records its classification
 * here; nothing is simulated or scored outside the real sessions. */
export type MeetingStage = 'qualifying' | 'gate-pick' | 'moto' | 'results';
export const MEETING_VERSION = 1;
export interface MeetingMoto {
  /** Classification, car ids winner first (finishers, then non-finishers). */
  order: number[];
  /** Car ids classified as finishers (only they score). */
  finished: number[];
}
export interface GatePick {
  car: number;
  /** 1-based qualifying position: the pick order. */
  turn: number;
  slot: number;
}
export interface MotoMeeting {
  version: typeof MEETING_VERSION;
  id: string;
  name: string;
  /** Moto 1 race options (a moto-format ruleset); qualifying and moto 2 derive from it. */
  base: SessionOptions;
  /** Weather for each moto (moto 2 may change). */
  weather: [WeatherPreset, WeatherPreset];
  stage: MeetingStage;
  /** Qualifying order (car ids, pole first) and best laps by car id (0: no time). */
  qualifying: number[] | null;
  qualifyingTimes: number[] | null;
  /** Gate slot by car id, picked in qualifying order before moto 1. */
  gates: number[] | null;
  picks: GatePick[];
  motos: MeetingMoto[];
}
const permutation = (ids: readonly number[], n: number) =>
  ids.length === n &&
  new Set(ids).size === n &&
  ids.every((id) => Number.isInteger(id) && id >= 0 && id < n);
/** Motos a ruleset runs per meeting (moto formats only); 0 otherwise. */
export function meetingMotos(options: Pick<SessionOptions, 'mode' | 'ruleset'>) {
  const format = rulesetFor(options).format;
  return format?.kind === 'moto' ? (format.motos ?? 0) : 0;
}
/** Start a meeting from a moto event's race options. */
export function createMeeting(
  id: string,
  name: string,
  race: SessionOptions,
  moto2Weather: WeatherPreset = race.weather,
): MotoMeeting {
  const base = validateOptions({ ...race, mode: 'race', grid: undefined, gates: undefined });
  if (meetingMotos(base) < 2) throw new Error(`${name}: not a two-moto format`);
  const errors = sessionIncompatibilities(base);
  if (errors.length) throw new Error(`${name}: ${errors.join('; ')}`);
  return {
    version: MEETING_VERSION,
    id,
    name,
    base,
    weather: [base.weather, moto2Weather],
    stage: 'qualifying',
    qualifying: null,
    qualifyingTimes: null,
    gates: null,
    picks: [],
    motos: [],
  };
}
/** Timed qualifying for the meeting's field at its venue (the solo
 * qualifying ruleset admits the off-road classes). */
export function qualifyingOptions(m: MotoMeeting): SessionOptions {
  if (m.stage !== 'qualifying') throw new Error('Qualifying is over');
  const { ruleset: _ruleset, durationSeconds: _duration, ...rest } = m.base;
  void _ruleset;
  void _duration;
  const options = validateOptions({
    ...rest,
    mode: 'qualifying',
    seed: (m.base.seed ^ 0x51a7) >>> 0,
  });
  const errors = sessionIncompatibilities(options);
  if (errors.length) throw new Error(`${m.name} qualifying: ${errors.join('; ')}`);
  return options;
}
export function recordQualifying(
  m: MotoMeeting,
  order: readonly number[],
  times: readonly number[],
) {
  const n = m.base.opponents + 1;
  if (m.stage !== 'qualifying') throw new Error('Qualifying already recorded');
  if (!permutation(order, n) || times.length !== n || !times.every(Number.isFinite))
    throw new Error('Qualifying classification does not match the meeting field');
  return { ...m, stage: 'gate-pick' as const, qualifying: [...order], qualifyingTimes: [...times] };
}
/** Gate pick (D049) in qualifying order over the venue's slot preference
 * (best first, `gateSlots`): every AI rider takes the most preferred free
 * slot; the player (car 0) takes `playerSlot` when it is free at their turn,
 * else the best free one. Returns the picks in turn order. */
export function pickMeetingGates(
  m: MotoMeeting,
  preference: readonly number[],
  playerSlot?: number,
): GatePick[] {
  if (!m.qualifying) throw new Error('Gate pick needs the qualifying order');
  const order = m.qualifying,
    before = order.slice(0, order.indexOf(0)),
    ahead = pickGates(before, preference),
    taken = new Set(ahead.values());
  const free = preference.filter((s) => !taken.has(s));
  const mine = playerSlot !== undefined && free.includes(playerSlot) ? playerSlot : free[0];
  if (mine === undefined) throw new Error('More riders than gate slots');
  const rest = pickGates(
    order.slice(order.indexOf(0) + 1),
    preference.filter((s) => !taken.has(s) && s !== mine),
  );
  return order.map((car, i) => ({
    car,
    turn: i + 1,
    slot: car === 0 ? mine : (ahead.get(car) ?? rest.get(car))!,
  }));
}
/** The free slots at the player's turn (what the gate-pick screen offers). */
export function playerGateChoices(m: MotoMeeting, preference: readonly number[]) {
  if (!m.qualifying) return [];
  const before = m.qualifying.slice(0, m.qualifying.indexOf(0)),
    taken = new Set(pickGates(before, preference).values());
  return preference.filter((s) => !taken.has(s));
}
export function confirmGates(m: MotoMeeting, picks: readonly GatePick[]) {
  const n = m.base.opponents + 1;
  if (m.stage !== 'gate-pick') throw new Error('Gates are already picked');
  const gates = Array.from({ length: n }, () => -1);
  for (const p of picks) gates[p.car] = p.slot;
  if (gates.some((g) => g < 0) || new Set(gates).size !== n)
    throw new Error('Incomplete gate pick');
  return { ...m, stage: 'moto' as const, gates, picks: picks.map((p) => ({ ...p })) };
}
/** Race options for the next moto: the meeting's field from its picked
 * gates; each moto its own seed and weather. */
export function motoOptions(m: MotoMeeting): SessionOptions {
  if (m.stage !== 'moto' || !m.gates || !m.qualifying) throw new Error('No moto to run');
  const index = m.motos.length;
  return validateOptions({
    ...m.base,
    grid: [...m.qualifying],
    gates: [...m.gates],
    weather: m.weather[index] ?? m.base.weather,
    seed: (m.base.seed + 7919 * index) >>> 0,
  });
}
export function recordMoto(m: MotoMeeting, moto: MeetingMoto) {
  const n = m.base.opponents + 1;
  if (m.stage !== 'moto') throw new Error('No moto is running');
  if (!permutation(moto.order, n) || !moto.finished.every((id) => moto.order.includes(id)))
    throw new Error('Moto classification does not match the meeting field');
  const motos = [...m.motos, { order: [...moto.order], finished: [...moto.finished] }];
  return { ...m, motos, stage: motos.length >= 2 ? ('results' as const) : ('moto' as const) };
}
/** Combined classification (moto points, ties to the better last moto). */
export function meetingClassification(m: MotoMeeting) {
  const points = rulesetFor(m.base).format?.motoPoints ?? MOTO_POINTS;
  return combineMotos(
    m.motos.map((moto) => ({ order: moto.order, finished: moto.finished })),
    points,
  );
}
