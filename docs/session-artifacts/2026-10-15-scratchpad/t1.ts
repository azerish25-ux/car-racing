import { Track } from '/home/user/Experiment-3/.claude/worktrees/wf_50bf1819-515-1/src/simulation/track.ts';
let t0 = performance.now();
const a = new Track('clear', true);
console.log('first flat aurel', performance.now() - t0, a.length);
t0 = performance.now();
const b = new Track('clear', true);
console.log('second', performance.now() - t0);
