import type { RecordedSessionIdentity } from '../core/session-identity.ts';
import {
  controls as neutralControls,
  type Controls,
  type SessionOptions,
} from '../simulation/config.ts';
import { decodeServerMessage, encodeControl, encodeInput } from './codec.ts';
import { CADENCE, LIMITS, NET_PROTOCOL_VERSION, TICKS_PER_COMMAND, TICK_MS } from './constants.ts';
import type { EventLoop } from './event-loop.ts';
import { joinIdentity, identityMismatch } from './identity.ts';
import { ClientCommandLog, sanitizeControls } from './input.ts';
import { JitterBuffer, RemoteCarTrack, ServerClock } from './interpolation.ts';
import type { GridEntry, LobbyView, RaceEvent, RaceResults, ServerControl } from './messages.ts';
import { LocalCarPredictor, type Pose, type PredictorOptions } from './prediction.ts';
import { CAR_FLAG, type CarNetState, type Snapshot } from './snapshot.ts';
import type { Transport } from './transport.ts';

export type ClientState =
  | 'connecting'
  | 'lobby'
  | 'grid'
  | 'race'
  | 'results'
  | 'rejected'
  | 'kicked'
  | 'closed';

export interface PilotContext {
  /** First server tick the command being sampled will cover. */
  tick: number;
  /** Local time (ms). */
  now: number;
  client: RaceClient;
}
/** Where a client's controls come from: a device mapping in the game, a
 * scripted or AI pilot in tests. Its output is sanitized before use. */
export type InputSource = (context: PilotContext) => unknown;

export interface RenderedCar {
  car: number;
  pose: Pose;
  /** Server tick (fractional) this pose stands for. */
  tick: number;
  kind: 'predicted' | 'interpolated' | 'extrapolated' | 'held';
}
export interface ClientView {
  now: number;
  local: RenderedCar | null;
  remotes: RenderedCar[];
  /** No snapshot for longer than STALL_MS: show connection trouble. */
  stalled: boolean;
}
/** Silence after which the view reports the connection as stalled. */
export const STALL_MS = 250;
/** Most lap times per car a client accepts in results (6 h of 10 s laps). */
const MAX_RESULT_LAPS = 2160;

export interface RaceClientConfig {
  loop: EventLoop;
  transport: Transport;
  name: string;
  vehicle: string;
  /** Session the lobby advertised; identity is computed from local content. */
  advertised: SessionOptions;
  input: InputSource;
  /** This client's clock offset from the shared simulated clock (ms): peers
   * never share a clock, and nothing here relies on one. */
  clockOffsetMs?: number;
  /** Rejoin token from an earlier session. */
  token?: string;
  /** Platform account id presented on join. */
  account?: string;
  /** Test hook to present a different identity (tampered content). */
  identity?: (own: RecordedSessionIdentity) => RecordedSessionIdentity;
  /** Send ready as soon as the lobby welcomes this client. */
  autoReady?: boolean;
  predictor?: Partial<PredictorOptions>;
  onRender?: (view: ClientView, client: RaceClient) => void;
}

export interface ClientStats {
  snapshots: number;
  duplicateSnapshots: number;
  lateSnapshots: number;
  lostSnapshots: number;
  inputPackets: number;
  commands: number;
  rejectedSamples: number;
  clampedSamples: number;
  rttMs: number[];
  leadTicks: number[];
  interpolationDelayTicks: number[];
  renderKinds: Record<RenderedCar['kind'], number>;
  invalidMessages: number;
  stalledFrames: number;
  snapshotBytes: number[];
  inputBytes: number[];
  /** Commands carried by all input packets (≥ commands: redundancy). */
  commandCopies: number;
}

/** Online race client (WP50): sequenced input commands with redundancy,
 * local-car prediction with smoothed reconciliation, remote cars
 * interpolated through an adaptive jitter buffer. */
