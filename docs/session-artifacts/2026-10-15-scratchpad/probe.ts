import { liveRegistry, disciplineStatus, vehicleDiscipline } from '/home/user/Experiment-3/.claude/worktrees/wf_466ee687-d89-3/src/career/registry.ts';
import { festivalVehicles } from '/home/user/Experiment-3/.claude/worktrees/wf_466ee687-d89-3/src/simulation/open-world/session.ts';
import { VEHICLES } from '/home/user/Experiment-3/.claude/worktrees/wf_466ee687-d89-3/src/simulation/vehicles.ts';
const live = liveRegistry();
for (const d of ['circuit-cars', 'road-bikes', 'off-road', 'festival'] as const) {
  const s = disciplineStatus(live, d);
  console.log(d, s.state, s.vehicles.map((v) => v.id + ':' + v.classId).join(','), s.reasons);
}
console.log('festival vehicles', festivalVehicles().map((v) => v.id + ':' + v.classId).join(' '));
console.log(
  'bikes',
  Object.values(VEHICLES)
    .filter((v) => v.dynamicsKind === 'bike')
    .map((v) => v.id + ':' + v.classId + ':' + vehicleDiscipline(v as never) + (v.bike?.offroad ? ':dirt' : ''))
    .join(' '),
);
console.log(live.rulesets.map((r) => r.id + ':' + r.allowedClasses.join('/') + ':' + r.sessions.join('/')).join('\n'));
