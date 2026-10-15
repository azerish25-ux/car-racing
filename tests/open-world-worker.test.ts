import { afterEach, expect, it, vi } from 'vitest';
import { CAR_STRIDE, HEADER } from '../src/simulation/protocol.ts';
import type { FromOpenWorld, ToOpenWorld } from '../src/workers/open-world-protocol.ts';

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

/** The real festival worker driven in-process through its message protocol,
 * with the main thread's frame handling (FestivalSession.receive): every
 * frame replaces `current`, and the superseded `previous` buffer goes back
 * to the worker for reuse. */
it('keeps delivering frames when an event changes the field size, and after it ends', async () => {
  let now = 0;
  let pump: (() => void) | undefined;
  const received: FromOpenWorld[] = [];
  const scope = {
    onmessage: null as ((event: { data: ToOpenWorld }) => void) | null,
    postMessage(message: FromOpenWorld, transfer: Transferable[] = []) {
      received.push(structuredClone(message, { transfer }));
    },
  };
  vi.spyOn(performance, 'now').mockImplementation(() => now);
  vi.stubGlobal('self', scope);
  vi.stubGlobal('setInterval', (callback: () => void) => {
    pump = callback;
    return 1;
  });
  vi.resetModules();
  await import('../src/workers/open-world.worker.ts');
  const send = (data: ToOpenWorld, transfer: Transferable[] = []) =>
    scope.onmessage!({ data: structuredClone(data, { transfer }) });
  let previous: Float32Array | null = null,
    current: Float32Array | null = null,
    status: Extract<FromOpenWorld, { type: 'status' }>['status'] | null = null;
  const sizes: number[] = [];
  const drain = () => {
    for (const msg of received.splice(0)) {
      if (msg.type === 'error') throw new Error(msg.message);
      if (msg.type === 'status') status = msg.status;
      if (msg.type !== 'frame') continue;
      const frame = new Float32Array(msg.buffer);
      sizes.push(frame.length);
      if (previous && previous !== current) send({ type: 'recycle', buffer: previous.buffer as ArrayBuffer }, [previous.buffer]);
      previous = current ?? frame;
      current = frame;
    }
  };
  /** Advance the worker clock for `seconds`; frames delivered meanwhile. */
  const run = (seconds: number) => {
    const before = sizes.length;
    for (let t = 0; t < seconds; t += 0.008) {
      now += 8;
      pump!();
      drain();
    }
    return sizes.slice(before);
  };
  const solo = HEADER + CAR_STRIDE;
  send({ type: 'init', options: { vehicle: 'tc1', weather: 'clear', assist: 'sport', seed: 73021, discovered: [] } });
  drain();
  expect(sizes).toEqual([solo]);
  send({ type: 'pause', value: false });
  expect(pump).toBeDefined();
  // Free roam: a frame every other 120 Hz tick.
  const roam = run(1);
  expect(roam.length).toBeGreaterThan(40);
  expect(roam.every((n) => n === solo)).toBe(true);
  // A race adds rivals: frames of the new size keep coming.
  send({ type: 'command', command: { type: 'start', event: 'valley-sprint' } });
  drain();
  const field = HEADER + 4 * CAR_STRIDE;
  const race = run(1.5);
  expect(status!.mode).toMatch(/countdown|running/);
  expect(race.length).toBeGreaterThan(60);
  expect(race.every((n) => n === field)).toBe(true);
  expect(current!.length).toBe(field);
  // Abandon, then continue to free roam: back to one car, still live.
  send({ type: 'command', command: { type: 'cancel' } });
  drain();
  run(0.2);
  expect(status!.mode).toBe('finished');
  send({ type: 'command', command: { type: 'continue' } });
  drain();
  const after = run(1);
  // Free roam again (stopped at the marker, the race card may offer itself).
  expect(['free', 'card']).toContain(status!.mode);
  expect(after.length).toBeGreaterThan(40);
  expect(after.slice(1).every((n) => n === solo)).toBe(true);
  // A pause and resume does not change the cadence.
  send({ type: 'pause', value: true });
  send({ type: 'pause', value: false });
  drain();
  expect(run(0.5).length).toBeGreaterThan(20);
});
