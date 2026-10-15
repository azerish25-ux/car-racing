import { VEHICLES } from '/home/user/Experiment-3/.claude/worktrees/wf_9577868e-cce-1/src/simulation/vehicles.ts';
for (const d of Object.values(VEHICLES))
  console.log(
    d.id,
    JSON.stringify(d.aero),
    d.spec.inertia.join(','),
    d.restHeight,
    d.wheelPositions[0].join(','),
    d.wheelPositions[2].join(','),
  );
