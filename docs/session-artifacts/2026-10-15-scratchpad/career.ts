import { disciplineEvents } from '/home/user/Experiment-3/.claude/worktrees/wf_466ee687-d89-1/src/career/ladder.ts';
import { liveRegistry } from '/home/user/Experiment-3/.claude/worktrees/wf_466ee687-d89-1/src/career/registry.ts';
import { newCareer } from '/home/user/Experiment-3/.claude/worktrees/wf_466ee687-d89-1/src/career/save.ts';
import { meetingEvent } from '/home/user/Experiment-3/.claude/worktrees/wf_466ee687-d89-1/src/ui/offroad-meeting.ts';
import { offroadCourse } from '/home/user/Experiment-3/.claude/worktrees/wf_466ee687-d89-1/src/simulation/offroad/venues.ts';
import { circuitDefinition } from '/home/user/Experiment-3/.claude/worktrees/wf_466ee687-d89-1/src/simulation/circuits.ts';
import { rulesetFor } from '/home/user/Experiment-3/.claude/worktrees/wf_466ee687-d89-1/src/simulation/events.ts';
const reg = liveRegistry();
const save = newCareer();
// Unlock: max reputation & licences if fields exist
for (const k of Object.keys(save.reputation)) (save.reputation as any)[k] = 100;
for (const d of ['circuit-cars','road-bikes','off-road','festival'] as const) {
  for (const e of disciplineEvents(reg, save, d)) {
    const def = e.definition;
    if (!def) { continue; }
    if (!meetingEvent(def)) continue;
    const course = offroadCourse(circuitDefinition(def.circuit));
    console.log(d, e.key, e.kind, e.status, def.circuit, rulesetFor(def).id, 'gate', !!course?.spec.gate);
  }
}
