import { circuitDefinition } from './circuits.ts';
import { K, SKID_BASE } from './protocol.ts';
import { clamp } from '../core/math.ts';
import { AIDriver } from './ai.ts';
import { wakeOverlap } from './aero.ts';
import { CollisionSolver } from './collision.ts';
import {
  COMPOUNDS,
  alternateDryCompound,
  mandatoryStopSatisfied,
  racingSession,
  VEHICLE,
  type Compound,
  type Controls,
  type SessionOptions,
  validateOptions,
} from './config.ts';
import { OVERTAKE } from './drs.ts';
import {
  CAR_STRIDE,
  DEBRIS_BASE,
  DEBRIS_STRIDE,
  F,
  H,
  HEADER,
  R,
  RACE_BASE,
  W,
  WHEEL_BASE,
  WHEEL_STRIDE,
  carBase,
} from './protocol.ts';
import { PHASE, RaceDirector, updatePit } from './race.ts';
import { Track } from './track.ts';
import { Vehicle } from './vehicle.ts';
const COMPOUND_IDS = Object.keys(COMPOUNDS);
export class Simulation {
  readonly options: SessionOptions;
  readonly track: Track;
  readonly cars: Vehicle[];
  readonly ai: AIDriver[];
  readonly race: RaceDirector;
  readonly collisions = new CollisionSolver();
  tick = 0;
  autoPlayer = false;

