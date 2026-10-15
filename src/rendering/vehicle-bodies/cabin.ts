import * as T from 'three';
import { clamp } from '../../core/math.ts';
import type { VehicleDefinition } from '../../simulation/vehicles.ts';
import { COCKPIT_FOV } from '../options.ts';
import { bodySheetFor, type BodySheet, type ClosedSheet } from './body-sheet.ts';
import { ClosedBodyModel } from './closed-body.ts';
import { bodyFrame, type BodyFrame } from './frame.ts';

/** Per-vehicle driver's cabin (cars loose ends 1): where the driver sits,
 * where the eyes are, where the steering wheel, dash and cockpit cell stand,
 * and where the onboard roof / bonnet / airbox camera is mounted — all
 * derived from the body sheet (cabin stations, cowl, roof and floor heights)
 * and the simulated definition (axles, rest heights), so the cockpit camera
 * of a GT, a truck or a kart looks out of that machine rather than from the
 * Formula car's eye socket. Car frame: +Z nose, +Y up, +X driver's left,
 * origin at the centre of mass. The body builders read the same layout, so
 * the drawn seat, driver, wheel and interior always surround the eye. */
export type Vec3 = readonly [number, number, number];
export type CabinFamily = 'closed' | 'open-cockpit' | 'open-wheel' | 'kart' | 'buggy';
/** Where the second onboard ('pod') camera is mounted. */
export type MountKind = 'roof' | 'bonnet' | 'airbox';
export type WheelStyle = 'gt' | 'round' | 'dished' | 'formula' | 'kart';
export interface CabinView {
  /** Camera position (car frame). */
  eye: Vec3;
  /** Gaze pitch below the car's horizontal (radians, negative looks down). */
  pitch: number;
  /** Default vertical field of view (degrees). */
  fov: number;
}
export interface CabinLayout {
  id: string;
  family: CabinFamily;
  /** Body style ('gt', 'saloon', ..., or the sheet kind for open machines). */
  style: string;
  /** Race interior: bucket seat, harness, carbon dash and switch panel. */
  race: boolean;
  /** Full roll cage inside a roofed race car. */
  cage: boolean;
  /** A second (passenger or co-driver) seat. */
  passenger: boolean;
  /** Rear bench (road saloons with room behind the driver). */
  rearBench: boolean;
  driverScale: number;
  /** Driver seat: lateral x, cushion top y and the driver's z station (the
   * `addDriver` reference: the helmet centre stands 0.02 m ahead of it). */
  seat: Vec3;
  /** Helmet centre and the eye point between the eyes. */
  head: Vec3;
  eye: Vec3;
  wheel: {
    /** Rim centre; the hands hold it at +-`radius` on the horizontal. */
    centre: Vec3;
    radius: number;
    /** Column rake about X: the rim top leans forward, away from the driver,
     * so the column runs forward and down into the dash. */
    tilt: number;
    /** Steering-wheel radians per road-wheel radian (F.STEER is road angle). */
    ratio: number;
    style: WheelStyle;
    /** Hands below the helmet centre (x driver scale), as `addDriver` places them. */
    handDrop: number;
  };
  /** Cockpit cell of a closed body: toe-board and rear-bulkhead stations and
   * the cabin floor; null for open-wheel cars, karts and buggies. */
  cell: { front: number; rear: number; floor: number } | null;
  /** Dashboard: front (under the cowl) and rear stations, and its top. */
  dash: { front: number; rear: number; top: number } | null;
  /** Inner roof height (roofed closed bodies), else null. */
  roof: number | null;
  /** Main hoop station of the roll cage (behind the driver's seat). */
  hoop: number | null;
  cockpit: CabinView;
  mount: CabinView & { kind: MountKind };
}
/** Default seated-driver lenses (vertical degrees) by cabin family/style. The
 * Formula car's P6 lens is 54 deg; closed cars sit further from the screen
 * behind pillars and want a little more, karts and trucks most. */
