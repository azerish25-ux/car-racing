import { sessionIdentity, type RecordedSessionIdentity } from '../core/session-identity.ts';
import { PHASE } from '../simulation/race.ts';
import { AuthoritativeWorld } from './authority.ts';
import {
  chunkMessages,
  decodeClientMessage,
  encodeControl,
  encodeSnapshot,
  sizeLimit,
} from './codec.ts';
import {
  NET_PROTOCOL_VERSION,
  RATES,
  TICKS_PER_SNAPSHOT,
  TICK_MS,
  TIMEOUTS,
  type Timeouts,
} from './constants.ts';
import type { EventLoop } from './event-loop.ts';
import { TickBudgetMonitor, TokenBucket } from './guards.ts';
import { identityMismatch, joinIdentity } from './identity.ts';
import { ServerInputQueue, type InputPacket, type QueueStats } from './input.ts';
import type { Lobby, ModerationHooks } from './lobby.ts';
import type {
  ClientControl,
  GridEntry,
  RaceEvent,
  RaceResults,
  ResultEntry,
  ServerControl,
  SessionPhase,
} from './messages.ts';
import { createRecord, type SessionRecord } from './records.ts';
import { emptyCarState, type CarNetState } from './snapshot.ts';
import type { Transport } from './transport.ts';

/** What happens to a car whose driver's connection is lost (WP54).
 * 'ai-takeover': the server AI drives it and it stays classified.
 * 'ghost': the AI keeps it moving so the track stays safe, it is flagged
 * GHOST for presentation and classified behind every running car. Contact
 * immunity for ghosts needs a per-car collision mask in the shared solver,
 * which does not exist; that is stated, not simulated. */
export type DisconnectPolicy = 'ai-takeover' | 'ghost';

export interface RaceServerConfig {
  loop: EventLoop;
  lobby: Lobby;
  disconnectPolicy?: DisconnectPolicy;
  /** End the session this many simulated seconds after the green light
   * (provisional classification); otherwise run to the chequered flag. */
  raceSeconds?: number;
  /** Absolute cap on simulated ticks. */
  maxTicks?: number;
  moderation?: ModerationHooks;
  /** Wall clock (ms) for tick-budget measurement; defaults to performance.now. */
  wallClock?: () => number;
  /** Start the grid as soon as the lobby's ready check passes. */
  autoStart?: boolean;
  /** Kept for configuration compatibility; nothing in the server is seeded
   * (session tokens come from the platform CSPRNG). */
  seed?: number;
  /** Harness hook after every physics tick. */
  onTick?: (world: AuthoritativeWorld) => void;
  /** Harness hook on every lifecycle transition. */
  onPhase?: (phase: SessionPhase) => void;
  /** Override protocol timeouts (tests use short rejoin windows). */
  timeouts?: Partial<Timeouts>;
}

interface Connection {
  id: number;
  transport: Transport;
  player: Player | null;
  control: TokenBucket;
  input: TokenBucket;
  strikes: number;
  lastHeard: number;
  echo: number;
  echoAt: number;
  closed: boolean;
}
interface Player {
  id: string;
  /** Platform account presented on join; a rejoin must present it again. */
  account: string | null;
  name: string;
  vehicle: string;
  token: string;
  /** Rejoin attempts with this player's token. */
  rejoinBucket: TokenBucket;
  car: number | null;
  connection: Connection | null;
  queue: ServerInputQueue;
  /** First command since (re)binding applied; before that the car is held. */
  started: boolean;
  /** Rejoined: stay AI until the new connection's first command. */
  awaitingCommand: boolean;
  disconnectedAt: number | null;
  /** Left or kicked: the car stays with the AI and cannot be reclaimed. */
  forfeited: boolean;
  ghost: boolean;
  missingWindow: number;
  /** Consecutive ticks without a command, and whether the AI holds the car. */
  starved: number;
  starving: boolean;
  /** Input statistics of earlier connections (before a rejoin). */
  prior: QueueStats[];
}
export interface ServerStats {
  connections: number;
  rejectedJoins: { reason: string; at: number }[];
  invalidMessages: number;
  rateLimited: number;
  kicks: { player: string; reason: string }[];
  phases: { phase: SessionPhase; at: number }[];
  snapshotsSent: number;
  takeovers: { car: number; at: number; reason: string }[];
  rejoins: { car: number; at: number; afterMs: number }[];
  /** Episodes where a connected driver's commands stopped arriving. */
  starvations: number;
  /** Outbound control messages over the peer's size limit (never sent).
   * Variable-length payloads are chunked, so this stays 0. */
  oversizeMessages: number;
}