  constructor(options: SessionOptions) {
    this.options = validateOptions(options);
    this.track = new Track(
      this.options.weather,
      false,
      undefined,
      circuitDefinition(this.options.circuit),
    );
    const count = this.options.opponents + 1,
      grid = this.options.grid,
      length = this.track.length;
    // Qualifying releases the field spread around the lap, so every car has an
    // out-lap and clear track; a race uses the staggered grid in `grid` order.
    const spacing = Math.min(420, (length - 400) / count);
    this.cars = Array.from({ length: count }, (_, i) => {
      const c = new Vehicle(i, this.options.compound, this.options.setup, this.options.assist);
      const slot = grid ? grid.indexOf(i) : i;
      if (this.options.mode === 'qualifying')
        c.place(this.track, length - 32 - (slot + 1) * spacing, 0);
      else
        c.place(this.track, length - 32 - Math.floor(slot / 2) * 10, slot % 2 === 0 ? -2.2 : 2.2);
      return c;
    });
    this.ai = this.cars.map((c) => new AIDriver(c, 0.92 + (c.id % 4) * 0.014, this.options.seed));
    this.race = new RaceDirector(this.cars, this.track, this.options);
    if (this.options.mode === 'endurance')
      // Enough fuel for the distance plus a margin: real mass, no refuelling.
      for (const c of this.cars)
        c.fuel = Math.max(c.fuel, this.options.laps * (length / 1000) * 0.37 + 4);
    if (!racingSession(this.options.mode)) {
      this.race.phase = PHASE.RACING;
      this.race.time = this.race.greenAt;
    }
  }
  setInput(input: Controls) {
    const dst = this.cars[0].input;
    dst.throttle = Number.isFinite(input.throttle) ? clamp(input.throttle, 0, 1) : 0;
    dst.brake = Number.isFinite(input.brake) ? clamp(input.brake, 0, 1) : 0;
    dst.steer = Number.isFinite(input.steer) ? clamp(input.steer, -1, 1) : 0;
    dst.shift = Number.isFinite(input.shift) ? Math.sign(input.shift) : 0;
    dst.ers = input.ers === 0 ? 0 : input.ers === 2 ? 2 : 1;
    dst.reverse = !!input.reverse;
    dst.manualClutch = input.manualClutch === true;
    dst.clutch = Number.isFinite(input.clutch) ? clamp(input.clutch, 0, 1) : 0;
    const car = this.cars[0];
    if (input.drs === true) car.drsRequest = true;
    if (
      input.overtake === true &&
      car.overtakeClock <= 0 &&
      car.battery >= VEHICLE.maxBatteryJ * OVERTAKE.minBattery
    )
      car.overtakeClock = OVERTAKE.seconds;
  }
  /** Toggle the player's pit request; `compound` is the strategy page's choice. */
  requestPit(compound?: Compound) {
    const c = this.cars[0];
    c.pitRequested = !c.pitRequested;
    if (compound && Object.hasOwn(COMPOUNDS, compound)) {
      c.nextCompound = compound;
      return;
    }
    c.nextCompound =
      this.track.meanWater() > 0.85
        ? 'wet'
        : this.track.meanWater() > 0.3
          ? 'intermediate'
          : this.options.mode === 'endurance' && !mandatoryStopSatisfied(c.compoundsUsed)
            ? alternateDryCompound(c.tires[0].compound)
            : 'medium';
  }
  step(dt: number) {
    this.tick++;
    for (let i = 0; i < this.cars.length; i++) {
      const c = this.cars[i];
      if (i > 0 || this.autoPlayer || c.pitRequested || c.inPit || c.finishTime > 0) {
        this.race.laps[i].assisted = true;
        this.ai[i].update(dt, this.track, this.cars, this.race);
      } else if (this.race.phase === PHASE.LIGHTS && c.input.throttle === 0) c.input.brake = 1;
      c.wake = 0;
      for (const other of this.cars)
        if (other !== c)
          c.wake = Math.max(
            c.wake,
            wakeOverlap(
              c.body.position,
              other.body.position,
              other.forward,
              other.speed,
              c.forward,
            ),
          );
    }
    for (let sub = 0; sub < 2; sub++) {
      for (const c of this.cars) c.step(dt * 0.5, this.track);
      this.collisions.solve(this.cars, this.track);
    }
    for (const c of this.cars) c.recoverIfUpset(dt, this.track);
    for (const c of this.cars) updatePit(c, this.track, dt, this.cars);
    this.track.evolve(dt, Math.max(0, this.race.time - this.race.greenAt));
    this.race.step(dt);
  }
  writeFrame(out: Float32Array, stepMs = 0, dropped = 0) {
    if (out.length !== HEADER + this.cars.length * CAR_STRIDE)
      throw new Error('Invalid snapshot buffer');
    out[H.TIME] = this.race.time;
    out[H.PHASE] = this.race.phase;
    out[H.RACE_TIME] = this.race.raceTime;
    out[H.LIGHTS] = this.race.lights;
    out[H.RAIN] = this.track.rain;
    out[H.CLOUD] = this.track.cloud;
    out[H.AMBIENT] = this.track.ambient;
    out[H.FLAG] = this.race.flag === 'CHEQUERED' ? 2 : this.race.control.flags[0];
    out[H.STEP_MS] = stepMs;
    out[H.DROPPED] = dropped;
    out[H.WATER] = this.track.meanWater();
    out[H.TICK] = this.tick;
    out[H.CARS] = this.cars.length;
    out[H.LENGTH] = this.track.length;
    out[H.WIND_X] = this.track.windX;
    out[H.WIND_Z] = this.track.windZ;
    const sc = this.race.safetyCar;
    out[H.SC_PHASE] = sc.phase;
    out[H.SC_S] = sc.s;
    out[H.SC_SPEED] = sc.phase >= 2 ? sc.speed : 0;
    out[H.DRS_ENABLED] = Number(this.race.drs.enabled);
    let leaderLaps = 0;
    for (const lap of this.race.laps) leaderLaps = Math.max(leaderLaps, lap.completed);
    out[H.LAP_LEADER] = leaderLaps + 1;
    out[H.FORMATION] = 0;
    out[H.FORMATION + 1] = 0;
    out[H.FORMATION + 2] = 0;
    for (let id = 0; id < this.cars.length; id++) {
      const c = this.cars[id],
        b = c.body,
        t = this.race.laps[id],
        o = carBase(id),
        q = b.orientation;
      out[o + F.X] = b.position.x;
      out[o + F.Y] = b.position.y;
      out[o + F.Z] = b.position.z;
      out[o + F.QX] = q.x;
      out[o + F.QY] = q.y;
      out[o + F.QZ] = q.z;
      out[o + F.QW] = q.w;
      out[o + F.VX] = b.velocity.x;
      out[o + F.VY] = b.velocity.y;
      out[o + F.VZ] = b.velocity.z;
      out[o + F.WX] = b.omega.x;
      out[o + F.WY] = b.omega.y;
      out[o + F.WZ] = b.omega.z;
      out[o + F.SPEED] = c.speed;
      out[o + F.STEER] = c.steer;
      out[o + F.RPM] = c.rpm;
      out[o + F.GEAR] = c.gear;
      out[o + F.THROTTLE] = c.throttle;
      out[o + F.BRAKE] = c.brake;
      out[o + F.FUEL] = c.fuel;
      out[o + F.BATTERY] = c.battery;
      out[o + F.AERO_FRONT] = c.aero.front + c.aero.floor * 0.46;
      out[o + F.AERO_REAR] = c.aero.rear + c.aero.floor * 0.54;
      out[o + F.DRAG] = c.aero.drag;
      out[o + F.FRONT_HEALTH] = c.frontHealth;
      out[o + F.FLOOR_HEALTH] = c.floorHealth;
      out[o + F.REAR_HEALTH] = c.rearHealth;
      out[o + F.S] = c.s;
      out[o + F.LATERAL] = c.lateral;
      out[o + F.LAPS] = t.completed;
      out[o + F.LAP_TIME] = t.lapTime;
      out[o + F.BEST_LAP] = t.best;
      out[o + F.LAST_LAP] = t.last;
      out[o + F.PENALTY] = t.penalty;
      out[o + F.PIT_PHASE] = c.pitPhase;
      out[o + F.IN_PIT] = Number(c.inPit);
      out[o + F.AI_TARGET] = c.aiTarget;
      out[o + F.G_LONG] = c.gLong;
      out[o + F.G_LAT] = c.gLat;
      out[o + F.G_VERT] = c.gVert;
      out[o + F.RANK] = this.race.order.indexOf(id) + 1;
      out[o + F.FINISH] = c.finishTime;
      out[o + F.WAKE] = c.wake;
      out[o + F.SLIP_ENERGY] = c.tires.reduce((sum, w) => sum + w.energy, 0);
      out[o + F.BOTTOM_ENERGY] = c.bottomEnergy;
      const r = o + RACE_BASE,
        status = this.race.sectorStatus;
      out[r + R.DRS] = this.race.drs.state[id];
      out[r + R.DRS_ELIGIBLE] = Number(this.race.drs.eligibleZone[id] >= 0);
      out[r + R.TYRE_AGE_LAPS] = t.completed - this.race.stintStart[id];
      out[r + R.NEXT_COMPOUND] = c.pitRequested ? COMPOUND_IDS.indexOf(c.nextCompound) : -1;
      out[r + R.OVERTAKE] = c.overtakeClock;
      out[r + R.SECTOR_STATUS] = status[id * 3] + 4 * status[id * 3 + 1] + 16 * status[id * 3 + 2];
      out[r + R.DRS_FLAP] = c.drsFlap;
      out[r + 7] = 0;
      const k = o + SKID_BASE,
        skid = c.skid;
      out[k + K.CONTACTS] = skid.contacts;
      out[k + K.LOAD] = skid.normalLoad;
      out[k + K.SLIDE_POWER] = skid.slidingPower;
      out[k + K.DAMPING_POWER] = skid.dampingPower;
      out[k + K.SPARK_POWER] = skid.sparkPower;
      out[k + K.SPARK_X] = skid.point.x;
      out[k + K.SPARK_Y] = skid.point.y;
      out[k + K.SPARK_Z] = skid.point.z;
      out[k + K.NORMAL_X] = skid.normal.x;
      out[k + K.NORMAL_Y] = skid.normal.y;
      out[k + K.NORMAL_Z] = skid.normal.z;
      out[k + K.VELOCITY_X] = skid.velocity.x;
      out[k + K.VELOCITY_Y] = skid.velocity.y;
      out[k + K.VELOCITY_Z] = skid.velocity.z;
      out[k + K.SLIDE_WORK] = skid.slidingWorkJ;
      out[k + K.SPARK_WORK] = skid.sparkWorkJ;
      out[k + K.TOTAL_WORK] = skid.totalWorkJ;
      out[o + F.IMPACT] = c.impact;
      out[o + F.COMPOUND] = COMPOUND_IDS.indexOf(c.tires[0].compound);
      out[o + F.PIT_STOPS] = c.pitStops;
      out[o + F.MOTOR_POWER] = c.motorPower;
      out[o + F.REGEN_POWER] = c.regenerationPower;
      out[o + F.FRONT_RIDE] = c.frontRideHeight;
      out[o + F.REAR_RIDE] = c.rearRideHeight;
      out[o + F.BRAKE_BIAS] = c.setup.brakeBias;
      out[o + F.DIFF_POWER] = c.setup.diffPower;
      out[o + F.DIFF_COAST] = c.setup.diffCoast;
      out[o + F.ERS_MODE] = c.input.ers;
      out[o + F.JACK_HEIGHT] = c.jackHeight;
      out[o + F.SIDEPOD_HEALTH] = c.sidepodHealth;
      out[o + F.LOST_MASS] = c.lostMass;
      out[o + F.SUSPENSION_DAMAGE] = c.suspensionDamage;
      out[o + F.SECTOR] = t.sector;
      out[o + F.SECTOR_1] = t.sectors[0] || t.lastSectors[0];
      out[o + F.SECTOR_2] = t.sectors[1] || t.lastSectors[1];
      out[o + F.SECTOR_3] = t.sectors[2] || t.lastSectors[2];
      out[o + F.LAP_VALID] = Number(t.valid);
      out[o + F.LAST_LAP_VALID] = Number(t.lastValid && t.lastPenalty === 0);
      out[o + F.LAST_LAP_ASSISTED] = Number(t.lastAssisted);
      out[o + F.WARNINGS] = t.warnings;
      out[o + F.PIT_YIELDING] = Number(c.pitYielding);
      out[o + F.RETIRED] = Number(c.retired);
      out[o + F.MASS] = c.body.mass;
      out[o + F.CLUTCH_PEDAL] = c.input.clutch;
      out[o + F.CLUTCH_ENGAGEMENT] = c.clutch.engagement;
      out[o + F.CLUTCH_TORQUE] = c.clutch.transmittedTorque;
      out[o + F.CLUTCH_SLIP_POWER] = c.clutch.slipPower;
      out[o + F.ENGINE_TORQUE] = c.engineOutputTorque;
      out[o + F.LOCAL_FLAG] = this.race.control.flags[id];
      out[o + F.CAUTION_DISTANCE] = this.race.control.zoneDistance[id];
      out[o + F.CAUTION_SPEED] = this.race.control.zoneSpeed[id];
      out[o + F.BLUE_CAR] = this.race.control.blueCar[id];
      out[o + F.CONTROL_SEQUENCE] = this.race.control.sequence;
      out[o + F.CONTROL_PENALTIES] = this.race.control.penaltyCount[id];
      out[o + F.PIT_CLOCK] = c.pitClock;
      out[o + F.LAP_DELTA] = t.reference.delta(c.s, t.lapTime);
      out[o + F.DELTA_VALID] = Number(t.active && t.reference.bestTime > 0);
      const brain = this.ai[id].brain;
      out[o + F.AI_STRESS] = brain.stress;
      out[o + F.AI_TIRE_CARE] = brain.tireCare;
      out[o + F.AI_ERROR_COUNT] = brain.errors.events;
      out[o + F.AI_STEER_ERROR] = brain.errors.steer;
      out[o + F.AI_PEDAL_ERROR] = brain.errors.pedal;
      out[o + F.AI_DEFENDING] = brain.defence.offset;
      out[o + F.AI_PACE] = brain.pace;
      for (let i = 0; i < c.debris.pieces.length; i++) {
        const piece = c.debris.pieces[i],
          p = o + DEBRIS_BASE + i * DEBRIS_STRIDE;
        out[p] = piece.kind;
        out[p + 1] = piece.position.x;
        out[p + 2] = piece.position.y;
        out[p + 3] = piece.position.z;
        out[p + 4] = piece.rotation;
        out[p + 5] = piece.age;
        out[p + 6] = piece.mass;
        out[p + 7] = Number(piece.active);
      }
      for (let i = 0; i < 4; i++) {
        const w = c.tires[i],
          p = o + WHEEL_BASE + i * WHEEL_STRIDE;
        out[p + W.OMEGA] = w.omega;
        out[p + W.LOAD] = w.load;
        out[p + W.FX] = w.fx;
        out[p + W.FY] = w.fy;
        out[p + W.SLIP] = w.slip;
        out[p + W.ANGLE] = w.angle;
        out[p + W.SURFACE_TEMP] = w.surfaceTemp;
        out[p + W.CARCASS_TEMP] = w.carcassTemp;
        out[p + W.WEAR] = w.wear;
        out[p + W.DIRT] = w.dirt;
        out[o + F.MARBLE_PICKUP_FR + i] = w.marblePickup;
        out[p + W.COMPRESSION] = w.compression;
        out[p + W.DISC_TEMP] = w.discTemp;
        out[p + W.WATER] = w.water;
        out[p + W.SURFACE] = w.surface;
        out[p + W.ROTATION] = w.rotation;
        out[p + W.FLAT] = w.flatSpot;
        out[p + W.PRESSURE] = w.pressure;
        out[p + W.RADIUS] = w.radius;
        out[p + W.BLISTERING] = w.blistering;
        out[p + W.GRAINING] = w.graining;
        out[p + W.PUNCTURED] = Number(w.punctured);
        out[p + W.SUSPENSION_DAMAGE] = c.cornerDamage[i];
        out[p + W.SLIP_POWER] = w.energy;
        out[p + W.LENGTH] = w.length;
        out[p + W.STEER] = c.wheelSteering[i];
        out[p + W.CAMBER] = c.wheelCamber[i];
      }
    }
    return out;
  }
  makeFrame() {
    return this.writeFrame(new Float32Array(HEADER + this.cars.length * CAR_STRIDE));
  }
}
