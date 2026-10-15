/// <reference lib="webworker" />
import { FixedStepper } from '../core/math.ts';
import { CAR_STRIDE, HEADER } from '../simulation/protocol.ts';
import { REPLAY_TICKS, TelemetrySampler } from '../storage/telemetry-sampler.ts';
import { Simulation } from '../simulation/world.ts';
import { controls, type Controls, type SessionOptions } from '../simulation/config.ts';
import { InputLog, Resimulation, flashbackFloor } from '../core/flashback.ts';
import { EngineeringProbe, type ClientMessage, type WorkerMessage } from './diagnostics.ts';
const probe = new EngineeringProbe();
const scope = self as unknown as DedicatedWorkerGlobalScope;
let simulation: Simulation | null = null,
  paused = true,
  previous = performance.now(),
  lastInput = previous,
  stepMs = 0;
const clock = new FixedStepper();
let pool: ArrayBuffer[] = [];
let telemetry: TelemetrySampler | null = null;
// D31 flashback: every applied input, the session options and a running rewind.
let log = new InputLog(),
  sessionOptions: SessionOptions | null = null,
  rewind: Resimulation | null = null;
function applyInput(input: Controls) {
  if (!simulation) return;
  log.input(simulation.tick, input);
  simulation.setInput(input);
}
function recorder(sim: Simulation) {
  return new TelemetrySampler(
    sim,
    (buffer, rows) => send({ type: 'telemetry', buffer, rows }, [buffer]),
    (message) => send({ type: 'recordingWarning', message }),
    (buffer, rows) => send({ type: 'replayFrames', buffer, rows }, [buffer]),
  );
}
/** Swap in the re-simulated session at the flashback tick and report it. */
function finishFlashback(job: Resimulation) {
  simulation = job.simulation;
  log.truncate(job.target);
  telemetry = recorder(simulation);
  clock.reset();
  probe.reset();
  previous = performance.now();
  lastInput = previous;
  lastSent = simulation.tick;
  lastSurface = -1;
  lastPitPhase = simulation.cars[0].pitPhase;
  send({ type: 'flashback', tick: simulation.tick, time: simulation.race.time });
  const water = simulation.track.water.slice(),
    rubber = simulation.track.rubber.slice(),
    marbles = simulation.track.marbles.slice(),
    terrain = simulation.offroad?.terrain.renderDelta(true);
  send({ type: 'surface', water, rubber, marbles, time: simulation.race.time, terrain }, [
    water.buffer,
    rubber.buffer,
    marbles.buffer,
    ...(terrain ? [terrain.blocks.buffer] : []),
  ]);
  snapshot(true);
}
let lastSent = -1,
  lastSurface = -1,
  lastPitPhase = 0;
const send = (msg: WorkerMessage, transfer: Transferable[] = []) =>
  scope.postMessage(msg, transfer);
