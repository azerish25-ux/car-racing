/** Real production HUD with explicitly synthetic driving cue/state cases.
 * This tests layout and modal ownership, not physics or a completed drive. */
import { FestivalHud } from '../../src/ui/festival-hud.ts';
import { OpenWorldSimulation, festivalVehicles } from '../../src/simulation/open-world/session.ts';
import { driftFeedback } from '../../src/simulation/open-world/drift-feedback.ts';
const sim = new OpenWorldSimulation({ vehicle: 'tc1', traffic: false });
const actions: string[] = [];
const hud = new FestivalHud(
  document.querySelector<HTMLElement>('#app')!,
  sim.world,
  sim.events,
  festivalVehicles(),
  {
    start: (id) => actions.push(`start:${id}`),
    continue: () => actions.push('continue'),
    cancel: () => actions.push('cancel'),
    reset: () => actions.push('reset'),
    resume: () => actions.push('resume'),
    exit: () => actions.push('exit'),
    lighting: (mode) => actions.push(`lighting:${mode}`),
    vehicle: (id) => actions.push(`vehicle:${id}`),
    travel: (id) => actions.push(`travel:${id}`),
    autopilot: (on) => actions.push(`autopilot:${on}`),
    traffic: (on) => actions.push(`traffic:${on}`),
    map: () => actions.push('map'),
    photo: (open) => actions.push(`photo:${open}`),
  },
);
const inspect = () => {
  const card = document.getElementById('festDrift')!;
  const rect = (selector: string) => {
    const r = document.querySelector<HTMLElement>(selector)!.getBoundingClientRect();
    return { x: r.x, y: r.y, right: r.right, bottom: r.bottom, width: r.width, height: r.height };
  };
  return {
    visible: !card.hidden && getComputedStyle(card).display !== 'none',
    card: rect('#festDrift'),
    speed: rect('.fest-speed'),
    minimap: rect('.fest-minimap'),
    text: card.textContent,
    action: card.dataset.action,
    marker: document.getElementById('festDriftMarker')!.style.left,
    activeLabel: document.activeElement?.getAttribute('data-fest'),
    actions: [...actions],
  };
};
function draw(mode = 'hold') {
  hud.showPhoto(false);
  hud.showMap(false);
  hud.showMenu(false);
  const status = structuredClone(sim.status());
  status.speedKmh = 72; // Explicit synthetic 20 m/s motion, consistent with the cue below.
  status.road.onRoad = mode !== 'offroad';
  status.autopilot = mode === 'autopilot';
  status.mode = mode === 'countdown' ? 'countdown' : mode === 'finished' ? 'finished' : 'free';
  const angle = mode === 'build' ? 0.17 : mode === 'recover' ? 1.05 : mode === 'right' ? -0.5 : 0.5;
  const cue =
    mode === 'none' ? null : driftFeedback(20 * Math.sin(angle), 20 * Math.cos(angle), true);
  hud.update(status, sim.player.body.position.x, sim.player.body.position.z, 0, 3, 0.6, null, cue);
  return inspect();
}
function overlay(mode: string) {
  if (mode === 'menu')
    hud.showMenu(true, {
      lighting: 'day',
      vehicle: 'tc1',
      discovered: [],
      autopilot: false,
      inEvent: false,
      traffic: false,
    });
  else if (mode === 'map') hud.showMap(true);
  else if (mode === 'photo') hud.showPhoto(true);
  return inspect(); // Deliberately do not call update: paused input must hide immediately.
}
Object.assign(window, {
  hudReview: { draw, inspect, overlay, dispose: () => hud.dispose(), ready: true },
});
draw();
