import { validateOptions, type SessionOptions } from '../simulation/config.ts';
import { rulesetFor, sessionIncompatibilities } from '../simulation/events.ts';
import { VEHICLES } from '../simulation/vehicles.ts';
import { LIMITS, RATES } from './constants.ts';
import { TokenBucket } from './guards.ts';
import type { LobbyView, SessionPhase } from './messages.ts';

export interface LobbyConfig {
  name: string;
  /** Session template: circuit, mode, ruleset, laps, weather, assists, seed.
   * The field (opponents, vehicles, grid) comes from the members. */
  options: SessionOptions;
  /** Human drivers admitted. */
  capacity: number;
  /** Cars on the grid; empty places are filled with server AI. */
  fieldSize?: number;
  /** Fewest humans for the ready check to pass. */
  minPlayers?: number;
  /** Vehicle for AI fill; default: the first registry car the ruleset admits. */
  aiVehicle?: string;
}
export interface LobbyMember {
  player: string;
  name: string;
  vehicle: string;
  ready: boolean;
}
export interface LobbySummary {
  id: string;
  name: string;
  circuit: string;
  ruleset: string;
  mode: string;
  players: number;
  capacity: number;
  open: boolean;
}
/** Moderation hooks (WP53). The platform owns identity and persistence of
 * bans; the lobby only consults and reports. */
export interface ModerationHooks {
  isBanned?(player: string): boolean;
  onKick?(event: { lobby: string; player: string; by: string; reason: string }): void;
  onBan?(event: { lobby: string; player: string; by: string; reason: string }): void;
}
export type Outcome = { ok: true } | { ok: false; reason: string };
const fail = (reason: string): Outcome => ({ ok: false, reason });
const OK: Outcome = { ok: true };

function defaultAiVehicle(options: SessionOptions) {
  const allowed = rulesetFor(options).allowedClasses;
  return Object.values(VEHICLES).find((v) => allowed.includes(v.classId))?.id;
}

/** One lobby: membership, capacity, readiness, class/ruleset compatibility
 * and kick/ban (WP53). */
export class Lobby {
  readonly members: LobbyMember[] = [];
  private readonly bans = new Set<string>();
  locked = false;
  host: string | null;
  private constructor(
    readonly id: string,
    readonly config: Required<Omit<LobbyConfig, 'aiVehicle'>> & { aiVehicle: string },
    private readonly moderation: ModerationHooks,
    host: string | null,
  ) {
    this.host = host;
  }
  /** Validate a configuration; every reason it cannot host a session. */
  static create(
    id: string,
    config: LobbyConfig,
    moderation: ModerationHooks = {},
    host: string | null = null,
  ): { ok: true; lobby: Lobby } | { ok: false; reasons: string[] } {
    const reasons: string[] = [];
    if (typeof config.name !== 'string' || !config.name || config.name.length > 48)
      reasons.push('Lobby name must be 1-48 characters');
    const capacity = config.capacity,
      fieldSize = config.fieldSize ?? config.capacity;
    if (!Number.isInteger(capacity) || capacity < 1 || capacity > LIMITS.playersPerLobby)
      reasons.push(`Capacity must be 1-${LIMITS.playersPerLobby}`);
    if (!Number.isInteger(fieldSize) || fieldSize < capacity || fieldSize > LIMITS.playersPerLobby)
      reasons.push(`Field size must be ${capacity}-${LIMITS.playersPerLobby}`);
    let options: SessionOptions | null = null;
    try {
      options = validateOptions(config.options);
    } catch (error) {
      reasons.push(error instanceof Error ? error.message : 'Invalid session options');
    }
    const aiVehicle = config.aiVehicle ?? (options ? defaultAiVehicle(options) : undefined);
    if (!aiVehicle || !Object.hasOwn(VEHICLES, aiVehicle))
      reasons.push('No AI vehicle is eligible');
    if (options && aiVehicle && reasons.length === 0) {
      const field = Array.from({ length: fieldSize }, () => aiVehicle);
      reasons.push(
        ...sessionIncompatibilities({ ...options, opponents: fieldSize - 1, vehicles: field }),
      );
    }
    if (reasons.length || !options || !aiVehicle) return { ok: false, reasons };
    const { grid: _grid, ...template } = options;
    return {
      ok: true,
      lobby: new Lobby(
        id,
        {
          name: config.name,
          options: template,
          capacity,
          fieldSize,
          minPlayers: Math.max(1, Math.min(capacity, config.minPlayers ?? 1)),
          aiVehicle,
        },
        moderation,
        host,
      ),
    };
  }
  get options() {
    return this.config.options;
  }
  member(player: string) {
    return this.members.find((m) => m.player === player);
  }
  isBanned(player: string) {
    return this.bans.has(player) || this.moderation.isBanned?.(player) === true;
  }
  /** Why `vehicle` may not enter this session, or null. */
  vehicleIncompatibility(vehicle: string): string | null {
    const def = VEHICLES[vehicle];
    if (!def || !Object.hasOwn(VEHICLES, vehicle)) return `Unknown vehicle ${vehicle}`;
    const errors = sessionIncompatibilities({
      ...this.config.options,
      opponents: 0,
      vehicles: [vehicle],
    });
    return errors.length ? errors.join('; ').replace(/Car 1 \(([^)]*)\)/g, '$1') : null;
  }
  join(player: { player: string; name: string; vehicle: string }): Outcome {
    if (this.locked) return fail('The session has already started');
    if (this.member(player.player)) return fail('Already in this lobby');
    if (this.isBanned(player.player)) return fail('Banned from this lobby');
    if (this.members.length >= this.config.capacity) return fail('Lobby is full');
    const incompatible = this.vehicleIncompatibility(player.vehicle);
    if (incompatible) return fail(incompatible);
    this.members.push({ ...player, ready: false });
    this.host ??= player.player;
    return OK;
  }
  leave(player: string) {
    const i = this.members.findIndex((m) => m.player === player);
    if (i < 0) return false;
    this.members.splice(i, 1);
    if (this.host === player) this.host = this.members[0]?.player ?? null;
    return true;
  }
  setReady(player: string, ready: boolean): Outcome {
    const m = this.member(player);
    if (!m) return fail('Not in this lobby');
    if (this.locked) return fail('The session has already started');
    m.ready = ready;
    return OK;
  }
  /** Every reason the session cannot start now; ok when it can. */
  readyCheck(): { ok: boolean; reasons: string[] } {
    const reasons: string[] = [];
    if (this.members.length < this.config.minPlayers)
      reasons.push(`Needs ${this.config.minPlayers} driver(s); ${this.members.length} joined`);
    const waiting = this.members.filter((m) => !m.ready).map((m) => m.name);
    if (waiting.length) reasons.push(`Waiting for ${waiting.join(', ')}`);
    reasons.push(...sessionIncompatibilities(this.sessionOptions()));
    return { ok: reasons.length === 0, reasons };
  }
  private moderate(by: string, target: string): Outcome {
    if (by !== 'server' && by !== this.host) return fail('Only the host can moderate');
    if (by === target) return fail('The host cannot remove themselves');
    return OK;
  }
  kick(by: string, target: string, reason: string): Outcome {
    const allowed = this.moderate(by, target);
    if (!allowed.ok) return allowed;
    if (!this.leave(target)) return fail('Not in this lobby');
    this.moderation.onKick?.({ lobby: this.id, player: target, by, reason });
    return OK;
  }
  ban(by: string, target: string, reason: string): Outcome {
    const allowed = this.moderate(by, target);
    if (!allowed.ok) return allowed;
    this.bans.add(target);
    this.leave(target);
    this.moderation.onBan?.({ lobby: this.id, player: target, by, reason });
    return OK;
  }
  /** Session the race server builds: members in join order (pole first),
   * then AI entrants up to the field size. */
  sessionOptions(): SessionOptions {
    const field = Math.max(this.members.length, this.config.fieldSize),
      vehicles = Array.from(
        { length: field },
        (_, i) => this.members[i]?.vehicle ?? this.config.aiVehicle,
      );
    return validateOptions({ ...this.config.options, opponents: field - 1, vehicles });
  }
  view(phase: SessionPhase): LobbyView {
    return {
      id: this.id,
      name: this.config.name,
      phase,
      capacity: this.config.capacity,
      circuit: this.config.options.circuit ?? 'aurel',
      ruleset: rulesetFor(this.config.options).id,
      mode: this.config.options.mode,
      members: this.members.map((m) => ({ ...m })),
    };
  }
  summary(): LobbySummary {
    return {
      id: this.id,
      name: this.config.name,
      circuit: this.config.options.circuit ?? 'aurel',
      ruleset: rulesetFor(this.config.options).id,
      mode: this.config.options.mode,
      players: this.members.length,
      capacity: this.config.capacity,
      open: !this.locked && this.members.length < this.config.capacity,
    };
  }
}

