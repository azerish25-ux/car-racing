import type { RecordedSessionIdentity } from '../core/session-identity.ts';
import type { SessionOptions } from '../simulation/config.ts';
import { LIMITS } from './constants.ts';

/** Reliable control messages. Client → server messages are untrusted and
 * validated field by field; anything unexpected is rejected, not repaired. */
export type ClientControl =
  | {
      kind: 'join';
      net: number;
      name: string;
      vehicle: string;
      /** Identity the client computed from its own content for the
       * advertised session and its chosen vehicle (WP51). */
      identity: RecordedSessionIdentity;
      /** Rejoin token from an earlier welcome (WP54). */
      token?: string;
      /** Platform account id; authenticated by the platform layer. */
      account?: string;
    }
  | { kind: 'ready'; ready: boolean }
  | { kind: 'leave' }
  | { kind: 'ping'; t: number };

export interface LobbyMemberView {
  player: string;
  name: string;
  vehicle: string;
  ready: boolean;
}
export interface LobbyView {
  id: string;
  name: string;
  phase: SessionPhase;
  capacity: number;
  circuit: string;
  ruleset: string;
  mode: string;
  members: LobbyMemberView[];
}
export type SessionPhase = 'lobby' | 'grid' | 'race' | 'results' | 'teardown';
export interface GridEntry {
  car: number;
  name: string;
  /** Null for a server AI entrant. */
  player: string | null;
  vehicle: string;
}
export type RaceEvent =
  | { type: 'lap'; car: number; lap: number; time: number; valid: boolean; tick: number }
  | { type: 'driver'; car: number; mode: 'human' | 'ai'; reason: string; tick: number }
  | { type: 'finish'; car: number; tick: number };
export interface ResultEntry {
  position: number;
  car: number;
  name: string;
  player: string | null;
  laps: number;
  lapTimes: number[];
  best: number;
  status: 'running' | 'finished' | 'retired' | 'ai' | 'ghost';
}
export interface RaceResults {
  endTick: number;
  reason: 'finished' | 'time-limit' | 'aborted';
  classification: ResultEntry[];
  /** Digest of the verified record the server archived for this race. */
  recordDigest: string;
  /** Legal-progress audit disagreements (RouteProgress vs lap counter). */
  progressDisputes: number[];
}
export type ServerControl =
  | { kind: 'welcome'; player: string; token: string; lobby: LobbyView }
  | { kind: 'reject'; reason: string }
  | { kind: 'lobby'; lobby: LobbyView }
  | {
      kind: 'grid';
      options: SessionOptions;
      identity: RecordedSessionIdentity;
      entries: GridEntry[];
      car: number;
      /** Server tick at which the race clock starts, and the current tick. */
      startTick: number;
      serverTick: number;
      /** Server ms until `startTick` is simulated (countdown). */
      startInMs: number;
      /** Present on a rejoin: every race event so far. */
      events?: RaceEvent[];
    }
  | { kind: 'events'; events: RaceEvent[] }
  | { kind: 'results'; results: RaceResults }
  | { kind: 'kicked'; reason: string }
  | { kind: 'pong'; t: number; serverTick: number };

const isString = (v: unknown, max = 64): v is string =>
  typeof v === 'string' && v.length > 0 && v.length <= max;
const isInt = (v: unknown, lo = 0, hi = 0xffffffff): v is number =>
  typeof v === 'number' && Number.isInteger(v) && v >= lo && v <= hi;
const isHash = (v: unknown): v is string => typeof v === 'string' && /^[0-9a-f]{8}$/.test(v);

function validIdentity(v: unknown): v is RecordedSessionIdentity {
  if (!v || typeof v !== 'object') return false;
  const i = v as Record<string, unknown>;
  return (
    isInt(i.formatVersion, 0, 1e6) &&
    isInt(i.simulationVersion, 0, 1e6) &&
    isInt(i.tickHz, 1, 10000) &&
    isString(i.circuit) &&
    isHash(i.circuitHash) &&
    isString(i.ruleset) &&
    isHash(i.rulesetHash) &&
    Array.isArray(i.vehicles) &&
    i.vehicles.length >= 1 &&
    i.vehicles.length <= LIMITS.playersPerLobby &&
    i.vehicles.every((x) => isString(x)) &&
    Array.isArray(i.vehicleHashes) &&
    i.vehicleHashes.length === i.vehicles.length &&
    i.vehicleHashes.every(isHash) &&
    isString(i.assist, 16) &&
    isInt(i.seed)
  );
}
/** Validate an untrusted control message; returns the reason it is invalid. */
export function validateClientControl(v: unknown): ClientControl | string {
  if (!v || typeof v !== 'object' || Array.isArray(v)) return 'control message must be an object';
  const m = v as Record<string, unknown>;
  switch (m.kind) {
    case 'join': {
      if (!isInt(m.net, 0, 1e6)) return 'join: invalid protocol version';
      if (
        !isString(m.name, LIMITS.nameLength) ||
        [...m.name].some((ch) => ch.charCodeAt(0) < 32 || ch.charCodeAt(0) === 127)
      )
        return 'join: invalid name';
      if (!isString(m.vehicle, 32)) return 'join: invalid vehicle';
      if (!validIdentity(m.identity)) return 'join: invalid content identity';
      if (
        m.token !== undefined &&
        !(typeof m.token === 'string' && /^[0-9a-f]{16,64}$/.test(m.token))
      )
        return 'join: invalid token';
      if (
        m.account !== undefined &&
        !(typeof m.account === 'string' && /^[A-Za-z0-9_-]{1,32}$/.test(m.account))
      )
        return 'join: invalid account';
      return {
        kind: 'join',
        net: m.net,
        name: m.name,
        vehicle: m.vehicle,
        identity: m.identity,
        ...(m.token !== undefined ? { token: m.token as string } : {}),
        ...(m.account !== undefined ? { account: m.account as string } : {}),
      };
    }
    case 'ready':
      if (typeof m.ready !== 'boolean') return 'ready: invalid flag';
      return { kind: 'ready', ready: m.ready };
    case 'leave':
      return { kind: 'leave' };
    case 'ping':
      if (typeof m.t !== 'number' || !Number.isFinite(m.t)) return 'ping: invalid time';
      return { kind: 'ping', t: m.t };
    default:
      return 'unknown control message';
  }
}
