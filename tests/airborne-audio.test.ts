import { describe, expect, it } from 'vitest';
import {
  AIRBORNE_LOAD,
  airborneAt,
  engineUnload,
  landingDuration,
  landingThump,
} from '../src/audio/airborne-audio.ts';
import { powerUnitMix, newPowerUnitMix } from '../src/audio/power-unit.ts';
import { ContactAudio, contactMix, newContactMix } from '../src/audio/surface-audio.ts';
import { DEFAULT_OPTIONS } from '../src/simulation/config.ts';
import {
  CAR_STRIDE,
  F,
  H,
  HEADER,
  O,
  OFFROAD_BASE,
  R,
  RACE_BASE,
  W,
  WHEEL_BASE,
  WHEEL_STRIDE,
  carBase,
} from '../src/simulation/protocol.ts';
import { MATERIAL } from '../src/simulation/surface-material.ts';
import { vehicleIndex } from '../src/simulation/vehicles.ts';
import { Simulation } from '../src/simulation/world.ts';

/** A recording fake of the Web Audio nodes ContactAudio builds (no output). */
class Param {
  value = 0;
  readonly events: [string, number, number][] = [];
  setTargetAtTime(v: number, t: number) {
    this.events.push(['target', v, t]);
    this.value = v;
    return this;
  }
  setValueAtTime(v: number, t: number) {
    this.events.push(['value', v, t]);
    this.value = v;
    return this;
  }
  exponentialRampToValueAtTime(v: number, t: number) {
    this.events.push(['ramp', v, t]);
    return this;
  }
  cancelScheduledValues() {
    return this;
  }
}
class Node {
  connect<T>(n: T) {
    return n;
  }
  disconnect() {}
}
const fakeContext = () =>
  ({
    sampleRate: 4000,
    currentTime: 0,
    destination: new Node(),
    createGain: () => Object.assign(new Node(), { gain: new Param() }),
    createBiquadFilter: () =>
      Object.assign(new Node(), { type: '', frequency: new Param(), Q: new Param() }),
    createBufferSource: () =>
      Object.assign(new Node(), { buffer: null, loop: false, start() {}, stop() {} }),
    createBuffer: (_c: number, length: number) => ({
      getChannelData: () => new Float32Array(length),
    }),
    createOscillator: () =>
      Object.assign(new Node(), {
        type: '',
        frequency: new Param(),
        setPeriodicWave() {},
        start() {},
        stop() {},
      }),
    createPeriodicWave: () => ({}),
  }) as unknown as BaseAudioContext;
const layer = (audio: ContactAudio, name: string) =>
  (audio as unknown as { layers: Record<string, { gain: { gain: Param } }> }).layers[name].gain
    .gain;

function frame(surface: number, load = 2000) {
  const f = new Float32Array(HEADER + CAR_STRIDE),
    o = carBase(0);
  f[H.CARS] = 1;
  f[o + F.SPEED] = 20;
  f[o + F.RPM] = 8000;
  for (let i = 0; i < 4; i++) {
    const p = o + WHEEL_BASE + i * WHEEL_STRIDE;
    f[p + W.LOAD] = load;
    f[p + W.OMEGA] = 60;
    f[p + W.SURFACE] = surface;
  }
  return f;
}

describe('loose-ground rolling audio', () => {
  it('gives dirt, mud, sand and snow their own layers, not the circuit ones', () => {
    for (const [surface, key] of [
      [MATERIAL.DIRT, 'dirt'],
      [MATERIAL.MUD, 'mud'],
      [MATERIAL.SAND, 'sand'],
      [MATERIAL.SNOW, 'snow'],
    ] as const) {
      const mix = contactMix(frame(surface), newContactMix());
      expect(mix[key], key).toBeGreaterThan(0);
      for (const other of ['dirt', 'mud', 'sand', 'snow', 'asphalt', 'grass', 'kerb'] as const)
        if (other !== key) expect(mix[other], `${key}:${other}`).toBe(0);
    }
    // Ice is a faint trace of the snow layer; a gravel road uses the gravel layer.
    const ice = contactMix(frame(MATERIAL.ICE), newContactMix()).snow,
      snow = contactMix(frame(MATERIAL.SNOW), newContactMix()).snow;
    expect(ice).toBeGreaterThan(0);
    expect(ice).toBeLessThan(snow / 2);
    expect(contactMix(frame(MATERIAL.GRAVEL_ROAD), newContactMix()).gravel).toBeGreaterThan(0);
  });
  it('turns wet dirt into mud and wheelspin on loose ground into thrown soil, not squeal', () => {
    const dry = frame(MATERIAL.DIRT),
      wet = frame(MATERIAL.DIRT);
    wet[carBase(0) + OFFROAD_BASE + O.MOISTURE] = 0.9;
    expect(contactMix(wet, newContactMix()).mud).toBeGreaterThan(
      contactMix(wet, newContactMix()).dirt,
    );
    expect(contactMix(dry, newContactMix()).mud).toBe(0);
    const spin = frame(MATERIAL.DIRT);
    for (let i = 2; i < 4; i++) {
      spin[carBase(0) + WHEEL_BASE + i * WHEEL_STRIDE + W.SLIP_POWER] = 2e5;
      spin[carBase(0) + WHEEL_BASE + i * WHEEL_STRIDE + W.SLIP] = 0.6;
    }
    const mix = contactMix(spin, newContactMix());
    expect(mix.scrub).toBe(0);
    expect(mix.dirt).toBeGreaterThan(contactMix(dry, newContactMix()).dirt);
    // Wheels in the air make no ground sound at all.
    const air = contactMix(frame(MATERIAL.DIRT, 0), newContactMix());
    expect([air.dirt, air.mud, air.sand, air.snow]).toEqual([0, 0, 0, 0]);
  });
});

