import { EVENTS } from '/home/user/Experiment-3/.claude/worktrees/wf_9577868e-cce-1/src/simulation/events.ts';
import { VEHICLES } from '/home/user/Experiment-3/.claude/worktrees/wf_9577868e-cce-1/src/simulation/vehicles.ts';
import { classInfo } from '/home/user/Experiment-3/.claude/worktrees/wf_9577868e-cce-1/src/simulation/vehicle-classes.ts';

const raced = new Set(EVENTS.flatMap((e) => [e.vehicles].flat()).map((id) => VEHICLES[id].classId));
const missing = new Set(
  Object.values(VEHICLES)
    .filter((v) => classInfo(v.classId).raceRuleset && !raced.has(v.classId))
    .map((v) => v.classId),
);
console.log('missing', [...missing]);
const machines = new Set(EVENTS.flatMap((e) => [e.vehicles].flat()));
console.log(
  'machines without an event',
  Object.values(VEHICLES)
    .filter((v) => classInfo(v.classId).raceRuleset && !machines.has(v.id))
    .map((v) => v.id),
);
