import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { VENUE_THEMES } from '../src/rendering/venue-kit/theme.ts';
import { validateCareerContent } from '../src/career/validation.ts';
import { CATALOGUE_CIRCUIT_IDS } from '../src/simulation/circuit-catalogue/venue-data.ts';
import { CIRCUITS, CIRCUIT_IDS, type CircuitDefinition } from '../src/simulation/circuits.ts';
import { DEFAULT_OPTIONS } from '../src/simulation/config.ts';
import {
  PROTECTED_NAMES,
  validateCircuitDefinition,
} from '../src/simulation/content-validation.ts';
import {
  BIKE_RACE_CLASSES,
  EVENTS,
  RULESETS,
  sessionIncompatibilities,
} from '../src/simulation/events.ts';
import { PHASE } from '../src/simulation/race.ts';
import { Track, trackPoint } from '../src/simulation/track.ts';
import { MARSHAL_RECOVERY, Simulation } from '../src/simulation/world.ts';
import { SESSION_RULES_FIELDS, sessionRulesSummary } from '../src/ui/machine-options.ts';
import { VEHICLES } from '../src/simulation/vehicles.ts';
import { vehicleFamily } from '../src/simulation/bike-definitions.ts';

/** Catalogue wave 2 review: regression checks for each verified finding. */
const tracks = new Map<string, Track>();
const track = (id: keyof typeof CIRCUITS) => {
  let t = tracks.get(id);
  if (!t) tracks.set(id, (t = new Track('clear', false, undefined, CIRCUITS[id])));
  return t;
};
/** Track curvature is positive turning towards +lateral (the right-hand side,
 * where a positive steering command turns): + right, - left. */
const corner = (id: keyof typeof CIRCUITS, name: string) => {
  const c = CIRCUITS[id].corners.find((k) => k.name === name);
  if (!c) throw new Error(`${id}: no corner ${name}`);
  const p = trackPoint();
  track(id).at(c.s, p);
  return { ...p, s: c.s };
};
const json = <T>(path: string) => JSON.parse(readFileSync(path, 'utf8')) as T;

