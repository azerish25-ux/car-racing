import { DEFAULT_OPTIONS } from '/home/user/Experiment-3/.claude/worktrees/wf_466ee687-d89-1/src/simulation/config.ts';
import { EVENTS, eventSession } from '/home/user/Experiment-3/.claude/worktrees/wf_466ee687-d89-1/src/simulation/events.ts';
import { PHASE } from '/home/user/Experiment-3/.claude/worktrees/wf_466ee687-d89-1/src/simulation/race.ts';
import { Simulation } from '/home/user/Experiment-3/.claude/worktrees/wf_466ee687-d89-1/src/simulation/world.ts';
import { qualifyingGrid, raceResult } from '/home/user/Experiment-3/.claude/worktrees/wf_466ee687-d89-1/src/core/championship.ts';
import { F, carBase } from '/home/user/Experiment-3/.claude/worktrees/wf_466ee687-d89-1/src/simulation/protocol.ts';
import { gateSlots } from '/home/user/Experiment-3/.claude/worktrees/wf_466ee687-d89-1/src/simulation/offroad/session.ts';
import { offroadCourse } from '/home/user/Experiment-3/.claude/worktrees/wf_466ee687-d89-1/src/simulation/offroad/venues.ts';
import {
  confirmGates,
  createMeeting,
  meetingClassification,
  motoOptions,
  pickMeetingGates,
  qualifyingOptions,
  recordMoto,
  recordQualifying,
} from '/home/user/Experiment-3/.claude/worktrees/wf_466ee687-d89-1/src/simulation/offroad/meeting.ts';

const DT = 1 / 120;
const event = EVENTS.find((e) => e.id === 'valley-ridge-mx-moto-1')!;
const race = eventSession({ ...event, opponents: 3, laps: 1, vehicles: ['mx450', 'mx250', 'mx450', 'mx250'] }, DEFAULT_OPTIONS);
let m = createMeeting('vr', 'VR MEETING', race, 'changeable');
const run = (options: ReturnType<typeof qualifyingOptions>) => {
  const sim = new Simulation(options);
  sim.autoPlayer = true;
  const start = performance.now();
  let t = 0;
  for (; t < 900 && sim.race.phase !== PHASE.FINISHED; t += DT) sim.step(DT);
  const frame = sim.makeFrame();
  sim.writeFrame(frame);
  console.log(options.mode, 'sim', t.toFixed(1), 's wall', ((performance.now() - start) / 1000).toFixed(1), 's phase', sim.race.phase);
  return { sim, frame };
};
const q = run(qualifyingOptions(m));
const grid = qualifyingGrid(q.frame);
const times = Array.from({ length: 4 }, (_, i) => q.frame[carBase(i) + F.BEST_LAP]);
console.log('qualifying', grid, times.map((x) => x.toFixed(2)));
m = recordQualifying(m, grid, times);
const slots = gateSlots(q.sim.track, offroadCourse(q.sim.track.circuit)!, 4);
const picks = pickMeetingGates(m, slots.preference);
console.log('picks', picks);
m = confirmGates(m, picks);
for (let k = 0; k < 2; k++) {
  const options = motoOptions(m);
  const r = run(options);
  console.log('gates in session', r.sim.offroad!.entrants.map((e) => e.slot));
  const res = raceResult(r.frame, options.grid!, true, 'x');
  m = recordMoto(m, { order: res.order, finished: res.order.filter((id) => !res.retired.includes(id)) });
  console.log('moto', k + 1, res.order, 'retired', res.retired);
}
console.log(meetingClassification(m));