export const CABIN_FOV: Readonly<Record<string, number>> = Object.freeze({
  'open-wheel': 54,
  prototype: 54,
  gt: 56,
  supercar: 56,
  roadster: 56,
  'open-prototype': 55,
  saloon: 58,
  rally: 60,
  truck: 62,
  buggy: 62,
  kart: 64,
});
/** Onboard mount lenses (vertical degrees). */
export const MOUNT_FOV: Readonly<Record<MountKind, number>> = Object.freeze({
  roof: 58,
  airbox: 58,
  bonnet: 60,
});
/** The cockpit view's lens: the class default moved by the player's
 * `cockpitFov` preference relative to the Formula default (so a player who
 * widened the Formula lens by 6 deg gets the GT's default widened by 6). */
export function cabinFov(layout: CabinLayout, setting: number) {
  const offset = Number.isFinite(setting)
    ? clamp(setting, COCKPIT_FOV.min, COCKPIT_FOV.max) - COCKPIT_FOV.default
    : 0;
  return clamp(layout.cockpit.fov + offset, 40, 80);
}
/** The onboard mount's lens, widened up to 4 deg with speed (m/s) like the T-cam. */
export function mountFov(layout: CabinLayout, speed: number) {
  const v = Number.isFinite(speed) ? Math.abs(speed) : 0;
  return layout.mount.fov + Math.min(4, v * 0.05);
}
/** Bounded seat motion: the inertial head offset can never carry the eye out
 * of the cabin (the same limits as the Formula cockpit framing). */
export const CABIN_MOTION_LIMIT = Object.freeze([0.02, 0.012, 0.018] as const);
export function cabinEye(layout: CabinLayout, motion: T.Vector3, out: T.Vector3) {
  const [x, y, z] = layout.eye,
    m = CABIN_MOTION_LIMIT;
  if (![motion.x, motion.y, motion.z].every(Number.isFinite))
    throw new Error('Invalid cabin eye motion');
  return out.set(
    x + clamp(motion.x, -m[0], m[0]),
    y + clamp(motion.y, -m[1], m[1]),
    z + clamp(motion.z, -m[2], m[2]),
  );
}
/** The onboard mount's camera point. A mounted camera is bolted to the car,
 * so the inertial offset is bounded like the seat motion: it can never carry
 * the lens into the bodywork in front of it (light bar, wheel rim, headrest). */
export function mountEye(layout: CabinLayout, motion: T.Vector3, out: T.Vector3) {
  const [x, y, z] = layout.mount.eye,
    m = CABIN_MOTION_LIMIT;
  if (![motion.x, motion.y, motion.z].every(Number.isFinite))
    throw new Error('Invalid onboard mount motion');
  return out.set(
    x + clamp(motion.x, -m[0], m[0]),
    y + clamp(motion.y, -m[1], m[1]),
    z + clamp(motion.z, -m[2], m[2]),
  );
}
/** Unit gaze direction of a view (car frame). */
export function cabinDirection(view: CabinView, out: T.Vector3) {
  return out.set(0, Math.sin(view.pitch), Math.cos(view.pitch));
}
const cache = new Map<string, CabinLayout | null>();
/** The cabin of a definition (null for the Formula car, which keeps its
 * supplied cockpit, and for motorcycles). Cached per definition id. */
export function cabinFor(def: VehicleDefinition): CabinLayout | null {
  let layout = cache.get(def.id);
  if (layout === undefined) {
    const sheet = bodySheetFor(def);
    layout = sheet ? cabinLayout(def, sheet) : null;
    cache.set(def.id, layout);
  }
  return layout;
}
const v3 = (x: number, y: number, z: number): Vec3 => Object.freeze([x, y, z] as const);
/** Seat-to-eye geometry of the procedural driver (`addDriver`, scale s): the
 * helmet centre stands 0.74 s above the cushion; the eye sits 5 mm above and
 * 0.085 s ahead of it, inside the helmet shell. */
const HEAD_RISE = 0.74,
  EYE_RISE = 0.005,
  EYE_AHEAD = 0.085;
