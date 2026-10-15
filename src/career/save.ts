import type { Championship } from '../core/championship.ts';
import { validateChampionship } from '../core/championship.ts';
import type { Setup } from '../simulation/config.ts';
import type { TeamState } from '../storage/team-career.ts';
import { LICENCE_IDS, MEDALS, type LicenceId, type Medal } from './licences.ts';
import { DISCIPLINE_IDS, type DisciplineId } from './registry.ts';

/** Versioned driver-career save (GAME_DESIGN §4–§5). Stored under its own
 * key with backup-before-overwrite (SaveStore.writeWithBackup) and read with
 * readRecovered, so a corrupt primary falls back to the previous copy. The
 * team (`team:v1`) and championship (`championship:v1`) saves are never
 * rewritten by the career: their data is read once to seed a new career. */
/** Version 2 added the festival records (`festival`). */
export const CAREER_VERSION = 2;
export const CAREER_KEY = 'career';
/** Copies kept aside before this build overwrites a career it cannot read:
 * one saved by a newer build, or one that failed validation. */
export const CAREER_NEWER_KEY = 'career:newer';
export const CAREER_UNREADABLE_KEY = 'career:unreadable';
export const STARTING_CREDITS = 40000;
export const MAX_PRESETS = 6;
export interface LicenceRecord {
  medal: Medal | null;
  /** Best measured value in the test's metric units. */
  best: number | null;
  attempts: number;
}
export interface OwnedVehicle {
  id: string;
  source: 'purchase' | 'award';
}
export interface SetupPreset {
  name: string;
  /** Only parameters the machine exposes (VehicleDefinition.setupKeys). */
  values: Partial<Setup>;
}
export interface EventRecord {
  bestPosition: number;
  bestLap: number;
  starts: number;
}
/** Best results of a festival event over one kind of paid run. */
export interface FestivalBest {
  stars: number;
  /** Best elapsed time (s) and best measure (trap / zone km/h, drift points). */
  bestTime: number | null;
  bestValue: number | null;
  /** Races: best finishing position. */
  bestPosition: number | null;
  runs: number;
}
/** A festival event's career record (key `festival.<region>.<event>`). The
 * top-level bests are runs in your own machines, paid at the full rate;
 * `loaner` holds runs in the career's loaned machine, so a loaned run never
 * uses up the star, first-completion and reputation pay of a later run in
 * your own machine. `reputation` is the festival reputation the event has
 * paid so far (at most two per star and one for completing it). */
export interface FestivalRecord extends FestivalBest {
  reputation: number;
  loaner?: FestivalBest;
}
export interface CareerChampionship {
  vehicle: string;
  season: Championship;
  /** Session ids of rounds already recorded (idempotence). */
  sessions: string[];
}
export interface CareerSave {
  version: typeof CAREER_VERSION;
  /** Incremented by every write; another tab's write is detected by it. */
  revision: number;
  credits: number;
  reputation: Record<DisciplineId, number>;
  licences: Partial<Record<LicenceId, LicenceRecord>>;
  owned: OwnedVehicle[];
  active: Partial<Record<DisciplineId, string>>;
  presets: Record<string, SetupPreset[]>;
  /** Selected preset index per vehicle; -1 or absent is the baseline. */
  selected: Record<string, number>;
  results: Record<string, EventRecord>;
  championships: Record<string, CareerChampionship>;
  /** Festival event records (paid runs only). */
  festival: Record<string, FestivalRecord>;
  /** Sessions already paid (most recent 200); festival runs as `festival:<run id>`. */
  paidSessions: string[];
  ledger: { label: string; amount: number }[];
  /** Which legacy saves seeded this career. */
  migratedFrom: string[];
}
const zeroReputation = () =>
  Object.fromEntries(DISCIPLINE_IDS.map((d) => [d, 0])) as Record<DisciplineId, number>;
export function newCareer(): CareerSave {
  return {
    version: CAREER_VERSION,
    revision: 0,
    credits: STARTING_CREDITS,
    reputation: zeroReputation(),
    licences: {},
    owned: [],
    active: {},
    presets: {},
    selected: {},
    results: {},
    championships: {},
    festival: {},
    paidSessions: [],
    ledger: [{ label: 'Career starting credits', amount: STARTING_CREDITS }],
    migratedFrom: [],
  };
}
export interface LegacySaves {
  team?: TeamState | null;
  championship?: Championship | null;
  /** Garage & Settings setup, imported as a preset for these vehicles. */
  setup?: Setup | null;
  vehicles?: readonly { id: string; setupKeys: readonly string[] }[];
}
/** A new career seeded from existing saves (WP23/WP24 migration). Only
 * earned progress carries over: team reputation above its founding value,
 * classified championship rounds, and the garage setup as a preset. Paid
 * team sessions stay paid. Nothing is invented and the legacy saves remain. */