/** Lobby directory: create, list, join, leave (WP53), with a per-player
 * token bucket on every request. */
export class LobbyDirectory {
  private readonly lobbies = new Map<string, Lobby>();
  private readonly buckets = new Map<string, TokenBucket>();
  private next = 1;
  constructor(
    private readonly moderation: ModerationHooks = {},
    private readonly clock: () => number = () => 0,
    private readonly rate = RATES.control,
  ) {}
  private allow(player: string) {
    const now = this.clock();
    let bucket = this.buckets.get(player);
    if (!bucket) {
      bucket = new TokenBucket(this.rate.perSecond, this.rate.burst, now);
      this.buckets.set(player, bucket);
    }
    return bucket.take(now);
  }
  create(host: string, config: LobbyConfig) {
    if (!this.allow(host)) return { ok: false as const, reasons: ['Rate limited'] };
    const id = `L${this.next++}`,
      result = Lobby.create(id, config, this.moderation, host);
    if (!result.ok) return result;
    this.lobbies.set(id, result.lobby);
    return result;
  }
  get(id: string) {
    return this.lobbies.get(id);
  }
  list(filter: { circuit?: string; ruleset?: string; open?: boolean } = {}): LobbySummary[] {
    return [...this.lobbies.values()]
      .map((l) => l.summary())
      .filter(
        (s) =>
          (filter.circuit === undefined || s.circuit === filter.circuit) &&
          (filter.ruleset === undefined || s.ruleset === filter.ruleset) &&
          (filter.open === undefined || s.open === filter.open),
      );
  }
  join(lobby: string, player: { player: string; name: string; vehicle: string }): Outcome {
    if (!this.allow(player.player)) return fail('Rate limited');
    const l = this.lobbies.get(lobby);
    if (!l) return fail('No such lobby');
    return l.join(player);
  }
  leave(lobby: string, player: string): Outcome {
    if (!this.allow(player)) return fail('Rate limited');
    const l = this.lobbies.get(lobby);
    if (!l || !l.leave(player)) return fail('Not in this lobby');
    if (!l.members.length && !l.locked) this.lobbies.delete(lobby);
    return OK;
  }
  remove(lobby: string) {
    return this.lobbies.delete(lobby);
  }
}
