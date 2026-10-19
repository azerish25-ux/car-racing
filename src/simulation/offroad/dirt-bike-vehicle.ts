import { approach, clamp, G, lerp, mod, Vec3 } from '../../core/math.ts';
import { NOVICE } from '../bike.ts';
import { BIKE_RECOVERY, BikeVehicle, bikeOrientation } from '../bike-vehicle.ts';
import { chassisLean } from '../bike-definitions.ts';
import { COMPOUNDS, DEFAULT_SETUP, type Assist, type Compound, type Setup } from '../config.ts';
import { MARSHAL } from '../marshal.ts';
import { MATERIAL } from '../surface-material.ts';
import { surfaceSample, Track } from '../track.ts';
import type { VehicleDefinition } from '../vehicles.ts';
import { TrackTerrainSurface } from './course-terrain.ts';
import { offroadCourse } from './venues.ts';
import type { OffroadBikeSpec } from './types.ts';
import { LANDING_RULES } from './riding-feedback.ts';
import { wheelPickupImpulse } from './wheel-pickup.ts';

const TAU = Math.PI * 2;
/** How far (m) the rider's body moves fore/aft over the pegs at full lean;
 * on the ground that shifts the system CG (a weight-shift pitch torque). */
const RIDER_REACH = 0.25;
/** Deep terrain overlap is a contact-position error, not additional spring
 * travel. Normal bottoming keeps the calibrated bump stop; a discontinuous
 * surface step more than 12 cm past full travel is projected to its 15 mm
 * compliant stop before force integration can turn it into launch energy. */
const DEEP_CONTACT = 0.12,
  STOP_COMPLIANCE = 0.015;
/** Nose-up margin (rad) the pitch aid aims for over the landing slope. */
const LANDING_NOSE_UP = 0.1;

/** Resolve an incoming horizontal velocity in a yawed tyre basis. This is
 * an orthogonal change of axes, including any pre-existing contact slide;
 * it cannot add kinetic energy or redirect the centre of mass. */
export function landingTyreVelocity(forward: number, lateral: number, yaw: number) {
  const c = Math.cos(yaw),
    s = Math.sin(yaw);
  return {
    forward: forward * c + lateral * s,
    lateral: lateral * c - forward * s,
  };
}
/** Where the last flight ended, for the landing licence, snapshot and tests. */
export interface LandingRecord {
  /** Race-independent clock of the touchdown (adapter seconds). */
  time: number;
  /** Lap distance and horizontal distance flown since take-off (m). */
  s: number;
  distance: number;
  /** Take-off speed along the face (m/s) and the flight time (s). */
  takeoffSpeed: number;
  airTime: number;
  /** Chassis pitch minus ground slope at touchdown (rad, nose-up +). */
  pitchError: number;
  /** Ground slope at touchdown (rad, nose-up +). */
  slope: number;
  /** Impact speed into the ground (m/s, positive into it). */
  normalSpeed: number;
  /** Chassis yaw against its incoming path, and resulting tyre slide (m/s).
   * A whip rotates the bike, never its airborne centre-of-mass trajectory. */
  yawError: number;
  lateralSpeed: number;
  /** Peak suspension shaft speed at full travel (m/s), 0 without bottoming. */
  bottomSpeed: number;
  outcome: 'clean' | 'bottomed' | 'crash-front' | 'crash-rear' | 'crash-flat' | 'crash-side';
}
/** Off-road motorcycle adapter (WP39): the road-bike core (`Bike`) still
 * decides lean, steer, traction and grip limits on the ground; this class
 * adds the vertical plane those bikes never needed — a 2-DOF sprung chassis
 * (heave and pitch) on rising-rate, digressively damped ~300 mm suspension
 * over the authoritative terrain, take-off when the ground falls away faster
 * than gravity, ballistic flight with pitch control from the rider's body
 * position and the rear wheel's spin (throttle noses up, the rear brake noses
 * down: the reaction of the spinning wheel's angular momentum), and a
 * touchdown judged against the ground slope (front-first, rear-first and
 * flat bottomed landings crash past the definition's tolerances). Posture is
 * state too: standing on rough ground and in the air, a foot dab in slow
 * tight corners (which also props the lean), body fore/aft. */
