import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  disciplineStatus,
  disciplineVenues,
  liveRegistry,
  venueCaveat,
} from '../src/career/registry.ts';
import { trackSamplesFor } from '../src/simulation/circuit-catalogue/builder.ts';
import {
  BIKE_SAFETY,
  bikeSafetyReport,
  trackGeometryReport,
} from '../src/simulation/circuit-catalogue/geometry-checks.ts';
import { CATALOGUE_CIRCUIT_IDS } from '../src/simulation/circuit-catalogue/venue-data.ts';
import { CIRCUITS, CIRCUIT_IDS, type CircuitId } from '../src/simulation/circuits.ts';
import { DEFAULT_OPTIONS } from '../src/simulation/config.ts';
import { validateCircuitDefinition } from '../src/simulation/content-validation.ts';
import {
  EVENTS,
  RULESETS,
  eventSession,
  sessionIncompatibilities,
} from '../src/simulation/events.ts';
import { Track, trackPoint } from '../src/simulation/track.ts';
import { VEHICLES } from '../src/simulation/vehicles.ts';
import { vehicleFamily } from '../src/simulation/bike-definitions.ts';

/** Catalogue wave 2: twenty layouts at seventeen venues. */
const WAVE_TWO = Object.freeze([
  'poggio-alto',
  'cape-wrenna',
  'haarveld',
  'montejaral',
  'hochwald',
  'loirette',
  'loirette-club',
  'serra-verde',
  'mount-ardlow',
  'arroyo-oro',
  'fiume-verde',
  'duinwijk',
  'ramla-night',
  'ramla-outer',
  'mirvari',
  'lantern-bay',
  'lotus-hill',
  'gantry-point',
  'gantry-point-reverse',
  'salt-flat',
] as const);
const tracks = new Map<string, Track>();
const track = (id: string) => {
  let t = tracks.get(id);
  if (!t) tracks.set(id, (t = new Track('clear', false, undefined, CIRCUITS[id as CircuitId])));
  return t;
};
const ridden = (vehicles: EventDefinitionVehicles) =>
  (typeof vehicles === 'string' ? [vehicles] : vehicles).some(
    (id) => vehicleFamily(VEHICLES[id]) === 'bike',
  );
type EventDefinitionVehicles = (typeof EVENTS)[number]['vehicles'];

