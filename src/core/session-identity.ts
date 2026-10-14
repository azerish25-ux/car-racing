import { circuitDefinition, type CircuitDefinition } from '../simulation/circuits.ts';
import type { SessionOptions } from '../simulation/config.ts';
import { rulesetFor } from '../simulation/events.ts';
import { PROTOCOL_VERSION } from '../simulation/protocol.ts';
import {
  DEFAULT_VEHICLE_ID,
  vehicleDefinition,
  type VehicleDefinition,
} from '../simulation/vehicles.ts';

/** Version of the physical model. Bump it whenever a solver change can alter
 * recorded lap times, so old records are archived or migrated explicitly
 * instead of competing silently against new physics (masterplan §22.5). */
export const SIMULATION_VERSION = 1;
/** Fixed physics tick used by the worker and headless simulation. */
export const SIMULATION_TICK_HZ = 120;

/** FNV-1a over a canonical string; stable across platforms and sessions. */
export function contentHash(text: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) h = Math.imul(h ^ text.charCodeAt(i), 0x01000193);
  return (h >>> 0).toString(16).padStart(8, '0');
}
/** Canonical JSON (sorted keys) so equal content always hashes equally. */
export function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  if (value && typeof value === 'object')
    return `{${Object.keys(value)
      .sort()
      .map((k) => `${JSON.stringify(k)}:${canonical((value as Record<string, unknown>)[k])}`)
      .join(',')}}`;
  return JSON.stringify(value ?? null);
}
export function vehicleHash(def: VehicleDefinition) {
  return contentHash(canonical(def));
}
/** Circuits hold profile functions: hash their design plus sampled profiles. */
export function circuitHash(def: CircuitDefinition) {
  const samples = Array.from({ length: 64 }, (_, i) => {
    const u = i / 64;
    return [def.elevation(u, false), def.halfWidth(u), def.bankGain(u), def.crossFall(u, false)];
  });
  return contentHash(
    canonical({
      id: def.id,
      design: def.design,
      samples,
      maxBank: def.maxBank,
      drs: def.drsZones,
      pit: def.pit ?? null,
    }),
  );
}
/** masterplan §6.3 RecordedSessionIdentity. */
export interface RecordedSessionIdentity {
  formatVersion: number;
  simulationVersion: number;
  tickHz: number;
  circuit: string;
  circuitHash: string;
  ruleset: string;
  rulesetHash: string;
  vehicles: string[];
  vehicleHashes: string[];
  assist: string;
  seed: number;
}
export function sessionIdentity(options: SessionOptions): RecordedSessionIdentity {
  const circuit = circuitDefinition(options.circuit),
    ruleset = rulesetFor(options),
    count = options.opponents + 1,
    vehicles = Array.from({ length: count }, (_, i) => options.vehicles?.[i] ?? DEFAULT_VEHICLE_ID);
  return {
    formatVersion: PROTOCOL_VERSION,
    simulationVersion: SIMULATION_VERSION,
    tickHz: SIMULATION_TICK_HZ,
    circuit: circuit.id,
    circuitHash: circuitHash(circuit),
    ruleset: ruleset.id,
    rulesetHash: contentHash(canonical(ruleset)),
    vehicles,
    vehicleHashes: vehicles.map((id) => vehicleHash(vehicleDefinition(id))),
    assist: options.assist,
    seed: options.seed,
  };
}
/** Record category: records only compete within the same circuit, vehicle
 * and physics version (masterplan §11.2, §22.5). */
export interface RecordCategory {
  circuit: string;
  vehicle: string;
  physics: number;
}
export function recordCategory(
  options: Pick<SessionOptions, 'circuit' | 'vehicles'>,
): RecordCategory {
  return {
    circuit: circuitDefinition(options.circuit).id,
    vehicle: options.vehicles?.[0] ?? DEFAULT_VEHICLE_ID,
    physics: SIMULATION_VERSION,
  };
}
/** Why a stored record cannot be used in `expected`, or null when compatible.
 * Records predating identity fields were made by the Formula APX-01 under
 * physics version 1 and are read as such (explicit, tested migration). */
export function recordIncompatibility(
  stored: { circuit?: unknown; vehicle?: unknown; physics?: unknown },
  expected: RecordCategory,
): string | null {
  const vehicle = typeof stored.vehicle === 'string' ? stored.vehicle : DEFAULT_VEHICLE_ID,
    physics = typeof stored.physics === 'number' ? stored.physics : 1;
  if (stored.circuit !== expected.circuit) return `recorded on ${String(stored.circuit)}`;
  if (vehicle !== expected.vehicle) return `recorded with vehicle ${vehicle}`;
  if (physics !== expected.physics)
    return `recorded with physics v${physics}; current physics is v${expected.physics}`;
  return null;
}