function engineering() {
  if (!simulation) return;
  const sample = probe.sample(simulation);
  if (sample) send({ type: 'engineering', sample });
}
function snapshot(required = false) {
  if (!simulation || (pool.length === 0 && !required)) return;
  // A paused consumer may still hold every transferable frame. Only an explicit
  // pause barrier or a player pit-service transition may allocate a snapshot;
  // normal frame delivery stays pooled.
  const buffer =
    pool.pop() ?? new ArrayBuffer((HEADER + simulation.cars.length * CAR_STRIDE) * 4);
  simulation.writeFrame(new Float32Array(buffer), stepMs, clock.droppedSeconds);
  send({ type: 'frame', buffer }, [buffer]);
}
scope.onmessage = (event: MessageEvent<ClientMessage>) => {
  try {
    const msg = event.data;
    switch (msg.type) {
      case 'engineering':
        probe.enable(msg.enabled);
        engineering();
        break;
      case 'init':
        probe.reset();
        simulation = new Simulation(msg.options);
        sessionOptions = msg.options;
        log = new InputLog();
        rewind = null;
        telemetry = recorder(simulation);
        clock.reset();
        paused = true;
        previous = performance.now();
        lastInput = previous;
        pool = Array.from(
          { length: 5 },
          () => new ArrayBuffer((HEADER + simulation!.cars.length * CAR_STRIDE) * 4),
        );
        lastSent = -1;
        lastSurface = -1;
        lastPitPhase = simulation.cars[0].pitPhase;
        snapshot();
        break;
      case 'input':
        applyInput(msg.input);
        lastInput = performance.now();
        break;
      case 'pause':
        if (
          msg.sequence !== undefined &&
          (!Number.isSafeInteger(msg.sequence) || msg.sequence < 1)
        )
          throw new Error('Invalid worker pause sequence');
        paused = msg.value;
        previous = performance.now();
        lastInput = previous;
        if (paused) {
          telemetry?.flush();
          telemetry?.flushReplay();
          applyInput(controls());
          snapshot(true);
        }
        // Dedicated-worker messages retain this ordering: recording flushes,
        // final paused snapshot, then the matching low-frequency receipt.
        if (simulation && msg.sequence !== undefined)
          send({ type: 'pauseState', sequence: msg.sequence, value: paused, tick: simulation.tick });
        break;
      case 'pit':
        if (simulation) log.pit(simulation.tick, msg.compound);
        simulation?.requestPit(msg.compound);
        break;
      case 'autopilot':
        if (simulation) {
          log.autopilot(simulation.tick, msg.value);
          simulation.autoPlayer = msg.value;
        }
        break;
      case 'flashback':
        if (
          !simulation ||
          !sessionOptions ||
          rewind ||
          !Number.isInteger(msg.tick) ||
          msg.tick < flashbackFloor(simulation.tick) ||
          msg.tick > simulation.tick
        )
          throw new Error('Invalid flashback request');
        paused = true;
        telemetry?.flush();
        telemetry?.flushReplay();
        rewind = new Resimulation(sessionOptions, log.entries.slice(), msg.tick);
        break;
      case 'recycleReplay':
        telemetry?.recycleReplay(msg.buffer);
        break;
      case 'recycleTelemetry':
        telemetry?.recycle(msg.buffer);
        break;
      case 'recycle':
        if (
          simulation &&
          msg.buffer.byteLength === (HEADER + simulation.cars.length * CAR_STRIDE) * 4 &&
          pool.length < 6
        )
          pool.push(msg.buffer);
        break;
    }
  } catch (error) {
    paused = true;
    send({ type: 'error', message: error instanceof Error ? error.message : String(error) });
  }
};
setInterval(() => {
  const now = performance.now(),
    elapsed = (now - previous) / 1000;
  previous = now;
  if (rewind) {
    // Re-simulate in slices (~2000 steps per turn) so messages keep flowing.
    try {
      const job = rewind;
      if (job.run()) {
        rewind = null;
        finishFlashback(job);
      }
    } catch (error) {
      rewind = null;
      send({ type: 'error', message: error instanceof Error ? error.message : String(error) });
    }
    return;
  }
  if (paused || !simulation) return;
  try {
    if (now - lastInput > 750) applyInput({ ...controls(), brake: 0.4 });
    const start = performance.now(),
      before = clock.ticks;
    clock.advance(elapsed, (dt) => {
      simulation!.step(dt);
      telemetry?.capture(stepMs, clock.droppedSeconds);
      // Service phases last 0.8-1.7 s. A stalled consumer (every pooled frame
      // held) or a starved worker batch must not skip one, so each player
      // phase is delivered once, on its first tick that is also a recorded
      // replay frame (every REPLAY_TICKS). Evidence rows can then be located
      // exactly in the replay, which a mid-interval tick could not be.
      const pitPhase = simulation!.cars[0].pitPhase;
      if (pitPhase !== lastPitPhase && simulation!.tick % REPLAY_TICKS === 0) {
        lastPitPhase = pitPhase;
        snapshot(true);
        lastSent = simulation!.tick;
      }
    });
    const count = clock.ticks - before;
    if (count) stepMs = stepMs * 0.9 + ((performance.now() - start) / count) * 0.1;
    if (simulation.tick - lastSent >= 2) {
      snapshot();
      lastSent = simulation.tick;
    }
    engineering();
    if (simulation.tick - lastSurface >= 60) {
      const water = simulation.track.water.slice(),
        rubber = simulation.track.rubber.slice(),
        marbles = simulation.track.marbles.slice(),
        // Terrain venues: the soil deformed since the last keyframe (the
        // whole field on a session's first keyframe).
        terrain = simulation.offroad?.terrain.renderDelta(lastSurface < 0);
      // Surface keyframes are independently timestamped. Flushing replay here
      // would send half-empty pages every 0.5 s and halve the configured stall reserve.
      // SessionReplay carries leading surface keyframes across pose-page boundaries.
      send({ type: 'surface', water, rubber, marbles, time: simulation.race.time, terrain }, [
        water.buffer,
        rubber.buffer,
        marbles.buffer,
        ...(terrain ? [terrain.blocks.buffer] : []),
      ]);
      lastSurface = simulation.tick;
    }
  } catch (error) {
    paused = true;
    send({
      type: 'error',
      message: error instanceof Error ? (error.stack ?? error.message) : String(error),
    });
  }
}, 4);