describe('catalogue wave 2', () => {
  it('appends twenty layouts at seventeen venues after the first twenty', () => {
    expect(CATALOGUE_CIRCUIT_IDS.slice(20, 40)).toEqual(WAVE_TWO);
    const venues = new Set(WAVE_TWO.map((id) => CIRCUITS[id].catalogue!.venue));
    expect(venues.size).toBe(17);
    // Every wave-2 layout has a corner list, a pit, DRS and a venue theme.
    for (const id of WAVE_TWO) {
      const def = CIRCUITS[id];
      expect(def.corners.length, id).toBeGreaterThanOrEqual(7);
      expect(def.drsZones.length, id).toBeGreaterThanOrEqual(1);
      expect([1, -1]).toContain(def.pit!.side);
      expect(validateCircuitDefinition(def), id).toEqual([]);
    }
  });

  it('builds the 20.8 km forest ring and 13.6 km endurance circuit with dense sampling', () => {
    for (const [id, reference] of [
      ['hochwald', 20832],
      ['loirette', 13626],
    ] as const) {
      const def = CIRCUITS[id],
        t = track(id);
      expect(Math.abs(t.length - reference) / reference).toBeLessThan(0.03);
      expect(def.samples).toBe(trackSamplesFor(reference));
      expect(t.points.length - 1).toBe(def.samples);
      // About 4.5 m between Track samples, at least 3 samples per control point.
      expect(t.length / def.samples!).toBeLessThan(4.6);
      expect(def.design.length * 3).toBeLessThanOrEqual(def.samples!);
      expect(def.catalogue!.dayNight).toBe(true);
      expect(trackGeometryReport(t).errors).toEqual([]);
    }
    // Wave-1 layouts keep Track's standard construction.
    expect(trackSamplesFor(7276)).toBe(1536);
    for (const id of CATALOGUE_CIRCUIT_IDS.slice(0, 20))
      expect(CIRCUITS[id].samples).toBeUndefined();
    // The forest ring falls ~270 m and climbs back; grades stay drivable.
    const ring = track('hochwald'),
      p = trackPoint();
    let low = Infinity,
      high = -Infinity;
    for (let s = 0; s < ring.length; s += 10) {
      ring.at(s, p);
      low = Math.min(low, p.y);
      high = Math.max(high, p.y);
    }
    expect(high - low).toBeGreaterThan(250);
    expect(trackGeometryReport(ring).maximumGradient).toBeLessThan(0.12);
  }, 120000);

  it('measures every bike-safe circuit and keeps walled street circuits off the list', () => {
    const flagged = CIRCUIT_IDS.filter((id) => CIRCUITS[id].bikeSafe);
    for (const id of [
      'aurel',
      'vellamar',
      'parco-reale',
      'northfield',
      'kansai',
      'texas-hill',
      'poggio-alto',
      'cape-wrenna',
      'haarveld',
      'montejaral',
      'loirette-club',
      'arroyo-oro',
      'fiume-verde',
    ])
      expect(flagged, id).toContain(id);
    for (const id of flagged) {
      const report = bikeSafetyReport(track(id));
      expect(report.errors, id).toEqual([]);
      expect(report.minimumCornerBarrier, id).toBeGreaterThanOrEqual(
        BIKE_SAFETY.cornerBarrier - 1e-6,
      );
      expect(report.maximumKerbHeight, id).toBeLessThanOrEqual(BIKE_SAFETY.kerbHeight);
    }
    // Streets, walls and tunnels fail the same measurement.
    for (const id of ['riviera', 'mirvari', 'lantern-bay', 'lotus-hill', 'hochwald'] as const) {
      expect(CIRCUITS[id].bikeSafe).toBeFalsy();
      expect(bikeSafetyReport(track(id)).errors.length, id).toBeGreaterThan(0);
    }
  }, 120000);

  it('races motorcycles only on bike-safe circuits (rulesets and career)', () => {
    for (const ruleset of ['gp-motorcycle', 'motorcycle-class-sprint'])
      expect(RULESETS[ruleset].bikeSafeCircuits).toBe(true);
    const race = {
      ...DEFAULT_OPTIONS,
      mode: 'race' as const,
      ruleset: 'gp-motorcycle',
      opponents: 1,
      vehicles: ['gpr1', 'gpr1'],
    };
    expect(sessionIncompatibilities({ ...race, circuit: 'poggio-alto' })).toEqual([]);
    expect(sessionIncompatibilities({ ...race, circuit: 'riviera' }).join(' ')).toContain(
      'bike-safe',
    );
    // Practice is not a motorcycle race: any paved circuit stays open.
    expect(
      sessionIncompatibilities({
        ...race,
        mode: 'practice',
        ruleset: 'open-practice',
        circuit: 'riviera',
      }),
    ).toEqual([]);
    // Every built-in road-racing motorcycle event is on a bike-safe circuit
    // (off-road motos run on terrain venues under their own formats).
    const bikeEvents = EVENTS.filter((e) => ridden(e.vehicles) && !CIRCUITS[e.circuit].offroad);
    expect(bikeEvents.length).toBeGreaterThanOrEqual(10);
    for (const event of bikeEvents) expect(CIRCUITS[event.circuit].bikeSafe, event.id).toBe(true);
    // The bike career reads the flag: only assessed circuits, no caveat.
    const live = liveRegistry(),
      venues = disciplineVenues(live, 'road-bikes').map((v) => v.id);
    expect(venueCaveat(live, 'road-bikes')).toBeNull();
    expect(venues).toContain('poggio-alto');
    expect(venues).toContain('aurel');
    expect(venues).not.toContain('riviera');
    expect(venues).not.toContain('lantern-bay');
    expect(disciplineVenues(live, 'circuit-cars').map((v) => v.id)).toContain('riviera');
    expect(disciplineStatus(live, 'road-bikes').state).toBe('open');
  });

  it('dresses the container terminal with crane gantries and the endurance venues for night', () => {
    const port = CIRCUITS['gantry-point'].catalogue!;
    expect(port.night).toBe(true);
    expect(port.dressing.gantries.length).toBeGreaterThan(0);
    expect(port.dressing.crossings).toHaveLength(1);
    expect(port.dressing.crossings[0].clearance).toBeGreaterThan(6.5);
    for (const id of ['ramla-night', 'ramla-outer', 'lantern-bay'] as const)
      expect(CIRCUITS[id].catalogue!.night).toBe(true);
    for (const id of ['hochwald', 'loirette', 'loirette-club'] as const)
      expect(CIRCUITS[id].catalogue!.dayNight).toBe(true);
    // Wave-1 venues gain the new fields with their old behaviour.
    for (const id of CATALOGUE_CIRCUIT_IDS.slice(0, 20)) {
      expect(CIRCUITS[id].catalogue!.dayNight).toBe(false);
      expect(CIRCUITS[id].catalogue!.dressing.gantries).toEqual([]);
    }
  });

  it('gives every wave-2 layout an event and a passing seeded AI race', () => {
    for (const id of WAVE_TWO) {
      if (id === 'gantry-point-reverse') continue;
      const events = EVENTS.filter((e) => e.circuit === id);
      expect(events.length, id).toBeGreaterThanOrEqual(1);
      for (const event of events) expect(() => eventSession(event, DEFAULT_OPTIONS)).not.toThrow();
    }
    const doc = JSON.parse(readFileSync('docs/circuit-catalogue-races.json', 'utf8')) as {
      reports: { id: string; passed: boolean; lengthM: number; bestLapS: number }[];
    };
    for (const id of WAVE_TWO) {
      const report = doc.reports.find((r) => r.id === id);
      expect(report, id).toBeDefined();
      expect(report!.passed, id).toBe(true);
      expect(report!.lengthM).toBe(Math.round(track(id).length));
    }
  });
});