export class DirtBikeVehicle extends BikeVehicle {
  readonly air: OffroadBikeSpec;
  airborne = false;
  airTime = 0;
  /** CG height (world), vertical speed, system pitch (rad, nose-up +) and rate. */
  cgY = 0;
  vy = 0;
  pitch = 0;
  pitchRate = 0;
  /** Rider-controlled chassis yaw relative to the ballistic travel heading.
   * Published through the ordinary body quaternion, not a new input channel. */
  airYaw = 0;
  airYawRate = 0;
  /** Suspension compressions (m) and the forces they carry (N). */
  compressionFront = 0;
  compressionRear = 0;
  forceFront = 0;
  forceRear = 0;
  /** Rear wheel spin while airborne (rad/s). */
  rearSpin = 0;
  /** Front wheel spin in flight (rad/s); its brake has a finite nose-down
   * reaction, so holding the brake after the wheel stops cannot add torque. */
  frontSpin = 0;
  standing = 0;
  dab = 0;
  /** Rider body position fore/aft, -1 back .. +1 forward. */
  riderBody = 0;
  /** Bottoming intensity 0..1 (decays). */
  bottom = 0;
  mud = 0;
  rutFront = 0;
  rutRear = 0;
  moisture = 0;
  /** Landings so far and the last one. */
  landings = 0;
  lastLanding: LandingRecord | null = null;
  /** Adapter clock (s), independent of the race clock. */
  clock = 0;
  /** Why each crash happened (landing outcomes, grip, contact), with its lap distance. */
  readonly crashCauses: { cause: string; s: number; time: number }[] = [];
  private loadGrip = 1;
  private smoothGrip = 0;
  private tiltLow = 0;
  private flightSpeed = 0;
  private takeoffSpeed = 0;
  private takeoffX = 0;
  private takeoffZ = 0;
  private freeSteps = 0;
  private bottomPeak = 0;
  private pendingLanding: LandingRecord | null = null;
  landingTarget = 0;
  landingIn = 0.6;
  private predictClock = 0;
  private longitudinal = 0;
  /** A real player jump preserves wheel-speed mismatch until loaded tyres
   * have picked it up. The ordinary core still owns rolling drive/braking;
   * only the inherited flight mismatch uses the spare friction budget. */
  private wheelPickup = false;
  private pickupSpeed = 0;
  private playerMotocross = false;
  private pickupFrontForce = 0;
  private pickupRearForce = 0;
  private readonly probe = surfaceSample();
  private readonly heading3 = new Vec3();
  private readonly left3 = new Vec3();
  constructor(
    id: number,
    compound: Compound = 'medium',
    setup: Setup = DEFAULT_SETUP,
    assist: Assist = 'sport',
    definition: VehicleDefinition,
  ) {
    super(id, compound, setup, assist, definition);
    if (!definition.bike?.offroad) throw new Error(`${definition.id} has no off-road block`);
    this.air = definition.bike.offroad;
  }
  /** Static sag (m) of each end under the bike's own weight. */
  private sag(front: boolean) {
    const b = this.bikeSpec,
      L = this.spec.wheelbase,
      m = this.dynamics.mass,
      load = (m * G * (front ? b.cgToRear : b.cgToFront)) / L;
    return this.springForceInverse(load, front);
  }
  /** Compression at which the rising-rate spring carries `force`. Preload
   * (setup, m) is spring compression already wound in: it takes sag out. */
  private springForceInverse(force: number, front: boolean) {
    const b = this.bikeSpec,
      k = front ? b.forkRate : b.shockRate,
      T = front ? b.forkTravel : b.shockTravel;
    let c = force / k;
    for (let i = 0; i < 6; i++) c = force / (k * (1 + this.air.progression * (c / T) ** 2));
    return Math.max(0, c - this.preload(front));
  }
  private spring(c: number, front: boolean) {
    const b = this.bikeSpec,
      k = front ? b.forkRate : b.shockRate,
      T = front ? b.forkTravel : b.shockTravel,
      wound = c + this.preload(front);
    return k * wound * (1 + this.air.progression * (wound / T) ** 2);
  }
  private preload(front: boolean) {
    return front ? this.setup.frontPreload : this.setup.rearPreload;
  }
  override place(track: Track, s: number, offset = 0) {
    super.place(track, s, offset);
    this.settle();
  }
  override placeFree(track: Track, x: number, z: number, heading: number, groundY: number) {
    super.placeFree(track, x, z, heading, groundY);
    this.settle();
  }
  /** Static equilibrium on the ground under both wheels. */
  private settle() {
    const b = this.bikeSpec,
      L = this.spec.wheelbase,
      gF = this.contacts[0].height,
      gR = this.contacts[2].height;
    this.pitch = Math.asin(clamp((gF - gR) / L, -0.6, 0.6));
    const ground = lerp(gR, gF, b.cgToRear / L);
    this.cgY = ground + b.cgHeight;
    this.vy = this.pitchRate = 0;
    this.airYaw = this.airYawRate = 0;
    this.wheelPickup = false;
    this.pickupSpeed = this.dynamics.speed;
    this.compressionFront = this.sag(true);
    this.compressionRear = this.sag(false);
    this.airborne = false;
    this.airTime = 0;
    this.freeSteps = 0;
    this.rearSpin = this.dynamics.speed / this.bikeSpec.rearWheelRadius;
    this.frontSpin = this.dynamics.speed / this.bikeSpec.frontWheelRadius;
    this.writeBody(this.lastTrack!, 0);
  }
  private lastTrack: Track | null = null;
  /** Speed (m/s) of the chassis as it left the ground on the last flight. */
  get lastTakeoff() {
    return this.takeoffSpeed;
  }
  /** Ground slope between the contact patches (rad, nose-up +: climbing). */
  get groundPitch() {
    return this.roadPitch;
  }
  override step(dt: number, track: Track) {
    this.lastTrack = track;
    this.clock += dt;
    const d = this.dynamics,
      b = this.body,
      spec = this.bikeSpec;
    this.debris.step(dt, track);
    this.absorbExternal(dt);
    const ai = this.aiSteps > 0;
    d.assists = ai ? NOVICE : this.riderAids;
    if (this.aiSteps > 0) this.aiSteps--;
    b.mass = this.definition.spec.dryMass + this.fuel - this.lostMass;
    d.mass = b.mass;
    let throttle = clamp(this.input.throttle, 0, 1);
    let brake = clamp(this.input.brake, 0, 1);
    let rear = clamp(this.input.clutch, 0, 1);
    // Wheelie control reads the sprung chassis here: the core's aid knows
    // only flat-ground load transfer, but a front lifted by a face, a bounce
    // or the drive is the sprung model's. With the front off the ground and
    // the nose up over the ground, the aid closes the throttle, and covers
    // the rear brake as the lift nears the balance point.
    if (d.assists.wheelie && this.riding && !this.airborne && this.frontLight > 0.25) {
      const lift = this.pitch - Math.max(this.rearSlope, this.roadPitch);
      throttle *= 1 - clamp((lift - 0.3) / 0.25, 0, 1);
      rear = Math.max(rear, clamp((lift - 0.45) / 0.2, 0, 1));
    }
    if (this.inPit && track.pitSpeedZone(this.s))
      throttle *= clamp((MARSHAL.pitSpeed - this.speed) / 0.8, 0, 1);
    if (this.retired) {
      throttle = 0;
      brake = 1;
    }
    this.throttle = throttle;
    this.brake = brake;
    this.rearBrake = rear;
    const course = offroadCourse(track.circuit);
    this.pickupFrontForce = this.pickupRearForce = 0;
    this.playerMotocross =
      !ai &&
      (course?.kind === 'motocross' || course?.kind === 'supercross') &&
      (this.definition.id === 'mx250' || this.definition.id === 'mx450');
    if (!this.playerMotocross || !this.riding) this.wheelPickup = false;
    // Ground grip: tyre/surface peak (knobby bite from the material table),
    // the load the suspension actually carries, and berm support.
    // Smoothed: a hop or a rut edge does not change the rider's lean budget
    // within one step (the core's lean aid assumes a slowly varying grip).
    const surface = Math.min(this.surfaceGrip(0), this.surfaceGrip(2)),
      target = surface * clamp(this.loadGrip, 0.85, 1.15) * this.bankSupport(surface);
    this.smoothGrip =
      this.smoothGrip > 0
        ? this.smoothGrip + (target - this.smoothGrip) * Math.min(1, dt / 0.35)
        : target;
    d.grip = this.smoothGrip;
    d.slope = Math.sin(this.roadPitch);
    this.posture(dt, course, track);
    this.tuck = 0;
    d.dragScale = 1 + 0.08 * this.standing;
    const hang =
      d.speed > 10 ? clamp(0.6 * this.input.steer + 0.4 * d.lean, -1, 1) * (1 - this.standing) : 0;
    const force = this.drive(dt, throttle);
    const was = this.lastState;
    d.riderReady = this.riderReady();
    if (this.contactCrash) {
      this.contactCrash = false;
      this.crashReason = 'contact';
      d.fall(Math.abs(this.slide) > 6 || d.speed > 30 ? 'highside' : 'lowside');
    }
    if (this.airborne && d.state === 'riding') this.flight(dt, throttle, rear, brake, ai);
    else if (this.airborne) this.coast(dt);
    else {
      const x0 = d.x,
        z0 = d.z;
      d.step(
        {
          lean: this.input.steer,
          throttle,
          frontBrake: brake,
          rearBrake: rear,
          rider: hang,
          drive: force,
        },
        dt,
      );
      const coreSpeed = d.speed;
      if (this.wheelPickup && this.riding) {
        this.pickupWheels(dt);
        d.longitudinal += (d.speed - coreSpeed) / dt;
        // Keep this contact step's travel consistent with its corrected
        // velocity. Steering remains the core's continuous yaw solution.
        if (coreSpeed > 0) {
          d.x = x0 + ((d.x - x0) * d.speed) / coreSpeed;
          d.z = z0 + ((d.z - z0) * d.speed) / coreSpeed;
        }
      }
      // The core integrates horizontal travel at its speed; on a face that
      // speed is along the ground, so the plan-view step is its cosine.
      const c = Math.cos(this.roadPitch);
      d.x = x0 + (d.x - x0) * c;
      d.z = z0 + (d.z - z0) * c;
      if (d.state === 'riding') {
        // Bulldozing and rolling in loose soil beyond the tyre's own rolling.
        const extra = Math.max(
          0,
          0.5 * (this.contacts[0].resistance + this.contacts[2].resistance) - (d.p.rolling ?? 0),
        );
        d.speed = Math.max(0, d.speed - extra * G * dt);
        // A foot down props the lean in slow, tight corners.
        if (Math.abs(this.dab) > 0.5) {
          const limit = this.air.dabLean + 0.12;
          if (Math.abs(d.lean) > limit) {
            d.lean = Math.sign(d.lean) * limit;
            d.leanRate *= 0.5;
          }
        }
        // Over-leaned on loose ground the rear steps out and stands the bike
        // up (a slide, not a fall): lean the tyres cannot hold (the aid's
        // friction budget, 0.8 mu) is bled off before it runs away.
        const hold = Math.atan(0.8 * d.p.mu * d.grip),
          over = Math.abs(d.lean) - Math.min(d.leanLimit + 0.06, hold - 0.02);
        if (over > 0 && Math.sign(d.leanRate) === Math.sign(d.lean)) {
          d.leanRate *= Math.exp(-12 * dt);
          d.lean -= Math.sign(d.lean) * Math.min(over, 1.2 * dt);
          d.speed = Math.max(0, d.speed - 1.5 * dt);
        }
      }
      this.longitudinal =
        d.driveForce -
        d.frontBrakeForce -
        d.rearBrakeForce +
        this.pickupFrontForce +
        this.pickupRearForce;
    }
    if (this.pendingLanding) this.judgeLanding(this.pendingLanding);
    if (was === 'riding' && d.state !== 'riding') {
      const landing = this.lastLanding,
        fromLanding =
          landing && landing.outcome.startsWith('crash') && this.clock - landing.time < 0.5;
      this.crashCauses.push({
        cause: fromLanding ? landing.outcome : this.crashReason || `grip-${d.state}`,
        s: this.s,
        time: this.clock,
      });
      if (this.crashCauses.length > 32) this.crashCauses.shift();
      this.crashReason = '';
      this.separate();
    }
    this.lastState = d.state;
    if (was === 'separated' && d.state === 'remount') this.planRemount(track);
    if (d.state === 'remount') this.pushToRemount(dt);
    if (was === 'remount' && d.state === 'riding') {
      this.remount.active = false;
      this.slide = 0;
      this.airborne = false;
    }
    // Contact slide decays with grip; rut walls steer the wheels (tramlining).
    if (!this.airborne) {
      if (this.slide !== 0) {
        const decel = Math.max(1, 0.7 * d.p.mu * d.grip * G) * dt;
        this.slide = Math.abs(this.slide) <= decel ? 0 : this.slide - Math.sign(this.slide) * decel;
        if (Math.abs(this.slide) > 5.5 && this.riding) {
          d.fall('lowside');
          this.separate();
          this.lastState = d.state;
        }
      }
      if (this.riding) {
        const tilt = this.lateralTilt();
        this.tiltLow += (tilt - this.tiltLow) * Math.min(1, dt / 0.35);
        this.slide += G * (tilt - this.tiltLow) * 0.6 * dt;
      }
    }
    const h = d.heading;
    d.x += Math.cos(h) * this.slide * dt;
    d.z -= Math.sin(h) * this.slide * dt;
    if (this.yawKick !== 0) {
      d.heading += this.yawKick * dt;
      this.yawKick *= Math.exp(-8 * dt);
      if (Math.abs(this.yawKick) < 1e-4) this.yawKick = 0;
    }
    this.updateRider(dt, track);
    const power = Math.max(0, this.engineOutputTorque * this.clutch.engineOmega);
    this.fuel = Math.max(0, this.fuel - (power / (0.3 * 43e6) + 0.0002) * dt);
    this.writeBody(track, dt);
    this.updateSuspensionAndTyres(dt);
    this.updateSkid(dt);
    this.updateMud(dt);
    this.impact = Math.max(0, this.impact - dt * 2);
    this.bottom = Math.max(0, this.bottom - dt * 1.5);
    if (b.position.y < this.groundY - 6) this.retired = true;
    void spec;
  }
  /** Ballistic flight: plan-view travel at the take-off speed less drag,
   * rear-wheel spin dynamics and the pitch torques they and the rider make. */
  private flight(dt: number, throttle: number, rear: number, brake: number, ai: boolean) {
    const d = this.dynamics,
      a = this.air,
      spec = this.spec;
    this.airTime += dt;
    this.flightSpeed = Math.max(
      0,
      this.flightSpeed - ((d.p.drag * this.flightSpeed ** 2) / d.mass) * dt,
    );
    d.speed = this.flightSpeed;
    d.x += Math.sin(d.heading) * this.flightSpeed * dt;
    d.z += Math.cos(d.heading) * this.flightSpeed * dt;
    // Assisted pitch control (AI always; the player's Sport rider aid uses the
    // body only): aim the chassis at the predicted landing slope.
    this.predictClock -= dt;
    if (this.predictClock <= 0) {
      this.predictClock = 0.1;
      this.predictLanding();
    }
    // Riders land rear wheel first: aim a little nose-up of the slope.
    const chassis = this.pitch + this.riderBody * 0.06,
      target = this.landingTarget + LANDING_NOSE_UP;
    const wanted = (target - chassis) / Math.max(0.12, this.landingIn) - this.pitchRate;
    const assisted = ai || this.assist === 'sport';
    let pedal = throttle,
      rearBrake = rear;
    if (ai) {
      pedal = clamp(wanted * 1.2, 0, 1);
      rearBrake = clamp(-wanted * 1.2, 0, 1);
      // Air-pitch corrections belong to this flight step. Touchdown can
      // occur before the next AI update: writing the shared inputs here
      // would apply a rear-brake tap as a grounded command on that substep.
      this.throttle = pedal;
      this.rearBrake = rearBrake;
    }
    // The raw rider braces forward under braking and draws back with drive;
    // Sport retains the calibrated landing-slope body aid. These are the
    // existing pedal inputs, so replays and network controls remain identical.
    const bodyTarget = assisted
      ? clamp(-wanted * 0.9, -1, 1)
      : clamp(0.55 * brake + 0.4 * rear - 0.3 * throttle, -0.3, 0.8);
    this.riderBody = approach(this.riderBody, bodyTarget, dt * 4);
    // Rear wheel: the engine spins it up toward the limiter in this gear;
    // the rear brake stops it. The chassis takes the reaction torque.
    // The engaged ratio through the setup's gearing, as on the ground
    // (BikeVehicle.drive), so the engine note does not step at take-off.
    const ratio = spec.gearRatios[this.gear + 1] * spec.finalDrive * this.gearing,
      limit = (spec.limiterRPM * Math.PI) / 30 / ratio,
      previous = this.rearSpin;
    this.rearSpin = clamp(
      this.rearSpin + (pedal * a.spinUp - rearBrake * a.spinBrake - 2) * dt,
      0,
      limit,
    );
    this.rpm = clamp((this.rearSpin * ratio * 30) / Math.PI, spec.idleRPM, spec.limiterRPM);
    const spinTorque = (a.spinInertia * (this.rearSpin - previous)) / dt;
    const frontCoast = this.frontSpin * Math.exp(-0.4 * dt);
    this.frontSpin = Math.max(0, frontCoast - (ai ? 0 : brake * a.spinBrake * 0.7 * dt));
    // Decelerating the front wheel also pitches the machine nose-down. The
    // player can use the normal brake, including the touch brake, in flight.
    // AI retains its surveyed rear-brake controller without a second pedal.
    const frontBrakeTorque = (spec.wheelInertia * (this.frontSpin - frontCoast)) / dt;
    // Forward body (+) pitches the bike nose-down.
    const bodyTorque = -this.riderBody * a.bodyTorque;
    this.airTorque = spinTorque + frontBrakeTorque + bodyTorque;
    // Handing a player whip to the demonstration rider must recover its
    // bank as well as its yaw. Ordinary AI flights keep their calibration.
    if (!ai || this.airYaw !== 0 || this.airYawRate !== 0) this.airLean(dt, ai);
    this.airWhip(dt, ai);
    d.steer = approach(d.steer, 0, dt * 2);
    d.driveForce = d.frontBrakeForce = d.rearBrakeForce = 0;
    this.longitudinal = 0;
  }
  /** The rider can bank the chassis in flight without steering the ballistic
   * path. Releasing the stick levels the bike; Sport progressively asks for
   * level wheels as touchdown approaches. Bounded rate prevents a keyboard
   * tap from snapping the bike sideways, and no stunt/boost is awarded. */
  private airLean(dt: number, ai = false) {
    const d = this.dynamics,
      assisted = ai || this.assist === 'sport',
      settle = assisted ? clamp((this.landingIn - 0.1) / 0.38, 0, 1) : 1,
      target = (ai ? 0 : clamp(this.input.steer, -1, 1)) * (assisted ? 0.36 : 0.52) * settle,
      wantedRate = clamp((target - d.lean) * 6, -1.8, 1.8);
    // Reverse the roll response promptly when a key/stick is released. A
    // slow rate reversal kept adding lean for most of a short tabletop.
    d.leanRate = approach(d.leanRate, wantedRate, dt * 16);
    const previous = d.lean;
    d.lean = clamp(d.lean + d.leanRate * dt, -this.bikeSpec.maxLean, this.bikeSpec.maxLean);
    if (d.lean === previous && Math.abs(d.lean) >= this.bikeSpec.maxLean) d.leanRate = 0;
  }
  /** Steering in flight swings the bike beneath the rider. This changes the
   * visible attitude only until a tyre touches soil; there is no lateral air
   * force or extra speed. Letting go unwinds the whip, with Sport helping
   * during the final half-second. Raw riders must square their own landing. */
  private airWhip(dt: number, ai: boolean) {
    const course = this.lastTrack ? offroadCourse(this.lastTrack.circuit) : null,
      motocross = course?.kind === 'motocross' || course?.kind === 'supercross';
    if (!motocross || (this.definition.id !== 'mx250' && this.definition.id !== 'mx450')) return;
    const assisted = ai || this.assist === 'sport',
      settle = assisted ? clamp((this.landingIn - 0.08) / 0.55, 0, 1) : 1,
      target = (ai ? 0 : clamp(this.input.steer, -1, 1)) * (assisted ? 0.44 : 0.6) * settle,
      wantedRate = clamp((target - this.airYaw) * 7, -2.2, 2.2);
    this.airYawRate = approach(this.airYawRate, wantedRate, dt * 16);
    const previous = this.airYaw;
    this.airYaw = clamp(this.airYaw + this.airYawRate * dt, -0.6, 0.6);
    if (this.airYaw === previous && Math.abs(this.airYaw) >= 0.6) this.airYawRate = 0;
  }
  /** A machine whose rider came off in the air (a contact crash): no
   * inputs and no pitch aid; it keeps its flight speed until it lands. */
  private coast(dt: number) {
    const d = this.dynamics;
    this.airTime += dt;
    this.flightSpeed = Math.max(
      0,
      this.flightSpeed - ((d.p.drag * this.flightSpeed ** 2) / d.mass) * dt,
    );
    d.speed = this.flightSpeed;
    d.x += Math.sin(d.heading) * this.flightSpeed * dt;
    d.z += Math.cos(d.heading) * this.flightSpeed * dt;
    this.rearSpin = Math.max(0, this.rearSpin - 2 * dt);
    this.frontSpin *= Math.exp(-0.4 * dt);
    this.airTorque = 0;
    // A separated rider cannot keep winding a whip with held steering.
    this.airYawRate *= Math.exp(-2 * dt);
    this.airYaw = clamp(this.airYaw + this.airYawRate * dt, -0.6, 0.6);
    d.steer = approach(d.steer, 0, dt * 2);
    d.driveForce = d.frontBrakeForce = d.rearBrakeForce = 0;
    this.longitudinal = 0;
  }
  private airTorque = 0;
  /** Finish synchronizing airborne wheels without resetting their angular
   * velocity on the touchdown edge. Core drive/braking already acts on its
   * rolling reference, so advect that reference and resolve only the extra
   * mismatch. Contact friction used by the pedals and cornering is reserved
   * first; a loaded brake cannot claim it a second time as a pickup impulse.
   * Every remaining impulse has an equal opposite rim angular impulse. */
  private pickupWheels(dt: number) {
    const d = this.dynamics,
      spec = this.bikeSpec,
      deltaSpeed = d.speed - this.pickupSpeed;
    // An end still hanging clear of a rear/front-first touchdown cannot be
    // spun by chassis acceleration: its rolling reference begins at load.
    if (this.forceFront > 0)
      this.frontSpin = Math.max(0, this.frontSpin + deltaSpeed / spec.frontWheelRadius);
    if (this.forceRear > 0)
      this.rearSpin = Math.max(0, this.rearSpin + deltaSpeed / spec.rearWheelRadius);
    const lateral = d.mass * Math.abs(d.speed * d.speed * d.curvature),
      mu = d.p.mu * d.grip;
    const pickup = (front: boolean) => {
      const radius = front ? spec.frontWheelRadius : spec.rearWheelRadius,
        inertia = front ? this.spec.wheelInertia : this.air.spinInertia,
        spin = front ? this.frontSpin : this.rearSpin,
        load = front ? this.forceFront : this.forceRear,
        share = (front ? spec.cgToRear : spec.cgToFront) / this.spec.wheelbase,
        existing = front ? d.frontBrakeForce : d.driveForce - d.rearBrakeForce,
        capacity = Math.sqrt(Math.max(0, (mu * load) ** 2 - (lateral * share) ** 2)),
        spare = Math.max(0, capacity - Math.abs(existing)),
        impulse = wheelPickupImpulse(d.speed, spin, radius, inertia, d.mass, spare * dt);
      d.speed += impulse / d.mass;
      const result = Math.max(0, spin - (impulse * radius) / inertia);
      if (front) {
        this.frontSpin = result;
        this.pickupFrontForce = impulse / dt;
      } else {
        this.rearSpin = result;
        this.pickupRearForce = impulse / dt;
      }
    };
    pickup(true);
    pickup(false);
    this.pickupSpeed = d.speed;
    // Sub-centimetre/s residuals have no perceptible rotor energy. Ending
    // only near rolling equality prevents a fixed timeout from snapping a
    // still-locked wheel to speed, including on a lightly loaded landing.
    if (
      Math.abs(this.frontSpin * spec.frontWheelRadius - d.speed) < 0.005 &&
      Math.abs(this.rearSpin * spec.rearWheelRadius - d.speed) < 0.005
    )
      this.wheelPickup = false;
  }
  private crashReason = '';
  /** Seconds the front wheel has been unloaded on the ground (a wheelie),
   * and the pitch torque (N m, nose-up +) of the last step with a wheel down. */
  private frontLight = 0;
  private noseTorque = 0;
  /** Ground slope under the rear tyre at its last contact (rad, nose-up +). */
  private rearSlope = 0;
  /** Wheelie angle (sprung chassis pitch over the ground, rad) past which
   * further nose-up rotation about the CG no longer presses the rear tyre
   * into the ground: the balance point of a wheelie, beyond which the bike
   * goes over. Measured over the ground, as the core's own loop-out limit
   * is, not against the horizon. */
  private loopOutPitch() {
    const spec = this.bikeSpec;
    return Math.atan(spec.cgToRear / (spec.cgHeight + this.sag(false)));
  }
  /** A wheelie past its balance point: the rider loops out on the ground. */
  private loopOut() {
    this.crashReason = 'loop-out';
    this.dynamics.fall('highside');
    this.freeSteps = 0;
    this.frontLight = 0;
  }
  /** Where and at what slope the current flight will land (10 Hz). */
  private predictLanding() {
    const d = this.dynamics,
      track = this.lastTrack!,
      sh = Math.sin(d.heading),
      ch = Math.cos(d.heading),
      clearance = this.bikeSpec.cgHeight;
    let y = this.cgY,
      vy = this.vy,
      x = d.x,
      z = d.z;
    const step = 0.04;
    for (let t = step; t < 3; t += step) {
      vy -= G * step;
      y += vy * step;
      x += sh * this.flightSpeed * step;
      z += ch * this.flightSpeed * step;
      track.sample(x, z, this.probe, y - clearance);
      if (y - clearance <= this.probe.height) {
        const n = this.probe.normal,
          along = n.x * sh + n.z * ch;
        this.landingTarget = Math.atan2(-along, n.y);
        this.landingIn = t;
        return;
      }
    }
    this.landingTarget = 0;
    this.landingIn = 0.6;
  }
  /** Lateral tilt of the ground under the bike toward its left (rad). */
  private lateralTilt() {
    const h = this.dynamics.heading,
      lx = Math.cos(h),
      lz = -Math.sin(h),
      n0 = this.contacts[0].normal,
      n2 = this.contacts[2].normal;
    return 0.5 * ((n0.x * lx + n0.z * lz) / n0.y + (n2.x * lx + n2.z * lz) / n2.y);
  }
  /** Friction scale a berm's bank adds to a turn it supports (or takes away). */
  private bankSupport(grip: number) {
    const d = this.dynamics,
      turn = Math.sign(d.curvature);
    if (!turn || this.airborne) return 1;
    const t = clamp(this.lateralTilt() * turn, -0.3, 0.6),
      mu = Math.max(0.3, d.p.mu * grip);
    return clamp((mu + t) / ((1 - mu * t * 0.85) * mu), 0.75, 1.9);
  }
  /** Standing over rough ground and in the air, a foot dab in slow corners,
   * body fore/aft with throttle and brakes on the ground. */
  private posture(dt: number, course: ReturnType<typeof offroadCourse>, track: Track) {
    const d = this.dynamics,
      a = this.air;
    if (!this.riding) {
      this.standing = approach(this.standing, 0, dt * 3);
      this.dab = approach(this.dab, 0, dt * 6);
      this.riderBody = approach(this.riderBody, 0, dt * 3);
      return;
    }
    let rough = false;
    if (course) {
      const next = course.nextJump(this.s);
      rough =
        course.isRough(this.s) ||
        course.isRough(this.s + d.speed * 0.6) ||
        (next !== null && next.distance < Math.max(12, d.speed * 1.4)) ||
        course.jumpAt(this.s) !== null;
    }
    // Rolling a steep up-face slowly (into a gap, over a landing mound) the
    // rider stands and leans over the bars to keep the front down.
    const climb = clamp((7 - d.speed) / 3, 0, 1) * clamp((this.roadPitch - 0.2) / 0.25, 0, 1);
    const standUp =
      this.airborne || (d.speed > 7 && Math.abs(d.lean) < 0.42 && rough) || climb > 0.5;
    this.standing = approach(this.standing, standUp ? 1 : 0, dt * 3.5);
    const slow =
      d.speed < a.dabSpeed && (Math.abs(d.lean) > a.dabLean * 0.6 || Math.abs(d.steer) > 0.32);
    this.dab = approach(
      this.dab,
      slow && !this.airborne ? Math.sign(d.lean || d.steer || 1) : 0,
      dt * 6,
    );
    if (!this.airborne)
      this.riderBody = approach(
        this.riderBody,
        clamp(0.45 * this.throttle - 0.55 * this.brake + climb, -1, 1),
        dt * 3,
      );
    void track;
  }
  /** The 2-DOF sprung chassis over the two contact patches (heave + pitch),
   * integrated semi-implicitly; detects take-off, touchdown and bottoming. */
  private vertical(dt: number) {
    const d = this.dynamics,
      spec = this.bikeSpec,
      a = this.air,
      L = this.spec.wheelbase,
      fa = spec.cgToFront,
      ra = spec.cgToRear,
      m = d.mass;
    if (!this.riding && this.airborne) {
      // Riderless flight: ballistic until the machine is down at its lying
      // height over the ground below, then laid there (never dropped mid-air).
      this.vy -= G * dt;
      this.cgY += this.vy * dt;
      this.pitchRate *= Math.exp(-0.3 * dt);
      this.pitch = clamp(this.pitch + this.pitchRate * dt, -1.2, 1.2);
      this.forceFront = this.forceRear = 0;
      const ground = lerp(this.contacts[2].height, this.contacts[0].height, ra / L);
      if (this.cgY > ground + spec.cgHeight) return;
      const n = this.contacts[2].normal,
        slopeAt = Math.atan(-(n.x * Math.sin(d.heading) + n.z * Math.cos(d.heading)) / n.y);
      // Only the speed along the ground survives the impact.
      d.speed = Math.max(0, this.flightSpeed * Math.cos(slopeAt) + this.vy * Math.sin(slopeAt));
      this.airborne = false;
    }
    if (!this.riding) {
      // A fallen or pushed bike lies on the ground; no flight.
      const ground = lerp(this.contacts[2].height, this.contacts[0].height, ra / L);
      this.cgY = ground + spec.cgHeight;
      this.vy = this.pitchRate = 0;
      this.airYaw = this.airYawRate = 0;
      this.pitch = this.roadPitch;
      this.airborne = false;
      this.forceFront = this.forceRear = 0;
      this.compressionFront = this.compressionRear = 0.02;
      return;
    }
    const sagF = this.sag(true),
      sagR = this.sag(false),
      HF = spec.cgHeight + sagF,
      HR = spec.cgHeight + sagR;
    const sin = Math.sin(this.pitch),
      cos = Math.cos(this.pitch);
    const freeF = this.cgY + fa * sin - HF * cos,
      freeR = this.cgY - ra * sin - HR * cos;
    let cF = this.contacts[0].height - freeF,
      cR = this.contacts[2].height - freeR;
    const penetration = Math.max(cF - spec.forkTravel, cR - spec.shockTravel);
    if (penetration > DEEP_CONTACT) {
      const correction = penetration - STOP_COMPLIANCE;
      this.cgY += correction;
      cF -= correction;
      cR -= correction;
    }
    const vh = this.airborne ? this.flightSpeed : d.speed * Math.cos(this.roadPitch);
    const slope = (i: number) => {
      const n = this.contacts[i].normal,
        h = d.heading;
      return -(n.x * Math.sin(h) + n.z * Math.cos(h)) / Math.max(0.1, n.y);
    };
    const vF = this.vy + (fa * cos + HF * sin) * this.pitchRate,
      vR = this.vy + (-ra * cos + HR * sin) * this.pitchRate;
    // A whipped chassis sweeps its contact patches across the ground while
    // its centre keeps flying straight. Include that rotational sweep when
    // the two ends first compress on a berm or an uneven landing.
    const yawSweep = (i: number, reach: number) => {
      if (!this.airborne || this.airYawRate === 0) return 0;
      const n = this.contacts[i].normal,
        h = d.heading + this.airYaw;
      return (
        -((n.x * Math.cos(h) - n.z * Math.sin(h)) / Math.max(0.1, n.y)) * reach * this.airYawRate
      );
    };
    const rateF = slope(0) * vh + yawSweep(0, fa) - vF,
      rateR = slope(2) * vh + yawSweep(2, -ra) - vR;
    // A standing rider's legs soak part of every hit.
    const damping = 1 + 0.5 * this.standing;
    const end = (c: number, rate: number, front: boolean) => {
      if (c <= 0) return 0;
      const T = front ? spec.forkTravel : spec.shockTravel,
        C =
          (front ? a.forkDamping : a.shockDamping) *
          damping *
          (front ? this.forkFirmness : this.shockFirmness),
        k = front ? spec.forkRate : spec.shockRate;
      // Rebound (extension) is damped harder than compression at low speed.
      const damper = (C * rate * (rate < 0 ? 2.2 : 1)) / (1 + Math.abs(rate) / a.damperKnee);
      let f = this.spring(Math.min(c, T), front) + damper;
      if (c > T) {
        // Bump stop: a stiff, lossy end of travel; record the bottoming.
        f += 40 * k * (c - T) + 6 * C * Math.max(0, rate);
        this.bottomPeak = Math.max(this.bottomPeak, Math.max(0, rate));
      }
      return Math.max(0, f);
    };
    const FF = end(cF, rateF, true),
      FR = end(cR, rateR, false);
    const contact = FF > 0 || FR > 0;
    // Longitudinal tyre forces act at the ground, below the CG: squat and dive.
    const pitchMoment = contact ? this.longitudinal * spec.cgHeight : 0;
    // On the ground the rider's body fore/aft shifts the CG over the wheels
    // (forward pitches nose-down); in the air it is a reaction torque only.
    const bodyShift = contact ? -this.riderBody * RIDER_REACH * spec.riderMass * G * cos : 0;
    const torque =
      (FF * fa - FR * ra) * cos + pitchMoment + bodyShift + (this.airborne ? this.airTorque : 0);
    this.vy += ((FF + FR) / m - G) * dt;
    this.pitchRate += (torque / a.pitchInertia) * dt;
    // The rider's body damps pitch: strongly with a wheel down (more when
    // standing over rough ground), a little in the air.
    this.pitchRate *= Math.exp(
      -(contact ? 1.5 + 2.5 * this.standing : 0.3 + 0.5 * this.standing) * dt,
    );
    this.cgY += this.vy * dt;
    this.pitch = clamp(this.pitch + this.pitchRate * dt, -1.2, 1.2);
    this.compressionFront = clamp(cF, 0, spec.forkTravel);
    this.compressionRear = clamp(cR, 0, spec.shockTravel);
    this.forceFront = FF;
    this.forceRear = FR;
    const load = (FF + FR) / (m * G);
    this.loadGrip += (clamp(load, 0.55, 1.3) - this.loadGrip) * Math.min(1, dt / 0.08);
    this.frontLight = !this.airborne && FF <= 0 ? this.frontLight + dt : 0;
    if (contact) this.noseTorque = torque;
    if (FR > 0) this.rearSlope = Math.atan(slope(2));
    // A held wheelie (front up for a while) past its balance point, over
    // both the ground under the rear tyre and the line to the ground under
    // the front, with the drive still rotating the nose up, loops the rider
    // out on the ground (the sprung pitch, not the core's relative pitch,
    // carries a wheelie on this adapter). A front hanging over a crest or a
    // lip while the rear tyre's load brings the nose back, or one bounced off
    // the next face in a gap, is not a wheelie.
    const looping = (slope: number) =>
      this.frontLight > 0.4 &&
      this.pitchRate > 0 &&
      this.noseTorque > 0 &&
      this.pitch - Math.max(Math.atan(slope), this.roadPitch) > this.loopOutPitch();
    if (!this.airborne && FR > 0 && looping(slope(2))) {
      this.loopOut();
      return;
    }
    if (this.airborne) {
      if (contact) {
        // Touchdown: judged once both the speed split and pitch are known.
        this.airborne = false;
        this.landings++;
        const slopeAt = Math.atan(
          cF > 0 && cR > 0 ? 0.5 * (slope(0) + slope(2)) : cF > 0 ? slope(0) : slope(2),
        );
        const chassis = this.pitch + this.riderBody * 0.06;
        const normal = this.flightSpeed * Math.sin(slopeAt) - this.vy * Math.cos(slopeAt);
        const along = this.flightSpeed * Math.cos(slopeAt) + this.vy * Math.sin(slopeAt);
        d.speed = Math.max(0, along);
        const yawError = this.airYaw;
        if (Math.abs(yawError) > 1e-9) {
          // Re-express incoming ground-plane momentum in the now-yawed tyre
          // axes. The previous world velocity is preserved: the transverse
          // component becomes real tyre slide, which soil friction dissipates
          // on the following steps. Landing crooked cannot turn a flight for
          // free, and sufficiently large slides use the normal fall/recovery.
          const velocity = landingTyreVelocity(
            d.speed * Math.cos(this.roadPitch),
            this.slide,
            yawError,
          );
          d.speed = Math.max(0, velocity.forward / Math.cos(this.roadPitch));
          this.slide = velocity.lateral;
          d.heading += yawError;
        }
        this.airYaw = this.airYawRate = 0;
        d.pitch = 0;
        this.wheelPickup =
          this.playerMotocross &&
          this.airTime > LANDING_RULES.minimumAirTime &&
          this.takeoffSpeed > LANDING_RULES.rollingHopSpeed;
        this.pickupSpeed = d.speed;
        if (!this.wheelPickup) {
          this.rearSpin = d.speed / spec.rearWheelRadius;
          this.frontSpin = d.speed / spec.frontWheelRadius;
        }
        this.bottomPeak = 0;
        this.pendingLanding = {
          time: this.clock,
          s: this.s,
          distance: Math.hypot(d.x - this.takeoffX, d.z - this.takeoffZ),
          takeoffSpeed: this.takeoffSpeed,
          airTime: this.airTime,
          pitchError: chassis - slopeAt,
          slope: slopeAt,
          normalSpeed: normal,
          yawError,
          lateralSpeed: this.slide,
          bottomSpeed: 0,
          outcome: 'clean',
        };
        // Publish the touchdown immediately. Its shared record is refined
        // during settlement, avoiding a one-step stale landing in the HUD,
        // roost burst and replay camera on the AIRBORNE falling edge.
        this.lastLanding = this.pendingLanding;
        this.settleTime = LANDING_RULES.settleSeconds;
      }
    } else if (!contact) {
      // Leaving the ground: both wheels unloaded for a few substeps.
      if (++this.freeSteps > 2 && looping(this.faceSlope)) this.loopOut();
      else if (this.freeSteps > 2) {
        this.airborne = true;
        this.airTime = 0;
        this.airYaw = this.airYawRate = 0;
        // The last wheel leaves along its own face: that slope splits the
        // speed into the plan-view flight speed (the springs gave vy).
        this.flightSpeed = d.speed * Math.cos(Math.atan(this.faceSlope));
        this.takeoffSpeed = Math.hypot(this.flightSpeed, this.vy);
        this.takeoffX = d.x;
        this.takeoffZ = d.z;
        // The sprung pitch is the flight pitch (it already carries any
        // wheelie); the core's relative pitch has no say in the air.
        d.pitch = 0;
        // A rebound before pickup has finished retains its real rotor
        // speeds. Tiny terrain hops from ordinary rolling keep the original
        // surveyed take-off behaviour.
        if (!this.wheelPickup) {
          this.rearSpin = d.speed / spec.rearWheelRadius;
          this.frontSpin = d.speed / spec.frontWheelRadius;
        }
        this.wheelPickup = false;
        this.predictClock = 0;
      }
    } else {
      this.freeSteps = 0;
      // Slope under the wheel that leaves last (the rear on a face).
      this.faceSlope = cR > 0 ? slope(2) : slope(0);
    }
    if (this.settleTime > 0 && this.pendingLanding) {
      this.settleTime -= dt;
      this.pendingLanding.bottomSpeed = Math.max(this.pendingLanding.bottomSpeed, this.bottomPeak);
    }
  }
  private settleTime = 0;
  private faceSlope = 0;
  /** Touchdown outcome: pitch error against the slope, then bottoming over
   * the first quarter second of the stroke. */
  private judgeLanding(r: LandingRecord) {
    const d = this.dynamics,
      a = this.air;
    // A hop of a few hundredths of a second is a bump, not a landing: only
    // real flights are judged on pitch (and only with a real impact).
    // Skimming whoops and rollers the rider expects the hops: wider limits.
    const course = this.lastTrack ? offroadCourse(this.lastTrack.circuit) : null,
      tolerance = course?.isRough(r.s) ? LANDING_RULES.roughTolerance : 1;
    // A hop at rolling pace (over a sharp crest, down a backside) is ridden
    // out: pitch decides only a real jump or a hard touchdown.
    const real = r.takeoffSpeed > LANDING_RULES.rollingHopSpeed;
    if (r.outcome === 'clean' && r.airTime > LANDING_RULES.minimumAirTime && real) {
      // Only a yawed touchdown adds this immediate judgement. Ordinary
      // slides retain the shared adapter's existing tyre-friction recovery.
      if (
        Math.abs(r.yawError) > 1e-9 &&
        Math.abs(r.lateralSpeed) > LANDING_RULES.crossedCrashSpeed
      ) {
        r.outcome = 'crash-side';
        d.fall('lowside');
      } else if (
        r.pitchError < -a.noseDownLimit * tolerance &&
        r.normalSpeed > LANDING_RULES.noseDownNormalSpeed
      ) {
        r.outcome = 'crash-front';
        d.fall('highside');
      } else if (
        r.pitchError > a.noseUpLimit * tolerance &&
        r.normalSpeed > LANDING_RULES.noseUpNormalSpeed
      ) {
        r.outcome = 'crash-rear';
        d.fall('lowside');
      }
    }
    if (r.outcome === 'clean' || r.outcome === 'bottomed') {
      if (r.bottomSpeed > a.bottomOutSpeed) {
        r.outcome = 'crash-flat';
        d.fall('lowside');
      } else if (r.bottomSpeed > LANDING_RULES.bottomedShaftSpeed && r.outcome === 'clean') {
        r.outcome = 'bottomed';
        // A hard bottom costs speed (the rider absorbs the rest).
        d.speed *= 1 - 0.12 * clamp(r.bottomSpeed / a.bottomOutSpeed, 0, 1);
      }
      this.bottom = Math.max(this.bottom, clamp(r.bottomSpeed / a.bottomOutSpeed, 0, 1));
    }
    this.lastLanding = r;
    if (this.settleTime <= 0 || r.outcome.startsWith('crash')) this.pendingLanding = null;
  }
  /** Mud carried by machine and rider: picked up on wet, soft soil with speed
   * and wheelspin, shed slowly (presentation-only state, but recorded). */
  private updateMud(dt: number) {
    const c = this.contacts[2],
      d = this.dynamics,
      wetSoil =
        c.surface === MATERIAL.MUD
          ? 1
          : c.surface === MATERIAL.DIRT ||
              c.surface === MATERIAL.SAND ||
              c.surface === MATERIAL.GRAVEL_ROAD
            ? 0.15 + this.moisture
            : 0;
    // A dry moto leaves a film of dust over several laps; mud and spin coat
    // a machine within a lap or two.
    const pick = this.airborne
      ? 0
      : wetSoil * (0.0004 * d.speed + 0.012 * Math.abs(d.rearSlip)) * dt;
    this.mud = clamp(this.mud + pick - 0.0015 * dt * this.mud, 0, 1);
  }
  protected override updateSuspensionAndTyres(dt: number) {
    const d = this.dynamics,
      spec = this.bikeSpec,
      riding = this.riding;
    const k = 1 - Math.exp(-dt / 0.02);
    this.fork += ((riding ? this.compressionFront : 0.02) - this.fork) * k;
    this.shock += ((riding ? this.compressionRear : 0.02) - this.shock) * k;
    const m = d.mass,
      lateral = d.speed * d.speed * d.curvature,
      L = this.spec.wheelbase;
    for (let i = 0; i < 4; i++) {
      const t = this.tires[i],
        front = i < 2,
        c = this.contacts[i],
        ideal = COMPOUNDS[t.compound].ideal;
      const rolling = (riding || d.state === 'remount') && !this.airborne;
      t.omega =
        this.airborne || (this.wheelPickup && riding)
          ? front
            ? this.frontSpin
            : this.rearSpin
          : rolling
            ? d.speed / t.radius
            : t.omega * Math.exp(-1.5 * dt);
      t.rotation = mod(t.rotation + t.omega * dt, TAU);
      t.load = riding ? (front ? this.forceFront : this.forceRear) : 0;
      const grounded = riding && !this.airborne;
      t.fx = grounded
        ? front
          ? -d.frontBrakeForce + this.pickupFrontForce
          : d.driveForce - d.rearBrakeForce + this.pickupRearForce
        : 0;
      t.fy = grounded ? (m * lateral * (front ? spec.cgToRear : spec.cgToFront)) / L : 0;
      const inheritedSlip =
        grounded && this.wheelPickup
          ? Math.abs(t.omega * t.radius - d.speed) / Math.max(3, d.speed)
          : 0;
      t.slip = grounded ? Math.max(front ? 0 : Math.min(0.3, d.rearSlip), inheritedSlip) : 0;
      t.angle = front ? d.steer : 0;
      t.compression = front ? this.fork : this.shock;
      t.length = (front ? spec.forkTravel : spec.shockTravel) - t.compression + 0.2;
      t.water = c.water;
      t.surface = c.surface;
      // A locked, unloaded tyre reports force demand, not unlimited heat.
      // Flight and recovery have no contact work, even if that sample remains.
      const use = grounded ? clamp(front ? d.frontUse : d.rearUse, 0, 1.5) : 0;
      const work = Math.hypot(t.fx, t.fy) * d.speed;
      t.energy = work * 0.02;
      t.wear = Math.min(1, t.wear + (work * dt) / (COMPOUNDS[t.compound].lifeJ * 10));
      const carcass = ideal - 4 + 10 * use - 6 * clamp(c.water, 0, 1);
      t.carcassTemp += (carcass - t.carcassTemp) * (1 - Math.exp(-dt / 30));
      t.surfaceTemp += (t.carcassTemp + 8 * use - t.surfaceTemp) * (1 - Math.exp(-dt / 3));
      const brakePower = (front ? d.frontBrakeForce : d.rearBrakeForce) * d.speed * 0.5;
      t.discTemp +=
        (brakePower / (front ? 1600 : 900) - (t.discTemp - 40) * (0.015 + 0.003 * d.speed)) * dt;
      this.wheelSteering[i] = front ? d.steer : 0;
      this.wheelCamber[i] = d.lean;
    }
  }
  /** Contact patches on the terrain, the vertical model, then the rigid-body
   * pose: CG at the sprung height, pitched by the chassis pitch. */
  protected override writeBody(track: Track, dt: number) {
    this.lastTrack = track;
    const d = this.dynamics,
      b = this.body,
      spec = this.bikeSpec,
      L = this.spec.wheelbase;
    // The tyre contact points follow the whipped chassis, while velocity
    // keeps following the independent centre-of-mass travel heading.
    let h = d.heading + this.airYaw,
      sh = Math.sin(h),
      ch = Math.cos(h);
    const front = this.contactPoints[0],
      rear = this.contactPoints[2];
    front.set(d.x + sh * spec.cgToFront, 0, d.z + ch * spec.cgToFront);
    rear.set(d.x - sh * spec.cgToRear, 0, d.z - ch * spec.cgToRear);
    const y = this.groundY;
    track.sample(front.x, front.z, this.contacts[0], y);
    track.sample(rear.x, rear.z, this.contacts[2], y);
    this.copySample(this.contacts[0], this.contacts[1]);
    this.copySample(this.contacts[2], this.contacts[3]);
    front.y = this.contacts[0].height;
    rear.y = this.contacts[2].height;
    this.contactPoints[1].copy(front);
    this.contactPoints[3].copy(rear);
    this.roadPitch = Math.asin(clamp((front.y - rear.y) / L, -0.6, 0.6));
    // The collision solver may depenetrate body Y between physical steps.
    // Differentiate our last authoritative pose so that correction cannot
    // become a false vertical speed fed back into the next contact impulse.
    const previousY = this.written.position.y;
    if (dt > 0) this.vertical(dt);
    else if (this.cgY === 0 && this.pitch === 0) {
      this.pitch = this.roadPitch;
      this.cgY = lerp(rear.y, front.y, spec.cgToRear / L) + spec.cgHeight;
      this.compressionFront = this.sag(true);
      this.compressionRear = this.sag(false);
    }
    // Touchdown commits chassis yaw to the grounded heading in vertical().
    h = d.heading + this.airYaw;
    sh = Math.sin(h);
    ch = Math.cos(h);
    const fallen = !this.airborne && Math.abs(d.lean) > 1.2;
    // The sprung model carries squat, dive and wheelies itself; the core's
    // relative pitch only guards its own loop-out limit.
    const chassisPitch = fallen ? this.roadPitch : this.pitch + this.riderBody * 0.06;
    bikeOrientation(b.orientation, h, chassisPitch, fallen ? d.lean : chassisLean(d.lean, spec));
    if (fallen) {
      this.pivot.set(d.x, (front.y + rear.y) / 2 + spec.crownRadius, d.z);
      this.offset.set(0, 0.18 - spec.crownRadius, 0);
      b.orientation.rotate(this.offset, this.scratch);
      b.position.copy(this.pivot).add(this.scratch);
    } else {
      // The CG rides on the springs; the lean lowers it on the tyre crowns.
      const lean = chassisLean(d.lean, spec),
        drop = (spec.cgHeight - spec.crownRadius) * (1 - Math.cos(lean));
      b.position.set(d.x, this.cgY - drop, d.z);
    }
    this.groundY = lerp(rear.y, front.y, spec.cgToRear / L);
    const v = Math.hypot(d.speed, this.slide);
    const planar = this.airborne ? this.flightSpeed : d.speed * Math.cos(this.roadPitch),
      travelSin = Math.sin(d.heading),
      travelCos = Math.cos(d.heading);
    b.velocity.set(
      travelSin * planar + travelCos * this.slide,
      dt > 0 && Math.abs(b.position.y - previousY) < 0.5 ? (b.position.y - previousY) / dt : 0,
      travelCos * planar - travelSin * this.slide,
    );
    const yawRate =
      (this.riding && !this.airborne ? d.speed * d.curvature : this.airYawRate) + this.yawKick;
    this.heading3.set(sh, 0, ch);
    this.left3.set(ch, 0, -sh);
    b.omega.set(
      -sh * d.leanRate + this.left3.x * -this.pitchRate,
      yawRate,
      -ch * d.leanRate + this.left3.z * -this.pitchRate,
    );
    b.orientation.rotate(this.scratch.set(0, 0, 1), this.forward);
    b.orientation.rotate(this.scratch.set(0, 1, 0), this.up);
    b.orientation.inverseRotate(b.velocity, this.localVelocity);
    this.speed = v;
    this.steer = d.steer;
    this.lateral = track.nearest(d.x, d.z, this.trackPosition, this.groundY);
    this.s = this.trackPosition.s;
    const lateralAccel = this.riding && !this.airborne ? d.speed * d.speed * d.curvature : 0;
    this.gLong = d.longitudinal / G;
    this.gLat = lateralAccel / G;
    this.gVert = (this.forceFront + this.forceRear) / (d.mass * G);
    this.aero.front = this.aero.rear = this.aero.floor = 0;
    this.aero.drag = spec.drag * d.dragScale * d.speed * d.speed;
    this.frontRideHeight = this.rearRideHeight = Math.max(
      0,
      b.position.y - this.groundY - spec.cgHeight * 0.5,
    );
    b.acceleration.set(0, 0, 0);
    this.written.position.copy(b.position);
    this.written.velocity.copy(b.velocity);
    this.written.omega.copy(b.omega);
    // Ruts and moisture under the machine (snapshot channels).
    const surface = Track.offroadOf(track);
    if (surface instanceof TrackTerrainSurface) {
      const t = surface.terrain;
      this.rutFront = t.depthAt(this.contacts[0].lateral, this.contacts[0].s);
      this.rutRear = t.depthAt(this.contacts[2].lateral, this.contacts[2].s);
      this.moisture = t.moistureAt(t.cellIndex(this.contacts[2].lateral, this.contacts[2].s));
    }
  }
  override restart(track: Track) {
    this.planRemount(track);
    const d = this.dynamics;
    if (!this.inPit && Math.hypot(this.remount.x - d.x, this.remount.z - d.z) > 3) {
      // A beached machine is assisted across the feature visibly. An
      // instantaneous 20–40 m restart can skip a timing gate, leaving the
      // rider a whole circulation behind despite having reached the exit.
      // Recovery crosses that ground; no lap progress is manufactured.
      d.speed = 0;
      d.state = 'remount';
      d.stateClock = 0;
      d.leanRate = 0;
      this.lastState = 'remount';
      this.slide = this.yawKick = this.stuckClock = 0;
      this.pendingLanding = null;
      this.settle();
      return;
    }
    super.restart(track);
    this.settle();
  }
  protected override pushToRemount(dt: number) {
    if (!(dt > 0) || !this.remount.active) return;
    const d = this.dynamics,
      distance = Math.hypot(this.remount.x - d.x, this.remount.z - d.z),
      remaining = Math.max(dt, BIKE_RECOVERY.maxPush - d.stateClock),
      // Long feature recoveries used to snap their remaining distance when
      // the five-second remount timeout expired. Spread that assistance
      // across the same bounded interval so every timing gate is crossed.
      assistedStep = Math.max(dt, (distance * dt) / (BIKE_RECOVERY.pushSpeed * remaining));
    super.pushToRemount(assistedStep);
  }
  /** The remount (and marshal restart) point: the road bike's — on the
   * course inside its edge, facing the course — moved past a jump whose face
   * is still to be climbed (OffroadCourse.restartS): a machine restarted at
   * a standstill on a take-off face or in a gap cannot climb out of it, so
   * the rider pushes it over to the flat ground beyond the feature. */
  protected override planRemount(track: Track) {
    super.planRemount(track);
    const course = offroadCourse(track.circuit),
      p = this.remountPoint;
    if (!course || this.inPit) return;
    const s = course.restartS(p.s);
    if (s === mod(p.s, track.length)) return;
    const lateral = (this.remount.x - p.x) * p.nx + (this.remount.z - p.z) * p.nz;
    track.at(s, p);
    const edge = Math.max(0, p.width - BIKE_RECOVERY.edgeInset),
      side = clamp(lateral, -edge, edge);
    this.remount.x = p.x + p.nx * side;
    this.remount.z = p.z + p.nz * side;
    this.remount.heading = Math.atan2(p.tx, p.tz);
  }
}
