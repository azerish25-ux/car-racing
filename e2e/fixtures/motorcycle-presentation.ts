import { Color } from 'three';
import { Interface } from '../../src/ui/interface.ts';
import { SURFACE, Track, trackPoint } from '../../src/simulation/track.ts';
import { VEHICLES } from '../../src/simulation/vehicles.ts';
import { bikeSlipstreamDragScale } from '../../src/simulation/bike-slipstream.ts';
import { menuPreview } from '../../src/rendering/menu-preview.ts';
import {
  B,
  BIKE_BASE,
  F,
  H,
  W,
  WHEEL_BASE,
  WHEEL_STRIDE,
  carBase,
} from '../../src/simulation/protocol.ts';
import type { CameraMode, RacingRenderer } from '../../src/rendering/renderer.ts';

let ui: Interface;
let track: Track;
let lastPreview = '';

/** Production DOM and styles with explicit synthetic telemetry. This fixture
 * verifies layout/state restoration, not rendered scenery or gameplay. */
export function mountMotorcycleHud() {
  const root = document.createElement('main');
  root.id = 'app';
  document.body.replaceChildren(root);
  track = new Track();
  const noop = () => {};
  ui = new Interface(root, track, {
    action: noop,
    start: noop,
    apply: noop,
    seek: noop,
    replaySpeed: noop,
    exportSetup: noop,
    importSetup: noop,
    previewMachine: (id) => {
      lastPreview = id;
    },
  });
  ui.ready();
  const notice = document.createElement('p');
  notice.textContent = 'INTERFACE LAYOUT CHECK · SYNTHETIC TELEMETRY · NO 3D SCENE';
  notice.style.cssText =
    'position:fixed;bottom:3px;left:4px;font:10px monospace;color:#a9b7bf;pointer-events:none';
  document.body.append(notice);
}

export interface HudSnapshot {
  time: number;
  speed: number;
  gear: number;
  rpm: number;
  lean: number;
  station: number;
  lateral: number;
  tow: number;
  frontSurface: number;
  rearSurface: number;
  frontWater: number;
  rearWater: number;
  frontDisc: number;
  intervention: number;
  flag: number;
}

export function showMotorcycleHud(
  machine = 'gpr1',
  camera: CameraMode = 'chase',
  fallen = false,
  snapshot: Partial<HudSnapshot> = {},
) {
  const frame = menuPreview(track, snapshot.station ?? track.length - 32, machine),
    o = carBase(0);
  frame[H.PHASE] = 2;
  frame[H.TIME] = snapshot.time ?? (fallen ? 30 : 20);
  frame[o + F.SPEED] = snapshot.speed ?? 45;
  frame[o + F.GEAR] = snapshot.gear ?? 4;
  frame[o + F.RPM] = snapshot.rpm ?? 11340;
  frame[o + F.THROTTLE] = 0.6;
  frame[o + F.BRAKE] = 0.25;
  frame[o + F.FUEL] = 12.4;
  frame[o + F.LAP_TIME] = 48.271;
  frame[o + F.RANK] = 1;
  frame[o + F.LATERAL] = snapshot.lateral ?? 0;
  frame[o + BIKE_BASE + B.LEAN] = snapshot.lean ?? 0.72;
  frame[o + BIKE_BASE + B.REAR_BRAKE] = 0.35;
  frame[o + BIKE_BASE + B.TUCK] = 0.8;
  frame[o + BIKE_BASE + B.INTERVENTION] = snapshot.intervention ?? (fallen ? 0.6 : 0.18);
  frame[o + F.LOCAL_FLAG] = snapshot.flag ?? 0;
  frame[o + BIKE_BASE + B.STATE] = fallen ? 3 : 0;
  // A coherent velocity enables the production corner/draft readout in the
  // responsive-layout checks instead of silently hiding it behind a zero
  // velocity paired with a nonzero speedometer.
  const road = track.at(frame[o + F.S], trackPoint()),
    speed = frame[o + F.SPEED];
  frame[o + F.VX] = speed * road.tx;
  frame[o + F.VZ] = speed * road.tz;
  const bike = VEHICLES[machine]?.bike;
  if (bike)
    frame[o + F.DRAG] =
      bike.drag * speed ** 2 * bikeSlipstreamDragScale(0.8, bike.tuckDrag, snapshot.tow ?? 0);
  for (let wheel = 0; wheel < 4; wheel++) {
    const p = o + WHEEL_BASE + wheel * WHEEL_STRIDE;
    frame[p + W.CARCASS_TEMP] = wheel < 2 ? 83 : 96;
    frame[p + W.WEAR] = wheel < 2 ? 0.08 : 0.13;
    frame[p + W.SURFACE] =
      (wheel < 2 ? snapshot.frontSurface : snapshot.rearSurface) ?? SURFACE.ASPHALT;
    frame[p + W.WATER] = (wheel < 2 ? snapshot.frontWater : snapshot.rearWater) ?? 0;
    frame[p + W.DISC_TEMP] = wheel < 2 ? (snapshot.frontDisc ?? 500) : 200;
  }
  // Deliberately poison redundant copies: a bike displays its actual front/rear.
  frame[o + WHEEL_BASE + WHEEL_STRIDE + W.CARCASS_TEMP] = 1;
  frame[o + WHEEL_BASE + WHEEL_STRIDE * 3 + W.CARCASS_TEMP] = 2;
  const renderer = {
    mode: camera,
    debug: false,
    cars: [{ paint: { color: new Color(0xe45d40) } }],
  } as unknown as RacingRenderer;
  ui.showMode('driving');
  // One call represents one presented snapshot. Repeating it to satisfy a
  // panel throttle would hide stale instruments at a low rendering cadence.
  ui.update(frame, renderer, false, 1);
}

export function showGpCornerCase(exit = false) {
  showMotorcycleHud('gpr1', 'chase', false, {
    station: track.circuit.corners[0].s + (exit ? 12 : -80),
    lean: 0.3,
  });
}

export function showMotorcycleMenu() {
  ui.showMode('menu');
}
export function previewSelection() {
  return lastPreview;
}
