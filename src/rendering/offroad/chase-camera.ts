import { Vector3 } from 'three';
import { clamp } from '../../core/math.ts';
import { surfaceSample, trackPoint, type Track } from '../../simulation/track.ts';

/** Framing derived from references 056, 059, 072 and 086: the complete rider
 * occupies the lower centre, neighboring ruts remain visible, and a crest
 * does not rotate the camera into the sky. Values are metres and degrees. */
export const MOTOCROSS_CHASE = Object.freeze({
  distance: 5.4,
  distancePerMS: 0.025,
  height: 1.72,
  lookAhead: 7,
  lookPerMS: 0.32,
  fov: 56,
  fovGain: 5.5,
  airDistance: 0.7,
  airHeight: 0.3,
  airFov: 1.5,
  terrainClearance: 1.05,
  sightlineClearance: 0.28,
  maximumRoll: 0.055,
});

type CameraTerrain = Pick<Track, 'at' | 'sample'>;
type Position = { x: number; y: number; z: number };

export interface MotocrossCameraFrame {
  anchor: Position;
  heading: number;
  s: number;
  speed: number;
  cgHeight: number;
  lean: number;
  airborne: boolean;
  airTime: number;
  /** Existing O.LANDING_SPEED and O.BOTTOM channels. */
  landingSpeed: number;
  bottom: number;
  /** Existing camera shake gain, 0..1. Zero disables roll/landing motion. */
  motion: number;
}

/** A heading-led motocross rig. The world's existing translation spring
 * handles lateral movement; this rig provides course lookahead, airborne
 * framing and a small analytically damped landing response. No randomness,
 * wall-clock time or allocations inside the terrain probes. */
export class MotocrossChaseCamera {
  readonly eye = new Vector3();
  readonly gaze = new Vector3();
  readonly up = new Vector3(0, 1, 0);
  fov: number = MOTOCROSS_CHASE.fov;
  private airBlend = 0;
  private roll = 0;
  private gazeHeight = 0;
  private landingOffset = 0;
  private landingVelocity = 0;
  private wasAirborne = false;
  private flightTime = 0;
  private initialized = false;
  private readonly road = trackPoint();
  private readonly ahead = trackPoint();
  private readonly probe = surfaceSample();

  reset() {
    this.initialized = false;
    this.airBlend = this.roll = this.gazeHeight = 0;
    this.landingOffset = this.landingVelocity = 0;
    this.wasAirborne = false;
    this.flightTime = 0;
  }

