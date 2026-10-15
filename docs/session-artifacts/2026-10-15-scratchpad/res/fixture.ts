import { FestivalHud } from '/home/user/Experiment-3/.claude/worktrees/wf_50bf1819-515-1/src/ui/festival-hud.ts';
import { openWorld } from '/home/user/Experiment-3/.claude/worktrees/wf_50bf1819-515-1/src/simulation/open-world/world.ts';
import { resolveEvents } from '/home/user/Experiment-3/.claude/worktrees/wf_50bf1819-515-1/src/simulation/open-world/festival-events.ts';
import { festivalVehicles } from '/home/user/Experiment-3/.claude/worktrees/wf_50bf1819-515-1/src/simulation/open-world/session.ts';
export function mount() {
  const world = openWorld();
  const events = resolveEvents(world);
  const log: string[] = [];
  const cb = (name: string) => () => log.push(name);
  const hud = new FestivalHud(document.body, world, events, festivalVehicles(), {
    start: cb('start'), continue: cb('continue'), cancel: cb('cancel'), reset: cb('reset'), resume: cb('resume'),
    exit: cb('exit'), lighting: cb('lighting'), vehicle: cb('vehicle'), travel: cb('travel'), autopilot: cb('autopilot'),
  });
  const base = {
    mode: 'finished', time: 100, vehicleId: 'x', speedKmh: 0, autopilot: false, card: null, event: null,
    result: { kind: 'festival-result', version: 1, regionId: 'r', eventId: 'valley-sprint', eventName: 'Valley sprint', eventKind: 'sprint',
      vehicleId: 'x', completed: true, abandoned: false, position: 1, entrants: 2, time: 60, trapKmh: null, averageKmh: null,
      driftScore: null, driftLines: [], stars: 3, legalDistance: 1, offRouteSeconds: 0,
      standings: [{ car: 0, name: 'YOU', vehicleId: 'x', time: 60, progress: 1 }, { car: 1, name: 'R', vehicleId: 'y', time: null, progress: 0.9 }], at: 100, assisted: false },
    discovered: [], road: { name: 'Coast road', roadClass: 'highway', limitKmh: 90, onRoad: true, surface: 'asphalt' }, message: null,
    streaming: {},
  };
  // As FestivalSession: a fresh (structured-cloned) status every 100 ms, update() every animation frame.
  let status: any = structuredClone(base);
  setInterval(() => (status = structuredClone(base)), 100);
  const tick = () => { hud.update(status, 560, -2602, 0, 3, 0.5); requestAnimationFrame(tick); };
  tick();
  (window as any).log = log;
}
