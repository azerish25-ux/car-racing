import { SIMULATION_TICK_HZ } from '../core/session-identity.ts';

/** Online protocol constants (WP50–WP54, masterplan §22). The physics tick,
 * the input cadence and the network snapshot cadence are deliberately
 * separate numbers: the server simulates at 120 Hz, a client samples its
 * controls at 60 Hz (each command covers two physics ticks) and sends them at
 * 30 Hz with redundancy, and the server publishes a compact state at 20 Hz. */
export const NET_PROTOCOL_VERSION = 1;

export const CADENCE = Object.freeze({
  physicsHz: SIMULATION_TICK_HZ,
  inputSampleHz: 60,
  inputSendHz: 30,
  snapshotHz: 20,
  renderHz: 60,
});
export const TICK_MS = 1000 / CADENCE.physicsHz;
/** Physics ticks covered by one input command at the nominal cadence. */
export const TICKS_PER_COMMAND = CADENCE.physicsHz / CADENCE.inputSampleHz;
export const TICKS_PER_SNAPSHOT = CADENCE.physicsHz / CADENCE.snapshotHz;

/** Hard limits applied to everything a peer sends (WP54). */
export const LIMITS = Object.freeze({
  /** Unreliable datagrams stay below a conservative path MTU. */
  datagramBytes: 1200,
  /** Reliable control messages (join, lobby, results). */
  reliableBytes: 8192,
  /** A single result message may carry a classification for a full field. */
  resultBytes: 32768,
  commandsPerPacket: 16,
  /** One command may cover at most this many ticks (lead adjustment). */
  commandTicksMax: 8,
  /** Commands further than this ahead of the server clock are rejected. */
  leadTicksMax: 240,
  /** Unacknowledged commands repeated in every input packet. */
  inputRedundancy: 12,
  nameLength: 24,
  carsPerSnapshot: 32,
  playersPerLobby: 12,
});

export const TIMEOUTS = Object.freeze({
  /** Silence after which a connection is treated as lost. */
  disconnectMs: 1000,
  /** A human car with no command for this long is held by the AI until
   * commands resume (never drive on stale inputs). */
  inputStarvationMs: 250,
  /** A disconnected driver may reclaim the car within this window. */
  rejoinWindowMs: 30000,
  /** Grid countdown between the grid message and the first physics tick. */
  gridCountdownMs: 1500,
  /** Results stay available this long before teardown. */
  resultsLingerMs: 2000,
  /** A connection that never sends a valid join is closed. */
  joinMs: 5000,
});

export type Timeouts = { [K in keyof typeof TIMEOUTS]: number };

/** Token-bucket rates per connection. Exceeding them drops the message and
 * adds a strike; enough strikes close the connection. */
export const RATES = Object.freeze({
  control: { perSecond: 8, burst: 16 },
  input: { perSecond: 75, burst: 40 },
  strikesToKick: 40,
});

/** IPv4 + UDP header bytes added to every datagram on the wire. Reliable
 * channels over DTLS/SCTP or TCP carry more; this is a stated lower bound. */
export const UDP_IP_OVERHEAD_BYTES = 28;
