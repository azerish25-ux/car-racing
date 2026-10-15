import { VEHICLES } from '/home/user/Experiment-3/.claude/worktrees/wf_50bf1819-515-1/src/simulation/vehicles.ts';
import { festivalVehicles } from '/home/user/Experiment-3/.claude/worktrees/wf_50bf1819-515-1/src/simulation/open-world/session.ts';
for (const v of Object.values(VEHICLES)) console.log(v.id, v.classId, v.dynamicsKind, v.name, (v as any).family ?? '', (v as any).category ?? '');
console.log('festival:', festivalVehicles().map((v) => v.id).join(' '));
