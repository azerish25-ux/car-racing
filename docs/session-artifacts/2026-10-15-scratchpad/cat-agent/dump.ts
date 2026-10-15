import { VEHICLES } from '/home/user/Experiment-3/.claude/worktrees/agent-ac7432dc5f9d804f3/src/simulation/vehicles.ts';
import { CATALOGUE_BRIEFS } from '/home/user/Experiment-3/.claude/worktrees/agent-ac7432dc5f9d804f3/src/simulation/vehicle-catalogue/index.ts';
for (const d of Object.values(VEHICLES)) {
  const dl = d.driveline as Record<string, Record<string, unknown>> | undefined;
  const desc = dl
    ? Object.entries(dl)
        .map(([k, v]) => k + ':' + JSON.stringify(v).slice(0, 70))
        .join(',')
    : '-';
  console.log(
    [d.id, d.name, d.classId, d.drivetrain, d.spec.mass, desc, (CATALOGUE_BRIEFS as Record<string, string>)[d.id] ?? ''].join(' | '),
  );
}
