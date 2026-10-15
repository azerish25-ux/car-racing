import { circuitDefinition } from '/home/user/Experiment-3/.claude/worktrees/wf_b0a03695-07e-1/src/simulation/circuits.ts';
import { DIRT_BIKES } from '/home/user/Experiment-3/.claude/worktrees/wf_b0a03695-07e-1/src/simulation/offroad/dirt-bikes.ts';
import { rollRun } from '/home/user/Experiment-3/.claude/worktrees/wf_b0a03695-07e-1/src/simulation/offroad/jump-rig.ts';
import { offroadCourse } from '/home/user/Experiment-3/.claude/worktrees/wf_b0a03695-07e-1/src/simulation/offroad/venues.ts';
for (const venue of ['valley-ridge-mx', 'arena-nord-sx'] as const) {
  const course = offroadCourse(circuitDefinition(venue))!;
  for (const j of course.jumps) {
    const row: string[] = [];
    for (const v of [2, 2.5, 3, 3.5, 4, 4.5]) {
      const r = rollRun(DIRT_BIKES.mx450, venue, j, v, 1 / 240, 8);
      row.push(`${v}:${r.crashes ? 'X' : r.passed ? 'ok' : 'stop'}`);
    }
    console.log(venue.slice(0, 6), j.name.padEnd(14), row.join(' '));
  }
}
