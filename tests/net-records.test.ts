import { beforeAll, describe, expect, it } from 'vitest';
import { canonical } from '../src/core/session-identity.ts';
import { DEFAULT_OPTIONS, validateOptions } from '../src/simulation/config.ts';
import {
  AuthoritativeWorld,
  CHECKPOINT_TICKS,
  decodeJournal,
  encodeJournal,
  journalEntryLimit,
  type JournalEntry,
} from '../src/net/authority.ts';
import { ShadowPilot } from '../src/net/bots.ts';
import { fromBase64, toBase64 } from '../src/net/bytes.ts';
import {
  MAX_RECORD_TICKS,
  createRecord,
  recordDigest,
  verifyRecord,
  type SessionRecord,
} from '../src/net/records.ts';

/** A time-trial lap driven through the network input path: the pilot's
 * controls are quantized and journaled exactly as a server applies them. */
const OPTIONS = validateOptions({ ...DEFAULT_OPTIONS, mode: 'time-trial', seed: 6060 });
let record: SessionRecord;
let live: AuthoritativeWorld;
const copy = () => JSON.parse(JSON.stringify(record)) as SessionRecord;
const resign = (r: SessionRecord) => ({ ...r, digest: recordDigest(r) });

beforeAll(() => {
  live = new AuthoritativeWorld(OPTIONS);
  const pilot = new ShadowPilot(live, 0, 'humanized', 3);
  while (live.lapTimes[0].length < 1 && live.tick < 120 * 120) {
    if (live.tick % 2 === 0) live.setControls(0, pilot.sample(1 / 60), true);
    live.step();
  }
  for (let t = 0; t < 30; t++) live.step();
  record = createRecord(live);
});

