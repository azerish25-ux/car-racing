import { describe, expect, it } from 'vitest';
import { GHOST_FIELDS, GHOST_VERSION, ghostKey, validateGhost } from '../src/core/ghost-lap.ts';
import {
  SIMULATION_VERSION,
  circuitHash,
  recordIncompatibility,
  sessionIdentity,
} from '../src/core/session-identity.ts';
import { AUREL, VELLAMAR } from '../src/simulation/circuits.ts';
import { DEFAULT_OPTIONS } from '../src/simulation/config.ts';
import {
  CAR_STRIDE,
  HEADER,
  H,
  SNAPSHOT_SCHEMA,
  snapshotIncompatibility,
} from '../src/simulation/protocol.ts';
import { leaderboardKey } from '../src/storage/leaderboard.ts';

const legacyGhost = () => {
  const samples = new Float32Array(GHOST_FIELDS * 40);
  for (let i = 0; i < 40; i++) {
    samples[i * GHOST_FIELDS] = (i / 39) * 80;
    for (let k = 1; k < GHOST_FIELDS; k++) samples[i * GHOST_FIELDS + k] = k === 8 ? 1 : 0;
  }
  return {
    version: GHOST_VERSION,
    circuit: 'aurel',
    trackLength: 3000,
    lapTime: 80,
    sectors: [27, 26, 27],
    assist: 'sport',
    compound: 'medium',
    weather: 'clear',
    recordedAt: '2026-01-01',
    samples,
  };
};
describe('WP12 recorded identity and schema policy', () => {
  it('hashes content, not object identity', () => {
    expect(circuitHash(AUREL)).toBe(circuitHash({ ...AUREL }));
    expect(circuitHash(AUREL)).not.toBe(circuitHash(VELLAMAR));
    const id = sessionIdentity({ ...DEFAULT_OPTIONS, opponents: 1, vehicles: ['tc1', 'apx01'] });
    expect(id.vehicles).toEqual(['tc1', 'apx01']);
    expect(id.vehicleHashes[0]).not.toBe(id.vehicleHashes[1]);
    expect(id.simulationVersion).toBe(SIMULATION_VERSION);
  });
  it('reads pre-identity ghosts as Formula physics v1 and rejects others with reasons', () => {
    const category = { circuit: 'aurel', vehicle: 'apx01', physics: 1 };
    expect(validateGhost(legacyGhost(), 'aurel', 3000, category)?.vehicle).toBe('apx01');
    expect(validateGhost(legacyGhost(), 'aurel', 3000, { ...category, vehicle: 'tc1' })).toBeNull();
    expect(recordIncompatibility({ circuit: 'aurel' }, { ...category, physics: 2 })).toMatch(
      /physics v1; current physics is v2/,
    );
    expect(ghostKey('aurel')).toBe('ghost:v1:aurel');
    expect(ghostKey('aurel', 'tc1')).toBe('ghost:v1:aurel:tc1');
    expect(leaderboardKey('aurel')).toBe('leaderboard:aurel');
    expect(leaderboardKey('aurel', 'tc1', 1)).toBe('leaderboard:aurel:tc1:p1');
    expect(leaderboardKey('aurel', 'apx01', 2)).toBe('leaderboard:aurel:apx01:p2');
  });
  it('describes every per-car block inside the stride without overlap', () => {
    const blocks = [...SNAPSHOT_SCHEMA.blocks].sort((a, b) => a.offset - b.offset);
    let end = 0;
    for (const b of blocks) {
      expect(b.offset).toBeGreaterThanOrEqual(end);
      end = b.offset + b.stride * b.count;
    }
    expect(end).toBe(CAR_STRIDE);
    const frame = new Float32Array(HEADER + 2 * CAR_STRIDE);
    frame[H.CARS] = 2;
    expect(snapshotIncompatibility(frame)).toBeNull();
    expect(snapshotIncompatibility(frame, 10)).toMatch(/not supported/);
    frame[H.CARS] = 3;
    expect(snapshotIncompatibility(frame)).toMatch(/length/);
  });
});
