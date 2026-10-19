import * as T from 'three';
import { TAU } from '../../core/math.ts';
import {
  B,
  BIKE_BASE,
  F,
  H,
  R,
  RACE_BASE,
  W,
  WHEEL_BASE,
  WHEEL_STRIDE,
  carBase,
} from '../../simulation/protocol.ts';
import { WHEEL_POSITIONS } from '../../simulation/vehicle.ts';
import { vehicleAt, type VehicleDefinition } from '../../simulation/vehicles.ts';
import { renderWind } from '../../simulation/weather.ts';
import { injectDeclarations, type ShaderStage, type StudioShader } from './shader-hooks.ts';

/**
 * StudioFrame: the per-frame uniforms every studio department shares.
 *
 * One `update()` per rendered frame (renderer.ts, after the shadow anchor and the
 * scene/camera matrix update) writes plain values into uniform objects that
 * materials and passes bind *by identity*: binding costs no per-material update
 * and no draw call, and every consumer sees the same frame state.
 *
 * Determinism: values depend only on the presented snapshot, the solved camera
 * and the sun. No wall clock and no random source. A held frame (presented time
 * unchanged) reports no motion (`prev == now`), so held, paused and photo frames
 * are byte-identical. Camera cuts (view key change), seeks and rewinds (time
 * jumps back or more than `STUDIO_SEEK_SECONDS` forward), resizes (aspect
 * change) and explicit `reset()` calls restart the motion history.
 *
 * Car slots are car ids (`< studioCarCount`, at most 12, the protocol limit).
 * `studioCarNow/Prev` are rigid chassis-to-world matrices (+X driver's left,
 * +Y up, +Z nose). `studioCarPose` is (x, z, yaw, groundY): chassis origin,
 * heading `atan2(forward.x, forward.z)` and the ground height. Formula cars use
 * the mean world height of their four presented tyre contacts; GP prototypes
 * recover their ground plane from the bike's crown/pivot pose. The studio car
 * footprint is the oriented box of half
 * extents `STUDIO_CAR_HALF_EXTENTS` (2.8 m along, 1.0 m across) about (x, z).
 *
 * Usage. Material edits go through a chained hook:
 *   chainShaderHook(material, 'foliage-wind-v1', (shader) => {
 *     useStudioUniforms(shader, ['studioWind'], 'vertex');
 *     injectAfter(shader, 'common', 'float sway(vec3 p) { return studioWind.w * sin(studioWind.z + p.x); }', 'vertex');
 *     injectAfter(shader, 'begin_vertex', 'transformed.x += 0.02 * sway(transformed);', 'vertex');
 *   });
 * Declarations always precede code injected after the same anchor, and blocks
 * after one anchor keep their call order. Chain the same key on the mesh's
 * depth and distance materials when the edit moves vertices, so shadows follow.
 * Full-screen passes reference the objects directly, e.g.
 * `uniforms: { studioPrevViewProj: studioUniforms.studioPrevViewProj }`, and
 * prepend `studioGlsl(['studioPrevViewProj'])` to their fragment source.
 * The view matrices describe the main camera only: mirror, probe and wet
 * reflection passes render the same materials, so velocity-style outputs must
 * be gated to the main scene pass by the consumer.
 */

export const STUDIO_MAX_CARS = 12;
export const STUDIO_CAR_HALF_EXTENTS = Object.freeze({ length: 2.8, width: 1.0 });
/** A forward presented-time jump longer than this is a seek, not motion. */
export const STUDIO_SEEK_SECONDS = 2;

