import { DEFAULT_OPTIONS, validateOptions, type SessionOptions } from '../simulation/config.ts';
import type { CircuitId } from '../simulation/circuits.ts';
import { ShadowPilot, type PilotProfile } from './bots.ts';
import { RaceClient, type ClientView } from './client.ts';
import { CADENCE, TICK_MS } from './constants.ts';
import { EventLoop, NetRandom } from './event-loop.ts';
import { distribution, type Distribution } from './guards.ts';
import { Lobby } from './lobby.ts';
import type { SessionPhase } from './messages.ts';
import { verifyRecord, type VerifyResult } from './records.ts';
import { RaceServer, type DisconnectPolicy } from './server.ts';
import {
  NetworkSimulator,
  TARGET_LINK,
  type DirectionStats,
  type LinkConditions,
  type SimulatedLink,
} from './transport.ts';
import type { AuthoritativeWorld } from './authority.ts';

export interface SliceConfig {
  clients: number;
  seed: number;
  circuit?: CircuitId;
  /** Simulated seconds of racing after the green light. */
  raceSeconds: number;
  link?: LinkConditions;
  /** Pilot profile per client (cycled); default alternates smooth/humanized. */
  profiles?: PilotProfile[];
  /** Cut one client's link at `atSeconds` (session clock) and reconnect a new
   * client process with its token `offlineSeconds` later. */
  disconnect?: { client: number; atSeconds: number; offlineSeconds: number };
  disconnectPolicy?: DisconnectPolicy;
  /** Re-simulate the archived record headlessly (default true). */
  verify?: boolean;
  progress?: (message: string) => void;
}

/** Ground truth for the harness: every car's position at every tick in a
 * sliding window, recorded by the server. Clients never read it. */
class TruthRing {
  private readonly data: Float64Array;
  newest = -1;
  constructor(
    private readonly cars: number,
    private readonly size = 512,
  ) {
    this.data = new Float64Array(cars * size * 3);
  }
  record(world: AuthoritativeWorld) {
    const t = world.tick,
      slot = t % this.size;
    world.sim.cars.forEach((c, i) => {
      const o = (slot * this.cars + i) * 3;
      this.data[o] = c.body.position.x;
      this.data[o + 1] = c.body.position.y;
      this.data[o + 2] = c.body.position.z;
    });
    this.newest = t;
  }
  at(car: number, tick: number): [number, number, number] | null {
    const a = Math.floor(tick),
      b = a + 1,
      u = tick - a;
    if (a < 1 || b > this.newest || this.newest - a >= this.size - 1) return null;
    const oa = ((a % this.size) * this.cars + car) * 3,
      ob = ((b % this.size) * this.cars + car) * 3,
      d = this.data;
    return [
      d[oa] + (d[ob] - d[oa]) * u,
      d[oa + 1] + (d[ob + 1] - d[oa + 1]) * u,
      d[oa + 2] + (d[ob + 2] - d[oa + 2]) * u,
    ];
  }
}

const kbit = (bytes: number, seconds: number) => (bytes * 8) / 1000 / Math.max(1e-9, seconds);
const round = (v: number, digits = 4) => Math.round(v * 10 ** digits) / 10 ** digits;
const roundDist = (d: Distribution, digits = 4): Distribution => ({
  samples: d.samples,
  mean: round(d.mean, digits),
  p50: round(d.p50, digits),
  p95: round(d.p95, digits),
  p99: round(d.p99, digits),
  max: round(d.max, digits),
});

