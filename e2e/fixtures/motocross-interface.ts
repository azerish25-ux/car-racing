import { Color } from 'three';
import '@fontsource-variable/saira/wdth.css';
import '@fontsource-variable/saira/wdth-italic.css';
import '../../src/ui/style.css';
import { DEFAULT_OPTIONS, validateOptions } from '../../src/simulation/config.ts';
import { F, H, B, BIKE_BASE, O, OFFROAD_BASE, carBase } from '../../src/simulation/protocol.ts';
import { Track } from '../../src/simulation/track.ts';
import { VEHICLES } from '../../src/simulation/vehicles.ts';
import { Simulation } from '../../src/simulation/world.ts';
import { FLAG } from '../../src/simulation/marshal.ts';
import { RadioArbiter } from '../../src/core/radio.ts';
import type { RacingRenderer } from '../../src/rendering/renderer.ts';
import { Interface } from '../../src/ui/interface.ts';
import { raceBriefing } from '../../src/ui/race-briefing.ts';
import { RadioCaption } from '../../src/ui/radio-caption.ts';

let ui: Interface;
let radio: RadioCaption;
let radioArbiter: RadioArbiter;
let simulation: Simulation | null = null;
let frame: Float32Array | null = null;
const renderer = {
  mode: 'chase',
  debug: false,
  cars: [{ paint: { color: new Color(0xe5a157) } }],
} as unknown as RacingRenderer;

/** Production Interface/CSS in a DOM component test. Callback observations
 * and explicitly synthetic flight samples are not a gameplay recording. */
export function mountMotocrossMenu(scale = 1) {
  const root = document.createElement('main');
  root.id = 'app';
  document.body.replaceChildren(root);
  document.documentElement.style.setProperty('--ui-scale', String(scale));
  const output = document.createElement('output');
  output.id = 'mxInterfaceEvents';
  output.hidden = true;
  const events: unknown[] = [];
  const record = (event: unknown) => {
    events.push(event);
    output.textContent = JSON.stringify(events);
  };
  const noop = () => {};
  ui = new Interface(root, new Track(), {
    action: (action) => {
      record({ action });
      if (action === 'modalClose') ui.closeModal();
    },
    start: (options, held) => record({ options, held: !!held }),
    previewMachine: (machine) => record({ preview: machine }),
    apply: noop,
    seek: noop,
    replaySpeed: noop,
    exportSetup: noop,
    importSetup: noop,
  });
  root.append(output);
  // Main creates this outside Interface. Keep that integration boundary in the
  // fixture so a caption cannot silently escape the motocross layout checks.
  radio = new RadioCaption(root);
  radioArbiter = new RadioArbiter();
  ui.ready();
  ui.showMode('menu');
  return { boundary: 'DOM component only' };
}

/** Measure the inherited production form grid and the actual text line boxes.
 * Offscreen fields are checked separately after normal keyboard focus scrolls. */
export function measureMotocrossMenu() {
  const rect = (node: Element) => {
    const box = node.getBoundingClientRect();
    return { x: box.x, y: box.y, width: box.width, height: box.height };
  };
  const box = (selector: string) => rect(document.querySelector(selector)!);
  const scroll = document.querySelector<HTMLElement>('.mx-menu-scroll')!;
  const start = document.querySelector<HTMLButtonElement>('.mx-start-dock .enter.primary')!;
  const texts = [
    '.mx-setup .mx-venue-card strong',
    '.mx-setup .mx-venue-card p',
    '.mx-ride-presets button b',
    '.mx-ride-presets button span',
  ].flatMap((selector) =>
    [...document.querySelectorAll<HTMLElement>(selector)].map((node) => {
      const range = document.createRange();
      range.selectNodeContents(node);
      return {
        selector,
        text: node.textContent,
        rect: rect(node),
        lines: [...range.getClientRects()].filter((line) => line.width > 0).length,
        overflow: node.scrollWidth - node.clientWidth,
      };
    }),
  );
  const middle = start.getBoundingClientRect();
  return {
    discipline: document.querySelector<HTMLElement>('#menu')!.dataset.discipline,
    form: box('#sessionForm'),
    panel: box('.mx-setup'),
    card: box('.mx-setup .mx-venue-card'),
    scroll: {
      ...rect(scroll),
      heightAvailable: scroll.clientHeight,
      heightTotal: scroll.scrollHeight,
    },
    start: {
      ...rect(start),
      form: start.form?.id,
      unobscured: start.contains(
        document.elementFromPoint(middle.x + middle.width / 2, middle.y + middle.height / 2),
      ),
    },
    horizontalOverflow: scroll.scrollWidth - scroll.clientWidth,
    texts,
  };
}

export function mountMotocrossHud(circuit: 'valley-ridge-mx' | 'arena-nord-sx', scale = 1) {
  mountMotocrossMenu(scale);
  simulation = new Simulation(
    validateOptions({
      ...DEFAULT_OPTIONS,
      circuit,
      ruleset: 'motocross-moto',
      vehicles: Array(8).fill('mx450'),
      opponents: 7,
      mode: 'race',
      laps: 3,
    }),
  );
  ui.setTrack(simulation.track);
  ui.options = simulation.options;
  frame = simulation.makeFrame();
  radioArbiter.observe(frame, simulation.options.laps);
  ui.showMode('driving');
  ui.update(frame, renderer, false, 1);
  return {
    time: frame[H.TIME],
    cars: frame[H.CARS],
    fuel: frame[carBase(0) + F.FUEL],
    laps: simulation.options.laps,
  };
}