  update(dt: number, track: CameraTerrain, frame: MotocrossCameraFrame) {
    const { anchor, heading, cgHeight } = frame;
    if (
      dt < 0 ||
      ![
        dt,
        anchor.x,
        anchor.y,
        anchor.z,
        heading,
        frame.s,
        frame.speed,
        cgHeight,
        frame.lean,
        frame.airTime,
        frame.landingSpeed,
        frame.bottom,
        frame.motion,
      ].every(Number.isFinite)
    )
      throw new Error('Invalid motocross camera state');

    const h = Math.min(dt, 2),
      speed = clamp(frame.speed, 0, 60),
      motion = clamp(frame.motion, 0, 1),
      sh = Math.sin(heading),
      ch = Math.cos(heading),
      rollTarget =
        clamp(frame.lean * 0.12, -MOTOCROSS_CHASE.maximumRoll, MOTOCROSS_CHASE.maximumRoll) *
        motion;
    if (!this.initialized) {
      this.airBlend = Number(frame.airborne);
      this.roll = rollTarget;
      this.wasAirborne = frame.airborne;
      this.flightTime = frame.airborne ? frame.airTime : 0;
    } else if (h > 0) {
      this.airBlend += (Number(frame.airborne) - this.airBlend) * -Math.expm1(-h / 0.18);
      this.roll += (rollTarget - this.roll) * -Math.expm1(-h / 0.14);
      if (this.wasAirborne && !frame.airborne && this.flightTime > 0.16) {
        const strength = clamp(
          1.2 + Math.max(0, frame.landingSpeed) * 0.24 + clamp(frame.bottom, 0, 1) * 1.8,
          1.2,
          4.5,
        );
        this.landingVelocity -= strength * motion * Math.min(1, this.flightTime * 2);
      }
      this.wasAirborne = frame.airborne;
      this.flightTime = frame.airborne ? Math.max(this.flightTime, frame.airTime) : 0;
    }
    if (motion === 0) {
      this.roll = 0;
      this.landingOffset = this.landingVelocity = 0;
    } else if (h > 0) {
      // Closed-form critically damped spring: same response at 30 and 144 Hz.
      const omega = 14,
        coefficient = this.landingVelocity + omega * this.landingOffset,
        decay = Math.exp(-omega * h);
      this.landingOffset = (this.landingOffset + coefficient * h) * decay;
      this.landingVelocity = (this.landingVelocity - omega * coefficient * h) * decay;
    }

    const distance =
        MOTOCROSS_CHASE.distance +
        speed * MOTOCROSS_CHASE.distancePerMS +
        this.airBlend * MOTOCROSS_CHASE.airDistance,
      height = MOTOCROSS_CHASE.height + this.airBlend * MOTOCROSS_CHASE.airHeight,
      lookAhead = clamp(
        MOTOCROSS_CHASE.lookAhead + speed * MOTOCROSS_CHASE.lookPerMS + this.airBlend * 3,
        7,
        24,
      );
    this.eye.set(
      anchor.x - sh * distance,
      anchor.y + height + this.landingOffset,
      anchor.z - ch * distance,
    );
    this.gaze.set(anchor.x + sh * lookAhead, anchor.y, anchor.z + ch * lookAhead);

    track.at(frame.s, this.road);
    track.at(frame.s + lookAhead, this.ahead);
    // Look partway into the bend only while riding with the course. After a
    // spin or rejoin the player's physical heading still owns the camera.
    const alignment = sh * this.road.tx + ch * this.road.tz,
      routeBlend = clamp((alignment - 0.4) / 0.5, 0, 1) * 0.34,
      across =
        clamp((this.ahead.x - this.gaze.x) * ch - (this.ahead.z - this.gaze.z) * sh, -5, 5) *
        routeBlend;
    this.gaze.x += ch * across;
    this.gaze.z -= sh * across;
    track.sample(this.gaze.x, this.gaze.z, this.probe, anchor.y - cgHeight);
    const groundAhead = this.probe.height,
      groundRise = clamp(groundAhead + cgHeight - anchor.y, -1.3, 2.3),
      // Keep a modest downward view angle as look distance increases. A
      // fixed gaze height would lift the horizon and hide the next rut at
      // speed, while placing the helmet in the centre of the screen.
      groundedAim = height - (distance + lookAhead) * 0.205 + groundRise * 0.35,
      // In flight gaze descends toward the surface ahead, keeping the
      // downslope visible instead of following a nose-up chassis into the sky.
      landingAim = clamp(groundAhead + 0.85 - anchor.y, -5, 1.5),
      wantedHeight = groundedAim * (1 - this.airBlend * 0.6) + landingAim * this.airBlend * 0.6;
    if (!this.initialized) this.gazeHeight = wantedHeight;
    else if (h > 0) this.gazeHeight += (wantedHeight - this.gazeHeight) * -Math.expm1(-h / 0.16);
    this.gaze.y = anchor.y + this.gazeHeight + this.landingOffset * 0.25;
    this.clearTerrain(this.eye, anchor, track, cgHeight);
    this.up.set(ch * Math.sin(this.roll), Math.cos(this.roll), -sh * Math.sin(this.roll));
    this.fov =
      MOTOCROSS_CHASE.fov +
      clamp(speed / 32, 0, 1) * MOTOCROSS_CHASE.fovGain +
      this.airBlend * MOTOCROSS_CHASE.airFov;
    this.initialized = true;
    return this;
  }

  /** Apply to the final spring-filtered eye as well as the desired eye: a
   * freshly rising jump behind the bike cannot engulf a lagging camera. The
   * probes use the same terrain sampler as tyre contact, including berms. */
  clearTerrain(eye: Vector3, anchor: Position, track: CameraTerrain, cgHeight: number) {
    const hint = anchor.y - cgHeight;
    track.sample(eye.x, eye.z, this.probe, hint);
    eye.y = Math.max(eye.y, this.probe.height + MOTOCROSS_CHASE.terrainClearance);
    for (let i = 1; i <= 3; i++) {
      const t = i * 0.25;
      const x = eye.x + (anchor.x - eye.x) * t,
        z = eye.z + (anchor.z - eye.z) * t,
        lineY = eye.y + (anchor.y + 0.38 - eye.y) * t;
      track.sample(x, z, this.probe, hint);
      const missing = this.probe.height + MOTOCROSS_CHASE.sightlineClearance - lineY;
      if (missing > 0) eye.y += missing / (1 - t);
    }
  }
}
