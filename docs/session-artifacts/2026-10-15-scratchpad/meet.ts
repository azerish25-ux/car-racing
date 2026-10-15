import { EVENTS, rulesetFor } from '/home/user/Experiment-3/.claude/worktrees/wf_466ee687-d89-1/src/simulation/events.ts';
import { meetingEvent } from '/home/user/Experiment-3/.claude/worktrees/wf_466ee687-d89-1/src/ui/offroad-meeting.ts';
import { offroadCourse } from '/home/user/Experiment-3/.claude/worktrees/wf_466ee687-d89-1/src/simulation/offroad/venues.ts';
import { circuitDefinition } from '/home/user/Experiment-3/.claude/worktrees/wf_466ee687-d89-1/src/simulation/circuits.ts';
for (const e of EVENTS) {
  if (!meetingEvent(e)) continue;
  const c = circuitDefinition(e.circuit);
  const course = offroadCourse(c);
  console.log(e.id, e.circuit, rulesetFor(e).id, 'gate:', !!course?.spec.gate, 'opp', e.opponents);
}