describe('airborne engine note and landing thump', () => {
  it('unloads the engine voice and power-unit layers while the machine is in the air', () => {
    const f = frame(MATERIAL.DIRT),
      o = carBase(0);
    f[o + RACE_BASE + R.VEHICLE] = vehicleIndex('mx450');
    f[o + F.ENGINE_TORQUE] = 40;
    f[o + F.THROTTLE] = 1;
    f[o + F.GEAR] = 3;
    f[o + F.SPEED] = 25;
    expect(engineUnload(f, 0)).toBe(1);
    const ground = powerUnitMix(f, 0, 3, newPowerUnitMix());
    f[o + OFFROAD_BASE + O.AIRBORNE] = 1;
    expect(airborneAt(f, 0)).toBe(true);
    expect(engineUnload(f, 0)).toBe(AIRBORNE_LOAD);
    const air = powerUnitMix(f, 0, 3, newPowerUnitMix());
    expect(air.whine).toBeLessThan(ground.whine);
  });
  it('scales the thump with impact speed and ignores a roll-in', () => {
    expect(landingThump(0.2)).toBe(0);
    expect(landingThump(2)).toBeGreaterThan(0);
    expect(landingThump(5)).toBeGreaterThan(landingThump(2));
    expect(landingThump(20)).toBeCloseTo(0.6, 9);
    expect(landingDuration(6)).toBeGreaterThan(landingDuration(1));
    expect(landingThump(NaN)).toBe(0);
  });
  it('hears a touchdown once, at the speed the machine fell, and cancels it on a seek', () => {
    const audio = new ContactAudio(fakeContext());
    const f = frame(MATERIAL.DIRT),
      o = carBase(0);
    let t = 0;
    const feed = (airborne: boolean, vy: number) => {
      t += 1 / 60;
      f[H.TIME] = t;
      f[o + OFFROAD_BASE + O.AIRBORNE] = airborne ? 1 : 0;
      f[o + F.VY] = vy;
      audio.update(f, false, t);
    };
    feed(false, 0);
    for (let i = 0; i < 30; i++) feed(true, 3 - i * 0.3);
    feed(false, 0);
    expect(audio.landings).toBe(1);
    expect(audio.lastLanding).toBeCloseTo(-(3 - 29 * 0.3), 5);
    const thump = layer(audio, 'land').events.find((e) => e[0] === 'value')!;
    expect(thump[1]).toBeCloseTo(landingThump(audio.lastLanding), 6);
    feed(false, 0);
    expect(audio.landings).toBe(1);
    // A replay seek is not a landing: airborne before it, grounded after it.
    for (let i = 0; i < 5; i++) feed(true, -4);
    audio.reset(t);
    feed(false, 0);
    expect(audio.landings).toBe(1);
  });
  it('follows a real dirt bike over Valley Ridge: flights, touchdowns and the dirt layer', () => {
    const sim = new Simulation({
      ...DEFAULT_OPTIONS,
      mode: 'practice',
      circuit: 'valley-ridge-mx',
      opponents: 0,
      vehicles: ['mx450'],
    });
    sim.autoPlayer = true;
    const audio = new ContactAudio(fakeContext());
    const shot = sim.makeFrame();
    let flights = 0,
      wasAir = false,
      dirt = 0,
      unloaded = 0;
    for (let tick = 0; tick < 120 * 90; tick++) {
      sim.step(1 / 120);
      if (tick % 2) continue;
      sim.writeFrame(shot);
      const air = airborneAt(shot, 0);
      if (air && !wasAir) flights++;
      if (air) unloaded += Number(engineUnload(shot, 0) === AIRBORNE_LOAD);
      wasAir = air;
      audio.update(shot, false, shot[H.TIME]);
      dirt = Math.max(dirt, audio.mix.dirt + audio.mix.mud);
    }
    expect(flights).toBeGreaterThan(2);
    expect(unloaded).toBeGreaterThan(0);
    expect(audio.landings).toBeGreaterThanOrEqual(flights - 1);
    expect(audio.lastLanding).toBeGreaterThan(0);
    expect(dirt).toBeGreaterThan(0);
  }, 120000);
});