export interface StudioUniforms {
  /** Presented simulation time H.TIME, seconds. */
  studioTime: T.IUniform<number>;
  /** Presented seconds between the previous and current frame; 0 when held or cut. */
  studioFrameDt: T.IUniform<number>;
  /** (wind x m/s, wind z m/s, presented time s, gust 0..1). */
  studioWind: T.IUniform<T.Vector4>;
  /** Unit world direction toward the sun (key light). */
  studioSunDir: T.IUniform<T.Vector3>;
  /** Main camera projection × view, current frame. */
  studioViewProj: T.IUniform<T.Matrix4>;
  /** Main camera projection × view, previous presented frame (== current after a cut or hold). */
  studioPrevViewProj: T.IUniform<T.Matrix4>;
  studioCarCount: T.IUniform<number>;
  studioCarNow: T.IUniform<T.Matrix4[]>;
  studioCarPrev: T.IUniform<T.Matrix4[]>;
  /** (x, z, yaw, groundY) per car. */
  studioCarPose: T.IUniform<T.Vector4[]>;
  /** GP-only tyre contacts: (world x, world z, surface y, contact weight). */
  studioGpFront: T.IUniform<T.Vector4[]>;
  studioGpRear: T.IUniform<T.Vector4[]>;
  /** GP-only (1 riding / 2 separated, signed lean sine, rider offset, stand lift).
   * Zero for every other vehicle, preserving its existing grounding path. */
  studioGpShape: T.IUniform<T.Vector4[]>;
}
export type StudioUniformName = keyof StudioUniforms;

const GLSL_TYPES: Readonly<Record<StudioUniformName, string>> = Object.freeze({
  studioTime: 'float studioTime',
  studioFrameDt: 'float studioFrameDt',
  studioWind: 'vec4 studioWind',
  studioSunDir: 'vec3 studioSunDir',
  studioViewProj: 'mat4 studioViewProj',
  studioPrevViewProj: 'mat4 studioPrevViewProj',
  studioCarCount: 'int studioCarCount',
  studioCarNow: 'mat4 studioCarNow[STUDIO_MAX_CARS]',
  studioCarPrev: 'mat4 studioCarPrev[STUDIO_MAX_CARS]',
  studioCarPose: 'vec4 studioCarPose[STUDIO_MAX_CARS]',
  studioGpFront: 'vec4 studioGpFront[STUDIO_MAX_CARS]',
  studioGpRear: 'vec4 studioGpRear[STUDIO_MAX_CARS]',
  studioGpShape: 'vec4 studioGpShape[STUDIO_MAX_CARS]',
});
export const STUDIO_UNIFORM_NAMES = Object.freeze(Object.keys(GLSL_TYPES) as StudioUniformName[]);

export function createStudioUniforms(): StudioUniforms {
  return {
    studioTime: { value: 0 },
    studioFrameDt: { value: 0 },
    studioWind: { value: new T.Vector4() },
    studioSunDir: { value: new T.Vector3(0, 1, 0) },
    studioViewProj: { value: new T.Matrix4() },
    studioPrevViewProj: { value: new T.Matrix4() },
    studioCarCount: { value: 0 },
    studioCarNow: { value: Array.from({ length: STUDIO_MAX_CARS }, () => new T.Matrix4()) },
    studioCarPrev: { value: Array.from({ length: STUDIO_MAX_CARS }, () => new T.Matrix4()) },
    studioCarPose: { value: Array.from({ length: STUDIO_MAX_CARS }, () => new T.Vector4()) },
    studioGpFront: { value: Array.from({ length: STUDIO_MAX_CARS }, () => new T.Vector4()) },
    studioGpRear: { value: Array.from({ length: STUDIO_MAX_CARS }, () => new T.Vector4()) },
    studioGpShape: { value: Array.from({ length: STUDIO_MAX_CARS }, () => new T.Vector4()) },
  };
}

/** The application's shared uniform objects. The renderer's StudioFrame writes
 * them; any material or pass binds them (see `useStudioUniforms`). */
export const studioUniforms: StudioUniforms = createStudioUniforms();

/**
 * Deterministic gust factor in [0, 1): wind-speed strength (1 - e^(-v/4 m/s))
 * modulated by three incommensurate slow swells (9.7 s, 4.3 s, 2.1 s) between
 * 55 % and 100 %. Consumers multiply sway/flutter amplitudes by it.
 */
