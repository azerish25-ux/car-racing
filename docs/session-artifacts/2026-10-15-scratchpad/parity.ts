import { DEFAULT_OPTIONS, validateOptions } from '/home/user/Experiment-3/.claude/worktrees/wf_f5fa9a5f-78d-1/src/simulation/config.ts';
import { Simulation } from '/home/user/Experiment-3/.claude/worktrees/wf_f5fa9a5f-78d-1/src/simulation/world.ts';
import { AuthoritativeWorld } from '/home/user/Experiment-3/.claude/worktrees/wf_f5fa9a5f-78d-1/src/net/authority.ts';

const options = validateOptions({ ...DEFAULT_OPTIONS, mode: 'race', laps: 3, opponents: 3, seed: 77 });
const plain = new Simulation(options);
plain.autoPlayer = true;
const world = new AuthoritativeWorld(options);
for (let i = 0; i < 4; i++) world.setMode(i, 'ai');
const frame = plain.makeFrame();
const hash = (f: Float32Array) => {
  const words = new Uint32Array(f.buffer, f.byteOffset, f.length);
  let h = 0x811c9dc5;
  for (let i = 0; i < words.length; i++) h = Math.imul(h ^ words[i], 0x01000193);
  return (h >>> 0).toString(16).padStart(8, '0');
};
for (let t = 0; t < 1500; t++) {
  plain.step(1 / 120);
  world.step();
}
plain.writeFrame(frame);
console.log('plain', hash(frame), 'world', world.stateHash(), 'disputes', world.audit.disputes(), 'routeLaps', world.audit.progress.map((p) => [p.edge, p.s.toFixed(0), p.checkpoint, p.offRoute]));
