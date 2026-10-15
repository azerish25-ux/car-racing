import { describe, expect, it } from 'vitest';
import { DEFAULT_OPTIONS, controls, validateOptions } from '../src/simulation/config.ts';
import { Simulation } from '../src/simulation/world.ts';
import { OVERTAKE } from '../src/simulation/drs.ts';
import { AuthoritativeWorld, PIT_TOGGLE_MIN_TICKS, applyControls } from '../src/net/authority.ts';
import { ShadowPilot } from '../src/net/bots.ts';
import { quantizeControls } from '../src/net/input.ts';

const OPTIONS = validateOptions({ ...DEFAULT_OPTIONS, mode: 'race', opponents: 2, seed: 314 });
function frameHash(sim: Simulation) {
  const frame = sim.makeFrame(),
    words = new Uint32Array(frame.buffer);
  let h = 0x811c9dc5;
  for (let i = 0; i < words.length; i++) h = Math.imul(h ^ words[i], 0x01000193);
  return (h >>> 0).toString(16).padStart(8, '0');
}

describe('authoritative world (WP50 server simulation)', () => {
  it('an all-AI NetDriver field is bit-identical to the plain Simulation', () => {
    const plain = new Simulation(OPTIONS);
    plain.autoPlayer = true;
    const world = new AuthoritativeWorld(OPTIONS);
    for (let car = 0; car < 3; car++) world.setMode(car, 'ai');
    for (let t = 0; t < 1200; t++) {
      plain.step(1 / 120);
      world.step();
    }
    expect(world.stateHash()).toBe(frameHash(plain));
  });
  it('applies network controls exactly as Simulation.setInput does for the player', () => {
    const a = new Simulation(OPTIONS),
      b = new Simulation(OPTIONS);
    const input = quantizeControls({
      ...controls(),
      throttle: 0.7,
      brake: 0.1,
      steer: -0.4,
      shift: 1,
      ers: 2,
      reverse: true,
      manualClutch: true,
      clutch: 0.3,
      drs: true,
      overtake: true,
    });
    a.setInput(input);
    applyControls(b.cars[0], input, 2, true);
    expect({ ...b.cars[0].input }).toEqual({ ...a.cars[0].input });
    expect(b.cars[0].drsRequest).toBe(a.cars[0].drsRequest);
    expect(b.cars[0].overtakeClock).toBe(a.cars[0].overtakeClock);
    // Requesting a pit stop chooses the compound the same way too.
    const w = new AuthoritativeWorld(OPTIONS);
    a.requestPit();
    w.requestPit(0);
    expect([w.sim.cars[0].pitRequested, w.sim.cars[0].nextCompound]).toEqual([
      a.cars[0].pitRequested,
      a.cars[0].nextCompound,
    ]);
  });
  it('an overtake request starts the boost; edges that cannot act and fast pit toggles are not journaled', () => {
    const options = validateOptions({ ...DEFAULT_OPTIONS, mode: 'race', opponents: 0, seed: 314 });
    const world = new AuthoritativeWorld(options),
      car = world.sim.cars[0];
    expect(car.definition.hybrid).toBe(true);
    for (let t = 0; t < 10; t++) world.step();
    world.setControls(0, { ...controls(), overtake: true }, true);
    world.step();
    expect(car.overtakeClock).toBeCloseTo(OVERTAKE.seconds - 1 / 120, 9);
    // A modified client sends one-tick commands flipping every edge and the
    // throttle each tick for 2 s: only real state changes reach the journal.
    const before = world.journal.length;
    for (let t = 0; t < 240; t++) {
      world.setControls(
        0,
        { ...controls(), throttle: 1 - (t % 2), overtake: true, pit: true },
        true,
      );
      world.step();
    }
    const added = world.journal.slice(before);
    expect(added.filter((e) => e.kind === 'overtake')).toHaveLength(0);
    expect(added.filter((e) => e.kind === 'pit')).toHaveLength(240 / PIT_TOGGLE_MIN_TICKS);
    expect(added.filter((e) => e.kind === 'controls')).toHaveLength(240);
    expect(added.length).toBeLessThan(240 * 1.1);
    // The replay reproduces the boost and the toggles exactly.
    const replayed = AuthoritativeWorld.replay(options, world.journal, world.tick);
    expect(replayed.stateHash()).toBe(world.stateHash());
  });
  it('the shadow pilot leaves no trace in the world it reads', () => {
    const plain = new Simulation(OPTIONS);
    plain.autoPlayer = true;
    const world = new AuthoritativeWorld(OPTIONS);
    for (let car = 0; car < 3; car++) world.setMode(car, 'ai');
    const pilots = [0, 1, 2].map((car) => new ShadowPilot(world, car, 'humanized', 5));
    for (let t = 0; t < 1100; t++) {
      if (t % 2 === 0) for (const p of pilots) p.sample(1 / 60);
      plain.step(1 / 120);
      world.step();
    }
    expect(world.stateHash()).toBe(frameHash(plain));
  });
  it('replays its journal to the identical state, and restores a crashed world', () => {
    const live = new AuthoritativeWorld(OPTIONS);
    live.setMode(2, 'ai');
    const pilots = [0, 1].map(
      (car) => new ShadowPilot(live, car, car === 1 ? 'humanized' : 'smooth', 9),
    );
    const drive = (world: AuthoritativeWorld, until: number) => {
      while (world.tick < until) {
        if (world.tick % 2 === 0)
          for (const p of pilots) world.setControls(p.car, p.sample(1 / 60), true);
        if (world.tick === 900) world.setMode(1, 'ai');
        if (world.tick === 1000) world.setMode(1, 'human');
        if (world.tick === 1100)
          world.setControls(0, { ...controls(), throttle: 1, overtake: true }, true);
        world.step();
      }
    };
    drive(live, 1200);
    expect(live.journal.some((e) => e.kind === 'overtake')).toBe(true);
    expect(live.journal.filter((e) => e.kind === 'mode').length).toBe(3);
    const crashedAt = live.tick,
      liveHash = live.stateHash();
    // A restarted server rebuilds the exact state from the persisted journal…
    const restored = AuthoritativeWorld.replay(OPTIONS, live.journal.slice(), crashedAt);
    expect(restored.stateHash()).toBe(liveHash);
    expect(restored.journal).toEqual(live.journal);
    // …and continues identically when given the same subsequent inputs.
    const later = [0, 1].map(() => quantizeControls({ ...controls(), throttle: 0.9, steer: 0.05 }));
    for (let t = 0; t < 240; t++)
      for (const w of [live, restored]) {
        if (t === 0) later.forEach((c, car) => w.setControls(car, c, true));
        w.step();
      }
    expect(restored.stateHash()).toBe(live.stateHash());
    expect(() =>
      AuthoritativeWorld.replay(OPTIONS, [{ tick: 5, car: 9, kind: 'mode', mode: 'ai' }], 10),
    ).toThrow(/unknown car/);
  });
});
