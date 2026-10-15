import * as T from 'three';
import { VEHICLE } from '../simulation/config.ts';
import { chassisLean, dynamicLean } from '../simulation/bike-definitions.ts';
import {
  B,
  BIKE_BASE,
  BIKE_STRIDE,
  CAR_STRIDE,
  HEADER,
  R,
  RACE_BASE,
  W,
  WHEEL_BASE,
  WHEEL_STRIDE,
  carBase,
} from '../simulation/protocol.ts';
import {
  DEFAULT_VEHICLE_ID,
  vehicleDefinition,
  vehicleIndex,
  type VehicleDefinition,
} from '../simulation/vehicles.ts';
import { writeGhostFrame, type GhostPose } from '../core/ghost-lap.ts';
import { BikeShells, staticSag } from './bike.ts';
import { FormulaCar } from './car.ts';
import type { HeroShells } from './hero-shells.ts';
import { VehicleBodies } from './vehicle-bodies/index.ts';
import { bodySheetFor } from './vehicle-bodies/body-sheet.ts';

/** Translucent Time Trial ghost. It is an ordinary vehicle representation
 * posed from the saved personal-best lap — the Formula car, the recorded
 * catalogue machine's procedural body, or the recorded motorcycle and its
 * rider — with one shared translucent material, no shadows, no reflections,
 * and a fade near the camera so it never hides the player's own vehicle or
 * cockpit. It never collides and is not simulated. */
export const GHOST_LOOK = Object.freeze({
  color: 0xa9dcff,
  emissive: 0x2c7fb3,
  opacity: 0.34,
  fadeStart: 3,
  fadeEnd: 14,
});

export function ghostOpacity(distance: number) {
  const t = Math.min(
    1,
    Math.max(0, (distance - GHOST_LOOK.fadeStart) / (GHOST_LOOK.fadeEnd - GHOST_LOOK.fadeStart)),
  );
  return GHOST_LOOK.opacity * t * t * (3 - 2 * t);
}

/** Which representation draws a recorded vehicle (the same choice the field
 * makes: bike shells, catalogue bodies, else the Formula car). */
export type GhostRepresentation = 'formula' | 'body' | 'bike';
export function ghostRepresentation(definition: VehicleDefinition): GhostRepresentation {
  if (definition.dynamicsKind === 'bike' && definition.bike) return 'bike';
  return bodySheetFor(definition) ? 'body' : 'formula';
}

/** Vehicle channels for the ghost's one-car frame: the recorded vehicle index,
 * wheel steer and rolling phase at that machine's radius, and for a bike the
 * chassis lean recovered from the recorded orientation, the static sag of its
 * suspension and a speed tuck. Ghost samples carry the pose, steer and speed
 * only, so suspension and rider detail are representative, not recorded. */
export function writeGhostVehicle(
  frame: Float32Array,
  pose: GhostPose,
  definition: VehicleDefinition,
  euler = new T.Euler(),
  quaternion = new T.Quaternion(),
) {
  const o = carBase(0);
  frame[o + RACE_BASE + R.VEHICLE] = vehicleIndex(definition.id);
  const bike = definition.dynamicsKind === 'bike' ? definition.bike : undefined;
  const radius = (i: number) =>
    bike ? (i < 2 ? bike.frontWheelRadius : bike.rearWheelRadius) : definition.spec.wheelRadius;
  const steer = bike
    ? 0
    : pose.steer *
      (definition.id === DEFAULT_VEHICLE_ID ? VEHICLE.maxSteer : definition.spec.maxSteer);
  for (let i = 0; i < 4; i++) {
    const p = o + WHEEL_BASE + i * WHEEL_STRIDE;
    frame[p + W.STEER] = i < 2 ? steer : 0;
    frame[p + W.ROTATION] = (pose.s / radius(i)) % (Math.PI * 2);
    frame[p + W.RADIUS] = radius(i);
    frame[p + W.LOAD] = 0;
  }
  const k = o + BIKE_BASE;
  frame.fill(0, k, k + BIKE_STRIDE);
  if (!bike) return;
  // Snapshot orientation = yaw(heading) · pitch · roll(-chassis lean).
  euler.setFromQuaternion(quaternion.set(pose.qx, pose.qy, pose.qz, pose.qw), 'YXZ');
  const chassis = -euler.z,
    lean = dynamicLean(chassis, bike),
    sag = staticSag(definition);
  frame[k + B.LEAN] = lean;
  frame[k + B.STEER] = pose.steer;
  frame[k + B.FORK] = sag.fork;
  frame[k + B.SHOCK] = sag.shock;
  frame[k + B.TUCK] =
    Math.abs(chassisLean(lean, bike)) < 0.2 ? Math.min(1, Math.max(0, (pose.speed - 25) / 10)) : 0;
}

