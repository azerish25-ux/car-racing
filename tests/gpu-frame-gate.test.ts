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
  it('refreshes an overdue fence without declaring unfinished work complete', () => {
    const { gate, gl, state, clock } = fixture();
    gate.submittedFrame();
    clock.now = 1001;
    expect(gate.ready()).toBe(false);
    expect(state.finishes).toBe(0);
    expect(state.flushes).toBe(2);
    expect(gate.diagnostics()).toMatchObject({ pending: true, completed: 0, flushRefreshes: 1 });
    // The next task observes actual completion after the driver progresses.
    clock.now += 16;
    state.wait = gl.CONDITION_SATISFIED;
    expect(gate.ready()).toBe(true);
    expect(state.deleted).toHaveLength(1);
    expect(gate.diagnostics().completed).toBe(1);
  });

  it('keeps input callbacks live throughout a 30-second GPU workload', () => {
    const { gate, gl, state, clock } = fixture();
    state.finishCost = 30000;
    gate.submittedFrame();
    let inputPolls = 0;
    for (let t = 16; t < 30000; t += 16) {
      clock.now = t;
      inputPolls++;
      expect(gate.ready()).toBe(false);
      expect(clock.now).toBe(t);
    }
    expect(inputPolls).toBeGreaterThan(1800);
    expect(state.next).toBe(1);
    expect(state.finishes).toBe(0);
    expect(gate.diagnostics().completed).toBe(0);
    state.wait = gl.CONDITION_SATISFIED;
    expect(gate.ready()).toBe(true);
    gate.submittedFrame();
    expect(state.next).toBe(2);
  });

  it('fails closed on a persistently stuck driver instead of draining or queueing', () => {
    const { gate, state, clock } = fixture();
    gate.submittedFrame();
    for (let t = 16; t < 120000; t += 16) {
      clock.now = t;
      expect(gate.ready()).toBe(false);
    }
    clock.now = 120000;
    expect(() => gate.ready()).toThrow('GPU frame completion stalled');
    expect(gate.ready()).toBe(false);
    expect(() => gate.submittedFrame()).toThrow('GPU frame completion stalled');
    expect(state.finishes).toBe(0);
    expect(state.next).toBe(1);
    expect(gate.diagnostics().completed).toBe(0);
  });

  it('does not mistake a hidden tab or held editor for active GPU waiting', () => {
    const { gate, gl, state, clock } = fixture();
    gate.submittedFrame();
    clock.now += 600000;
    expect(gate.ready()).toBe(false);
    expect(gate.diagnostics().activeWaitMs).toBe(0);
    state.wait = gl.CONDITION_SATISFIED;
    expect(gate.ready()).toBe(true);
    expect(state.finishes).toBe(0);
    expect(gate.maxWaitMs).toBe(10000);
  });

  it('rejects unbounded or invalid polling configuration', () => {
    const { gl } = fixture();
    for (const limits of [
      [0, 10, 100],
      [10, 5, 100],
      [10, 100, 100],
      [1, 2, Infinity],
    ])
      expect(() => new GpuFrameGate(gl, () => 0, ...(limits as [number, number, number]))).toThrow(
        'Invalid GPU frame polling limits',
      );
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
      flushRefreshes: 0,
      pendingMs: 0,
      activeWaitMs: 0,
      failure: null,
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
