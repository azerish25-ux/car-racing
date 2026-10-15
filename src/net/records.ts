import {
  SIMULATION_VERSION,
  canonical,
  contentHash,
  recordCategory,
  recordIncompatibility,
  sessionIdentity,
  type RecordCategory,
  type RecordedSessionIdentity,
} from '../core/session-identity.ts';
import { validateOptions, type SessionOptions } from '../simulation/config.ts';
import {
  AuthoritativeWorld,
  CHECKPOINT_TICKS,
  decodeJournal,
  encodeJournal,
  journalEntryLimit,
  type JournalEntry,
} from './authority.ts';
import { fromBase64, toBase64 } from './bytes.ts';
import { identityMismatch } from './identity.ts';

export const RECORD_FORMAT = 'apex-verified-session';
export const RECORD_VERSION = 1;
/** Longest session a verifier will re-simulate (6 h at 120 Hz). */
export const MAX_RECORD_TICKS = 6 * 3600 * 120;

/** What the record asserts; the verifier recomputes every field. */
export interface RecordClaim {
  /** Classification order (car ids, leader first) at `endTick`. */
  order: number[];
  laps: number[];
  /** Every completed lap time per car (s, exact float64). */
  lapTimes: number[][];
  /** Best valid lap per car (0 when none), as the race director keeps it. */
  best: number[];
  /** Per car and completed lap: the server AI drove the car at some tick of
   * that lap (AI entrant, disconnect takeover, input starvation, pit lane).
   * Such laps never count for a leaderboard. */
  lapAssisted: boolean[][];
  /** State hash at every multiple of CHECKPOINT_TICKS (10 s) up to endTick. */
  checkpoints: { tick: number; hash: string }[];
  finalHash: string;
}
/** A verified session record (WP52): seed and options, the authoritative
 * input journal and the content hashes it ran against. Nothing in it is
 * trusted: acceptance means a headless re-simulation from these inputs, on
 * this build's content, reproduced the claim exactly. */
export interface SessionRecord {
  format: typeof RECORD_FORMAT;
  version: number;
  identity: RecordedSessionIdentity;
  /** Leaderboard category of car 0 (recordCategory). */
  category: RecordCategory;
  options: SessionOptions;
  endTick: number;
  journalEntries: number;
  /** encodeJournal(), base64. */
  journal: string;
  claim: RecordClaim;
  /** contentHash of the record without this field: catches corruption in
   * storage or transit. It is not a signature; re-simulation is the check. */
  digest: string;
}

export function recordDigest(record: Omit<SessionRecord, 'digest'> & { digest?: string }) {
  const { digest: _digest, ...body } = record;
  return contentHash(canonical(body));
}
function claimOf(world: AuthoritativeWorld): RecordClaim {
  return {
    order: [...world.sim.race.order],
    laps: world.sim.race.laps.map((l) => l.completed),
    lapTimes: world.lapTimes.map((t) => [...t]),
    best: world.sim.race.laps.map((l) => l.best),
    lapAssisted: world.lapAssisted.map((a) => [...a]),
    checkpoints: world.checkpoints.map((c) => ({ ...c })),
    finalHash: world.stateHash(),
  };
}
/** Archive a finished (or time-limited) authoritative session. */
export function createRecord(world: AuthoritativeWorld): SessionRecord {
  const options = world.sim.options,
    body: Omit<SessionRecord, 'digest'> = {
      format: RECORD_FORMAT,
      version: RECORD_VERSION,
      identity: sessionIdentity(options),
      category: recordCategory(options),
      options,
      endTick: world.tick,
      journalEntries: world.journal.length,
      journal: toBase64(encodeJournal(world.journal)),
      claim: claimOf(world),
    };
  return { ...body, digest: recordDigest(body) };
}

export type VerifyResult =
  | {
      ok: true;
      ticks: number;
      cpuMs: number;
      finalHash: string;
      category: RecordCategory;
      /** The only lap a leaderboard may take from this record: car 0's best
       * lap that is valid, unpenalized and driven by its human driver
       * throughout (0 when there is none), and how many such laps it has. */
      categoryBest: number;
      categoryLaps: number;
    }
  | { ok: false; reason: string; stage: 'format' | 'content' | 'journal' | 'resimulation' };

const isNumberArray = (v: unknown): v is number[] =>
  Array.isArray(v) && v.every((x) => typeof x === 'number' && Number.isFinite(x));
const isBooleanArray = (v: unknown): v is boolean[] =>
  Array.isArray(v) && v.every((x) => typeof x === 'boolean');
