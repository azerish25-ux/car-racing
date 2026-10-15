// Drives the real open-world worker module in-process with the same
// frame/recycle logic as FestivalSession.receive, and counts frames delivered
// before and after a race start (field 1 -> N cars).
const ROOT = '/home/user/Experiment-3/.claude/worktrees/wf_50bf1819-515-1';
let previous: Float32Array | null = null, current: Float32Array | null = null;
let frames = 0, status: any = null, ready = false;
const fakeSelf: any = {
  postMessage(msg: any) { setTimeout(() => mainReceive(msg), 0); },
  onmessage: null,
};
(globalThis as any).self = fakeSelf;
const toWorker = (msg: any) => setTimeout(() => fakeSelf.onmessage({ data: msg }), 0);
function mainReceive(msg: any) {
  switch (msg.type) {
    case 'ready': ready = true; break;
    case 'frame': {
      const frame = new Float32Array(msg.buffer);
      if (previous && previous.length === current?.length && previous !== current)
        toWorker({ type: 'recycle', buffer: previous.buffer });
      previous = current ?? frame;
      current = frame;
      frames++;
      break;
    }
    case 'status': status = msg.status; break;
    case 'error': console.log('ERROR', msg.message); break;
  }
}
const { festivalDefaultVehicle } = await import(ROOT + '/src/simulation/open-world/session.ts');
await import(ROOT + '/src/workers/open-world.worker.ts');
const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));
toWorker({ type: 'init', options: { vehicle: festivalDefaultVehicle(), weather: 'clear', assist: 'sport', seed: 73021, discovered: [] } });
while (!ready || !current) await wait(20);
const inputTimer = setInterval(() => toWorker({ type: 'input', input: { throttle: 0, brake: 0, steer: 0, shift: 0, ers: 1, reverse: false, manualClutch: false, clutch: 0 } }), 16);
toWorker({ type: 'pause', value: false });
await wait(500);
let f0 = frames; await wait(2000);
console.log('free roam: frames in 2 s =', frames - f0, 'cars in frame =', current![1 /*placeholder*/] === undefined ? '?' : '');
toWorker({ type: 'command', command: { type: 'start', event: 'valley-sprint' } });
await wait(300);
f0 = frames; await wait(3000);
console.log('after race start: frames in 3 s =', frames - f0, 'mode =', status?.mode, 'status time =', status?.time?.toFixed(2), 'frame length =', current!.length, 'previous length =', previous!.length);
// pause/unpause twice
toWorker({ type: 'pause', value: true }); await wait(100); toWorker({ type: 'pause', value: false }); await wait(100);
f0 = frames; await wait(1000);
console.log('after one pause/resume: frames in 1 s =', frames - f0);
toWorker({ type: 'pause', value: true }); await wait(100); toWorker({ type: 'pause', value: false }); await wait(100);
f0 = frames; await wait(1000);
console.log('after second pause/resume: frames in 1 s =', frames - f0);
clearInterval(inputTimer);
process.exit(0);
