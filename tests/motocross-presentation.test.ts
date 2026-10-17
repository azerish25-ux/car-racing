import { describe, expect, it } from 'vitest';
import { circuitDefinition } from '../src/simulation/circuits.ts';
import { DEFAULT_OPTIONS, validateOptions } from '../src/simulation/config.ts';
import { EVENTS, sessionIncompatibilities } from '../src/simulation/events.ts';
import {
  F,
  H,
  R,
  RACE_BASE,
  B,
  BIKE_BASE,
  W,
  WHEEL_BASE,
  WHEEL_STRIDE,
  carBase,
} from '../src/simulation/protocol.ts';
import { Track, trackPoint } from '../src/simulation/track.ts';
import { VEHICLES, vehicleAt } from '../src/simulation/vehicles.ts';
import { motocrossMenuPreview } from '../src/rendering/offroad/menu-bike.ts';
import { staticSag } from '../src/rendering/bike.ts';
import { machineOptions } from '../src/ui/machine-options.ts';
import { eventCard } from '../src/ui/event-cards.ts';
import {
  MOTOCROSS_RIDE_PRESETS,
  motocrossKind,
  motocrossLayout,
  motocrossPreset,
  motocrossSessionTitle,
} from '../src/ui/motocross-presentation.ts';

describe('motocross reference presentation', () => {
  it('all offered rides resolve to eligible real sessions on both venues and both bikes', () => {
    for (const circuit of ['valley-ridge-mx', 'arena-nord-sx'] as const)
      for (const machine of ['mx450', 'mx250'])
        for (const preset of MOTOCROSS_RIDE_PRESETS) {
          const base = validateOptions({
            ...DEFAULT_OPTIONS,
            circuit,
            mode: preset.mode,
            opponents: preset.opponents,
            assist: preset.assist,
          });
          const options = validateOptions({ ...base, ...machineOptions(base, machine) });
          expect(sessionIncompatibilities(options), `${circuit}/${machine}/${preset.id}`).toEqual(
            [],
          );
          expect(options.vehicles).toHaveLength(preset.opponents + 1);
          expect(options.vehicles!.every((id) => id === machine)).toBe(true);
        }
    expect(motocrossPreset('not-a-preset')).toBeNull();
  });

  it('the showroom uses the chosen motorcycle rig dimensions and never invents race progress', () => {
    const track = new Track();
    for (const machine of ['mx450', 'mx250']) {
      const frame = motocrossMenuPreview(track, machine),
        o = carBase(0);
      const definition = vehicleAt(Math.round(frame[o + RACE_BASE + R.VEHICLE]));
      const sag = staticSag(definition),
        ground = track.at(frame[o + F.S], trackPoint());
      expect(definition).toBe(VEHICLES[machine]);
      expect(frame[o + F.Y] - ground.y).toBeCloseTo(definition.bike!.cgHeight, 5);
      expect(frame[o + BIKE_BASE + B.FORK]).toBeCloseTo(sag.fork, 6);
      expect(frame[o + BIKE_BASE + B.SHOCK]).toBeCloseTo(sag.shock, 6);
      for (let wheel = 0; wheel < 4; wheel++)
        expect(frame[o + WHEEL_BASE + wheel * WHEEL_STRIDE + W.RADIUS]).toBeCloseTo(
          wheel < 2 ? definition.bike!.frontWheelRadius : definition.bike!.rearWheelRadius,
          6,
        );
      expect(frame[o + F.LAPS]).toBe(0);
      expect(frame[H.TIME]).toBe(0);
      expect(frame[o + F.SPEED]).toBe(0);
      expect(Array.from(frame).every(Number.isFinite)).toBe(true);
    }
    expect(() => motocrossMenuPreview(track, 'apx01')).toThrow(/motocross machine/);
  });

  it('keeps the new discipline presentation scoped to motocross and supercross', () => {
    expect(motocrossKind('aurel')).toBeNull();
    expect(motocrossKind('kestrel-rx')).toBeNull();
    expect(motocrossSessionTitle(DEFAULT_OPTIONS)).toBeNull();
    expect(motocrossSessionTitle({ ...DEFAULT_OPTIONS, circuit: 'valley-ridge-mx' })).toBe(
      'MOTOCROSS MOTO',
    );
    for (const id of ['valley-ridge-mx', 'arena-nord-sx'] as const) {
      const outline = motocrossLayout(id);
      expect(outline).not.toMatch(/NaN|Infinity|<image|http/);
      expect(outline).toContain(circuitDefinition(id).short);
      expect(outline).toContain('layout outline');
    }
  });

  it('motocross event entry retains real event and meeting actions with relevant rules', () => {
    const event = EVENTS.find((e) => e.circuit === 'valley-ridge-mx' && e.id.endsWith('-moto-1'))!;
    const index = EVENTS.indexOf(event),
      html = eventCard(event, index);
    expect(html).toContain(`data-action="event:${index}"`);
    expect(html).toContain(`data-action="meeting:event:${index}"`);
    expect(html).toContain('Gate drop');
    expect(html).toContain('riders');
    expect(html).not.toContain('DRS');
  });
});