export function careerFromLegacy(legacy: LegacySaves): CareerSave {
  const career = newCareer();
  const team = legacy.team,
    season = legacy.championship ? validateChampionship(legacy.championship) : null;
  if (team) {
    const earned = Math.max(0, Math.min(40, Math.round(team.reputation) - 12));
    career.reputation['circuit-cars'] += earned;
    career.paidSessions = team.paidSessions.filter((s) => typeof s === 'string').slice(-200);
    career.migratedFrom.push('team:v1');
    if (earned)
      career.ledger.push({ label: `Team HQ reputation carried over (+${earned})`, amount: 0 });
  }
  if (season) {
    const classified = season.results.filter(
      (r) => !r.retired.includes(0) && !r.demonstration,
    ).length;
    const earned = Math.min(20, classified * 2);
    career.reputation['circuit-cars'] = Math.min(100, career.reputation['circuit-cars'] + earned);
    for (const r of season.results)
      if (!career.paidSessions.includes(r.session)) career.paidSessions.push(r.session);
    career.paidSessions = career.paidSessions.slice(-200);
    career.migratedFrom.push('championship:v1');
    if (earned)
      career.ledger.push({
        label: `Championship rounds carried over (+${earned} reputation)`,
        amount: 0,
      });
  }
  if (legacy.setup && legacy.vehicles) {
    for (const v of legacy.vehicles) {
      const values = Object.fromEntries(
        v.setupKeys
          .filter((k) => k in legacy.setup!)
          .map((k) => [k, legacy.setup![k as keyof Setup]]),
      ) as Partial<Setup>;
      if (Object.keys(values).length)
        career.presets[v.id] = [{ name: 'Imported garage setup', values }];
    }
    career.migratedFrom.push('settings.setup');
  }
  return career;
}
const int = (v: unknown, fallback: number, min: number, max: number) =>
  typeof v === 'number' && Number.isFinite(v)
    ? Math.max(min, Math.min(max, Math.round(v)))
    : fallback;
const finite = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? v : null);
const shortId = (v: unknown): v is string =>
  typeof v === 'string' && v.length > 0 && v.length <= 64 && !v.includes(':');
const record = (v: unknown): Record<string, unknown> =>
  v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : {};
/** Migrations from older career versions, applied in order. Version 1 is the
 * first; the table is where a future shape change lands. */
export const CAREER_MIGRATIONS: Readonly<
  Record<number, (save: Record<string, unknown>) => Record<string, unknown>>
> = Object.freeze({
  // 1 → 2: festival records start empty; everything else is unchanged.
  1: (save: Record<string, unknown>) => ({ ...save, version: 2, festival: {} }),
});
/** The stored version of a career written by a newer build, else null. */
export function newerCareerVersion(value: unknown): number | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const version = (value as Record<string, unknown>).version;
  return typeof version === 'number' && Number.isInteger(version) && version > CAREER_VERSION
    ? version
    : null;
}
/** Validate a stored career: bounded known fields only. Unknown vehicle ids
 * are kept (another build may register them) but are never priced or raced
 * until the registry has them. Throws on data that cannot be a career, so
 * readRecovered falls back to the backup. */
