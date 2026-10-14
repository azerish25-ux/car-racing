import { describe, expect, it } from 'vitest';
import { GpuFrameGate } from '../src/rendering/gpu-frame-gate.ts';

function fixture() {
  const clock = { now: 0 };
  const state = {
    lost: false,
    allocationFails: false,
    wait: 2,
    next: 0,
    deleted: [] as WebGLSync[],
    waits: [] as number[][],
    flushes: 0,
    finishes: 0,
    finishCost: 0,
    fences: [] as number[][],
  };
  const gl = {
    SYNC_GPU_COMMANDS_COMPLETE: 1,
    TIMEOUT_EXPIRED: 2,
    ALREADY_SIGNALED: 3,
    CONDITION_SATISFIED: 4,
    WAIT_FAILED: 5,
    isContextLost: () => state.lost,
    fenceSync: (condition: number, flags: number) => {
      state.fences.push([condition, flags]);
      return state.allocationFails ? null : ({ id: ++state.next } as WebGLSync);
    },
    clientWaitSync: (_fence: WebGLSync, flags: number, timeout: number) => {
      state.waits.push([flags, timeout]);
      return state.wait;
    },
    deleteSync: (fence: WebGLSync) => state.deleted.push(fence),
    flush: () => state.flushes++,
    finish: () => {
      state.finishes++;
      // gl.finish blocks until outstanding GPU work completes.
      clock.now += state.finishCost;
    },
  } as unknown as WebGL2RenderingContext;
  return { gate: new GpuFrameGate(gl, () => clock.now), gl, state, clock };
}