export function studioGust(time: number, windX: number, windZ: number) {
  if (!Number.isFinite(time)) return 0;
  const speed = Math.hypot(renderWind(windX), renderWind(windZ));
  const strength = 1 - Math.exp(-speed / 4);
  const swell =
    0.55 * Math.sin((TAU * time) / 9.7) +
    0.3 * Math.sin((TAU * time) / 4.3 + 1.7) +
    0.15 * Math.sin((TAU * time) / 2.1 + 0.6);
  return strength * (0.55 + 0.45 * (0.5 + 0.5 * swell));
}

/** CPU reference of `studioCarPoseLocal`: world point → (across, height above
 * ground, along) in a car's footprint frame. */
export function studioCarLocal(pose: T.Vector4, point: T.Vector3, out = new T.Vector3()) {
  const s = Math.sin(pose.z),
    c = Math.cos(pose.z),
    dx = point.x - pose.x,
    dz = point.z - pose.y;
  return out.set(dx * c - dz * s, point.y - pose.w, dx * s + dz * c);
}

const CAR_HELPERS = /* glsl */ `
#ifndef STUDIO_CAR_HELPERS
#define STUDIO_CAR_HELPERS
#define STUDIO_CAR_HALF_LENGTH ${STUDIO_CAR_HALF_EXTENTS.length.toFixed(2)}
#define STUDIO_CAR_HALF_WIDTH ${STUDIO_CAR_HALF_EXTENTS.width.toFixed(2)}
// Rigid (rotation + translation) world -> chassis space, without a general inverse.
vec3 studioRigidToLocal( mat4 m, vec3 p ) { return ( p - m[ 3 ].xyz ) * mat3( m ); }
// World -> (across, height above ground, along) for pose (x, z, yaw, groundY).
vec3 studioCarPoseLocal( vec4 pose, vec3 p ) {
	float s = sin( pose.z ), c = cos( pose.z );
	vec2 d = p.xz - pose.xy;
	return vec3( d.x * c - d.y * s, p.y - pose.w, d.x * s + d.y * c );
}
#endif`;

/** GLSL declarations for `names`, each guarded so several hooks on one material
 * may declare the same studio uniform. */
export function studioGlsl(names: readonly StudioUniformName[]) {
  const lines = ['#ifndef STUDIO_MAX_CARS', `#define STUDIO_MAX_CARS ${STUDIO_MAX_CARS}`, '#endif'];
  for (const name of names) {
    const declaration = GLSL_TYPES[name];
    if (!declaration) throw new Error(`Unknown studio uniform "${String(name)}"`);
    const guard = `STUDIO_DECLARED_${name}`;
    lines.push(`#ifndef ${guard}`, `#define ${guard}`, `uniform ${declaration};`, '#endif');
  }
  if (names.some((name) => name.startsWith('studioCar'))) lines.push(CAR_HELPERS);
  return lines.join('\n');
}

/**
 * Bind the shared uniform objects into a compiling shader and declare them
 * directly after `#include <common>` (or `anchor`) in the given stage(s), above
 * any code injected after that anchor, whichever call came first. Call from a
 * `chainShaderHook` body. Uniforms are assigned by identity, never copied.
 */
export function useStudioUniforms(
  shader: StudioShader,
  names: readonly StudioUniformName[],
  stages: ShaderStage | 'both' = 'both',
  uniforms: StudioUniforms = studioUniforms,
  anchor = 'common',
) {
  const glsl = studioGlsl(names);
  for (const name of names) shader.uniforms[name] = uniforms[name];
  for (const stage of stages === 'both' ? (['vertex', 'fragment'] as const) : [stages])
    injectDeclarations(shader, anchor, glsl, stage);
}

const UNIT = new T.Vector3(1, 1, 1);
const finiteValue = (frame: Float32Array, offset: number) =>
  Number.isFinite(frame[offset]) ? frame[offset] : 0;

