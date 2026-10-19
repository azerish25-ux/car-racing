/// <reference lib="webworker" />
import { worldRegion } from '../simulation/open-world/regions.ts';
import { FixedStepper } from '../core/math.ts';
import { controls, type Controls } from '../simulation/config.ts';
import { OpenWorldSimulation } from '../simulation/open-world/session.ts';
import { CAR_STRIDE, HEADER } from '../simulation/protocol.ts';
import type { FromOpenWorld, ToOpenWorld } from './open-world-protocol.ts';

/** Festival free-roam simulation worker: the same fixed 120 Hz stepping and
 * pooled transferable snapshots as the circuit worker, plus a 10 Hz status
 * message for the festival HUD and one message per event result. Terrain
 * tiles stream inside the session within its residency budget. */
const scope = self as unknown as DedicatedWorkerGlobalScope;
let simulation: OpenWorldSimulation | null = null,
  paused = true,
  previous = performance.now(),
  lastInput = previous,
  stepMs = 0,
  lastSent = -1,
  lastStatus = -Infinity;
const clock = new FixedStepper();
/** Transferable frame buffers of the current field size. The field grows
 * when an event adds rivals and shrinks when it ends: the pool is refilled at
 * the new size then, because buffers of the old size coming back from the
 * main thread are dropped and would otherwise leave it empty for good. */
const POOL_SIZE = 4;
let pool: ArrayBuffer[] = [],
  poolBytes = 0;
const send = (msg: FromOpenWorld, transfer: Transferable[] = []) =>
  scope.postMessage(msg, transfer);
const frameBytes = () => (HEADER + (simulation?.cars.length ?? 1) * CAR_STRIDE) * 4;
function fillPool(bytes: number) {
  pool = Array.from({ length: POOL_SIZE }, () => new ArrayBuffer(bytes));
  poolBytes = bytes;
}
function snapshot(required = false) {
  if (!simulation) return;
  const bytes = frameBytes();
  if (bytes !== poolBytes) fillPool(bytes);
  if (!pool.length && !required) return;
  const buffer = pool.pop() ?? new ArrayBuffer(bytes);
  simulation.writeFrame(new Float32Array(buffer), stepMs, clock.droppedSeconds);
  // Ambient traffic rides with the frame it belongs to (a few hundred bytes).
  if (simulation.traffic.cars.length) {
    const traffic = simulation.trafficFrame().buffer as ArrayBuffer;
    send({ type: 'frame', buffer, traffic }, [buffer, traffic]);
  } else send({ type: 'frame', buffer }, [buffer]);
}
function status() {
  if (!simulation) return;
  send({ type: 'status', status: simulation.status() });
  lastStatus = performance.now();
}
function applyInput(input: Controls) {
  simulation?.setInput(input);
}
scope.onmessage = (event: MessageEvent<ToOpenWorld>) => {
  try {
    const msg = event.data;
    switch (msg.type) {
      case 'init': {
        const start = performance.now();
        simulation = new OpenWorldSimulation({
          ...msg.options,
          region: worldRegion(msg.options.regionId),
        });
        clock.reset();
        paused = true;
        previous = performance.now();
        lastInput = previous;
        fillPool(frameBytes());
        lastSent = -1;
        send({
          type: 'ready',
          buildMs: performance.now() - start,
          vehicle: simulation.player.definition.id,
        });
        snapshot(true);
        status();
        break;
      }
      case 'input':
        applyInput(msg.input);
        lastInput = performance.now();
        break;
      case 'pause':
        paused = msg.value;
        previous = performance.now();
        lastInput = previous;
        if (paused) {
          applyInput(controls());
          snapshot(true);
          status();
        }
        break;
      case 'command': {
        const before = simulation?.cars.length;
        simulation?.command(msg.command);
        // A field change or teleport: deliver the new state at once.
        if (simulation && (simulation.cars.length !== before || paused)) snapshot(true);
        status();
        break;
      }
      case 'recycle':
        // A buffer of a previous field size is dropped (the pool was refilled).
        if (simulation && msg.buffer.byteLength === poolBytes && pool.length < POOL_SIZE + 2)
          pool.push(msg.buffer);
        break;
    }
  } catch (error) {
    send({ type: 'error', message: error instanceof Error ? error.message : String(error) });
  }
};
setInterval(() => {
  const now = performance.now(),
    elapsed = (now - previous) / 1000;
  previous = now;
  if (paused || !simulation) return;
  try {
    if (now - lastInput > 750) applyInput({ ...controls(), brake: 0.4 });
    const start = performance.now(),
      before = clock.ticks,
      cars = simulation.cars.length;
    clock.advance(elapsed, (dt) => {
      simulation!.step(dt);
      const result = simulation!.takeResult();
      if (result) send({ type: 'result', result });
    });
    const count = clock.ticks - before;
    if (count) stepMs = stepMs * 0.9 + ((performance.now() - start) / count) * 0.1;
    if (simulation.cars.length !== cars) snapshot(true);
    else if (simulation.tick - lastSent >= 2) {
      snapshot();
      lastSent = simulation.tick;
    }
    if (performance.now() - lastStatus > 100) status();
  } catch (error) {
    paused = true;
    send({
      type: 'error',
      message: error instanceof Error ? (error.stack ?? error.message) : String(error),
    });
  }
}, 4);