export function validateCareer(value: unknown): CareerSave {
  if (!value || typeof value !== 'object' || Array.isArray(value))
    throw new Error('Career save must be an object');
  let raw = value as Record<string, unknown>;
  let version = raw.version;
  if (typeof version !== 'number' || !Number.isInteger(version) || version < 1)
    throw new Error('Career save has no version');
  if (version > CAREER_VERSION)
    throw new Error(`Career save version ${version} is newer than this build (${CAREER_VERSION})`);
  while (version < CAREER_VERSION) {
    const migrate = CAREER_MIGRATIONS[version];
    if (!migrate) throw new Error(`No migration from career version ${version}`);
    raw = migrate(raw);
    version++;
  }
  const out = newCareer();
  out.ledger = [];
  out.revision = int(raw.revision, 0, 0, Number.MAX_SAFE_INTEGER);
  out.credits = int(raw.credits, 0, 0, 1e9);
  const rep = record(raw.reputation);
  for (const d of DISCIPLINE_IDS) out.reputation[d] = int(rep[d], 0, 0, 100);
  const licences = record(raw.licences);
  for (const id of LICENCE_IDS) {
    const l = record(licences[id]);
    if (!Object.keys(l).length) continue;
    out.licences[id] = {
      medal: MEDALS.includes(l.medal as Medal) ? (l.medal as Medal) : null,
      best: finite(l.best),
      attempts: int(l.attempts, 0, 0, 1e6),
    };
  }
  const seen = new Set<string>();
  if (Array.isArray(raw.owned))
    for (const o of raw.owned.slice(0, 200)) {
      const v = record(o);
      if (!shortId(v.id) || seen.has(v.id)) continue;
      seen.add(v.id);
      out.owned.push({ id: v.id, source: v.source === 'award' ? 'award' : 'purchase' });
    }
  const active = record(raw.active);
  for (const d of DISCIPLINE_IDS)
    if (shortId(active[d]) && seen.has(active[d] as string)) out.active[d] = active[d] as string;
  for (const [id, list] of Object.entries(record(raw.presets)).slice(0, 200)) {
    if (!shortId(id) || !Array.isArray(list)) continue;
    const presets = list.slice(0, MAX_PRESETS).flatMap((p) => {
      const preset = record(p);
      if (typeof preset.name !== 'string') return [];
      const values: Partial<Setup> = {};
      for (const [k, n] of Object.entries(record(preset.values)))
        if (/^[a-zA-Z]{1,24}$/.test(k) && finite(n) !== null)
          (values as Record<string, number>)[k] = n as number;
      return [{ name: preset.name.slice(0, 40), values }];
    });
    if (presets.length) out.presets[id] = presets;
  }
  for (const [id, index] of Object.entries(record(raw.selected)))
    if (shortId(id) && out.presets[id])
      out.selected[id] = int(index, -1, -1, out.presets[id].length - 1);
  for (const [key, r] of Object.entries(record(raw.results)).slice(0, 500)) {
    const e = record(r);
    if (typeof key !== 'string' || key.length > 120) continue;
    out.results[key] = {
      bestPosition: int(e.bestPosition, 99, 1, 99),
      bestLap: finite(e.bestLap) ?? 0,
      starts: int(e.starts, 0, 0, 1e6),
    };
  }
  for (const [key, c] of Object.entries(record(raw.championships)).slice(0, 100)) {
    const entry = record(c);
    const season = validateChampionship(entry.season);
    if (!season || !shortId(entry.vehicle) || key.length > 120) continue;
    out.championships[key] = {
      vehicle: entry.vehicle,
      season,
      sessions: Array.isArray(entry.sessions)
        ? entry.sessions
            .filter((s): s is string => typeof s === 'string' && s.length <= 80)
            .slice(-24)
        : [],
    };
  }
  const positive = (v: unknown) => {
    const n = finite(v);
    return n !== null && n >= 0 ? n : null;
  };
  const festivalBest = (e: Record<string, unknown>): FestivalBest => ({
    stars: int(e.stars, 0, 0, 3),
    bestTime: positive(e.bestTime),
    bestValue: positive(e.bestValue),
    bestPosition:
      e.bestPosition === null || e.bestPosition === undefined ? null : int(e.bestPosition, 99, 1, 99),
    runs: int(e.runs, 0, 0, 1e6),
  });
  for (const [key, r] of Object.entries(record(raw.festival)).slice(0, 200)) {
    const e = record(r);
    if (key.length > 120 || !key.startsWith('festival.')) continue;
    const own = festivalBest(e),
      loaner = e.loaner && typeof e.loaner === 'object' ? festivalBest(record(e.loaner)) : null;
    // A record without the reputation count (written before it existed)
    // has paid its own stars and first completion.
    const paid = 2 * own.stars + (own.runs > 0 ? 1 : 0);
    out.festival[key] = {
      ...own,
      reputation: int(e.reputation, paid, 0, 7),
      ...(loaner ? { loaner } : {}),
    };
  }
  if (Array.isArray(raw.paidSessions))
    out.paidSessions = raw.paidSessions
      .filter((s): s is string => typeof s === 'string' && s.length <= 100)
      .slice(-200);
  if (Array.isArray(raw.ledger))
    out.ledger = raw.ledger
      .map(record)
      .filter((x) => typeof x.label === 'string' && finite(x.amount) !== null)
      .slice(-48)
      .map((x) => ({
        label: (x.label as string).slice(0, 120),
        amount: int(x.amount, 0, -1e9, 1e9),
      }));
  if (Array.isArray(raw.migratedFrom))
    out.migratedFrom = raw.migratedFrom
      .filter((s): s is string => typeof s === 'string')
      .slice(0, 8);
  return out;
}