function seated(x: number, seatY: number, z: number, s: number, rise = EYE_RISE) {
  const head = v3(x, seatY + HEAD_RISE * s, z + 0.02);
  return { head, eye: v3(x, head[1] + rise, head[2] + EYE_AHEAD * s) };
}
/** A single-seater driver lies back: the eyes sit a little below the helmet
 * centre, under the halo's top bar (the Formula P6 framing). */
const RECLINED_EYE_RISE = -0.025;
/** Build the layout for a definition and its sheet (pure, deterministic). */
export function cabinLayout(def: VehicleDefinition, sheet: BodySheet): CabinLayout {
  const f = bodyFrame(def);
  const race = def.classId !== 'road';
  if (sheet.kind === 'closed') return closedCabin(def, f, sheet, race);
  if (sheet.kind === 'open-wheel') {
    const s = sheet,
      scale = 0.92,
      zCockpit = f.z(s.cockpit),
      seatY = f.y(0.12),
      { head, eye } = seated(0, seatY, zCockpit - 0.1, scale, RECLINED_EYE_RISE),
      tubTop = s.tub[1];
    const mount =
      (s.era === 'modern' || s.era === 'eighties') && s.airbox
        ? v3(0, f.y(1.0) + 0.09, zCockpit - 0.36)
        : s.era === 'seventies' && s.airbox
          ? v3(0, f.y(tubTop + 0.43) + 0.09, zCockpit - 0.5)
          : s.era === 'historic' || s.era === 'seventies'
            ? v3(0, f.y(tubTop + 0.32) + 0.1, zCockpit - 0.36)
            : // No airbox (modern electric): above the headrest bulkhead,
              // not inside it.
              v3(0, f.y(tubTop + 0.48), zCockpit - 0.34);
    return Object.freeze<CabinLayout>({
      id: def.id,
      family: 'open-wheel',
      style: s.era,
      race: true,
      cage: false,
      passenger: false,
      rearBench: false,
      driverScale: scale,
      seat: v3(0, seatY, zCockpit - 0.1),
      head,
      eye,
      wheel: wheelAt(head, scale, zCockpit + 0.36, 0.15, 3.5, 'formula', 0.28),
      cell: null,
      dash: null,
      roof: null,
      hoop: null,
      cockpit: { eye, pitch: -0.06, fov: CABIN_FOV['open-wheel'] },
      mount: { kind: 'airbox', eye: mount, pitch: -0.075, fov: MOUNT_FOV.airbox },
    });
  }
  if (sheet.kind === 'kart') {
    const scale = 0.92,
      seatY = f.y(0.06),
      z = f.rearAxle + 0.4,
      { head, eye } = seated(0, seatY, z, scale);
    return Object.freeze<CabinLayout>({
      id: def.id,
      family: 'kart',
      style: 'kart',
      race: true,
      cage: false,
      passenger: false,
      rearBench: false,
      driverScale: scale,
      seat: v3(0, seatY, z),
      head,
      eye,
      wheel: wheelAt(head, scale, f.frontAxle - 0.08, 0.6, 2.2, 'kart'),
      cell: null,
      dash: null,
      roof: null,
      hoop: null,
      cockpit: { eye, pitch: -0.08, fov: CABIN_FOV.kart },
      // A nose camera ahead of the steering wheel's rim (the rim's top
      // reaches about 3 cm past the front axle).
      mount: {
        kind: 'bonnet',
        eye: v3(0, f.y(0.5), f.frontAxle + 0.1),
        pitch: -0.06,
        fov: MOUNT_FOV.bonnet,
      },
    });
  }
  // Buggy: driver on the left seat of a two-seat cage.
  const scale = 0.92,
    zCockpit = f.z(sheet.cockpit),
    floor = f.y(0.36),
    seatY = floor + 0.08,
    { head, eye } = seated(0.28, seatY, zCockpit - 0.1, scale);
  return Object.freeze<CabinLayout>({
    id: def.id,
    family: 'buggy',
    style: 'buggy',
    race: true,
    cage: false,
    passenger: true,
    rearBench: false,
    driverScale: scale,
    seat: v3(0.28, seatY, zCockpit - 0.1),
    head,
    eye,
    wheel: wheelAt(head, scale, zCockpit + 0.36, 0.35, 12, 'dished', 0.33),
    cell: null,
    dash: null,
    roof: f.y(sheet.roof) - 0.03,
    hoop: null,
    cockpit: { eye, pitch: -0.06, fov: CABIN_FOV.buggy },
    // At the front of the roof, ahead of the front roof hoop and the light
    // bar (zCockpit + 0.5 ± 0.04), never behind the bar's rear face.
    mount: {
      kind: 'roof',
      eye: v3(0, f.y(sheet.roof) + 0.12, zCockpit + 0.62),
      pitch: -0.1,
      fov: MOUNT_FOV.roof,
    },
  });
}
/** Steering wheel ahead of the hands: `addDriver` puts the hands `drop` s
 * below the helmet centre and 0.17 s either side, so the rim radius is 0.17 s. */