/** Anonymous players get ids outside the account namespace (an account id
 * matches /^[A-Za-z0-9_-]{1,32}$/ and can never contain ':'), so a client
 * cannot claim, collide with or inherit the bans of a server-assigned id. */
export const GUEST_PREFIX = 'guest:';

/** Compare two strings in time independent of where they first differ. */
export function constantTimeEqual(a: string, b: string) {
  let diff = a.length ^ b.length;
  for (let i = 0; i < Math.max(a.length, b.length); i++)
    diff |= (a.charCodeAt(i) || 0) ^ (b.charCodeAt(i) || 0);
  return diff === 0;
}
/** 128 bits from the platform CSPRNG (Web Crypto, in browsers and Node). */
export function sessionToken() {
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
}

/** Authoritative race server (WP50–WP54): lobby → grid → race → results →
 * teardown over any Transport. It owns accepted inputs, simulation, legal
 * progress, results and the verified record; clients only send commands.
 *
 * Crash/restart: the journal is the complete authoritative history, so a
 * supervisor that persisted it can rebuild the exact world by replay
 * (`AuthoritativeWorld.replay`, tested) and let drivers rejoin with their
 * tokens. Journal persistence and a supervisor are not implemented; without
 * them a server crash voids the session and clients time out. */
export class RaceServer {
  phase: SessionPhase = 'lobby';
  world: AuthoritativeWorld | null = null;
  record: SessionRecord | null = null;
  results: RaceResults | null = null;
  identity: RecordedSessionIdentity | null = null;
  readonly budget = new TickBudgetMonitor();
  readonly stats: ServerStats = {
    connections: 0,
    rejectedJoins: [],
    invalidMessages: 0,
    rateLimited: 0,
    kicks: [],
    phases: [{ phase: 'lobby', at: 0 }],
    snapshotsSent: 0,
    takeovers: [],
    rejoins: [],
    starvations: 0,
    oversizeMessages: 0,
  };
  private readonly connections = new Set<Connection>();
  private readonly players = new Map<string, Player>();
  private readonly byCar: (Player | null)[] = [];
  private readonly events: RaceEvent[] = [];
  private pendingEvents: RaceEvent[] = [];
  private readonly wall: () => number;
  /** Loop time the first physics tick runs (set when the grid starts). */
  private raceStartsAt = Infinity;
  private nextConnection = 1;
  private nextPlayer = 1;
  private stopTicks: (() => void) | null = null;
  private entries: GridEntry[] = [];
  private scratch: CarNetState[] = [];
  private grid: Extract<ServerControl, { kind: 'grid' }> | null = null;
  readonly timeouts: Timeouts;
  private readonly starveTicks: number;
  constructor(readonly config: RaceServerConfig) {
    this.timeouts = { ...TIMEOUTS, ...config.timeouts };
    this.starveTicks = Math.round(this.timeouts.inputStarvationMs / TICK_MS);
    this.wall = config.wallClock ?? (() => performance.now());
    this.stats.phases[0].at = config.loop.now;
    // Lobby/grid liveness: silent members are dropped (race ticks check their own).
    this.stopSweep = config.loop.every(250, () => this.sweep(), config.loop.now + 250);
  }
  private stopSweep: () => void;
  private sweep() {
    if (this.phase === 'teardown') return this.stopSweep();
    if (this.phase === 'race') return;
    for (const p of [...this.players.values()])
      if (p.connection && this.loop.now - p.connection.lastHeard > this.timeouts.joinMs)
        this.disconnect(p, 'connection timed out');
  }
  get loop() {
    return this.config.loop;
  }
  get lobby() {
    return this.config.lobby;
  }
  private setPhase(phase: SessionPhase) {
    this.phase = phase;
    this.stats.phases.push({ phase, at: this.loop.now });
    this.config.onPhase?.(phase);
  }
  /** Take ownership of a new connection. */
  accept(transport: Transport) {
    const now = this.loop.now,
      conn: Connection = {
        id: this.nextConnection++,
        transport,
        player: null,
        control: new TokenBucket(RATES.control.perSecond, RATES.control.burst, now),
        input: new TokenBucket(RATES.input.perSecond, RATES.input.burst, now),
        strikes: 0,
        lastHeard: now,
        echo: 0,
        echoAt: now,
        closed: false,
      };
    this.stats.connections++;
    this.connections.add(conn);
    transport.onMessage = (data, channel) => this.receive(conn, data, channel);
    transport.onClose = (reason) => this.lost(conn, `closed by client: ${reason}`);
    this.loop.after(this.timeouts.joinMs, () => {
      if (!conn.player && !conn.closed) this.close(conn, 'no join received');
    });
  }
  /** Send one reliable control message, never over the size the client
   * accepts (it would drop it silently). Callers chunk variable-length data. */
  private send(conn: Connection, message: ServerControl) {
    if (conn.closed) return;
    const data = encodeControl(message);
    if (data.length > sizeLimit('reliable', true)) {
      this.stats.oversizeMessages++;
      return;
    }
    conn.transport.send(data, 'reliable');
  }
  /** Race events in as many `events` messages as the size limit needs. */
  private sendEvents(conn: Connection, events: readonly RaceEvent[]) {
    for (const message of this.eventMessages(events)) this.send(conn, message);
  }
  private eventMessages(events: readonly RaceEvent[]): ServerControl[] {
    if (!events.length) return [];
    return chunkMessages(
      events,
      (part) => ({ kind: 'events', events: part }),
      () => this.stats.oversizeMessages++,
    );
  }
  /** The results, with lap times sent ahead in chunks when the whole
   * classification would not fit one message (long races, full fields). */
  private resultMessages(results: RaceResults): ServerControl[] {
    const whole: ServerControl = { kind: 'results', results };
    if (encodeControl(whole).length <= sizeLimit('reliable', true)) return [whole];
    const out: ServerControl[] = [];
    for (const row of results.classification)
      out.push(
        ...chunkMessages(
          row.lapTimes,
          (times, from) => ({ kind: 'lapTimes', car: row.car, from, times }),
          () => this.stats.oversizeMessages++,
        ),
      );
    out.push({
      kind: 'results',
      results: {
        ...results,
        lapTimesSeparate: true,
        classification: results.classification.map((row) => ({ ...row, lapTimes: [] })),
      },
    });
    return out;
  }
  private close(conn: Connection, reason: string) {
    if (conn.closed) return;
    conn.closed = true;
    this.connections.delete(conn);
    conn.transport.close(reason);
  }
  private strike(conn: Connection, reason: 'invalid' | 'rate') {
    conn.strikes++;
    if (reason === 'rate') this.stats.rateLimited++;
    else this.stats.invalidMessages++;
    if (conn.strikes >= RATES.strikesToKick) {
      const why = reason === 'rate' ? 'message rate limit exceeded' : 'too many invalid messages';
      if (conn.player) this.kick(conn.player.id, why);
      else this.close(conn, why);
    }
  }
  private receive(conn: Connection, data: Uint8Array, channel: 'reliable' | 'unreliable') {
    if (conn.closed) return;
    const decoded = decodeClientMessage(data, channel);
    if (!decoded.ok) {
      this.strike(conn, 'invalid');
      return;
    }
    const message = decoded.value,
      bucket = message.type === 'input' ? conn.input : conn.control;
    if (!bucket.take(this.loop.now)) {
      this.strike(conn, 'rate');
      return;
    }
    conn.lastHeard = this.loop.now;
    if (message.type === 'input') this.input(conn, message.packet);
    else this.control(conn, message.control);
  }
  private input(conn: Connection, packet: InputPacket) {
    conn.echo = packet.sentAt;
    conn.echoAt = this.loop.now;
    const player = conn.player;
    if (!player || player.car === null || !this.world || this.phase !== 'race') return;
    // Commands outside the tick or sequence window never come from a
    // well-behaved client: each such packet is a strike.
    if (player.queue.accept(packet.commands, this.world.tick) > 0) this.strike(conn, 'invalid');
  }
  private control(conn: Connection, message: ClientControl) {
    switch (message.kind) {
      case 'join':
        if (conn.player) {
          this.strike(conn, 'invalid');
          return;
        }
        this.join(conn, message);
        return;
      case 'ready':
        if (!conn.player) return this.strike(conn, 'invalid');
        if (this.phase === 'lobby') {
          this.lobby.setReady(conn.player.id, message.ready);
          this.broadcastLobby();
          this.maybeStart();
        }
        return;
      case 'leave':
        if (conn.player) this.forfeit(conn.player, 'left the session');
        this.close(conn, 'left');
        return;
      case 'ping':
        this.send(conn, { kind: 'pong', t: message.t, serverTick: this.world?.tick ?? 0 });
        return;
    }
  }
  private reject(conn: Connection, reason: string) {
    this.stats.rejectedJoins.push({ reason, at: this.loop.now });
    this.send(conn, { kind: 'reject', reason });
    this.close(conn, reason);
  }
  /** The identity this server expects from a client joining with `vehicle`. */
  expectedIdentity(vehicle: string) {
    return joinIdentity(this.lobby.options, vehicle);
  }
  private join(conn: Connection, message: Extract<ClientControl, { kind: 'join' }>) {
    if (message.net !== NET_PROTOCOL_VERSION)
      return this.reject(
        conn,
        `network protocol v${message.net} is not supported (server speaks v${NET_PROTOCOL_VERSION})`,
      );
    if (message.token !== undefined) return this.rejoin(conn, message);
    if (this.phase !== 'lobby') return this.reject(conn, 'the session has already started');
    const incompatible = this.lobby.vehicleIncompatibility(message.vehicle);
    if (incompatible) return this.reject(conn, incompatible);
    const mismatch = identityMismatch(this.expectedIdentity(message.vehicle), message.identity);
    if (mismatch) return this.reject(conn, `content mismatch: ${mismatch}`);
    // A platform account id (authenticated by the platform, not here) makes
    // bans and rejoins stick to a person; otherwise the server assigns one.
    const id = message.account ?? `${GUEST_PREFIX}${this.nextPlayer++}`;
    if (this.players.has(id)) return this.reject(conn, 'this account is already in the session');
    const joined = this.lobby.join({ player: id, name: message.name, vehicle: message.vehicle });
    if (!joined.ok) return this.reject(conn, joined.reason);
    const player: Player = {
      id,
      account: message.account ?? null,
      name: message.name,
      vehicle: message.vehicle,
      token: sessionToken(),
      rejoinBucket: new TokenBucket(RATES.rejoin.perSecond, RATES.rejoin.burst, this.loop.now),
      car: null,
      connection: conn,
      queue: new ServerInputQueue(),
      started: false,
      awaitingCommand: false,
      disconnectedAt: null,
      forfeited: false,
      ghost: false,
      missingWindow: 0,
      starved: 0,
      starving: false,
      prior: [],
    };
    this.players.set(id, player);
    conn.player = player;
    this.send(conn, {
      kind: 'welcome',
      player: id,
      token: player.token,
      lobby: this.lobby.view(this.phase),
    });
    this.broadcastLobby();
    this.maybeStart();
  }
  private rejoin(conn: Connection, message: Extract<ClientControl, { kind: 'join' }>) {
    const token = message.token as string,
      now = this.loop.now;
    // Every token is compared (no early exit) in constant time.
    let player: Player | undefined;
    for (const p of this.players.values()) if (constantTimeEqual(p.token, token)) player = p;
    if (!player || player.forfeited) return this.reject(conn, 'unknown or forfeited session token');
    if (!player.rejoinBucket.take(now)) return this.reject(conn, 'too many rejoin attempts');
    // A token is bound to the account it was issued to, when there is one.
    if (player.account !== null && message.account !== player.account)
      return this.reject(conn, 'this session token belongs to another account');
    if (this.phase !== 'race' && this.phase !== 'grid')
      return this.reject(conn, 'the session is no longer running');
    if (
      player.disconnectedAt !== null &&
      now - player.disconnectedAt > this.timeouts.rejoinWindowMs
    )
      return this.reject(conn, 'the rejoin window has expired');
    // Never take a car from a connection that is still live: a restarted
    // client whose old connection the server has not yet lost retries after
    // the disconnect timeout instead.
    const holder = player.connection;
    if (holder && !holder.closed && now - holder.lastHeard <= this.timeouts.disconnectMs)
      return this.reject(conn, 'this driver is still connected');
    const mismatch = identityMismatch(this.expectedIdentity(player.vehicle), message.identity);
    if (mismatch) return this.reject(conn, `content mismatch: ${mismatch}`);
    if (holder) this.close(holder, 'replaced by a new connection');
    const away = player.disconnectedAt === null ? 0 : this.loop.now - player.disconnectedAt;
    player.connection = conn;
    conn.player = player;
    player.disconnectedAt = null;
    player.prior.push(player.queue.stats);
    player.queue = new ServerInputQueue();
    player.started = false;
    player.awaitingCommand = true;
    player.starved = 0;
    player.starving = false;
    player.ghost = false;
    // Never drive on the old connection's last controls: the AI holds the
    // car until the new connection's first command arrives.
    if (player.car !== null && this.world) this.world.setMode(player.car, 'ai');
    if (player.car !== null)
      this.stats.rejoins.push({ car: player.car, at: this.loop.now, afterMs: away });
    this.send(conn, {
      kind: 'welcome',
      player: player.id,
      token: player.token,
      lobby: this.lobby.view(this.phase),
    });
    if (!this.grid || player.car === null) return;
    if (this.phase === 'grid') {
      // Still counting down: the same grid every driver got, with the time left.
      this.send(conn, {
        ...this.grid,
        car: player.car,
        startInMs: Math.max(0, this.raceStartsAt - now),
      });
      return;
    }
    // Racing: an empty `events` list marks the race as running and resets the
    // client's history, which follows in size-limited chunks. Events not yet
    // broadcast go out with the next snapshot, as for every other driver.
    this.send(conn, {
      ...this.grid,
      car: player.car,
      serverTick: this.world?.tick ?? 0,
      startInMs: 0,
      events: [],
    });
    this.sendEvents(conn, this.events.slice(0, this.events.length - this.pendingEvents.length));
  }
  private broadcastLobby() {
    const view = this.lobby.view(this.phase);
    for (const p of this.players.values())
      if (p.connection) this.send(p.connection, { kind: 'lobby', lobby: view });
  }
  private maybeStart() {
    if (this.config.autoStart !== false && this.phase === 'lobby' && this.lobby.readyCheck().ok)
      this.startGrid();
  }
  /** Lobby → grid: build the authoritative world and announce the field. */
  startGrid() {
    if (this.phase !== 'lobby') throw new Error('Grid can only start from the lobby');
    const check = this.lobby.readyCheck();
    if (!check.ok) throw new Error(`Not ready: ${check.reasons.join('; ')}`);
    this.lobby.locked = true;
    this.setPhase('grid');
    const options = this.lobby.sessionOptions(),
      world = new AuthoritativeWorld(options);
    this.world = world;
    this.identity = sessionIdentity(options);
    const members = this.lobby.members;
    this.entries = world.sim.cars.map((_, car) => {
      const member = members[car],
        player = member ? (this.players.get(member.player) ?? null) : null;
      if (player) player.car = car;
      this.byCar[car] = player;
      if (!player) world.setMode(car, 'ai');
      return {
        car,
        name: player?.name ?? `AI ${car + 1}`,
        player: player?.id ?? null,
        vehicle: options.vehicles?.[car] ?? 'apx01',
      };
    });
    this.scratch = world.sim.cars.map((_, i) => emptyCarState(i));
    this.grid = {
      kind: 'grid',
      options,
      identity: this.identity,
      entries: this.entries,
      car: -1,
      startTick: 0,
      serverTick: 0,
      startInMs: this.timeouts.gridCountdownMs,
    };
    for (const p of this.players.values())
      if (p.connection && p.car !== null) this.send(p.connection, { ...this.grid, car: p.car });
    this.raceStartsAt = this.loop.now + this.timeouts.gridCountdownMs;
    this.loop.after(this.timeouts.gridCountdownMs, () => this.beginRace());
  }
  private beginRace() {
    if (this.phase !== 'grid') return;
    this.raceStartsAt = this.loop.now;
    this.setPhase('race');
    this.stopTicks = this.loop.every(TICK_MS, () => this.tick());
  }
  private tick() {
    const world = this.world;
    if (!world || this.phase !== 'race') return;
    // The budget covers all per-tick server work: inputs, step, snapshots.
    const start = this.wall(),
      now = this.loop.now,
      t = world.tick;
    for (const player of this.players.values()) {
      if (player.car === null) continue;
      const slot = player.queue.take(t);
      if (player.connection && player.disconnectedAt === null && !player.forfeited) {
        if (slot) {
          if (player.awaitingCommand || player.starving) {
            world.setMode(player.car, 'human');
            if (player.awaitingCommand)
              this.emit({
                type: 'driver',
                car: player.car,
                mode: 'human',
                reason: 'rejoined',
                tick: t,
              });
            player.awaitingCommand = false;
            player.starving = false;
          }
          player.starved = 0;
          world.setControls(player.car, slot.controls, slot.first);
          player.started = true;
        } else if (player.started && !player.awaitingCommand) {
          player.queue.stats.missingTicks++;
          player.missingWindow++;
          if (++player.starved >= this.starveTicks && !player.starving) {
            player.starving = true;
            this.stats.starvations++;
            world.setMode(player.car, 'ai');
          }
        }
        // Silence counts from the first physics tick at the earliest: a driver
        // who (re)joined during the countdown has no snapshot, so no inputs, yet.
        if (
          now - Math.max(player.connection.lastHeard, this.raceStartsAt) >
          this.timeouts.disconnectMs
        )
          this.disconnect(player, 'connection timed out');
      }
    }
    world.step();
    for (const event of world.events) this.emit(event);
    if (world.tick % TICKS_PER_SNAPSHOT === 0) this.snapshot();
    this.budget.record(this.wall() - start);
    this.config.onTick?.(world);
    const race = world.sim.race,
      limit = this.config.raceSeconds;
    if (race.phase === PHASE.FINISHED) this.endRace('finished');
    else if (limit !== undefined && race.time >= race.greenAt + limit) this.endRace('time-limit');
    else if (this.config.maxTicks !== undefined && world.tick >= this.config.maxTicks)
      this.endRace('time-limit');
  }
  private emit(event: RaceEvent) {
    this.events.push(event);
    this.pendingEvents.push(event);
  }
  private snapshot() {
    const world = this.world as AuthoritativeWorld,
      now = this.loop.now,
      race = world.sim.race;
    for (const player of this.players.values()) {
      const conn = player.connection;
      if (!conn || conn.closed || player.car === null) continue;
      const cars = this.scratch.map((s, car) =>
        world.capture(car, car === player.car, s, this.byCar[car]?.ghost === true),
      );
      const slack = player.queue.takeSlack();
      conn.transport.send(
        encodeSnapshot({
          tick: world.tick,
          phase: race.phase,
          raceTime: race.time,
          ackSeq: player.queue.contiguousSeq,
          slack: slack === Infinity ? 127 : slack,
          missing: player.missingWindow,
          echo: conn.echo,
          hold: now - conn.echoAt,
          cars,
        }),
        'unreliable',
      );
      player.missingWindow = 0;
      this.stats.snapshotsSent++;
    }
    world.clearContacts();
    if (this.pendingEvents.length) {
      const messages = this.eventMessages(this.pendingEvents);
      this.pendingEvents = [];
      for (const p of this.players.values())
        if (p.connection && p.car !== null)
          for (const message of messages) this.send(p.connection, message);
    }
  }
  /** Connection lost (timeout, close, sever): AI takeover or ghost. */
  private disconnect(player: Player, reason: string) {
    if (player.connection) this.close(player.connection, reason);
    player.connection = null;
    if (player.car === null || !this.world || (this.phase !== 'race' && this.phase !== 'grid')) {
      if (this.phase === 'lobby') {
        this.lobby.leave(player.id);
        this.players.delete(player.id);
        this.broadcastLobby();
        // The one member nobody was waiting for may just have gone.
        this.maybeStart();
      }
      return;
    }
    player.disconnectedAt = this.loop.now;
    player.ghost = this.config.disconnectPolicy === 'ghost';
    this.world.setMode(player.car, 'ai');
    this.stats.takeovers.push({ car: player.car, at: this.loop.now, reason });
    this.emit({ type: 'driver', car: player.car, mode: 'ai', reason, tick: this.world.tick });
  }
  private lost(conn: Connection, reason: string) {
    if (conn.closed) return;
    conn.closed = true;
    this.connections.delete(conn);
    if (conn.player && conn.player.connection === conn) this.disconnect(conn.player, reason);
  }
  private forfeit(player: Player, reason: string) {
    if (this.phase === 'lobby') {
      this.lobby.leave(player.id);
      this.players.delete(player.id);
      if (player.connection) this.close(player.connection, reason);
      player.connection = null;
      this.broadcastLobby();
      this.maybeStart();
      return;
    }
    player.forfeited = true;
    if (player.connection && player.disconnectedAt === null) this.disconnect(player, reason);
  }
  /** Remove a player (rate abuse, host or platform moderation). */
  kick(playerId: string, reason: string, ban = false) {
    const player = this.players.get(playerId);
    if (!player) return false;
    this.stats.kicks.push({ player: playerId, reason });
    if (ban) this.lobby.ban('server', playerId, reason);
    else if (this.phase === 'lobby') this.lobby.kick('server', playerId, reason);
    else
      this.config.moderation?.onKick?.({
        lobby: this.lobby.id,
        player: playerId,
        by: 'server',
        reason,
      });
    if (player.connection) this.send(player.connection, { kind: 'kicked', reason });
    this.forfeit(player, `kicked: ${reason}`);
    return true;
  }
  private endRace(reason: RaceResults['reason']) {
    const world = this.world as AuthoritativeWorld;
    this.stopTicks?.();
    this.stopTicks = null;
    this.setPhase('results');
    if (this.pendingEvents.length) this.snapshot();
    this.record = createRecord(world);
    const running: ResultEntry[] = [],
      ghosts: ResultEntry[] = [];
    for (const row of world.classification()) {
      const player = this.byCar[row.car],
        entry: ResultEntry = {
          position: 0,
          car: row.car,
          name: this.entries[row.car]?.name ?? `Car ${row.car + 1}`,
          player: player?.id ?? null,
          laps: row.laps,
          lapTimes: row.lapTimes,
          best: row.best,
          status: row.retired
            ? 'retired'
            : player?.ghost
              ? 'ghost'
              : row.finishTime > 0
                ? 'finished'
                : !player || player.disconnectedAt !== null || player.forfeited
                  ? 'ai'
                  : 'running',
        };
      (entry.status === 'ghost' ? ghosts : running).push(entry);
    }
    const classification = [...running, ...ghosts].map((e, i) => ({ ...e, position: i + 1 }));
    this.results = {
      endTick: world.tick,
      reason,
      classification,
      recordDigest: this.record.digest,
      progressDisputes: world.audit.disputes(),
    };
    const messages = this.resultMessages(this.results);
    for (const p of this.players.values())
      if (p.connection) for (const message of messages) this.send(p.connection, message);
    this.loop.after(this.timeouts.resultsLingerMs, () => this.teardown());
  }
  /** Results → teardown: close every connection and stop all timers. */
  teardown() {
    if (this.phase === 'teardown') return;
    this.stopTicks?.();
    this.stopTicks = null;
    this.setPhase('teardown');
    for (const conn of [...this.connections]) this.close(conn, 'session over');
    for (const p of this.players.values()) p.connection = null;
  }
  /** Input statistics per car (all connections of the driver), for reports. */
  inputStats() {
    return [...this.players.values()]
      .filter((p) => p.car !== null)
      .map((p) => {
        const total = { ...p.queue.stats };
        for (const prior of p.prior)
          for (const key of Object.keys(total) as (keyof QueueStats)[]) total[key] += prior[key];
        return { car: p.car as number, player: p.id, ...total };
      });
  }
  playerByCar(car: number) {
    const p = this.byCar[car];
    return p
      ? { id: p.id, token: p.token, connected: !!p.connection, mode: this.world?.drivers[car].mode }
      : null;
  }
}
