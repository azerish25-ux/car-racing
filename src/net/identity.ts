import {
  SIMULATION_TICK_HZ,
  SIMULATION_VERSION,
  sessionIdentity,
  type RecordedSessionIdentity,
} from '../core/session-identity.ts';
import type { SessionOptions } from '../simulation/config.ts';
import { PROTOCOL_VERSION } from '../simulation/protocol.ts';

/** The identity a client computes from its *own* content for a session it
 * wants to join with `vehicle`: the advertised circuit/ruleset/assists/seed
 * and its chosen car, hashed by its local definitions (WP51). */
export function joinIdentity(advertised: SessionOptions, vehicle: string): RecordedSessionIdentity {
  const { grid: _grid, ...rest } = advertised;
  return sessionIdentity({ ...rest, opponents: 0, vehicles: [vehicle] });
}

/** First reason `presented` cannot race in a session whose server computed
 * `expected` (same function, server content), or null when they agree. Every
 * physical input is compared: snapshot format, physics version, tick rate,
 * circuit/ruleset/vehicle ids and content hashes, assists and seed. */
export function identityMismatch(
  expected: RecordedSessionIdentity,
  presented: RecordedSessionIdentity,
): string | null {
  if (presented.simulationVersion !== expected.simulationVersion)
    return `simulation version ${presented.simulationVersion} does not match the server's version ${expected.simulationVersion}`;
  if (presented.formatVersion !== expected.formatVersion)
    return `snapshot format v${presented.formatVersion} does not match the server's v${expected.formatVersion}`;
  if (presented.tickHz !== expected.tickHz)
    return `physics tick ${presented.tickHz} Hz does not match the server's ${expected.tickHz} Hz`;
  if (presented.circuit !== expected.circuit)
    return `circuit ${presented.circuit} is not this session's circuit ${expected.circuit}`;
  if (presented.circuitHash !== expected.circuitHash)
    return `circuit ${expected.circuit} content ${presented.circuitHash} differs from the server's ${expected.circuitHash}`;
  if (presented.ruleset !== expected.ruleset)
    return `ruleset ${presented.ruleset} is not this session's ruleset ${expected.ruleset}`;
  if (presented.rulesetHash !== expected.rulesetHash)
    return `ruleset ${expected.ruleset} content ${presented.rulesetHash} differs from the server's ${expected.rulesetHash}`;
  if (presented.vehicles.length !== expected.vehicles.length)
    return 'vehicle list does not match the session';
  for (let i = 0; i < expected.vehicles.length; i++) {
    if (presented.vehicles[i] !== expected.vehicles[i])
      return `vehicle ${presented.vehicles[i]} is not ${expected.vehicles[i]}`;
    if (presented.vehicleHashes[i] !== expected.vehicleHashes[i])
      return `vehicle ${expected.vehicles[i]} content ${presented.vehicleHashes[i]} differs from the server's ${expected.vehicleHashes[i]}`;
  }
  if (presented.assist !== expected.assist)
    return `assist mode ${presented.assist} does not match the session's ${expected.assist}`;
  if (presented.seed !== expected.seed) return 'session seed does not match';
  return null;
}

/** Build-level constants a client must share before content is compared. */
export const BUILD_IDENTITY = Object.freeze({
  simulationVersion: SIMULATION_VERSION,
  snapshotFormat: PROTOCOL_VERSION,
  tickHz: SIMULATION_TICK_HZ,
});
