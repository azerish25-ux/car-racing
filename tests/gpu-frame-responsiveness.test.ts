import { expect, it } from 'vitest';
import { GpuFrameGate } from '../src/rendering/gpu-frame-gate.ts';

it('never blocks the input task or treats an overdue, unfinished frame as completed', () => {
  let now = 0;
  let finishes = 0;
  const gl = {
    SYNC_GPU_COMMANDS_COMPLETE: 1,
    TIMEOUT_EXPIRED: 2,
    ALREADY_SIGNALED: 3,
    CONDITION_SATISFIED: 4,
    isContextLost: () => false,
    fenceSync: () => ({}) as WebGLSync,
    clientWaitSync: () => 2,
    deleteSync: () => {},
    flush: () => {},
    finish: () => {
      finishes++;
      now += 30_000;
    },
  } as unknown as WebGL2RenderingContext;
  const gate = new GpuFrameGate(gl, () => now);
  gate.submittedFrame();
  now = 1_001;
  const before = now;
  const ready = gate.ready();
  expect({ finishes, elapsed: now - before, ready }).toEqual({
    finishes: 0,
    elapsed: 0,
    ready: false,
  });
  expect(gate.diagnostics()).toMatchObject({ pending: true, submitted: 1, completed: 0 });
  gate.dispose();
});
