import { clamp } from '../core/math.ts';
import {
  B,
  BIKE_BASE,
  F,
  R,
  RACE_BASE,
  W,
  WHEEL_BASE,
  WHEEL_STRIDE,
  carBase,
} from '../simulation/protocol.ts';
import { vehicleAt } from '../simulation/vehicles.ts';
import { chassisLean } from '../simulation/bike-definitions.ts';

const finite = (value: number, fallback = 0) => (Number.isFinite(value) ? value : fallback);
const percent = (value: number) => Math.round(clamp(finite(value), 0, 1) * 100);
const RIDER_STATES = ['RIDING', 'LOW SIDE', 'HIGH SIDE', 'RIDER DOWN', 'REMOUNTING'] as const;

/** Read the two actual tyres and the recorded rider/electronics channels.
 * The transport duplicates front into 0/1 and rear into 2/3; those copies do
 * not represent four motorcycle tyres. Nothing here estimates a grip budget. */
export function bikeReadout(frame: Float32Array) {
  const o = carBase(0),
    b = o + BIKE_BASE;
  const definition = vehicleAt(Math.round(frame[o + RACE_BASE + R.VEHICLE]));
  if (!definition.bike) return null;
  const tyre = (wheel: 0 | 2) => {
    const p = o + WHEEL_BASE + wheel * WHEEL_STRIDE;
    return {
      temperature: Math.round(finite(frame[p + W.CARCASS_TEMP])),
      life: percent(1 - finite(frame[p + W.WEAR])),
      punctured: frame[p + W.PUNCTURED] > 0,
    };
  };
  const frontLoad = Math.max(0, finite(frame[b + B.FRONT_LOAD]));
  const rearLoad = Math.max(0, finite(frame[b + B.REAR_LOAD]));
  const load = frontLoad + rearLoad;
  const state = RIDER_STATES[Math.round(frame[b + B.STATE])] ?? 'RIDING';
  const loaded = state === 'RIDING' && load > 1;
  return {
    name: definition.name,
    discipline: definition.classId === 'gp-bike' ? 'GP' : 'BIKE',
    lean: Math.round(
      clamp((chassisLean(finite(frame[b + B.LEAN]), definition.bike) * 180) / Math.PI, -90, 90),
    ),
    rearBrake: percent(frame[b + B.REAR_BRAKE]),
    frontBrake: percent(frame[o + F.BRAKE]),
    tuck: percent(frame[b + B.TUCK]),
    intervention: percent(frame[b + B.INTERVENTION]),
    state,
    // The bike transport retains its last riding loads during separation.
    // Do not present those stale values as current contact load transfer.
    frontLoad: loaded ? Math.round((frontLoad / load) * 100) : null,
    rearLoad: loaded ? Math.round((rearLoad / load) * 100) : null,
    hangOff: Math.round(finite(frame[b + B.RIDER_OFFSET]) * 100),
    fork: Math.round(Math.max(0, finite(frame[b + B.FORK])) * 1000),
    shock: Math.round(Math.max(0, finite(frame[b + B.SHOCK])) * 1000),
    front: tyre(0),
    rear: tyre(2),
  };
}