const isHash = (v: unknown) => typeof v === 'string' && /^[0-9a-f]{8}$/.test(v);

const assistDivergence = (car: number, lap: number, claimed: boolean) =>
  `car ${car} lap ${lap}: claimed ${claimed ? '' : 'not '}AI-assisted, re-simulation says otherwise`;
/** Car 0's leaderboard laps in a (re-simulated) world. */
function categoryLaps(world: AuthoritativeWorld) {
  const times = world.lapTimes[0] ?? [],
    eligible = times.filter((_, k) => world.lapValid[0][k] && !world.lapAssisted[0][k]);
  return { best: eligible.length ? Math.min(...eligible) : 0, laps: eligible.length };
}

/** Verify a record by re-simulating it headlessly (WP52). Accepts only when
 * the content matches this build and the replayed classification, lap counts,
 * every lap time and the final state hash are bit-identical to the claim. */
export function verifyRecord(input: unknown): VerifyResult {
  const bad = (stage: 'format' | 'content' | 'journal' | 'resimulation', reason: string) =>
    ({ ok: false, stage, reason }) as const;
  if (!input || typeof input !== 'object') return bad('format', 'record must be an object');
  const r = input as Partial<SessionRecord>;
  if (r.format !== RECORD_FORMAT) return bad('format', 'unknown record format');
  if (r.version !== RECORD_VERSION)
    return bad('format', `record version ${String(r.version)} is not supported`);
  if (
    !Number.isInteger(r.endTick) ||
    (r.endTick as number) < 1 ||
    (r.endTick as number) > MAX_RECORD_TICKS
  )
    return bad('format', 'end tick is out of range');
  const claim = r.claim;
  if (
    !claim ||
    !isNumberArray(claim.order) ||
    !isNumberArray(claim.laps) ||
    !isNumberArray(claim.best) ||
    !Array.isArray(claim.lapTimes) ||
    !claim.lapTimes.every(isNumberArray) ||
    !Array.isArray(claim.lapAssisted) ||
    !claim.lapAssisted.every(isBooleanArray) ||
    !Array.isArray(claim.checkpoints) ||
    !isHash(claim.finalHash)
  )
    return bad('format', 'claim is malformed');
  // The checkpoints are exactly the multiples of CHECKPOINT_TICKS up to the
  // end, so every one of them is compared during re-simulation and a forged
  // claim fails within 10 simulated seconds of its first divergence.
  const endTick = r.endTick as number,
    expected = Math.floor(endTick / CHECKPOINT_TICKS);
  if (
    claim.checkpoints.length !== expected ||
    !claim.checkpoints.every((c, k) => c && c.tick === (k + 1) * CHECKPOINT_TICKS && isHash(c.hash))
  )
    return bad('format', `claim must hold the ${expected} state checkpoints of the session`);
  if (typeof r.digest !== 'string' || recordDigest(r as SessionRecord) !== r.digest)
    return bad('format', 'record digest mismatch (corrupted or edited in transit)');
  // Options must already be canonical: a verifier never repairs a claim.
  let options: SessionOptions;
  try {
    options = validateOptions(r.options);
  } catch {
    return bad('content', 'session options are invalid');
  }
  if (canonical(options) !== canonical(r.options))
    return bad('content', 'session options are not in canonical form');
  if (!r.identity) return bad('content', 'record has no session identity');
  if (r.identity.simulationVersion !== SIMULATION_VERSION)
    return bad(
      'content',
      `recorded with physics v${r.identity.simulationVersion}; this verifier runs v${SIMULATION_VERSION}`,
    );
  const local = sessionIdentity(options),
    mismatch = identityMismatch(local, r.identity);
  if (mismatch) return bad('content', mismatch);
  const category = recordCategory(options);
  if (!r.category) return bad('content', 'record has no category');
  const incompatible = recordIncompatibility(r.category, category);
  if (incompatible) return bad('content', `category mismatch: ${incompatible}`);
  const cars = options.opponents + 1;
  if (
    claim.order.length !== cars ||
    claim.laps.length !== cars ||
    claim.lapTimes.length !== cars ||
    claim.best.length !== cars ||
    claim.lapAssisted.length !== cars ||
    claim.lapAssisted.some((a, car) => a.length !== claim.lapTimes[car].length)
  )
    return bad('format', 'claim does not cover the field');
  if ([...claim.order].sort((a, b) => a - b).some((car, i) => car !== i))
    return bad('format', 'classification order is not a permutation of the field');
  if (!claim.laps.every((n) => Number.isInteger(n) && n >= 0))
    return bad('format', 'lap counts must be non-negative integers');
  if (typeof r.journal !== 'string') return bad('journal', 'record has no journal');
  // Longer journals than the live server can write for this many ticks
  // and cars are refused before decoding (a genuine 6 h record always fits).
  const limit = journalEntryLimit(endTick, cars);
  if (!Number.isInteger(r.journalEntries) || (r.journalEntries as number) > limit)
    return bad('journal', 'journal is longer than this session allows');
  let journal: JournalEntry[];
  try {
    journal = decodeJournal(fromBase64(r.journal), limit);
  } catch (error) {
    return bad(
      'journal',
      `journal is unreadable: ${error instanceof Error ? error.message : error}`,
    );
  }
  if (journal.length !== r.journalEntries) return bad('journal', 'journal entry count mismatch');
  for (const e of journal)
    if (e.car >= cars || e.tick >= endTick)
      return bad('journal', 'journal entry outside the session');
  const start = performance.now(),
    checkpoints = new Map(claim.checkpoints.map((c) => [c.tick, c.hash]));
  let world: AuthoritativeWorld,
    divergence: string | null = null;
  try {
    // Fail fast: compare every checkpoint and every lap the moment the
    // re-simulation reaches it.
    world = AuthoritativeWorld.replay(options, journal, endTick, (w) => {
      const hash = checkpoints.get(w.tick);
      if (hash !== undefined && hash !== w.stateHash()) {
        divergence = `state diverges from the claim at tick ${w.tick} (${(w.tick / 120).toFixed(1)} s)`;
        return false;
      }
      for (const event of w.events)
        if (event.type === 'lap') {
          const claimed = claim.lapTimes[event.car]?.[event.lap - 1];
          if (claimed !== event.time) {
            divergence = `car ${event.car} lap ${event.lap}: claimed ${claimed ?? 'no lap'} s, re-simulation gives ${event.time} s`;
            return false;
          }
          const assisted = w.lapAssisted[event.car][event.lap - 1];
          if (claim.lapAssisted[event.car]?.[event.lap - 1] !== assisted) {
            divergence = assistDivergence(event.car, event.lap, !assisted);
            return false;
          }
        }
      return true;
    });
  } catch (error) {
    return bad(
      'resimulation',
      `re-simulation failed: ${error instanceof Error ? error.message : error}`,
    );
  }
  if (divergence) return bad('resimulation', divergence);
  const cpuMs = performance.now() - start,
    actual = claimOf(world);
  if (
    actual.checkpoints.length !== claim.checkpoints.length ||
    actual.checkpoints.some(
      (c, k) => c.tick !== claim.checkpoints[k].tick || c.hash !== claim.checkpoints[k].hash,
    )
  )
    return bad('resimulation', 'checkpoint list does not reproduce');
  for (let car = 0; car < cars; car++) {
    const claimed = claim.lapTimes[car],
      real = actual.lapTimes[car];
    if (claimed.length !== real.length)
      return bad(
        'resimulation',
        `car ${car}: claimed ${claimed.length} laps, re-simulation completed ${real.length}`,
      );
    for (let lap = 0; lap < real.length; lap++)
      if (claimed[lap] !== real[lap])
        return bad(
          'resimulation',
          `car ${car} lap ${lap + 1}: claimed ${claimed[lap]} s, re-simulation gives ${real[lap]} s`,
        );
    if (claim.laps[car] !== actual.laps[car])
      return bad('resimulation', `car ${car}: lap count does not reproduce`);
    if (claim.best[car] !== actual.best[car])
      return bad('resimulation', `car ${car}: best lap does not reproduce`);
    for (let lap = 0; lap < real.length; lap++)
      if (claim.lapAssisted[car][lap] !== actual.lapAssisted[car][lap])
        return bad('resimulation', assistDivergence(car, lap + 1, claim.lapAssisted[car][lap]));
  }
  if (claim.order.join(',') !== actual.order.join(','))
    return bad(
      'resimulation',
      `classification ${claim.order.join(',')} does not reproduce (${actual.order.join(',')})`,
    );
  if (claim.finalHash !== actual.finalHash)
    return bad('resimulation', 'final state does not reproduce');
  const leaderboard = categoryLaps(world);
  return {
    ok: true,
    ticks: world.tick,
    cpuMs,
    finalHash: actual.finalHash,
    category,
    categoryBest: leaderboard.best,
    categoryLaps: leaderboard.laps,
  };
}
