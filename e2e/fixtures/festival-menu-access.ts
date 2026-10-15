import { InputController } from '../../src/input/controller.ts';
import { FestivalControls } from '../../src/session/festival-controls.ts';
import { resolveEvents } from '../../src/simulation/open-world/festival-events.ts';
import { festivalVehicles } from '../../src/simulation/open-world/session.ts';
import { openWorld } from '../../src/simulation/open-world/world.ts';
import { DEFAULT_SETTINGS } from '../../src/storage/data.ts';
import { FestivalHud } from '../../src/ui/festival-hud.ts';

/** The real festival HUD, pause/keyboard controls and application input
 * controller, wired as FestivalSession and GameApp.startFestival wire them;
 * no renderer, workers or simulation. */
export function mountFestivalMenu() {
  const root = document.createElement('main');
  root.id = 'app';
  root.style.cssText = 'position:fixed;inset:0';
  document.body.replaceChildren(root);
  const log = document.createElement('output');
  log.id = 'festivalEvents';
  log.hidden = true;
  document.body.append(log);
  const record = (value: string) => {
    log.textContent += `${value};`;
  };
  const world = openWorld(),
    events = resolveEvents(world),
    vehicles = festivalVehicles();
  let controls: FestivalControls | null = null;
  // GameApp routes application actions to the festival first.
  const input = new InputController(structuredClone(DEFAULT_SETTINGS), (name) => {
    record(`action:${name}`);
    if (name === 'pause') controls?.togglePause();
  });
  const hud = new FestivalHud(root, world, events, vehicles, {
    start: (id) => record(`start:${id}`),
    continue: () => record('continue'),
    cancel: () => record('cancel'),
    reset: () => {
      record('reset');
      controls?.setPaused(false);
    },
    resume: () => {
      record('resume');
      controls?.setPaused(false);
    },
    exit: () => record('exit'),
    lighting: (mode) => {
      record(`lighting:${mode}`);
      controls?.openMenu();
    },
    vehicle: (id) => {
      record(`vehicle:${id}`);
      controls?.setPaused(false);
    },
    travel: (id) => record(`travel:${id}`),
    autopilot: (on) => {
      record(`autopilot:${on}`);
      controls?.setPaused(false);
    },
  });
  controls = new FestivalControls(hud, {
    pause: (value) => record(`pause:${value}`),
    driving: (on) => {
      input.setEnabled(on);
      record(`driving:${on}`);
    },
    menuState: () => ({
      lighting: 'day',
      vehicle: vehicles[0].id,
      discovered: [events[0].spec.id],
      autopilot: false,
      inEvent: false,
    }),
    card: () => null,
    start: (id) => record(`start:${id}`),
    continue: () => record('continue'),
  });
  // GameApp.startFestival: driving input on for the session.
  input.setEnabled(true);
}
