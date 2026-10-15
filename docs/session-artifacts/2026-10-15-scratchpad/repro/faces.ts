import { circuitDefinition } from '/home/user/Experiment-3/.claude/worktrees/wf_b0a03695-07e-1/src/simulation/circuits.ts';
import { rigTrack } from '/home/user/Experiment-3/.claude/worktrees/wf_b0a03695-07e-1/src/simulation/offroad/jump-rig.ts';
import { offroadCourse } from '/home/user/Experiment-3/.claude/worktrees/wf_b0a03695-07e-1/src/simulation/offroad/venues.ts';
import { surfaceSample } from '/home/user/Experiment-3/.claude/worktrees/wf_b0a03695-07e-1/src/simulation/track.ts';
for (const venue of ['valley-ridge-mx', 'arena-nord-sx'] as const) {
  const track = rigTrack(venue), course = offroadCourse(circuitDefinition(venue))!;
  const out = surfaceSample(), p = { } as any;
  for (const j of course.jumps) {
    let maxUp = 0, maxDown = 0, prev = NaN;
    for (let s = j.start - 2; s < j.end + 2; s += 0.25) {
      const q = track.at(s, track.at(s, {} as any) as any);
      track.sample(q.x, q.z, out, q.y + 5);
      if (!Number.isNaN(prev)) { const g = Math.atan((out.height - prev) / 0.25); maxUp = Math.max(maxUp, g); maxDown = Math.min(maxDown, g); }
      prev = out.height;
    }
    console.log(venue, j.name, j.kind, 'lip', j.lipAngle.toFixed(3), 'landingPitch', j.landingPitch.toFixed(3), 'maxUp', maxUp.toFixed(3), 'maxDown', maxDown.toFixed(3));
  }
}
