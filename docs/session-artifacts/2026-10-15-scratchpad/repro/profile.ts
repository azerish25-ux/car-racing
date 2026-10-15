import { rigTrack } from '/home/user/Experiment-3/.claude/worktrees/wf_b0a03695-07e-1/src/simulation/offroad/jump-rig.ts';
import { surfaceSample, trackPoint } from '/home/user/Experiment-3/.claude/worktrees/wf_b0a03695-07e-1/src/simulation/track.ts';
const track = rigTrack((process.argv[2] ?? 'valley-ridge-mx') as any);
const from = +(process.argv[3] ?? 580), to = +(process.argv[4] ?? 616);
const p = trackPoint(), out = surfaceSample();
let prev = NaN; const rows: string[] = [];
for (let s = from; s <= to; s += 0.5) {
  track.at(s, p); track.sample(p.x, p.z, out, p.y + 3);
  rows.push(`${s.toFixed(1)}:${(out.height - p.y).toFixed(2)}${Number.isNaN(prev) ? '' : '(' + Math.atan((out.height - prev) / 0.5).toFixed(2) + ')'}`);
  prev = out.height;
}
console.log(rows.join(' '));
