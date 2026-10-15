const W = '/home/user/Experiment-3/.claude/worktrees/wf_f5fa9a5f-78d-1';
const { ServerInputQueue, readInputPacket, writeInputPacket } = await import(W + '/src/net/input.ts');
const { decodeClientMessage, encodeInput } = await import(W + '/src/net/codec.ts');
const { controls } = await import(W + '/src/simulation/config.ts');

const q = new ServerInputQueue();
let tick = 0;
let legitSeq = 0;
let evilSeq = 1_000_000;
const c = controls();
// 75 packets/s (input bucket rate), 16 commands each, far-future tick (rejected but marked).
const packetsPerTick = 75 / 120;
let acc = 0;
const report = (label) => {
  const t0 = performance.now();
  for (let i = 0; i < 120; i++) q.take(tick + i);
  const per = (performance.now() - t0) / 120;
  console.log(label, 'seen entries ~', (q as any).seen.size, 'take() ms/tick', per.toFixed(3), 'stats.rejected', q.stats.rejected);
};
for (let sec = 1; sec <= 600; sec++) {
  for (let i = 0; i < 120; i++, tick++) {
    acc += packetsPerTick;
    while (acc >= 1) {
      acc -= 1;
      const bytes = encodeInput({ sentAt: 0, ackTick: 0, commands: Array.from({ length: 16 }, (_, k) => ({ seq: evilSeq + k, tick: 0xfff00000 + k, ticks: 1, controls: c })) });
      evilSeq += 17; // leave a gap so contiguous ack never walks through
      const d = decodeClientMessage(bytes, 'unreliable');
      if (!d.ok) throw new Error(d.reason);
      q.accept(d.value.packet.commands, tick);
    }
    // legit commands keep the car driving
    q.accept([{ seq: legitSeq++, tick, ticks: 1, controls: c }], tick);
    q.take(tick);
  }
  if (sec % 60 === 0) report(`t=${sec}s`);
}