function wheelAt(
  head: Vec3,
  s: number,
  handsZ: number,
  tilt: number,
  ratio: number,
  style: WheelStyle,
  drop = 0.38,
) {
  return Object.freeze({
    centre: v3(head[0], head[1] - drop * s, handsZ + 0.02),
    radius: 0.17 * s,
    tilt,
    ratio,
    style,
    handDrop: drop,
  });
}
/** Closed cars hold the wheel higher (rim top near the dash top line). */
const CLOSED_HAND_DROP = 0.33;
/** Steering ratio by style for closed bodies (road cars are slower geared). */
const CLOSED_RATIO: Record<ClosedSheet['style'], number> = {
  prototype: 9,
  gt: 11,
  supercar: 11,
  saloon: 12,
  roadster: 11,
  rally: 11,
  truck: 14,
};
function closedCabin(
  def: VehicleDefinition,
  f: BodyFrame,
  s: ClosedSheet,
  race: boolean,
): CabinLayout {
  const model = new ClosedBodyModel(f, s, [s.wheels.width[0] / 2, s.wheels.width[1] / 2]);
  const open = s.style === 'roadster' || !!s.open;
  const [ws, rf, rr, rw] = s.cabin,
    zWs = f.z(ws),
    zRF = f.z(rf),
    zRR = f.z(rr),
    zRW = f.z(rw);
  const scale = 0.9,
    upright = s.style === 'truck' || s.style === 'saloon' || s.style === 'rally';
  // Station: just ahead of the B-pillar, the helmet under the roof (roofed);
  // centred in the cockpit opening (open).
  const pillarB = (zRF + zRR) / 2 - 0.08;
  // A cab-forward screen pushes the seat back so the arms still reach a wheel
  // that stands clear of the dash.
  const reach = race ? 0.42 : 0.48;
  const seatZ = open
    ? (zWs + zRW) / 2 - 0.15
    : Math.min(pillarB + 0.28, zRF - 0.03, zWs - 0.22 - reach - (EYE_AHEAD * scale - 0.03));
  const eyeZ = seatZ - 0.05 + 0.02 + EYE_AHEAD * scale;
  // Seated height: cabin floor above the underbody, cushion above the floor
  // (race buckets sit low), then the driver. The eyes must see over the cowl
  // with the scuttle at least ~4 degrees below the horizon, and (roofed) the
  // helmet must clear the roof.
  const floorH = s.floor + (s.style === 'truck' ? 0.5 : upright ? 0.1 : 0.04),
    cushion = race ? 0.1 : upright ? 0.2 : 0.14,
    rise = HEAD_RISE * scale + EYE_RISE;
  let eyeH = Math.max(floorH + cushion + rise, s.cowl + Math.max(0.06, 0.09 * (zWs - eyeZ)));
  if (!open) eyeH = Math.min(eyeH, s.roof - 0.12);
  const seatY = f.y(eyeH - rise);
  // Lateral: the usual offset, but inboard of a narrow roof's cantrail (a
  // prototype's bubble), so the helmet stays under the roof and the eyes look
  // through the screen rather than at its pillar.
  const seatX = open
    ? upright
      ? 0.36
      : 0.3
    : Math.max(0.2, Math.min(upright ? 0.36 : 0.3, s.roofWidth * model.halfWidth(seatZ) - 0.1));
  const driverZ = seatZ - 0.05;
  const { head, eye } = seated(seatX, seatY, driverZ, scale);
  // Wheel: a race reach (or a road one) ahead of the eyes, behind the dash.
  const base = model.topY(zWs) - 0.012;
  const dashTop = Math.min(base - 0.014, eye[1] - 0.12);
  let handsZ = eye[2] + reach - 0.02;
  const dashRear = Math.min(zWs - 0.1, handsZ + 0.02 + 0.12);
  handsZ = Math.min(handsZ, dashRear - 0.1 - 0.02);
  const style: WheelStyle =
    s.style === 'rally' || s.style === 'truck'
      ? 'dished'
      : race && s.style !== 'roadster'
        ? 'gt'
        : 'round';
  const floor = f.y(floorH);
  const rear = Math.max(zRW + 0.05, Math.min(zRR + 0.05, seatZ - 0.45));
  // A tube cage in race cars built on road shells; prototypes carry their
  // roll structure in the monocoque.
  const cage = race && !open && s.style !== 'prototype';
  const passenger = !race || s.style === 'rally';
  const rearBench = !race && s.style === 'saloon' && seatZ - 0.55 - (rear + 0.35) > 0.2;
  // Onboard mount: a roof camera on roofed race cars, a bonnet camera on road
  // cars and open cockpits.
  const roofed = !open;
  let mount: CabinLayout['mount'];
  if (roofed && race)
    mount = {
      kind: 'roof',
      // On the roof ahead of any scoop.
      eye: v3(0, f.y(s.roof) + (s.roofScoop ? 0.16 : 0.11), zRF - 0.06),
      pitch: -0.09,
      fov: MOUNT_FOV.roof,
    };
  else {
    const zb = zWs + clamp((model.zFront - zWs) * 0.3, 0.22, 0.55);
    mount = {
      kind: 'bonnet',
      eye: v3(0, model.surfaceY(zb, 0) + (s.extras.includes('bonnet-scoop') ? 0.2 : 0.11), zb),
      pitch: -0.035,
      fov: MOUNT_FOV.bonnet,
    };
  }
  const fovKey = s.open ? 'open-prototype' : s.style;
  return Object.freeze<CabinLayout>({
    id: def.id,
    family: open ? 'open-cockpit' : 'closed',
    style: s.style,
    race,
    cage,
    passenger,
    rearBench,
    driverScale: scale,
    seat: v3(seatX, seatY, driverZ),
    head,
    eye,
    wheel: wheelAt(
      head,
      scale,
      handsZ,
      0.35,
      (race ? 1 : 1.3) * CLOSED_RATIO[s.style],
      style,
      CLOSED_HAND_DROP,
    ),
    cell: Object.freeze({ front: zWs + 0.12, rear, floor }),
    dash: Object.freeze({ front: zWs + 0.1, rear: dashRear, top: dashTop }),
    roof: roofed ? f.y(s.roof) - 0.03 : null,
    hoop: cage ? Math.max(rear + 0.04, seatZ - 0.42) : null,
    // Gaze: the scuttle line about 0.08 rad below the view centre (a sports
    // car looks nearly level; a truck's high seat looks down over its bonnet).
    cockpit: {
      eye,
      pitch: clamp(-Math.atan2(eyeH - s.cowl, Math.max(0.2, zWs - eye[2])) + 0.07, -0.09, -0.015),
      fov: CABIN_FOV[fovKey],
    },
    mount,
  });
}
