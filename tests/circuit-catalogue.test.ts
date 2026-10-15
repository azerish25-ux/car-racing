import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { trackGeometryReport } from '../src/simulation/circuit-catalogue/geometry-checks.ts';
import { CATALOGUE_CIRCUIT_IDS } from '../src/simulation/circuit-catalogue/venue-data.ts';
import { AUREL, CIRCUITS, circuitDefinition } from '../src/simulation/circuits.ts';
import { DEFAULT_OPTIONS } from '../src/simulation/config.ts';
import { validateCircuitDefinition } from '../src/simulation/content-validation.ts';
import { EVENTS, eventSession } from '../src/simulation/events.ts';
import { racingLineFor } from '../src/simulation/racing-line.ts';
import {
  CELL_COLS,
  CELL_ROWS,
  SURFACE,
  Track,
  surfaceSample,
  trackPoint,
} from '../src/simulation/track.ts';
import { Simulation } from '../src/simulation/world.ts';
import { CIRCUIT_MENU_LABELS, circuitOptionsHtml } from '../src/ui/circuit-menu.ts';

const tracks = new Map<string, Track>();
const track = (id: string) => {
  let t = tracks.get(id);
  if (!t) tracks.set(id, (t = new Track('clear', false, undefined, circuitDefinition(id))));
  return t;
};