export interface SliceReport {
  fixture: string;
  cadences: typeof CADENCE & { ticksPerCommand: number; ticksPerSnapshot: number };
  link: LinkConditions & { roundTripMs: number };
  session: {
    phases: { phase: SessionPhase; atMs: number }[];
    raceSeconds: number;
    simulatedSeconds: number;
    endTick: number;
    reason: string;
  };
  bandwidth: {
    perClientDownKbit: Distribution;
    perClientUpKbit: Distribution;
    perClientDownWireKbit: Distribution;
    perClientUpWireKbit: Distribution;
    snapshotBytes: Distribution;
    inputPacketBytes: Distribution;
    wp49CompactEstimateKbit: number;
    note: string;
  };
  inputs: {
    commandsSent: number;
    packetsSent: number;
    /** Copies of each command sent on average (redundancy). */
    copiesPerCommand: number;
    duplicatesDropped: number;
    lateCommands: number;
    lateTicks: number;
    missingTicks: number;
    rejected: number;
    appliedTicks: number;
    leadTicks: Distribution;
  };
  prediction: {
    positionErrorM: Distribution;
    /** Human-driven, no server-resolved contact within the prediction window. */
    positionErrorCleanM: Distribution;
    positionErrorNearContactM: Distribution;
    positionErrorAiDrivenM: Distribution;
    headingErrorDeg: Distribution;
    correctionM: Distribution;
    visualStepM: Distribution;
    snaps: number;
    note: string;
  };
  interpolation: {
    delayMs: Distribution;
    positionErrorM: Distribution;
    renderKinds: Record<string, number>;
    /** Frames a client drew while it knew it was not receiving snapshots. */
    stalledFrames: number;
  };
  network: {
    rttMs: Distribution;
    upDropped: number;
    downDropped: number;
    duplicated: number;
    reordered: number;
    snapshotsLost: number;
    snapshotsLate: number;
    snapshotsDuplicate: number;
  };
  server: ReturnType<RaceServer['budget']['report']> & { cpuMsPerSimulatedSecond: number };
  resilience: {
    disconnect: null | {
      car: number;
      severedAtMs: number;
      takeoverAfterMs: number | null;
      rejoinedAfterMs: number | null;
      humanAgainAfterMs: number | null;
    };
    invalidMessages: number;
    rateLimited: number;
    kicks: number;
    inputStarvations: number;
  };
  classification: {
    position: number;
    car: number;
    name: string;
    laps: number;
    lapTimes: number[];
    status: string;
  }[];
  progressDisputes: number[];
  verification: (VerifyResult & { recordBytes: number; journalEntries: number }) | null;
}

export interface SliceRun {
  report: SliceReport;
  server: RaceServer;
  /** The current client per driver (after any reconnect). */
  clients: RaceClient[];
  everyClient: RaceClient[];
}

/** Run an in-memory online race: one authoritative server, `clients`
 * networked drivers over simulated links, then verify the archived record.
 * Everything is on one deterministic event loop, so a run is reproducible
 * from its seed (wall-clock tick timing aside). */
