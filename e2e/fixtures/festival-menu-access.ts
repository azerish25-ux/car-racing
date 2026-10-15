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

/** The real HUD showing a finished race while status messages arrive as
 * fresh structured clones every 100 ms, as FestivalSession receives them,
 * and update() runs every animation frame. */
export function mountFestivalResults() {
  const root = document.createElement('main');
  root.id = 'app';
  root.style.cssText = 'position:fixed;inset:0';
  document.body.replaceChildren(root);
  const log = document.createElement('output');
  log.id = 'festivalEvents';
  log.hidden = true;
  document.body.append(log);
  const world = openWorld(),
    events = resolveEvents(world),
    vehicles = festivalVehicles(),
    event = events.find((e) => e.spec.kind === 'sprint')!;
  const noop = () => {};
  const hud = new FestivalHud(root, world, events, vehicles, {
    start: noop,
    continue: () => (log.textContent += 'continue;'),
    cancel: noop,
    reset: noop,
    resume: noop,
    exit: noop,
    lighting: noop,
    vehicle: noop,
    travel: noop,
    autopilot: noop,
  });
  const source = {
    mode: 'finished',
    time: 140,
    vehicleId: vehicles[0].id,
    speedKmh: 0,
    autopilot: false,
    card: null,
    event: null,
    result: {
      kind: 'festival-result',
      version: 1,
      regionId: world.region.id,
      eventId: event.spec.id,
      eventName: event.spec.name,
      eventKind: event.spec.kind,
      vehicleId: vehicles[0].id,
      completed: true,
      abandoned: false,
      position: 1,
      entrants: 4,
      time: 132.4,
      trapKmh: null,
      averageKmh: null,
      driftScore: null,
      driftLines: [],
      stars: 3,
      legalDistance: event.distance,
      offRouteSeconds: 0,
      standings: [{ car: 0, name: 'YOU', vehicleId: vehicles[0].id, time: 132.4, progress: 1 }],
      at: 139.5,
      assisted: false,
    },
    discovered: [],
    road: { name: 'Test road', roadClass: 'country', limitKmh: 90, onRoad: true, surface: 'asphalt' },
    message: null,
    streaming: { resident: 0, peakResident: 0, budget: 24, generated: 0, evicted: 0, stalls: 0, prefetched: 0, generationMs: 0, worstGenerationMs: 0 },
  } as const;
  let status = structuredClone(source);
  setInterval(() => (status = structuredClone(source)), 100);
  const frame = () => {
    hud.update(status as never, 0, 0, 0, 0, 0);
    requestAnimationFrame(frame);
  };
  frame();
}
