// Scratch: lateral80 / braking sweep for a sheet variant.
import { clamp, G } from '/home/user/Experiment-3/.claude/worktrees/wf_9577868e-cce-1/src/core/math.ts';
import { DEFAULT_SETUP } from '/home/user/Experiment-3/.claude/worktrees/wf_9577868e-cce-1/src/simulation/config.ts';
import { Vehicle } from '/home/user/Experiment-3/.claude/worktrees/wf_9577868e-cce-1/src/simulation/vehicle.ts';
import { VEHICLES, type VehicleDefinition } from '/home/user/Experiment-3/.claude/worktrees/wf_9577868e-cce-1/src/simulation/vehicles.ts';
import { DynamicsTrack } from '/home/user/Experiment-3/.claude/worktrees/wf_9577868e-cce-1/scripts/dynamics-fixtures.ts';

function standing(def: VehicleDefinition, track: DynamicsTrack, dt: number, assist: 'raw' | 'sport') {
  const car = new Vehicle(0, 'medium', DEFAULT_SETUP, assist, def);
  car.place(track, 0);
  car.input.brake = 1;
  for (let t = 0; t < 2; t += dt) car.step(dt, track);
  car.input.brake = 0;
  return car;
}
function rolling(def: VehicleDefinition, track: DynamicsTrack, dt: number, speed: number) {
  const car = standing(def, track, dt, 'raw');
  car.body.velocity.set(0, 0, speed);
  car.speed = speed;
  for (const tire of car.tires) tire.omega = speed / tire.radius;
  const spec = def.spec,
    top = spec.gearRatios.length - 2;
  let gear = top;
  while (
    gear > 1 &&
    ((speed / spec.wheelRadius) * spec.gearRatios[gear + 1] * spec.finalDrive * 30) / Math.PI <
      spec.downshiftRPM
  )
    gear--;
  car.gear = gear;
  car.clutch.engineOmega = Math.max(
    (spec.idleRPM * Math.PI) / 30,
    (speed / spec.wheelRadius) * spec.gearRatios[car.gear + 1] * spec.finalDrive,
  );
  return car;
}
export function lateral(def: VehicleDefinition, dt: number, kmh: number) {
  const track = new DynamicsTrack();
  const speed = kmh / 3.6;
  const car = rolling(def, track, dt, speed);
  let steer = 0,
    filtered = 0,
    peak = 0,
    peakSteer = 0;
  for (let t = 0; t < 60; t += dt) {
    steer += 0.012 * dt;
    car.input.steer = steer;
    car.input.throttle = clamp((speed - car.speed) * 0.6 + 0.2, 0, 1);
    car.step(dt, track);
    filtered += (Math.abs(car.gLat) - filtered) * Math.min(1, dt / 0.25);
    if (filtered > peak) {
      peak = filtered;
      peakSteer = steer;
    }
    if (t > 2 && filtered < peak * 0.85) break;
    if (car.speed < speed * 0.8) break;
  }
  return { peak, peakSteer };
}
const id = process.argv[2];
const patches = JSON.parse(process.argv[3] ?? '{}');
const base = VEHICLES[id];
const { maxSteer, dryMass, ...top } = patches;
const def = {
  ...base,
  ...top,
  spec: { ...base.spec, ...(maxSteer ? { maxSteer } : {}), ...(dryMass ? { dryMass } : {}) },
} as VehicleDefinition;
const r = lateral(def, 1 / 240, 80);
console.log(id, JSON.stringify(patches), 'lat80', r.peak.toFixed(3), 'steer', r.peakSteer.toFixed(3), G);
