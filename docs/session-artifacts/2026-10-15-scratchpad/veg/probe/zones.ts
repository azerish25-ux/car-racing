import { CIRCUITS } from '/home/user/Experiment-3/.claude/worktrees/wf_1ec31848-637-3/src/simulation/circuits.ts';
import { Track } from '/home/user/Experiment-3/.claude/worktrees/wf_1ec31848-637-3/src/simulation/track.ts';
import { venuePlan } from '/home/user/Experiment-3/.claude/worktrees/wf_1ec31848-637-3/src/rendering/venue-plan.ts';
import {
  vegetationPlan,
  grovePlan,
} from '/home/user/Experiment-3/.claude/worktrees/wf_1ec31848-637-3/src/rendering/landscape.ts';
import { zoneRole } from '/home/user/Experiment-3/.claude/worktrees/wf_1ec31848-637-3/src/rendering/vegetation/planting.ts';
import { treeRole } from '/home/user/Experiment-3/.claude/worktrees/wf_1ec31848-637-3/src/rendering/vegetation/species.ts';
import { skyPaletteFor } from '/home/user/Experiment-3/.claude/worktrees/wf_1ec31848-637-3/src/rendering/assets/sky-catalogue.ts';

for (const id of process.argv.slice(2)) {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const track = new Track('clear', false, undefined, (CIRCUITS as any)[id]);
  const plan = venuePlan(track);
  console.log(id, 'palette', skyPaletteFor(track), JSON.stringify(plan.plantingZones.map((z: { species: string }) => z.species)));
  const near = vegetationPlan(track, 7109, [], undefined);
  const { groves, treeline } = grovePlan(track, 40913, []);
  const role = zoneRole(track);
  for (const [name, list] of [
    ['near', near],
    ['groves', groves],
    ['treeline', treeline],
  ] as const) {
    const roles: Record<string, number> = {},
      aspect: Record<string, number> = {};
    for (const t of list) {
      const r = role(t);
      roles[r] = (roles[r] ?? 0) + 1;
      const a = treeRole(t.height, t.width);
      aspect[a] = (aspect[a] ?? 0) + 1;
    }
    console.log('  ', name, list.length, 'zone', JSON.stringify(roles), 'aspect', JSON.stringify(aspect));
  }
}