export class StudioFrame {
  private time = NaN;
  private aspect = NaN;
  private view = '';
  private cars = 0;
  private updates = 0;
  private cuts = 0;
  private pending = true;
  /** Previous chassis matrices by car id (slots are ids). */
  private readonly previousCars = Array.from({ length: STUDIO_MAX_CARS }, () => new T.Matrix4());
  private readonly position = new T.Vector3();
  private readonly quaternion = new T.Quaternion();
  private readonly point = new T.Vector3();
  private readonly sunPosition = new T.Vector3();
  private readonly sunTarget = new T.Vector3();
  private readonly gpUp = new T.Vector3();
  private readonly gpForward = new T.Vector3();
  private readonly gpAxle = new T.Vector3();
  private readonly gpPivot = new T.Vector3();

  constructor(readonly uniforms: StudioUniforms = studioUniforms) {}

  /** Restart the motion history: the next frame reports no motion. */
  reset() {
    this.pending = true;
  }

  /**
   * Write this frame's values. `camera` and `sun` must have current world
   * matrices (the renderer calls this after `scene.updateMatrixWorld`). `view`
   * identifies the camera rig; any change is a cut.
   */
  update(
    presented: Float32Array,
    camera: T.Camera,
    sun: T.Object3D & { target: T.Object3D },
    view: string,
  ) {
    const u = this.uniforms;
    const time = presented[H.TIME];
    const cars = Math.min(STUDIO_MAX_CARS, Math.max(0, Math.floor(presented[H.CARS] || 0)));
    if (!Number.isFinite(time)) throw new Error('Invalid studio frame time');
    const aspect = (camera as T.PerspectiveCamera).aspect ?? 1;
    const elapsed = time - this.time;
    const cut =
      this.pending ||
      view !== this.view ||
      aspect !== this.aspect ||
      !(elapsed >= 0 && elapsed <= STUDIO_SEEK_SECONDS);
    // Motion advances only when presented time does: held frames show none.
    const advancing = !cut && elapsed > 0;
    if (cut) this.cuts++;
    this.updates++;
    this.pending = false;
    this.view = view;
    this.aspect = aspect;
    this.time = time;

    u.studioTime.value = time;
    u.studioFrameDt.value = advancing ? elapsed : 0;
    const windX = renderWind(presented[H.WIND_X]),
      windZ = renderWind(presented[H.WIND_Z]);
    u.studioWind.value.set(windX, windZ, time, studioGust(time, windX, windZ));
    this.sunPosition.setFromMatrixPosition(sun.matrixWorld);
    this.sunTarget.setFromMatrixPosition(sun.target.matrixWorld);
    const sunDir = u.studioSunDir.value.subVectors(this.sunPosition, this.sunTarget);
    if (sunDir.lengthSq() > 0) sunDir.normalize();
    else sunDir.set(0, 1, 0);

    const viewProj = u.studioViewProj.value;
    if (advancing) u.studioPrevViewProj.value.copy(viewProj);
    viewProj.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse);
    if (!advancing) u.studioPrevViewProj.value.copy(viewProj);

