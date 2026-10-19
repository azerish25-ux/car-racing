import * as T from 'three';
import { B, BIKE_BASE, F } from '../simulation/protocol.ts';
import type { VehicleDefinition } from '../simulation/vehicles.ts';

const finiteValue = (frame: Float32Array, offset: number) =>
  Number.isFinite(frame[offset]) ? frame[offset] : 0;

/** Shared projection for GP indirect grounding and emitted tyre effects.
 * Inputs are the presented physics pose, never live simulation or camera state.
 * Front/rear outputs are (world X, world Z, road height, contact share).
 * The extraction preserves the original StudioFrame crown/shoulder calculation.
 * A projector owns only fixed CPU scratch; it creates no scene/GPU resources. */
export class GpTyreContactProjector {
  private readonly up = new T.Vector3();
  private readonly forward = new T.Vector3();
  private readonly axle = new T.Vector3();
  private readonly pivot = new T.Vector3();
  private readonly point = new T.Vector3();

  /** Recover the GP road plane from BikeVehicle.writeBody's crown/pivot
   * kinematics, then project the definition's two tyre centres onto it.
   * Suspension LENGTH is a fork quantity on bikes, not a Formula hub offset.
   * Fixed scratch and uniform slots keep this allocation- and draw-free. */
  project(
    presented: Float32Array,
    o: number,
    definition: VehicleDefinition,
    position: T.Vector3,
    quaternion: T.Quaternion,
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
    this.up.set(0, 1, 0).applyQuaternion(quaternion);
    this.forward.set(0, 0, 1).applyQuaternion(quaternion);
    this.axle.set(1, 0, 0).applyQuaternion(quaternion);
    // The forward axis is unaffected by roll: its elevation carries the road
    // pitch plus a wheelie/stoppie. The crash pose omits the dynamic pitch.
    const roadPitch = T.MathUtils.clamp(
      Math.asin(T.MathUtils.clamp(this.forward.y, -1, 1)) - (fallen ? 0 : pitch),
      -Math.PI / 6,
      Math.PI / 6,
    );
    // writeBody uses asin(dy / planar wheelbase), so sin recovers its sampled
    // road slope exactly. This is not the tangent of a rigid ramp angle.
    const slope = Math.sin(roadPitch);
    this.pivot
      .copy(position)
      .addScaledVector(
        this.up,
        -(fallen ? 0.18 - spec.crownRadius : spec.cgHeight - spec.crownRadius),
      );
    if (!fallen)
      this.pivot.addScaledVector(this.forward, pitch >= 0 ? -spec.cgToRear : spec.cgToFront);
    this.pivot.y -= spec.crownRadius;
    // The fallen pivot is the mean of the two heights at d.x/z; the axle
    // offsets are not symmetric about that point on either GP definition.
    if (fallen) this.pivot.y -= (spec.cgToFront - spec.cgToRear) * 0.5 * slope;
    const ground =
      this.pivot.y + ((position.x - this.pivot.x) * sh + (position.z - this.pivot.z) * ch) * slope;
    // Closest point of the rounded tyre to the road plane: project its normal
    // into the wheel plane and onto the visible crown arc. Clamp at the same
    // shoulder as tyreGeometry so maximum lean cannot put a patch beyond it.
    const ny = 1 / Math.sqrt(1 + slope * slope),
      nx = -sh * slope * ny,
      nz = -ch * slope * ny,
      axleDot = this.axle.x * nx + this.axle.y * ny + this.axle.z * nz,
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
        .applyQuaternion(quaternion)
        .add(position)
        .addScaledVector(this.up, lift);
      if (planeNormal > 1e-5) {
        const reach = Math.min(1.25, Math.asin(Math.min(0.98, halfWidth / crown))),
          angle = Math.min(reach, Math.atan2(Math.abs(axleDot), planeNormal)),
          radial = (radius - crown + crown * Math.cos(angle)) / planeNormal,
          axial = -Math.sign(axleDot) * crown * Math.sin(angle);
        this.point.x += this.axle.x * axial - (nx - this.axle.x * axleDot) * radial;
        this.point.y += this.axle.y * axial - (ny - this.axle.y * axleDot) * radial;
        this.point.z += this.axle.z * axial - (nz - this.axle.z * axleDot) * radial;
      }
      const surface =
        ground + ((this.point.x - position.x) * sh + (this.point.z - position.z) * ch) * slope;
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
      T.MathUtils.clamp(this.up.x * ch - this.up.z * sh, -1, 1),
      T.MathUtils.clamp(
        finiteValue(presented, o + BIKE_BASE + B.RIDER_OFFSET),
        -spec.riderOffsetMax,
        spec.riderOffsetMax,
      ),
      lift,
    );
    return ground;
  }
}