export class GhostCar {
  readonly root = new T.Group();
  /** The Formula representation; it also carries the pose (root transform
   * and LOD) the catalogue body and the motorcycle follow. */
  readonly car: FormulaCar;
  readonly material: T.MeshStandardMaterial;
  private bodies: VehicleBodies | null = null;
  private bikes: BikeShells | null = null;
  private frame = new Float32Array(HEADER + CAR_STRIDE);
  private visibleNow = false;
  private readonly euler = new T.Euler();
  private readonly quaternion = new T.Quaternion();
  /** Representation of the vehicle last posed (diagnostics). */
  representation: GhostRepresentation = 'formula';
  vehicle = DEFAULT_VEHICLE_ID;
  constructor(hero?: HeroShells) {
    this.root.name = 'Time Trial ghost';
    // Car id 1 uses a rival representation, never the supplied player asset.
    this.car = new FormulaCar(1, hero);
    this.car.root.name = 'Time Trial ghost (Formula)';
    this.material = new T.MeshStandardMaterial({
      color: GHOST_LOOK.color,
      emissive: GHOST_LOOK.emissive,
      emissiveIntensity: 0.55,
      roughness: 0.45,
      metalness: 0,
      transparent: true,
      opacity: GHOST_LOOK.opacity,
      // Nearest surface only: internal parts do not stack into a bright blob.
      depthWrite: true,
    });
    this.material.name = 'Time Trial ghost';
    this.ghostly(this.car.root);
    this.root.add(this.car.root);
    this.root.visible = false;
  }
  /** One translucent material, no shadows; depth-only proxies stay hidden. */
  private readonly ghostly = (root: T.Object3D) => {
    root.traverse((object) => {
      const mesh = object as T.Mesh;
      if (!mesh.isMesh) return;
      const own = mesh.material as T.Material;
      if (!Array.isArray(own) && own.colorWrite === false) return;
      mesh.material = this.material;
      mesh.castShadow = false;
      mesh.receiveShadow = false;
      mesh.renderOrder = 3;
    });
  };
  get visible() {
    return this.visibleNow;
  }
  private hide() {
    this.visibleNow = this.root.visible = false;
  }
  /** Pose the ghost for this presented frame, or hide it. */
  update(
    pose: GhostPose | null,
    camera: T.PerspectiveCamera,
    quality: 'low' | 'medium' | 'high',
    time: number,
    dt: number,
  ) {
    if (!pose) return this.hide();
    const definition = vehicleDefinition(pose.vehicle ?? DEFAULT_VEHICLE_ID),
      kind = ghostRepresentation(definition);
    this.vehicle = definition.id;
    this.representation = kind;
    const f = this.frame,
      o = carBase(0);
    writeGhostFrame(f, pose, time);
    writeGhostVehicle(f, pose, definition, this.euler, this.quaternion);
    const distance = camera.position.distanceTo(this.car.root.position.set(pose.x, pose.y, pose.z));
    const opacity = ghostOpacity(distance);
    this.material.opacity = opacity;
    this.visibleNow = this.root.visible = opacity > 0.01;
    if (!this.visibleNow) return;
    this.car.root.visible = true;
    // The reduced representation is the ghost's detail level at any range.
    this.car.setLod(Math.max(distance, 80), quality, false);
    this.car.update(f, f, o, 1, dt, time, false);
    if (kind === 'body') {
      if (!this.bodies) {
        this.bodies = new VehicleBodies();
        this.bodies.root.name = 'Time Trial ghost (catalogue body)';
        this.bodies.onBuild = this.ghostly;
        this.root.add(this.bodies.root);
      }
      this.bodies.root.visible = true;
      this.bodies.update(f, f, 1, [this.car]);
    } else if (this.bodies) this.bodies.root.visible = false;
    if (kind === 'bike') {
      if (!this.bikes) {
        this.bikes = new BikeShells();
        this.bikes.root.name = 'Time Trial ghost (motorcycle)';
        this.bikes.install = this.ghostly;
        this.root.add(this.bikes.root);
      }
      this.bikes.root.visible = true;
      this.bikes.update(f, f, 1, [this.car], camera, quality, -1);
      // The bike pose tints its compound bands; the ghost keeps one colour.
      this.material.color.setHex(GHOST_LOOK.color);
    } else if (this.bikes) this.bikes.root.visible = false;
  }
  /** Car geometry is shared with the field and released with the renderer. */
  dispose() {
    this.material.dispose();
  }
}