export function runOnlineSlice(config: SliceConfig): SliceRun {
  const loop = new EventLoop(),
    net = new NetworkSimulator(loop, config.seed),
    link = config.link ?? TARGET_LINK,
    n = config.clients,
    log = config.progress ?? (() => {});
  const options: SessionOptions = validateOptions({
    ...DEFAULT_OPTIONS,
    circuit: config.circuit ?? 'aurel',
    mode: 'race',
    laps: 3,
    opponents: n - 1,
    seed: config.seed,
  });
  const created = Lobby.create('slice', {
    name: 'Online slice',
    options,
    capacity: n,
    fieldSize: n,
    minPlayers: n,
  });
  if (!created.ok) throw new Error(created.reasons.join('; '));
  const truth = new TruthRing(n);
  const linkStats = new Map<SimulatedLink, { up: DirectionStats; down: DirectionStats }>();
  let raceStartMs = 0,
    raceEndMs = 0;
  const snapshotLinks = () => {
    for (const l of net.links) linkStats.set(l, { up: { ...l.upStats }, down: { ...l.downStats } });
  };
  const server = new RaceServer({
    loop,
    lobby: created.lobby,
    raceSeconds: config.raceSeconds,
    disconnectPolicy: config.disconnectPolicy ?? 'ai-takeover',
    seed: config.seed,
    onTick: (world) => truth.record(world),
    onPhase: (phase) => {
      log(`phase ${phase} at ${(loop.now / 1000).toFixed(2)} s`);
      if (phase === 'race') {
        raceStartMs = loop.now;
        snapshotLinks();
      }
      if (phase === 'results') raceEndMs = loop.now;
    },
  });
  const profiles = config.profiles ?? ['smooth', 'humanized'];
  const pilots = new Map<number, ShadowPilot>();
  const remoteErrors: number[] = [];
  const random = new NetRandom(config.seed ^ 0x51ce);
  const measure = (view: ClientView) => {
    // A client that knows it is cut off shows a connection warning instead.
    if (view.stalled) return;
    for (const r of view.remotes) {
      const real = truth.at(r.car, r.tick);
      if (real) {
        const e = Math.hypot(r.pose.x - real[0], r.pose.y - real[1], r.pose.z - real[2]);
        remoteErrors.push(e);
      }
    }
  };
  const makeClient = (index: number, token?: string) => {
    const pair = net.connect(link, link, `client${index}${token ? '-rejoin' : ''}`);
    server.accept(pair.server);
    const client: RaceClient = new RaceClient({
      loop,
      transport: pair.client,
      name: `Driver ${index + 1}`,
      vehicle: 'apx01',
      advertised: options,
      autoReady: true,
      clockOffsetMs: Math.round((random.next() - 0.5) * 2e6),
      ...(token ? { token } : {}),
      input: () => {
        const world = server.world;
        if (!world || client.car < 0) return null;
        let pilot = pilots.get(client.car);
        if (!pilot) {
          pilot = new ShadowPilot(
            world,
            client.car,
            profiles[index % profiles.length],
            config.seed + index,
          );
          pilots.set(client.car, pilot);
        }
        return pilot.sample(1 / CADENCE.inputSampleHz);
      },
      onRender: measure,
    });
    return { client, link: pair.link };
  };
  const clients: RaceClient[] = [],
    links: SimulatedLink[] = [];
  /** Every client process, including ones replaced after a reconnect. */
  const everyClient: RaceClient[] = [];
  for (let i = 0; i < n; i++) {
    const made = makeClient(i);
    clients.push(made.client);
    everyClient.push(made.client);
    links.push(made.link);
    loop.at(20 + i * 37, () => made.client.join());
  }
  let disconnectInfo: SliceReport['resilience']['disconnect'] = null;
  if (config.disconnect) {
    const d = config.disconnect;
    const watch = loop.every(50, () => {
      const world = server.world;
      if (!world || server.phase !== 'race' || world.sim.race.time < d.atSeconds) return;
      watch();
      const victim = clients[d.client],
        car = victim.car,
        token = victim.token;
      links[d.client].sever();
      disconnectInfo = {
        car,
        severedAtMs: loop.now,
        takeoverAfterMs: null,
        rejoinedAfterMs: null,
        humanAgainAfterMs: null,
      };
      log(
        `severed client ${d.client} (car ${car}) at race time ${world.sim.race.time.toFixed(2)} s`,
      );
      loop.after(d.offlineSeconds * 1000, () => {
        victim.dispose();
        const again = makeClient(d.client, token);
        clients[d.client] = again.client;
        everyClient.push(again.client);
        links[d.client] = again.link;
        again.client.join();
        log(`client ${d.client} reconnecting with its token`);
      });
    });
  }
  const capMs = (config.raceSeconds + 30) * 1000;
  loop.runWhile(() => server.phase !== 'teardown', capMs);
  if (server.phase !== 'teardown') throw new Error(`Slice did not finish (phase ${server.phase})`);
  const world = server.world as AuthoritativeWorld,
    raceSeconds = (raceEndMs - raceStartMs) / 1000;

  // Bandwidth over the race window, per client (all of a client's links).
  const perClient = new Map<
    string,
    { up: number; down: number; upWire: number; downWire: number }
  >();
  for (const l of net.links) {
    const base = linkStats.get(l),
      key = l.client.label.replace(/-rejoin.*$/, '').replace(/:client$/, ''),
      sum = perClient.get(key) ?? { up: 0, down: 0, upWire: 0, downWire: 0 };
    sum.up += l.upStats.payloadBytes - (base?.up.payloadBytes ?? 0);
    sum.down += l.downStats.payloadBytes - (base?.down.payloadBytes ?? 0);
    sum.upWire += l.upStats.wireBytes - (base?.up.wireBytes ?? 0);
    sum.downWire += l.downStats.wireBytes - (base?.down.wireBytes ?? 0);
    perClient.set(key, sum);
  }
  const sums = [...perClient.values()];
  const all = <T>(pick: (c: RaceClient) => T[]) => everyClient.flatMap(pick);
  const inputStats = server.inputStats(),
    total = (key: keyof (typeof inputStats)[number]) =>
      inputStats.reduce((s, row) => s + (row[key] as number), 0);
  const commandsSent = everyClient.reduce((s, c) => s + c.stats.commands, 0),
    packetsSent = everyClient.reduce((s, c) => s + c.stats.inputPackets, 0),
    copies = everyClient.reduce((s, c) => s + c.stats.commandCopies, 0) / Math.max(1, commandsSent);

  if (disconnectInfo) {
    const d = disconnectInfo as NonNullable<SliceReport['resilience']['disconnect']>;
    const takeover = server.stats.takeovers.find((t) => t.car === d.car && t.at >= d.severedAtMs),
      rejoin = server.stats.rejoins.find((r) => r.car === d.car && r.at >= d.severedAtMs),
      human = world.journal.find(
        (e) =>
          e.kind === 'mode' &&
          e.car === d.car &&
          e.mode === 'human' &&
          e.tick * TICK_MS + raceStartMs > d.severedAtMs,
      );
    d.takeoverAfterMs = takeover ? round(takeover.at - d.severedAtMs, 1) : null;
    d.rejoinedAfterMs = rejoin ? round(rejoin.at - d.severedAtMs, 1) : null;
    d.humanAgainAfterMs = human
      ? round(human.tick * TICK_MS + raceStartMs - d.severedAtMs, 1)
      : null;
  }

  let verification: SliceReport['verification'] = null;
  if (config.verify !== false && server.record) {
    log('verifying the archived record by headless re-simulation');
    const result = verifyRecord(JSON.parse(JSON.stringify(server.record)));
    verification = {
      ...result,
      ...(result.ok ? { cpuMs: round(result.cpuMs, 1) } : {}),
      recordBytes: JSON.stringify(server.record).length,
      journalEntries: server.record.journalEntries,
    };
  }
  const budget = server.budget.report();
  const stats = net.links;
  const report: SliceReport = {
    fixture: `${n}-client online race on ${options.circuit}, ${config.raceSeconds} s of racing after the green light, in-memory transport`,
    cadences: {
      ...CADENCE,
      ticksPerCommand: CADENCE.physicsHz / CADENCE.inputSampleHz,
      ticksPerSnapshot: CADENCE.physicsHz / CADENCE.snapshotHz,
    },
    link: { ...link, roundTripMs: 2 * link.latencyMs },
    session: {
      phases: server.stats.phases.map((p) => ({ phase: p.phase, atMs: round(p.at, 1) })),
      raceSeconds: round(raceSeconds, 3),
      simulatedSeconds: round(world.sim.race.time, 3),
      endTick: world.tick,
      reason: server.results?.reason ?? 'none',
    },
    bandwidth: {
      perClientDownKbit: roundDist(distribution(sums.map((s) => kbit(s.down, raceSeconds))), 2),
      perClientUpKbit: roundDist(distribution(sums.map((s) => kbit(s.up, raceSeconds))), 2),
      perClientDownWireKbit: roundDist(
        distribution(sums.map((s) => kbit(s.downWire, raceSeconds))),
        2,
      ),
      perClientUpWireKbit: roundDist(distribution(sums.map((s) => kbit(s.upWire, raceSeconds))), 2),
      snapshotBytes: roundDist(distribution(all((c) => c.stats.snapshotBytes)), 1),
      inputPacketBytes: roundDist(distribution(all((c) => c.stats.inputBytes)), 1),
      wp49CompactEstimateKbit: (34 * n * CADENCE.snapshotHz * 8) / 1000,
      note: "Payload excludes, wire includes 28 B IPv4+UDP per datagram (and reliable retransmissions). Measured over the race window. WP49 estimated per-car payload only; the measured snapshot adds a 23 B per-recipient header and the receiving car's angular velocity and acceleration.",
    },
    inputs: {
      commandsSent,
      packetsSent,
      copiesPerCommand: round(copies, 2),
      duplicatesDropped: total('duplicates'),
      lateCommands: total('late'),
      lateTicks: total('lateTicks'),
      missingTicks: total('missingTicks'),
      rejected: total('rejected'),
      appliedTicks: total('appliedTicks'),
      leadTicks: roundDist(distribution(all((c) => c.stats.leadTicks)), 2),
    },
    prediction: {
      positionErrorM: roundDist(distribution(all((c) => c.predictor.stats.positionError))),
      positionErrorCleanM: roundDist(
        distribution(all((c) => c.predictor.stats.positionErrorClean)),
      ),
      positionErrorNearContactM: roundDist(
        distribution(all((c) => c.predictor.stats.positionErrorContact)),
      ),
      positionErrorAiDrivenM: roundDist(
        distribution(all((c) => c.predictor.stats.positionErrorAi)),
      ),
      headingErrorDeg: roundDist(distribution(all((c) => c.predictor.stats.headingError))),
      correctionM: roundDist(distribution(all((c) => c.predictor.stats.correction))),
      visualStepM: roundDist(distribution(all((c) => c.predictor.stats.visualStep)), 5),
      snaps: everyClient.reduce((s, c) => s + c.predictor.stats.snaps, 0),
      note: 'positionError: displayed (full-horizon) prediction of the local car vs the authoritative state for the same tick; correction: jump of the present predicted pose on reconciliation, before smoothing; visualStep: per-frame motion added by the decaying smoothing offset.',
    },
    interpolation: {
      delayMs: roundDist(
        distribution(all((c) => c.stats.interpolationDelayTicks).map((t) => t * TICK_MS)),
        2,
      ),
      positionErrorM: roundDist(distribution(remoteErrors)),
      renderKinds: everyClient.reduce(
        (acc, c) => {
          for (const [k, v] of Object.entries(c.stats.renderKinds)) acc[k] = (acc[k] ?? 0) + v;
          return acc;
        },
        {} as Record<string, number>,
      ),
      stalledFrames: everyClient.reduce((s, c) => s + c.stats.stalledFrames, 0),
    },
    network: {
      rttMs: roundDist(distribution(all((c) => c.stats.rttMs)), 2),
      upDropped: stats.reduce((s, l) => s + l.upStats.dropped, 0),
      downDropped: stats.reduce((s, l) => s + l.downStats.dropped, 0),
      duplicated: stats.reduce((s, l) => s + l.upStats.duplicated + l.downStats.duplicated, 0),
      reordered: stats.reduce((s, l) => s + l.upStats.reordered + l.downStats.reordered, 0),
      snapshotsLost: everyClient.reduce((s, c) => s + c.stats.lostSnapshots, 0),
      snapshotsLate: everyClient.reduce((s, c) => s + c.stats.lateSnapshots, 0),
      snapshotsDuplicate: everyClient.reduce((s, c) => s + c.stats.duplicateSnapshots, 0),
    },
    server: {
      ...budget,
      meanMs: round(budget.meanMs),
      p99Ms: round(budget.p99Ms),
      worstMs: round(budget.worstMs),
      cpuMsPerSimulatedSecond: round(budget.meanMs * CADENCE.physicsHz, 2),
    },
    resilience: {
      disconnect: disconnectInfo,
      invalidMessages: server.stats.invalidMessages,
      rateLimited: server.stats.rateLimited,
      kicks: server.stats.kicks.length,
      inputStarvations: server.stats.starvations,
    },
    classification: (server.results?.classification ?? []).map((r) => ({
      position: r.position,
      car: r.car,
      name: r.name,
      laps: r.laps,
      lapTimes: r.lapTimes,
      status: r.status,
    })),
    progressDisputes: server.results?.progressDisputes ?? [],
    verification,
  };
  return { report, server, clients, everyClient };
}
