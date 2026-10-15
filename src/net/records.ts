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
  decodeJournal,
  encodeJournal,
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
  /** Best valid lap per car (0 when none). */
  best: number[];
  /** State hash every CHECKPOINT_TICKS (10 s) and at the end. */
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
    }
  | { ok: false; reason: string; stage: 'format' | 'content' | 'journal' | 'resimulation' };

const isNumberArray = (v: unknown): v is number[] =>
  Array.isArray(v) && v.every((x) => typeof x === 'number' && Number.isFinite(x));

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
    !Array.isArray(claim.checkpoints) ||
    !claim.checkpoints.every((c) => c && Number.isInteger(c.tick) && typeof c.hash === 'string') ||
    typeof claim.finalHash !== 'string'
  )
    return bad('format', 'claim is malformed');
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
  if (claim.order.length !== cars || claim.laps.length !== cars || claim.lapTimes.length !== cars)
    return bad('format', 'claim does not cover the field');
  let journal: JournalEntry[];
  try {
    journal = decodeJournal(fromBase64(r.journal as string));
  } catch (error) {
    return bad(
      'journal',
      `journal is unreadable: ${error instanceof Error ? error.message : error}`,
    );
  }
  if (journal.length !== r.journalEntries) return bad('journal', 'journal entry count mismatch');
  for (const e of journal)
    if (e.car >= cars || e.tick >= (r.endTick as number))
      return bad('journal', 'journal entry outside the session');
  const start = performance.now(),
    checkpoints = new Map(claim.checkpoints.map((c) => [c.tick, c.hash]));
  let world: AuthoritativeWorld,
    divergence: string | null = null;
  try {
    // Fail fast: compare every checkpoint and every lap the moment the
    // re-simulation reaches it.
    world = AuthoritativeWorld.replay(options, journal, r.endTick as number, (w) => {
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
  if (actual.checkpoints.length !== claim.checkpoints.length)
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
  }
  if (claim.order.join(',') !== actual.order.join(','))
    return bad(
      'resimulation',
      `classification ${claim.order.join(',')} does not reproduce (${actual.order.join(',')})`,
    );
  if (claim.finalHash !== actual.finalHash)
    return bad('resimulation', 'final state does not reproduce');
  return { ok: true, ticks: world.tick, cpuMs, finalHash: actual.finalHash, category };
}