export class RaceClient {
  state: ClientState = 'connecting';
  reason = '';
  player = '';
  token = '';
  car = -1;
  lobby: LobbyView | null = null;
  grid: Extract<ServerControl, { kind: 'grid' }> | null = null;
  results: RaceResults | null = null;
  readonly events: RaceEvent[] = [];
  readonly commands = new ClientCommandLog();
  readonly clock = new ServerClock();
  readonly jitter = new JitterBuffer();
  readonly predictor: LocalCarPredictor;
  readonly remotes = new Map<number, RemoteCarTrack>();
  readonly stats: ClientStats = {
    snapshots: 0,
    duplicateSnapshots: 0,
    lateSnapshots: 0,
    lostSnapshots: 0,
    inputPackets: 0,
    commands: 0,
    rejectedSamples: 0,
    clampedSamples: 0,
    rttMs: [],
    leadTicks: [],
    interpolationDelayTicks: [],
    renderKinds: { predicted: 0, interpolated: 0, extrapolated: 0, held: 0 },
    invalidMessages: 0,
    stalledFrames: 0,
    snapshotBytes: [],
    inputBytes: [],
    commandCopies: 0,
  };
  lastSnapshotTick = -1;
  private lastSnapshotAt = -Infinity;
  latest: Snapshot | null = null;
  /** Ticks the client's commands run ahead of the newest observed tick. */
  lead = 16;
  private srtt = -1;
  /** Smallest keep-alive round trip (ms): seeds the input lead before any
   * input packet has been echoed. */
  pingRttMs = Infinity;
  private echoed = false;
  private lapTimeParts = new Map<number, number[]>();
  private lastControls: Controls = neutralControls();
  private timers: (() => void)[] = [];
  private pingTimer: (() => void) | null = null;
  constructor(readonly config: RaceClientConfig) {
    this.predictor = new LocalCarPredictor(config.predictor);
    if (config.token) this.token = config.token;
    config.transport.onMessage = (data, channel) => this.receive(data, channel);
    config.transport.onClose = (reason) => this.closed(reason);
  }
  get now() {
    return this.config.loop.now + (this.config.clockOffsetMs ?? 0);
  }
  private sendControl(message: Parameters<typeof encodeControl>[0]) {
    if (this.config.transport.open) this.config.transport.send(encodeControl(message), 'reliable');
  }
  /** Present this client's content identity and ask to join (or rejoin). */
  join() {
    const own = joinIdentity(this.config.advertised, this.config.vehicle),
      identity = this.config.identity ? this.config.identity(own) : own;
    this.sendControl({
      kind: 'join',
      net: NET_PROTOCOL_VERSION,
      name: this.config.name,
      vehicle: this.config.vehicle,
      identity,
      ...(this.token ? { token: this.token } : {}),
      ...(this.config.account ? { account: this.config.account } : {}),
    });
    // Keep-alive until inputs flow (they keep the link alive in the race).
    this.pingTimer = this.config.loop.every(500, () => {
      if (this.needsKeepAlive) this.sendControl({ kind: 'ping', t: this.now });
    });
  }
  /** Lobby and grid, and a race this client is not sending inputs to yet
   * (no snapshot so far, e.g. it just rejoined): silence would be a timeout. */
  get needsKeepAlive() {
    if (this.state === 'connecting' || this.state === 'lobby' || this.state === 'grid') return true;
    return this.state === 'race' && !this.commands.started;
  }
  setReady(ready: boolean) {
    this.sendControl({ kind: 'ready', ready });
  }
  leave() {
    this.sendControl({ kind: 'leave' });
    this.stop('closed', 'left');
  }
  private stop(state: ClientState, reason = '') {
    for (const stop of this.timers) stop();
    this.timers = [];
    this.pingTimer?.();
    this.pingTimer = null;
    if (this.state !== 'rejected' && this.state !== 'kicked') this.state = state;
    if (reason) this.reason = reason;
  }
  private closed(reason: string) {
    if (this.state === 'rejected' || this.state === 'kicked') return;
    this.stop(this.state === 'results' ? 'results' : 'closed', reason);
  }
  private receive(data: Uint8Array, channel: 'reliable' | 'unreliable') {
    const decoded = decodeServerMessage(data, channel);
    if (!decoded.ok) {
      this.stats.invalidMessages++;
      return;
    }
    const message = decoded.value;
    if (message.type === 'snapshot') {
      this.stats.snapshotBytes.push(data.length);
      this.onSnapshot(message.snapshot);
    } else this.onControl(message.control);
  }
  private onControl(message: ServerControl) {
    switch (message.kind) {
      case 'welcome':
        this.player = message.player;
        this.token = message.token;
        this.lobby = message.lobby;
        if (this.state === 'connecting') this.state = 'lobby';
        if (this.config.autoReady && message.lobby.phase === 'lobby') this.setReady(true);
        return;
      case 'reject':
        this.state = 'rejected';
        this.reason = message.reason;
        this.stop('rejected', message.reason);
        return;
      case 'kicked':
        this.state = 'kicked';
        this.reason = message.reason;
        this.stop('kicked', message.reason);
        return;
      case 'lobby':
        this.lobby = message.lobby;
        return;
      case 'grid':
        this.onGrid(message);
        return;
      case 'events':
        this.events.push(...message.events);
        return;
      case 'lapTimes':
        this.onLapTimes(message);
        return;
      case 'results': {
        const results = message.results;
        this.results = results.lapTimesSeparate
          ? {
              ...results,
              classification: results.classification.map((row) => ({
                ...row,
                lapTimes: [...(this.lapTimeParts.get(row.car) ?? [])],
              })),
            }
          : results;
        this.state = 'results';
        for (const stop of this.timers) stop();
        this.timers = [];
        return;
      }
      case 'pong': {
        const rtt = this.now - message.t;
        if (Number.isFinite(rtt) && rtt >= 0 && rtt < 5000) {
          this.pingRttMs = Math.min(this.pingRttMs, rtt);
          if (!this.echoed) this.srtt = this.pingRttMs;
        }
        return;
      }
    }
  }
  private onLapTimes(message: Extract<ServerControl, { kind: 'lapTimes' }>) {
    const { car, from, times } = message;
    if (
      !Number.isInteger(car) ||
      car < 0 ||
      car >= LIMITS.carsPerSnapshot ||
      !Number.isInteger(from) ||
      from < 0 ||
      !Array.isArray(times) ||
      from + times.length > MAX_RESULT_LAPS ||
      !times.every((t) => typeof t === 'number')
    ) {
      this.stats.invalidMessages++;
      return;
    }
    let list = this.lapTimeParts.get(car);
    if (!list) this.lapTimeParts.set(car, (list = []));
    times.forEach((t, i) => ((list as number[])[from + i] = t));
  }
  /** Every vehicle in the field must match local content too, or this
   * client could not present the race it is shown. */
  gridIncompatibility(): string | null {
    const grid = this.grid;
    if (!grid) return 'no grid';
    for (const entry of grid.entries) {
      const own = joinIdentity(grid.options, entry.vehicle),
        theirs = {
          ...grid.identity,
          vehicles: [grid.identity.vehicles[entry.car]],
          vehicleHashes: [grid.identity.vehicleHashes[entry.car]],
        };
      const mismatch = identityMismatch(own, theirs);
      if (mismatch) return `car ${entry.car + 1}: ${mismatch}`;
    }
    return null;
  }
  private onGrid(message: Extract<ServerControl, { kind: 'grid' }>) {
    this.grid = message;
    this.car = message.car;
    if (message.events) this.events.splice(0, this.events.length, ...message.events);
    const incompatible = this.gridIncompatibility();
    if (incompatible) {
      this.sendControl({ kind: 'leave' });
      this.stop('rejected', `cannot present this field: ${incompatible}`);
      this.state = 'rejected';
      return;
    }
    this.state = message.events ? 'race' : 'grid';
    for (const stop of this.timers) stop();
    const loop = this.config.loop;
    this.timers = [
      loop.every(1000 / CADENCE.inputSampleHz, () => this.sample()),
      loop.every(1000 / CADENCE.inputSendHz, () => this.sendInputs(), loop.now + 1),
      loop.every(1000 / CADENCE.renderHz, () => this.render(), loop.now + 2),
    ];
  }
  get entries(): GridEntry[] {
    return this.grid?.entries ?? [];
  }
  /** Server tick our next command must start at to arrive in time. */
  targetTick(now = this.now) {
    return this.clock.arrivalTick(now) + this.lead;
  }
  private sample() {
    if (!this.clock.synced || this.car < 0) return;
    const now = this.now;
    if (!this.commands.started) this.commands.start(Math.ceil(this.targetTick(now)));
    const target = this.targetTick(now) + TICKS_PER_COMMAND,
      ticks = Math.max(1, Math.min(4, Math.round(target - this.commands.nextTick)));
    const raw = this.config.input({ tick: this.commands.nextTick, now, client: this });
    const checked = sanitizeControls(raw);
    let controls = this.lastControls;
    if (checked.ok) {
      controls = checked.controls;
      if (checked.clamped.length) this.stats.clampedSamples++;
    } else {
      this.stats.rejectedSamples++;
      controls = { ...this.lastControls, overtake: false, pit: false };
    }
    this.lastControls = controls;
    this.commands.issue(ticks, controls);
    this.stats.commands++;
    this.predictor.advance(this.commands.nextTick - 1, this.inputAt);
  }
  private readonly inputAt = (tick: number) => this.commands.at(tick)?.controls;
  private sendInputs() {
    if (!this.commands.started || !this.config.transport.open) return;
    const commands = this.commands.resend(
      Math.min(LIMITS.inputRedundancy, LIMITS.commandsPerPacket),
      this.lastSnapshotTick + 1,
    );
    const packet = encodeInput({
      sentAt: Math.floor(this.now) >>> 0,
      ackTick: Math.max(0, this.lastSnapshotTick),
      commands,
    });
    this.config.transport.send(packet, 'unreliable');
    this.stats.inputPackets++;
    this.stats.inputBytes.push(packet.length);
    this.stats.commandCopies += commands.length;
  }
  private onSnapshot(s: Snapshot) {
    if (this.car < 0 || (this.state !== 'grid' && this.state !== 'race')) return;
    this.state = 'race';
    const now = this.now;
    for (const car of s.cars) {
      if (car.id === this.car) continue;
      let track = this.remotes.get(car.id);
      if (!track) this.remotes.set(car.id, (track = new RemoteCarTrack()));
      track.push(s.tick, car);
    }
    if (s.tick === this.lastSnapshotTick) {
      this.stats.duplicateSnapshots++;
      return;
    }
    if (s.tick < this.lastSnapshotTick) {
      this.stats.lateSnapshots++;
      return;
    }
    if (this.lastSnapshotTick >= 0) {
      const gap =
        Math.round((s.tick - this.lastSnapshotTick) / (CADENCE.physicsHz / CADENCE.snapshotHz)) - 1;
      if (gap > 0) this.stats.lostSnapshots += gap;
    }
    this.stats.snapshots++;
    this.lastSnapshotAt = now;
    this.lastSnapshotTick = s.tick;
    this.latest = s;
    this.clock.observe(s.tick, now);
    this.jitter.update(this.clock);
    if (s.echo) {
      const rtt = (((Math.floor(now) >>> 0) - s.echo) >>> 0) - s.hold;
      if (rtt >= 0 && rtt < 5000) {
        this.srtt = this.echoed ? this.srtt + (rtt - this.srtt) / 8 : rtt;
        this.echoed = true;
        this.stats.rttMs.push(rtt);
      }
    }
    this.adjustLead(s);
    this.commands.acknowledge(s.ackSeq);
    this.commands.prune(s.tick - 2 * this.predictor.options.responseLagTicks - 12);
    const own = s.cars.find((c) => c.id === this.car);
    if (own && this.commands.started)
      this.predictor.reconcile(own, s.tick, this.inputAt, this.commands.nextTick - 1, now);
  }
  /** Input lead control: keep the measured slack (how early new commands
   * reach the server) near a target that grows with arrival jitter. Fast to
   * grow (late inputs are mispredictions), slow to shrink. The initial lead
   * comes from the keep-alive round trip; a command that arrives after its
   * ticks were simulated reports negative slack, so a lead that started too
   * short still grows. */
  private adjustLead(s: Snapshot) {
    const target = 1.5 + 2 * this.clock.jitterTicks;
    if (this.stats.snapshots === 1 || (!this.commands.started && this.srtt >= 0))
      this.lead = (this.srtt >= 0 ? this.srtt / TICK_MS : 12) + target + 2;
    if (s.slack !== 127) {
      if (s.slack < target) this.lead += Math.min(2, target - s.slack);
      else if (s.slack > target + 2) this.lead -= 0.25;
    }
    if (s.missing > 0) this.lead += 1;
    this.lead = Math.max(2, Math.min(120, this.lead));
    this.stats.leadTicks.push(this.lead);
  }
  /** Compose what this client would draw now. */
  view(): ClientView {
    const now = this.now,
      local =
        this.predictor.ready && this.car >= 0
          ? {
              car: this.car,
              pose: this.predictor.render(now),
              tick: this.predictor.tick,
              kind: 'predicted' as const,
            }
          : null,
      renderTick = this.clock.arrivalTick(now) - this.jitter.delayTicks,
      remotes: RenderedCar[] = [];
    for (const [car, track] of this.remotes) {
      const sample = track.sample(renderTick);
      if (sample) remotes.push({ car, pose: sample.pose, tick: renderTick, kind: sample.kind });
    }
    return { now, local, remotes, stalled: now - this.lastSnapshotAt > STALL_MS };
  }
  private render() {
    if (!this.clock.synced) return;
    const view = this.view();
    if (view.stalled) this.stats.stalledFrames++;
    if (view.local) this.stats.renderKinds.predicted++;
    for (const r of view.remotes) this.stats.renderKinds[r.kind]++;
    this.stats.interpolationDelayTicks.push(this.jitter.delayTicks);
    this.config.onRender?.(view, this);
  }
  /** Stop all timers without telling the server (the process went away). */
  dispose() {
    this.stop('closed', 'disposed');
    this.config.transport.onMessage = null;
    this.config.transport.onClose = null;
  }
  /** Newest authoritative state of a car (HUD: laps, rank, flags). */
  carState(car: number): CarNetState | undefined {
    return this.latest?.cars.find((c) => c.id === car);
  }
  get aiDriven() {
    const own = this.carState(this.car);
    return own ? (own.flags & CAR_FLAG.AI) !== 0 : false;
  }
}
