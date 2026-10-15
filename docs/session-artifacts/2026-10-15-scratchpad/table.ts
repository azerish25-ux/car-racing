// Scratch: markdown rows for the catalogue-growth machines from the report.
import { readFileSync } from 'node:fs';
import { VEHICLES } from '/home/user/Experiment-3/.claude/worktrees/wf_9577868e-cce-1/src/simulation/vehicles.ts';
import { soundFamilyFor } from '/home/user/Experiment-3/.claude/worktrees/wf_9577868e-cce-1/src/audio/sound-profiles.ts';

const report = JSON.parse(
  readFileSync('/home/user/Experiment-3/.claude/worktrees/wf_9577868e-cce-1/docs/vehicle-calibration.json', 'utf8'),
).vehicles;
const ids = process.argv[2].split(',');
const diff = (d?: { type: string }) => (d ? (d.type === 'lsd' ? 'LSD' : d.type) : 'open');
for (const id of ids) {
  const def = VEHICLES[id];
  const r = report[id];
  const m = (k: string) => r.comparison.find((c: { metric: string }) => c.metric === k).measured;
  let drive: string;
  if (def.dynamicsKind === 'bike') drive = 'chain, rear';
  else if (def.drivetrain === 'awd') {
    const c = def.driveline!.centre!;
    const share = Math.round(c.frontShare * 100);
    drive = `AWD (${c.type === 'locked' ? 'locked' : diff(c) + ' centre'} ${share}:${100 - share}, ${diff(def.driveline!.front)}/${diff(def.driveline!.rear)} axles)`;
  } else if (def.drivetrain === 'fwd') drive = `FWD (${diff(def.driveline?.front)})`;
  else drive = `RWD (${def.driveline?.rear?.type === 'locked' ? 'locked axle' : diff(def.driveline?.rear)})`;
  const name = def.name
    .split(' ')
    .map((w, i) => (i === 0 ? w : w.toLowerCase()))
    .join(' ');
  console.log(
    `| ${name} | ${def.classId} | ${drive} | ${m('accel0to100').toFixed(2)} | ${m('topSpeed').toFixed(0)} | ${m('braking100Distance').toFixed(1)} | ${m('lateral80G').toFixed(2)} | ${soundFamilyFor(def)} |`,
  );
}