    u.studioCarCount.value = cars;
    for (let id = 0; id < STUDIO_MAX_CARS; id++) {
      const now = u.studioCarNow.value[id],
        prev = u.studioCarPrev.value[id],
        pose = u.studioCarPose.value[id],
        gpFront = u.studioGpFront.value[id],
        gpRear = u.studioGpRear.value[id],
        gpShape = u.studioGpShape.value[id],
        last = this.previousCars[id];
      gpFront.set(0, 0, 0, 0);
      gpRear.set(0, 0, 0, 0);
      gpShape.set(0, 0, 0, 0);
      if (id >= cars) {
        now.identity();
        prev.identity();
        last.identity();
        pose.set(0, 0, 0, 0);
        continue;
      }
      const o = carBase(id);
      this.position.set(presented[o + F.X], presented[o + F.Y], presented[o + F.Z]);
      this.quaternion
        .set(presented[o + F.QX], presented[o + F.QY], presented[o + F.QZ], presented[o + F.QW])
        .normalize();
      now.compose(this.position, this.quaternion, UNIT);
      // History exists only while time advances without a cut. A car that
      // joined this frame or moved implausibly far (recovery, pit reset) has
      // none either; without history a car reports no motion (prev == now).
      const jump = this.point.setFromMatrixPosition(last).distanceTo(this.position);
      const reach = 2 + 2 * Math.abs(presented[o + F.SPEED]) * elapsed;
      prev.copy(advancing && id < this.cars && jump <= reach ? last : now);
      last.copy(now);
      this.point.set(0, 0, 1).applyQuaternion(this.quaternion);
      const heading = Math.atan2(this.point.x, this.point.z);
      const definition = vehicleAt(Math.round(presented[o + RACE_BASE + R.VEHICLE]));
      const ground =
        definition.classId === 'gp-bike' && definition.bike
          ? this.gpGrounding(presented, o, definition, heading, gpFront, gpRear, gpShape)
          : this.groundHeight(presented, o);
      pose.set(this.position.x, this.position.z, heading, ground);
    }
    this.cars = cars;
  }

  /** Recover the GP road plane from BikeVehicle.writeBody's crown/pivot
   * kinematics, then project the definition's two tyre centres onto it.
   * Suspension LENGTH is a fork quantity on bikes, not a Formula hub offset.
   * Fixed scratch and uniform slots keep this allocation- and draw-free. */
  private gpGrounding(
    presented: Float32Array,
    o: number,
    definition: VehicleDefinition,
    heading: number,
    front: T.Vector4,
    rear: T.Vector4,
    shape: T.Vector4,
  ) {
    const spec = definition.bike!;
    const lean = finiteValue(presented, o + BIKE_BASE + B.LEAN),
      pitch = T.MathUtils.clamp(finiteValue(presented, o + BIKE_BASE + B.PITCH), -1.3, 1.3),
      fallen = Math.abs(lean) > 1.2,
      lift = finiteValue(presented, o + F.IN_PIT)
        ? T.MathUtils.clamp(finiteValue(presented, o + F.JACK_HEIGHT), 0, 0.5)
        : 0,
      sh = Math.sin(heading),
      ch = Math.cos(heading);
    this.gpUp.set(0, 1, 0).applyQuaternion(this.quaternion);
    this.gpForward.set(0, 0, 1).applyQuaternion(this.quaternion);
    this.gpAxle.set(1, 0, 0).applyQuaternion(this.quaternion);
    // The forward axis is unaffected by roll: its elevation carries the road
    // pitch plus a wheelie/stoppie. The crash pose omits the dynamic pitch.
    const roadPitch = T.MathUtils.clamp(
      Math.asin(T.MathUtils.clamp(this.gpForward.y, -1, 1)) - (fallen ? 0 : pitch),
      -Math.PI / 6,
      Math.PI / 6,
    );
    // writeBody uses asin(dy / planar wheelbase), so sin recovers its sampled
    // road slope exactly. This is not the tangent of a rigid ramp angle.
    const slope = Math.sin(roadPitch);
    this.gpPivot
      .copy(this.position)
      .addScaledVector(
        this.gpUp,
        -(fallen ? 0.18 - spec.crownRadius : spec.cgHeight - spec.crownRadius),
      );
    if (!fallen)
      this.gpPivot.addScaledVector(this.gpForward, pitch >= 0 ? -spec.cgToRear : spec.cgToFront);
    this.gpPivot.y -= spec.crownRadius;
    // The fallen pivot is the mean of the two heights at d.x/z; the axle
    // offsets are not symmetric about that point on either GP definition.
    if (fallen) this.gpPivot.y -= (spec.cgToFront - spec.cgToRear) * 0.5 * slope;
    const ground =
      this.gpPivot.y +
      ((this.position.x - this.gpPivot.x) * sh + (this.position.z - this.gpPivot.z) * ch) * slope;
    // Closest point of the rounded tyre to the road plane: project its normal
    // into the wheel plane and onto the visible crown arc. Clamp at the same
    // shoulder as tyreGeometry so maximum lean cannot put a patch beyond it.
    const ny = 1 / Math.sqrt(1 + slope * slope),
      nx = -sh * slope * ny,
      nz = -ch * slope * ny,
      axleDot = this.gpAxle.x * nx + this.gpAxle.y * ny + this.gpAxle.z * nz,
      planeNormal = Math.sqrt(Math.max(0, 1 - axleDot * axleDot));
    for (let i = 0; i < 2; i++) {
      const centre = definition.wheelPositions[i * 2],
        radius = i === 0 ? spec.frontWheelRadius : spec.rearWheelRadius,
        // BikeModel's broad rear slick uses a larger visual crown. Keep the
        // physics crown above for pivot inversion, this one for the mesh.
        crown = i === 0 ? spec.crownRadius : Math.max(spec.crownRadius, 0.11),
        halfWidth = i === 0 ? 0.06 : 0.1,
        contact = i === 0 ? front : rear;
      this.point
        .fromArray(centre)
        .applyQuaternion(this.quaternion)
        .add(this.position)
        .addScaledVector(this.gpUp, lift);
      if (planeNormal > 1e-5) {
        const reach = Math.min(1.25, Math.asin(Math.min(0.98, halfWidth / crown))),
          angle = Math.min(reach, Math.atan2(Math.abs(axleDot), planeNormal)),
          radial = (radius - crown + crown * Math.cos(angle)) / planeNormal,
          axial = -Math.sign(axleDot) * crown * Math.sin(angle);
        this.point.x += this.gpAxle.x * axial - (nx - this.gpAxle.x * axleDot) * radial;
        this.point.y += this.gpAxle.y * axial - (ny - this.gpAxle.y * axleDot) * radial;
        this.point.z += this.gpAxle.z * axial - (nz - this.gpAxle.z * axleDot) * radial;
      }
      const surface =
        ground +
        ((this.point.x - this.position.x) * sh + (this.point.z - this.position.z) * ch) * slope;
      const clearance = Math.max(0, this.point.y - surface);
      contact.set(
        this.point.x,
        this.point.z,
        surface,
        fallen ? 0 : 1 - T.MathUtils.smoothstep(clearance, 0.012, 0.075),
      );
    }
    shape.set(
      Math.round(finiteValue(presented, o + BIKE_BASE + B.STATE)) === 0 ? 1 : 2,
      T.MathUtils.clamp(this.gpUp.x * ch - this.gpUp.z * sh, -1, 1),
      T.MathUtils.clamp(
        finiteValue(presented, o + BIKE_BASE + B.RIDER_OFFSET),
        -spec.riderOffsetMax,
        spec.riderOffsetMax,
      ),
      lift,
    );
    return ground;
  }

  /** Mean world height of the four presented tyre contacts. */
  private groundHeight(presented: Float32Array, o: number) {
    let sum = 0;
    for (let wheel = 0; wheel < 4; wheel++) {
      const p = o + WHEEL_BASE + wheel * WHEEL_STRIDE,
        mount = WHEEL_POSITIONS[wheel];
      const length = presented[p + W.LENGTH] || 0.25,
        radius = presented[p + W.RADIUS] || 0.335;
      this.point
        .set(mount[0], mount[1] - length - radius, mount[2])
        .applyQuaternion(this.quaternion);
      sum += this.position.y + this.point.y;
    }
    return sum / 4;
  }

  diagnostics() {
    return {
      source: 'presented-snapshot' as const,
      updates: this.updates,
      cuts: this.cuts,
      time: this.uniforms.studioTime.value,
      frameDt: this.uniforms.studioFrameDt.value,
      cars: this.uniforms.studioCarCount.value,
      wind: this.uniforms.studioWind.value.toArray(),
      sunDir: this.uniforms.studioSunDir.value.toArray(),
      view: this.view,
      extraDraws: 0,
    };
  }
}