describe('verified records (WP52)', () => {
  it('a record is seed + options + input journal + content hashes, and verifies', () => {
    expect(record.claim.lapTimes[0].length).toBe(1);
    expect(record.claim.lapTimes[0][0]).toBeGreaterThan(40);
    expect(record.identity.seed).toBe(6060);
    expect(record.identity.circuitHash).toMatch(/^[0-9a-f]{8}$/);
    expect(record.category).toEqual({ circuit: 'aurel', vehicle: 'apx01', physics: 1 });
    expect(record.journalEntries).toBeGreaterThan(500);
    expect(decodeJournal(fromBase64(record.journal))).toEqual(live.journal);
    expect(record.claim.checkpoints.length).toBe(Math.floor(record.endTick / 1200));
    // The server-side legal-progress audit agrees with the lap counter.
    expect(live.audit.disputes()).toEqual([]);
    expect(live.audit.laps(0)).toBe(1);
    const result = verifyRecord(copy());
    expect(result).toMatchObject({
      ok: true,
      ticks: record.endTick,
      finalHash: record.claim.finalHash,
    });
  });
  it('rejects a forged lap time, even with a recomputed digest', () => {
    const forged = copy();
    forged.claim.lapTimes[0][0] -= 0.25;
    forged.claim.best[0] = forged.claim.lapTimes[0][0];
    // Without a new digest it fails the integrity check immediately…
    const tampered = verifyRecord(forged);
    expect(tampered).toMatchObject({ ok: false, stage: 'format' });
    // …and with one, the headless re-simulation refuses it.
    const result = verifyRecord(resign(forged));
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.stage).toBe('resimulation');
      expect(result.reason).toMatch(/car 0 lap 1: claimed .* re-simulation gives/);
    }
  });
  it('rejects a tampered input log at the first divergent checkpoint', () => {
    const entries = decodeJournal(fromBase64(record.journal));
    const index = entries.findIndex(
      (e) => e.kind === 'controls' && e.tick > 900 && e.controls.throttle > 0.5,
    );
    const entry = entries[index];
    if (entry.kind !== 'controls') throw new Error('expected a controls entry');
    entries[index] = {
      ...entry,
      controls: { ...entry.controls, steer: entry.controls.steer + 3 / 32767 },
    };
    const forged = copy();
    forged.journal = toBase64(encodeJournal(entries));
    const result = verifyRecord(resign(forged));
    expect(result.ok).toBe(false);
    if (!result.ok)
      expect(result.reason).toMatch(/state diverges from the claim at tick 1200|lap 1/);
  });
  it('rejects mismatched content, versions and malformed records', () => {
    const cases: [(r: SessionRecord) => void, RegExp][] = [
      [(r) => (r.identity.circuitHash = '00000000'), /circuit aurel content 00000000 differs/],
      [(r) => (r.identity.vehicleHashes[0] = 'deadbeef'), /vehicle apx01 content deadbeef differs/],
      [(r) => (r.identity.rulesetHash = 'feedface'), /ruleset time-trial content feedface differs/],
      [(r) => (r.identity.simulationVersion = 2), /physics v2; this verifier runs v1/],
      [(r) => (r.options.seed = 1), /seed/],
      [(r) => (r.options.setup.frontWing = 7), /canonical/],
      [(r) => (r.category.vehicle = 'tc1'), /category mismatch/],
      [(r) => (r.journal = r.journal.slice(0, 40)), /journal is unreadable/],
      [(r) => (r.journalEntries += 1), /entry count/],
      [(r) => (r.endTick = 0), /end tick/],
      [(r) => (r.version = 9), /version 9/],
    ];
    for (const [mutate, reason] of cases) {
      const r = copy();
      mutate(r);
      const result = verifyRecord(resign(r));
      expect(result.ok, String(reason)).toBe(false);
      if (!result.ok) expect(result.reason).toMatch(reason);
    }
    expect(verifyRecord(null)).toMatchObject({ ok: false, stage: 'format' });
    expect(verifyRecord({ ...copy(), format: 'other' })).toMatchObject({ ok: false });
    expect(canonical(copy().options)).toBe(canonical(OPTIONS));
  });
  it('requires exactly the session checkpoints and compares every one of them', () => {
    const n = Math.floor(record.endTick / CHECKPOINT_TICKS);
    expect(record.claim.checkpoints.map((c) => c.tick)).toEqual(
      Array.from({ length: n }, (_, k) => (k + 1) * CHECKPOINT_TICKS),
    );
    const formats: [(r: SessionRecord) => void, RegExp][] = [
      [
        (r) =>
          (r.claim.checkpoints = r.claim.checkpoints.map((c) => ({ ...c, tick: c.tick + 1e7 }))),
        /state checkpoints/,
      ],
      [
        (r) => (r.claim.checkpoints = r.claim.checkpoints.map((c) => ({ ...c, hash: 'bad' }))),
        /state checkpoints/,
      ],
      [(r) => r.claim.checkpoints.pop(), /state checkpoints/],
      [(r) => r.claim.best.push(1.234), /does not cover the field/],
      [(r) => (r.claim.order = [1]), /permutation/],
      [(r) => (r.claim.laps = [0.5]), /non-negative integers/],
    ];
    for (const [mutate, reason] of formats) {
      const r = copy();
      mutate(r);
      const result = verifyRecord(resign(r));
      expect(result, String(reason)).toMatchObject({ ok: false, stage: 'format' });
      if (!result.ok) expect(result.reason).toMatch(reason);
    }
    // Well-formed but invented hashes fail at the first checkpoint.
    const forged = copy();
    forged.claim.checkpoints = forged.claim.checkpoints.map((c) => ({ ...c, hash: 'deadbeef' }));
    const result = verifyRecord(resign(forged));
    expect(result).toMatchObject({ ok: false, stage: 'resimulation' });
    if (!result.ok) expect(result.reason).toMatch(/diverges from the claim at tick 1200 /);
  });
  it('AI-driven laps verify as a session but never count for the category', () => {
    const genuine = verifyRecord(copy());
    expect(record.claim.lapAssisted).toEqual([[false]]);
    expect(genuine).toMatchObject({
      ok: true,
      categoryLaps: live.lapValid[0][0] ? 1 : 0,
      categoryBest: live.lapValid[0][0] ? record.claim.lapTimes[0][0] : 0,
    });
    // A forger (or a server whose driver dropped out) has the server's own
    // AI drive car 0 for 100 ticks of the lap, and records the result.
    {
      const world = new AuthoritativeWorld(OPTIONS),
        pilot = new ShadowPilot(world, 0, 'humanized', 3);
      while (world.lapTimes[0].length < 1 && world.tick < 120 * 120) {
        if (world.tick === 300) world.setMode(0, 'ai');
        if (world.tick === 400) world.setMode(0, 'human');
        if (world.tick % 2 === 0 && world.drivers[0].mode === 'human')
          world.setControls(0, pilot.sample(1 / 60), true);
        world.step();
      }
      const assisted = createRecord(world);
      expect(assisted.claim.lapTimes[0].length).toBeGreaterThan(0);
      expect(assisted.claim.lapAssisted[0][0]).toBe(true);
      const result = verifyRecord(JSON.parse(JSON.stringify(assisted)));
      expect(result).toMatchObject({ ok: true, categoryLaps: 0, categoryBest: 0 });
      // Claiming the lap was driven by a human does not survive re-simulation.
      const lying = JSON.parse(JSON.stringify(assisted)) as SessionRecord;
      lying.claim.lapAssisted[0][0] = false;
      const refused = verifyRecord(resign(lying));
      expect(refused).toMatchObject({ ok: false, stage: 'resimulation' });
      if (!refused.ok) expect(refused.reason).toMatch(/car 0 lap 1: claimed not AI-assisted/);
    }
  });
  it('bounds the journal by the session, so a full-length race fits and a padded one does not', () => {
    // 75 min, 8 cars, an entry per car every other tick (a command change at
    // the 60 Hz input cadence): 2.16 M
    // entries (the old fixed cap was 2 M).
    const ticks = 75 * 60 * 120,
      entries: JournalEntry[] = [];
    for (let t = 0; t < ticks; t += 2)
      for (let car = 0; car < 8; car++) entries.push({ tick: t, car, kind: 'overtake' });
    expect(ticks).toBeLessThanOrEqual(MAX_RECORD_TICKS);
    expect(entries.length).toBeGreaterThan(2_000_000);
    expect(decodeJournal(encodeJournal(entries), journalEntryLimit(ticks, 8))).toHaveLength(
      entries.length,
    );
    expect(() => decodeJournal(encodeJournal(entries), journalEntryLimit(1000, 8))).toThrow(
      /too long/,
    );
    const padded = copy();
    padded.journalEntries = journalEntryLimit(padded.endTick, 1) + 1;
    const result = verifyRecord(resign(padded));
    expect(result).toMatchObject({ ok: false, stage: 'journal' });
    if (!result.ok) expect(result.reason).toMatch(/longer than this session allows/);
  });
});