/** One later presentation, with skipped simulation ticks, must show this
 * snapshot immediately instead of waiting for two more rendered frames. */
export function sampleSparseMotocrossHud(tick: number) {
  if (!frame) throw new Error('Mount a motocross HUD first');
  const o = carBase(0);
  frame[H.TICK] = tick;
  frame[H.TIME] = tick / 120;
  frame[H.PHASE] = 2;
  frame[o + F.SPEED] = 12.5 + tick / 100;
  frame[o + F.RPM] = 7000 + tick;
  ui.update(frame, renderer, false, 1);
  return { speed: Math.round(frame[o + F.SPEED] * 3.6), rpm: Math.round(frame[o + F.RPM]) };
}

/** Explicit synthetic samples isolate the UI's flight/landing/replay state
 * machine; physical acceptance is covered by the riding and offroad tests. */
export function sampleMotocrossHud(
  sample: 'air' | 'clean' | 'hard' | 'crash' | 'rewind' | 'redline',
) {
  if (!simulation || !frame) throw new Error('Mount a motocross HUD first');
  const o = carBase(0);
  frame[H.PHASE] = 2;
  frame[H.TIME] = sample === 'rewind' ? 1 : sample === 'air' ? 10 : 10.05;
  frame[H.RACE_TIME] = frame[H.TIME];
  frame[o + O.START + OFFROAD_BASE] = 2;
  frame[o + OFFROAD_BASE + O.AIRBORNE] = sample === 'air' ? 1 : 0;
  frame[o + OFFROAD_BASE + O.AIR_TIME] = sample === 'air' ? 0.84 : 0;
  frame[o + OFFROAD_BASE + O.LANDING_PITCH] = 0.1;
  frame[o + OFFROAD_BASE + O.LANDING_SPEED] = sample === 'hard' ? 6.8 : 2.4;
  frame[o + OFFROAD_BASE + O.BOTTOM] = sample === 'hard' ? 0.7 : 0;
  frame[o + BIKE_BASE + B.STATE] = sample === 'crash' ? 1 : 0;
  frame[o + F.SPEED] = 19;
  frame[o + F.GEAR] = 3;
  frame[o + F.RPM] = sample === 'redline' ? VEHICLES.mx450.spec.shiftRPM : 7800;
  for (let i = 0; i < 3; i++) ui.update(frame, renderer, false, 1);
}

/** A real race-control banner and real arbiter caption from one explicitly
 * synthetic double-yellow snapshot, alongside a visible holeshot readout. */
export function showMotocrossRaceAlert(held = false) {
  if (!simulation || !frame) throw new Error('Mount a motocross HUD first');
  const o = carBase(0);
  frame[H.TIME] = held ? 14.2 : 10.1;
  frame[H.RACE_TIME] = frame[H.TIME];
  frame[H.FLAG] = FLAG.DOUBLE_YELLOW;
  frame[o + F.LOCAL_FLAG] = FLAG.DOUBLE_YELLOW;
  frame[o + F.CAUTION_SPEED] = 8;
  frame[o + F.CONTROL_SEQUENCE] = 1;
  frame[o + OFFROAD_BASE + O.FORMAT] = 1;
  // Place one actual snapshot vehicle on each side of the player's body frame.
  // nearbyTraffic, rather than a fixture CSS flag, must expose both rider cues.
  const qx = frame[o + F.QX],
    qy = frame[o + F.QY],
    qz = frame[o + F.QZ],
    qw = frame[o + F.QW],
    rightX = 1 - 2 * (qy * qy + qz * qz),
    rightZ = 2 * (qx * qz - qw * qy);
  for (const id of [1, 2]) {
    const other = carBase(id),
      side = id === 1 ? -2 : 2;
    frame[other + F.X] = frame[o + F.X] + side * rightX;
    frame[other + F.Y] = frame[o + F.Y];
    frame[other + F.Z] = frame[o + F.Z] + side * rightZ;
  }
  radio.show(radioArbiter.observe(frame, simulation.options.laps));
  for (let i = 0; i < 3; i++) ui.update(frame, renderer, false, 1);
}

/** Reuse the same Interface/RadioCaption with a road session. The original
 * DOM parents must be restored, leaving other disciplines' CSS in control. */
export function restoreRoadHud() {
  const road = new Simulation(validateOptions({ ...DEFAULT_OPTIONS, opponents: 1 }));
  ui.setTrack(road.track);
  ui.options = road.options;
  const roadFrame = road.makeFrame();
  for (let i = 0; i < 3; i++) ui.update(roadFrame, renderer, false, 1);
  return {
    radioParent: radio.element.parentElement?.id,
    bannerParent: document.querySelector('.f1-banner')?.parentElement?.id,
    statusStacks: document.querySelectorAll('.mx-status-stack').length,
  };
}

export function showMotocrossBriefing() {
  if (!simulation) throw new Error('Mount a motocross HUD first');
  ui.modalContent(raceBriefing(simulation.options, simulation.makeFrame()));
}