describe('bounded asynchronous GPU frame submissions', () => {
  it('never deadlocks on a fence whose status is not refreshed (F01)', () => {
    const { gate, gl, state, clock } = fixture();
    gate.submittedFrame();
    state.wait = gl.TIMEOUT_EXPIRED;
    // A held replay submits nothing else; the status poll never changes.
    for (let ms = 1; ms <= 1200; ms++) {
      clock.now = ms;
      expect(gate.ready()).toBe(ms >= 1000);
      if (gate.diagnostics().expiredFences) break;
    }
    expect(gate.diagnostics()).toMatchObject({ pending: false, expiredFences: 1 });
    expect(state.deleted).toHaveLength(1);
    // A fence that completes within the bound is still awaited normally.
    gate.submittedFrame();
    clock.now += 100;
    expect(gate.ready()).toBe(false);
  });
  it('drains rather than queueing: a slow GPU never has two frames in flight', () => {
    const { gate, gl, state, clock } = fixture();
    // Frames that genuinely take 2 s each, polled every 16 ms. A drain at the
    // 1 s floor blocks for the remaining second of real GPU work.
    state.finishCost = 1000;
    for (let i = 0; i < 6; i++) {
      gate.submittedFrame();
      let done = false;
      for (let t = 16; t <= 2000 && !done; t += 16) {
        clock.now += 16;
        state.wait = t >= 2000 ? gl.CONDITION_SATISFIED : gl.TIMEOUT_EXPIRED;
        done = gate.ready();
      }
      // Whatever released the fence, nothing is outstanding before the next draw.
      expect(gate.diagnostics().pending).toBe(false);
      expect(gate.diagnostics().completed).toBe(gate.diagnostics().submitted);
    }
    // Early releases always drained the GPU first.
    expect(state.finishes).toBe(gate.diagnostics().expiredFences);
    // Once latency is learned, a 2 s frame is awaited by polling, not drained.
    expect(gate.waitBoundMs).toBeGreaterThan(2000);
    // A stale fence (work long done) is resolved without learning latency.
    state.finishCost = 0;
    const learned = gate.diagnostics().latencyMs;
    gate.submittedFrame();
    state.wait = gl.TIMEOUT_EXPIRED;
    for (let t = 0; t < 10000; t += 16) {
      clock.now += 16;
      if (gate.ready()) break;
    }
    expect(gate.diagnostics().pending).toBe(false);
    expect(gate.diagnostics().latencyMs).toBe(learned);
  });
  it('ignores completions first observed after an idle period and caps the bound', () => {
    const { gate, gl, state, clock } = fixture();
    gate.submittedFrame();
    // Held replay: nothing polls for a minute, then the fence is seen done.
    clock.now += 60000;
    state.wait = gl.CONDITION_SATISFIED;
    expect(gate.ready()).toBe(true);
    expect(gate.diagnostics().latencyMs).toBe(0);
    expect(gate.waitBoundMs).toBe(1000);
    expect(gate.maxWaitMs).toBe(10000);
  });
  it('permits the first frame and flushes a completion fence after its passes', () => {
    const { gate, gl, state } = fixture();
    expect(gate.ready()).toBe(true);
    expect(state.waits).toEqual([]);
    gate.submittedFrame();
    expect(state.fences).toEqual([[gl.SYNC_GPU_COMMANDS_COMPLETE, 0]]);
    expect(state.flushes).toBe(1);
    expect(gate.diagnostics()).toEqual({
      pending: true,
      submitted: 1,
      completed: 0,
      deferredCallbacks: 0,
      expiredFences: 0,
      latencyMs: 0,
    });
  });

  it('does not queue more draws or wait for the GPU during 600 busy callbacks', () => {
    const { gate, gl, state } = fixture();
    let inputPolls = 0;
    for (let frame = 0; frame < 601; frame++) {
      inputPolls++;
      if (gate.ready()) gate.submittedFrame();
    }
    expect(inputPolls).toBe(601);
    expect(state.next).toBe(1);
    expect(state.waits).toHaveLength(600);
    expect(state.waits.every(([flags, timeout]) => flags === 0 && timeout === 0)).toBe(true);
    expect(state.deleted).toHaveLength(0);
    expect(gate.diagnostics().deferredCallbacks).toBe(600);
    state.wait = gl.CONDITION_SATISFIED;
    expect(gate.ready()).toBe(true);
    expect(state.deleted).toHaveLength(1);
    expect(gate.diagnostics().completed).toBe(1);
    gate.submittedFrame();
    expect(state.next).toBe(2);
  });

  it('accepts both completion statuses and releases each handle exactly once', () => {
    for (const result of [3, 4]) {
      const { gate, state } = fixture();
      gate.submittedFrame();
      state.wait = result;
      expect(gate.ready()).toBe(true);
      expect(gate.ready()).toBe(true);
      gate.dispose();
      expect(state.deleted).toHaveLength(1);
      expect(state.waits).toHaveLength(1);
      expect(gate.diagnostics().pending).toBe(false);
    }
  });

  it('covers explicit startup draws with the latest fence without leaking handles', () => {
    const { gate, gl, state } = fixture();
    for (let i = 0; i < 4; i++) gate.submittedFrame();
    expect(state.deleted).toHaveLength(3);
    expect(state.flushes).toBe(4);
    state.wait = gl.ALREADY_SIGNALED;
    expect(gate.ready()).toBe(true);
    expect(gate.diagnostics().completed).toBe(4);
    expect(new Set(state.deleted).size).toBe(4);
  });

  it('reports a failed wait rather than admitting more unchecked GPU work', () => {
    const { gate, gl, state } = fixture();
    gate.submittedFrame();
    state.wait = gl.WAIT_FAILED;
    expect(() => gate.ready()).toThrow('Unable to check GPU frame completion');
    expect(state.deleted).toHaveLength(1);
    expect(gate.diagnostics().completed).toBe(0);
  });

  it('reports failed allocation rather than pretending a draw has completed', () => {
    const { gate, state } = fixture();
    state.allocationFails = true;
    expect(() => gate.submittedFrame()).toThrow('Unable to allocate GPU frame fence');
    expect(state.flushes).toBe(0);
    expect(gate.diagnostics().submitted).toBe(0);
  });

  it('never polls or deletes a handle invalidated by context loss', () => {
    const { gate, state } = fixture();
    gate.submittedFrame();
    state.lost = true;
    expect(gate.ready()).toBe(false);
    gate.submittedFrame();
    gate.dispose();
    expect(state.waits).toEqual([]);
    expect(state.deleted).toEqual([]);
    expect(state.flushes).toBe(1);
  });

  it('cleans up once and cannot submit again after disposal', () => {
    const { gate, state } = fixture();
    gate.submittedFrame();
    gate.dispose();
    gate.dispose();
    expect(gate.ready()).toBe(false);
    expect(() => gate.submittedFrame()).toThrow('GPU frame gate is disposed');
    expect(state.deleted).toHaveLength(1);
    expect(state.flushes).toBe(1);
  });
});