describe('catalogue wave 2 review', () => {
  it('rejects the reference circuits’ own corner names and protected signage', () => {
    const club = CIRCUITS['loirette-club'];
    for (const name of [
      'GARAGE VERT',
      'GARAGE BLEU',
      'CHAPELLE',
      'MUSÉE',
      'RACCORDEMENT',
      'CHEMIN AUX BOEUFS',
      'DUNLOP',
      'SPRUNGHÜGEL',
      'VARIANTE BASSA',
    ]) {
      const renamed: CircuitDefinition = {
        ...club,
        corners: [{ s: club.corners[0].s, name }, ...club.corners.slice(1)],
      };
      expect(validateCircuitDefinition(renamed).join(' '), name).toContain('protected');
    }
    // Trackside signage is player-visible copy too.
    const signed: CircuitDefinition = {
      ...club,
      catalogue: { ...club.catalogue!, signage: 'NURBURGRING' },
    };
    expect(validateCircuitDefinition(signed).join(' ')).toContain('"NURBURGRING"');
    // No layout, corner, signage or theme default carries a protected name.
    const pattern = new RegExp(
      `(^|[^a-z0-9])(${PROTECTED_NAMES.map((n) => n.replace(/[-.]/g, '\\$&')).join('|')})([^a-z0-9]|$)`,
      'i',
    );
    for (const id of CATALOGUE_CIRCUIT_IDS) {
      const def = CIRCUITS[id];
      for (const text of [def.catalogue!.signage ?? '', ...def.corners.map((c) => c.name)])
        expect(pattern.test(text), `${id}: ${text}`).toBe(false);
    }
    for (const [theme, style] of Object.entries(VENUE_THEMES))
      expect(pattern.test(style.sponsor), theme).toBe(false);
  });

  it('banks the dunes circuit’s bowl as a left hairpin, outside edge raised', () => {
    const bowl = corner('duinwijk', 'KUIPBOCHT'),
      final = corner('duinwijk', 'DUINBOCHT'),
      first = corner('duinwijk', 'HAARSPELD');
    expect(first.curvature).toBeGreaterThan(0); // right hairpin
    expect(bowl.curvature).toBeLessThan(0); // left
    // Outside of a left turn is the right-hand (+lateral) edge: 19 degrees.
    expect(bowl.bank).toBeGreaterThan(Math.tan((17 * Math.PI) / 180));
    expect(final.curvature).toBeGreaterThan(0); // banked final right
    expect(final.bank).toBeLessThan(-Math.tan((16 * Math.PI) / 180));
    expect(CIRCUITS.duinwijk.catalogue!.description).toContain('19-degree banked left');
  });

  it('gives the desert night circuit its downhill double left', () => {
    const corners = CIRCUITS['ramla-night'].corners.map((c) => c.name),
      at = corners.indexOf('QAMAR');
    expect(corners[at + 1]).toBe('HILAL');
    const first = corner('ramla-night', 'QAMAR'),
      second = corner('ramla-night', 'HILAL');
    expect(first.curvature).toBeLessThan(0);
    expect(second.curvature).toBeLessThan(0);
    // Every sample between them turns left or runs straight: no right between.
    const t = track('ramla-night'),
      p = trackPoint();
    for (let s = first.s; s < second.s; s += 5) {
      t.at(s, p);
      expect(p.curvature, `s ${s}`).toBeLessThan(1 / 400);
    }
    expect(second.y).toBeLessThan(first.y - 2); // downhill
    expect(CIRCUITS['ramla-night'].catalogue!.description).toContain('downhill double left');
  });

  it('describes the club circuit’s hairpins as one right and one left', () => {
    expect(corner('loirette-club', 'PIGEONNIER').curvature).toBeGreaterThan(1 / 45);
    expect(corner('loirette-club', 'ALLÉE DES CHÊNES').curvature).toBeLessThan(-1 / 45);
    expect(CIRCUITS['loirette-club'].catalogue!.description).toContain(
      'a slow right and a slow left hairpin',
    );
  });

  it('keeps the forest ring grid level enough that held cars do not roll', () => {
    const t = track('hochwald'),
      pit = CIRCUITS.hochwald.pit!,
      p = trackPoint();
    for (let row = 0; row < 12; row++) {
      t.at(t.length - pit.gridStart - row * pit.gridRow, p);
      expect(Math.abs(p.gradient), `row ${row}`).toBeLessThan(0.015);
    }
    // The default Formula field holds its grid through the lights.
    const sim = new Simulation({ ...DEFAULT_OPTIONS, circuit: 'hochwald', mode: 'race' });
    sim.autoPlayer = true;
    while (sim.race.phase !== PHASE.RACING) sim.step(1 / 120);
    expect(sim.race.laps.map((l) => l.penalty)).toEqual(sim.race.laps.map(() => 0));
  }, 120000);

  /** A car nosed into the forest ring's armco on its 3.5 m verge, where the
   * multi-class event's GT car wedged (seed 30107, s 3226 m). */
  const wedged = () => {
    const sim = new Simulation({
      ...DEFAULT_OPTIONS,
      circuit: 'hochwald',
      mode: 'practice',
      opponents: 0,
      vehicles: ['gt6r'],
    });
    sim.autoPlayer = true;
    const car = sim.cars[0];
    car.place(sim.track, 3226, 6.1);
    const p = car.trackPosition;
    // Facing the +lateral barrier, square to the road.
    car.body.orientation.yaw(Math.atan2(p.tz, -p.tx));
    return { sim, car };
  };
  it('backs a wedged car out and rejoins without marshal help', () => {
    const { sim, car } = wedged();
    const decisions = new Set<string>();
    let travelled = 0,
      last = car.s;
    for (let tick = 0; tick < 45 * 120; tick++) {
      sim.step(1 / 120);
      decisions.add(sim.ai[0].decision);
      const d = car.s - last;
      if (Math.abs(d) < 50) travelled += d;
      last = car.s;
    }
    expect(decisions.has('RECOVERY')).toBe(true);
    expect(sim.recoveries[0]).toBe(0);
    expect(car.gear).toBeGreaterThan(0); // never left driving backwards
    expect(travelled).toBeGreaterThan(150);
  }, 120000);

  it('has marshals recover a car that cannot get going, and leaves a parked one', () => {
    const { sim, car } = wedged();
    // Asking for drive yet pinned (throttle against the brake): it never moves.
    sim.ai[0].update = () => {
      car.input.throttle = 1;
      car.input.brake = 1;
      car.input.steer = 0;
      car.input.reverse = false;
    };
    for (let tick = 0; tick < (MARSHAL_RECOVERY.seconds + 2) * 120; tick++) sim.step(1 / 120);
    expect(sim.recoveries[0]).toBe(1);
    expect(Math.abs(car.lateral)).toBeLessThanOrEqual(car.trackPosition.width);
    expect(sim.race.control.events.some((e) => e.code === 'CAR_RECOVERED')).toBe(true);
    // A car parked without asking for drive (a retired fixture) stays put.
    const parked = wedged();
    parked.sim.ai[0].update = () => {
      parked.car.input.throttle = 0;
      parked.car.input.brake = 1;
    };
    for (let tick = 0; tick < (MARSHAL_RECOVERY.seconds + 5) * 120; tick++)
      parked.sim.step(1 / 120);
    expect(parked.sim.recoveries[0]).toBe(0);
  }, 120000);

  it('runs both endurance events to the flag with every car classified', () => {
    const doc = json<{
      reports: {
        event: string;
        passed: boolean;
        marshalRecoveries: number;
        classification: { retired: boolean; finishTime: number }[];
      }[];
    }>('docs/endurance-event-races.json');
    for (const id of ['hochwald-multi-class', 'loirette-dusk-endurance', 'kansai-endurance']) {
      const report = doc.reports.find((r) => r.event === id);
      expect(report, id).toBeDefined();
      expect(report!.passed, id).toBe(true);
      expect(report!.marshalRecoveries, id).toBe(0);
      for (const c of report!.classification) {
        expect(c.retired, id).toBe(false);
        expect(c.finishTime, id).toBeGreaterThan(0);
      }
    }
  });

  it('clears each motorcycle class only where its seeded race passes', () => {
    const doc = json<{
      passed: boolean;
      cleared: Record<string, string[]>;
      results: { circuit: string; class: string; passed: boolean }[];
    }>('docs/bike-clearance.json');
    expect(doc.passed).toBe(true);
    const flagged = CIRCUIT_IDS.filter((id) => CIRCUITS[id].bikeSafe);
    expect(flagged.length).toBeGreaterThanOrEqual(16);
    for (const id of flagged) {
      // Every class was raced here, and exactly the passing ones are declared.
      for (const cls of BIKE_RACE_CLASSES)
        expect(
          doc.results.some((r) => r.circuit === id && r.class === cls),
          `${id} ${cls}`,
        ).toBe(true);
      expect([...(CIRCUITS[id].bikeClasses ?? [])].sort(), id).toEqual([...doc.cleared[id]].sort());
      expect(CIRCUITS[id].bikeClasses!.length, id).toBeGreaterThan(0);
    }
    // The classic class is refused where it falls (the hairpin circuits)...
    const sprint = {
      ...DEFAULT_OPTIONS,
      mode: 'race' as const,
      ruleset: 'motorcycle-class-sprint',
      opponents: 1,
    };
    for (const circuit of ['ardennes', 'kansai', 'texas-hill'] as const) {
      expect(CIRCUITS[circuit].bikeClasses).not.toContain('classic-bike');
      expect(
        sessionIncompatibilities({ ...sprint, circuit, vehicles: ['cr750', 'cr750'] }).join(' '),
        circuit,
      ).toContain('not cleared');
      // ...while the modern classes race there.
      expect(
        sessionIncompatibilities({ ...sprint, circuit, vehicles: ['ss600', 'ss600'] }),
        circuit,
      ).toEqual([]);
    }
    // The career only offers what loads (every open event passes eventSession).
    expect(validateCareerContent()).toEqual([]);
  });

  it('races every built-in motorcycle event in the seeded bike evidence', () => {
    const doc = json<{
      passed: boolean;
      races: { event?: string; crashes: number[]; finishTimes: number[] }[];
    }>('docs/bike-race.json');
    expect(doc.passed).toBe(true);
    // Road-racing motorcycle events; off-road motos have their own evidence
    // (docs/offroad-races.json, npm run test:offroad).
    const bikeEvents = EVENTS.filter(
      (e) =>
        !CIRCUITS[e.circuit].offroad &&
        [e.vehicles].flat().some((id) => vehicleFamily(VEHICLES[id]) === 'bike'),
    );
    expect(bikeEvents.length).toBeGreaterThanOrEqual(11);
    for (const e of bikeEvents) {
      const race = doc.races.find((r) => r.event === e.id);
      expect(race, e.id).toBeDefined();
      expect(
        race!.crashes.reduce((a, b) => a + b, 0),
        e.id,
      ).toBeLessThanOrEqual(6);
      expect(
        race!.finishTimes.every((t) => t > 0),
        e.id,
      ).toBe(true);
      // Each event's class is cleared on its circuit.
      for (const id of [e.vehicles].flat())
        expect(CIRCUITS[e.circuit].bikeClasses, e.id).toContain(VEHICLES[id].classId);
    }
  });

  it('previews the rules for the selected circuit, not the default one', () => {
    expect(SESSION_RULES_FIELDS).toContain('circuit');
    const gp = {
      mode: 'race' as const,
      opponents: 7,
      compound: 'medium' as const,
      vehicle: 'gpr1',
    };
    const street = sessionRulesSummary({ ...gp, circuit: 'riviera' });
    expect(street).toMatch(/^Unavailable: .*bike-safe/);
    expect(sessionRulesSummary({ ...gp, circuit: 'poggio-alto' })).toMatch(
      new RegExp(`^${RULESETS['gp-motorcycle'].name}: `),
    );
    expect(sessionRulesSummary({ ...gp, vehicle: 'cr750', circuit: 'ardennes' })).toMatch(
      /^Unavailable: .*not cleared/,
    );
  });
});