describe('WP29/WP30 circuit catalogue', () => {
  it('registers twenty layouts at twelve new venues in three menu groups', () => {
    expect(CATALOGUE_CIRCUIT_IDS).toHaveLength(20);
    const metas = CATALOGUE_CIRCUIT_IDS.map((id) => CIRCUITS[id].catalogue!);
    const venues = (group: string) =>
      new Set(metas.filter((m) => m.group === group).map((m) => m.venue));
    expect(venues('real-world').size).toBe(6);
    expect(venues('unconventional').size).toBe(6);
    const html = circuitOptionsHtml();
    for (const label of ['Original', 'Real-world approximations', 'Unconventional'])
      expect(html).toContain(`<optgroup label="${label}">`);
    for (const id of CATALOGUE_CIRCUIT_IDS) expect(html).toContain(`value="${id}"`);
  });

  it('builds real-world approximations within 3% of their published lap length', () => {
    for (const id of CATALOGUE_CIRCUIT_IDS) {
      const meta = CIRCUITS[id].catalogue!,
        t = track(id);
      expect(meta.length).toBe(t.length);
      expect(CIRCUIT_MENU_LABELS[id]).toContain(`${(t.length / 1000).toFixed(2)} km`);
      if (meta.group === 'real-world') {
        expect(meta.referenceLength).toBeGreaterThan(2000);
        expect(Math.abs(t.length - meta.referenceLength!) / meta.referenceLength!).toBeLessThan(
          0.03,
        );
      }
      // Authored geometry was close to the reference before scaling.
      expect(meta.authoring.scale).toBeGreaterThan(0.85);
      expect(meta.authoring.scale).toBeLessThan(1.2);
    }
  });

  it('every layout passes definition and geometry validation with a solvable racing line', () => {
    for (const id of CATALOGUE_CIRCUIT_IDS) {
      expect(validateCircuitDefinition(CIRCUITS[id])).toEqual([]);
      const t = track(id),
        report = trackGeometryReport(t);
      expect(report.errors).toEqual([]);
      const line = racingLineFor(t),
        p = trackPoint();
      for (let i = 0; i < line.count; i += 7) {
        t.at(i * line.step, p);
        expect(Math.abs(line.offsets[i])).toBeLessThanOrEqual(p.width);
      }
      // Corners, sectors (thirds) and DRS zones sit on the lap.
      expect(CIRCUITS[id].corners.length).toBeGreaterThanOrEqual(3);
      for (const c of CIRCUITS[id].corners) expect(c.s).toBeLessThan(t.length);
      for (const z of CIRCUITS[id].drsZones)
        for (const s of [z.detect, z.start, z.end]) expect(s).toBeLessThan(t.length);
    }
  });

  it('keeps pit lanes on the venue’s own side with the straight they need', () => {
    for (const id of CATALOGUE_CIRCUIT_IDS) {
      const t = track(id),
        pit = t.pit;
      expect([1, -1]).toContain(pit.side);
      const box = t.at(t.boxS(5), trackPoint());
      expect(Math.sign(t.pitOffset(t.boxS(5)))).toBe(pit.side);
      const lane = t.sample(
        box.x + box.nx * t.pitOffset(box.s),
        box.z + box.nz * t.pitOffset(box.s),
        surfaceSample(),
        box.y,
      );
      expect(lane.surface).toBe(SURFACE.PIT);
    }
    const sides = new Set(CATALOGUE_CIRCUIT_IDS.map((id) => CIRCUITS[id].pit!.side));
    expect(sides).toEqual(new Set([1, -1]));
  });

  it('drives a full AI pit stop into a left-hand street paddock and rejoins', () => {
    const sim = new Simulation({
      ...DEFAULT_OPTIONS,
      circuit: 'riviera',
      mode: 'practice',
      opponents: 0,
    });
    sim.autoPlayer = true;
    const car = sim.cars[0];
    car.place(sim.track, sim.track.length - 600, 0);
    car.pitRequested = true;
    let serviceLateral = 0,
      impact = 0;
    for (let i = 0; i < 120 * 120 && car.pitStops === 0; i++) {
      sim.step(1 / 120);
      if (car.pitPhase === 3) serviceLateral = car.lateral;
      impact = Math.max(impact, car.impact);
    }
    expect(car.pitStops).toBe(1);
    expect(serviceLateral).toBeLessThan(-12);
    for (let i = 0; i < 120 * 30 && car.inPit; i++) sim.step(1 / 120);
    expect(car.inPit).toBe(false);
    expect(car.retired).toBe(false);
    expect(impact).toBeLessThan(0.2);
  }, 120000);

  it('stacks crossing roads as separate layers with bridge headroom', () => {
    for (const id of ['kansai', 'dockyard', 'dockyard-reverse'] as const) {
      const t = track(id),
        crossings = CIRCUITS[id].catalogue!.dressing.crossings;
      expect(crossings).toHaveLength(1);
      const c = crossings[0];
      expect(c.clearance).toBeGreaterThan(6.5);
      const lower = t.at(c.lower, trackPoint()),
        upper = t.at(c.upper, trackPoint());
      const p = trackPoint();
      t.nearest(c.x, c.z, p, lower.y + 0.5);
      expect(Math.abs(p.s - c.lower)).toBeLessThan(3);
      t.nearest(c.x, c.z, p, upper.y + 0.5);
      expect(Math.abs(p.s - c.upper)).toBeLessThan(3);
      expect(t.sample(c.x, c.z, surfaceSample(), lower.y + 0.5).height).toBeLessThan(lower.y + 0.5);
      expect(t.sample(c.x, c.z, surfaceSample(), upper.y + 0.5).height).toBeGreaterThan(
        upper.y - 0.5,
      );
    }
    // The other layouts never cross themselves.
    for (const id of CATALOGUE_CIRCUIT_IDS)
      if (!['kansai', 'dockyard', 'dockyard-reverse'].includes(id))
        expect(CIRCUITS[id].catalogue!.dressing.crossings).toEqual([]);
  });

  it('drives the dockyard flyover and underpass without a progress jump', () => {
    const sim = new Simulation({
      ...DEFAULT_OPTIONS,
      circuit: 'dockyard',
      mode: 'practice',
      opponents: 0,
    });
    sim.autoPlayer = true;
    const car = sim.cars[0],
      L = sim.track.length,
      c = CIRCUITS.dockyard.catalogue!.dressing.crossings[0];
    let previous = car.s,
      jump = 0,
      under = 0,
      over = 0;
    for (let i = 0; i < 120 * 140 && sim.race.laps[0].completed < 1; i++) {
      sim.step(1 / 120);
      const ds = ((car.s - previous + L * 1.5) % L) - L / 2;
      jump = Math.max(jump, Math.abs(ds));
      previous = car.s;
      if (Math.hypot(car.body.position.x - c.x, car.body.position.z - c.z) < 6) {
        if (car.body.position.y < 3) under++;
        else over++;
      }
    }
    expect(sim.race.laps[0].completed).toBe(1);
    expect(jump).toBeLessThan(3);
    expect(under).toBeGreaterThan(0);
    expect(over).toBeGreaterThan(0);
  }, 120000);

  it('banks the oval turns beyond 30 degrees and keeps the banking one road layer', () => {
    const t = track('speedbowl');
    let steepest = 0;
    const p = trackPoint();
    for (let s = 0; s < t.length; s += 5) steepest = Math.max(steepest, Math.abs(t.at(s, p).bank));
    expect((Math.atan(steepest) * 180) / Math.PI).toBeGreaterThan(30);
    // A car high on the banking (6 m above the centreline) keeps its station.
    const turn = CIRCUITS.speedbowl.corners[0].s;
    t.at(turn, p);
    const l = 9,
      x = p.x + p.nx * l,
      z = p.z + p.nz * l,
      y = p.y + p.bank * l;
    expect(y - p.y).toBeGreaterThan(4.5);
    const q = trackPoint();
    expect(t.nearest(x, z, q, y + 0.4)).toBeCloseTo(l, 0);
    expect(Math.abs(q.s - turn)).toBeLessThan(2);
  });

  it('shelters tunnel rows from rain while the open road floods', () => {
    for (const id of ['neon-city', 'neon-city-reverse', 'riviera'] as const) {
      const wet = new Track('rain', false, undefined, CIRCUITS[id]),
        tunnels = CIRCUITS[id].catalogue!.dressing.tunnels;
      expect(tunnels.length).toBeGreaterThan(0);
      const row = (s: number) => Math.floor((s / wet.length) * CELL_ROWS);
      const inside = tunnels[0].from + 15,
        outside = (tunnels[0].from + wet.length / 2) % wet.length;
      expect(wet.isCovered(inside)).toBe(true);
      expect(wet.isCovered(outside)).toBe(false);
      expect(wet.sheltered[row(inside)]).toBe(1);
      const water = (s: number) => {
        let w = 0;
        for (let c = 0; c < CELL_COLS; c++) w += wet.water[row(s) * CELL_COLS + c];
        return w;
      };
      expect(water(inside)).toBe(0);
      expect(water(outside)).toBeGreaterThan(0);
      for (let t = 0; t < 60; t += 0.5) wet.evolve(0.5, t);
      expect(water(inside)).toBe(0);
      expect(water(outside)).toBeGreaterThan(0);
    }
    // Aurel has no roof anywhere: its weather is unchanged.
    expect(track('aurel').sheltered.every((v) => v === 0)).toBe(true);
  });

  it('reads authored run-off and barriers in contact and collision', () => {
    const t = track('riviera'),
      p = t.at(400, trackPoint());
    // Street walls stand 2.6 m beyond the asphalt.
    expect(t.boundaryAt(p, -1)).toBeCloseTo(p.width + 2.6, 1);
    const aurel = new Track(),
      q = aurel.at(400, trackPoint());
    expect(aurel.boundaryAt(q, -1)).toBe(q.width + 11);
    // Northfield: asphalt run-off outside its corners, physics agrees.
    const n = track('northfield'),
      corner = n.circuit.corners.find((c) => c.name === 'VILLAGE')!,
      r = n.at(corner.s, trackPoint()),
      outside = r.curvature < 0 ? 1 : -1,
      l = outside * (r.width + 6);
    expect(n.sample(r.x + r.nx * l, r.z + r.nz * l, surfaceSample(), r.y).surface).toBe(
      SURFACE.ASPHALT,
    );
    expect(AUREL.runoff).toBeUndefined();
  });

  it('references catalogue layouts from built-in events', () => {
    const catalogueEvents = EVENTS.filter((e) =>
      (CATALOGUE_CIRCUIT_IDS as readonly string[]).includes(e.circuit),
    );
    expect(catalogueEvents.length).toBeGreaterThanOrEqual(5);
    for (const event of catalogueEvents)
      expect(() => eventSession(event, DEFAULT_OPTIONS)).not.toThrow();
  });

  it('records a passing seeded AI race on every layout (scripts/catalogue-races.ts)', () => {
    const doc = JSON.parse(readFileSync('docs/circuit-catalogue-races.json', 'utf8')) as {
      reports: { id: string; passed: boolean; lengthM: number; cars: number; laps: number }[];
    };
    for (const id of CATALOGUE_CIRCUIT_IDS) {
      const report = doc.reports.find((r) => r.id === id);
      expect(report, id).toBeDefined();
      expect(report!.passed).toBe(true);
      expect(report!.cars).toBeGreaterThanOrEqual(6);
      expect(report!.lengthM).toBe(Math.round(track(id).length));
    }
  });

  for (const id of ['alpine-pass-reverse', 'speedbowl', 'kansai-east'] as const)
    it(`an AI lap of ${id} stays on the road with valid progress`, () => {
      const sim = new Simulation({
        ...DEFAULT_OPTIONS,
        circuit: id,
        mode: 'practice',
        opponents: 0,
      });
      sim.autoPlayer = true;
      const car = sim.cars[0];
      let off = 0;
      for (let i = 0; i < 120 * 200 && sim.race.laps[0].completed < 1; i++) {
        sim.step(1 / 120);
        if (car.contacts.some((c) => c.surface === SURFACE.GRASS || c.surface === SURFACE.GRAVEL))
          off++;
      }
      expect(sim.race.laps[0].completed).toBe(1);
      expect(car.retired).toBe(false);
      expect(off / 120).toBeLessThan(1);
    }, 120000);
});
