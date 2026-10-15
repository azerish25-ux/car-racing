import { describe, expect, it } from 'vitest';
import { mod } from '../src/core/math.ts';
import { InputLog, Resimulation } from '../src/core/flashback.ts';
import { circuitDefinition } from '../src/simulation/circuits.ts';
import {
  DEFAULT_OPTIONS,
  DEFAULT_SETUP,
  controls,
  validateOptions,
  type SessionOptions,
} from '../src/simulation/config.ts';
import {
  validateCircuitDefinition,
  validateCircuitGeometry,
} from '../src/simulation/content-validation.ts';
import { eventSession, sessionIncompatibilities } from '../src/simulation/events.ts';
import { jumpHoldSpeed, ROLL_SPEED } from '../src/simulation/offroad/ai.ts';
import { TrackTerrainSurface } from '../src/simulation/offroad/course-terrain.ts';
import { DIRT_BIKES } from '../src/simulation/offroad/dirt-bikes.ts';
import {
  combineMotos,
  MOTO_POINTS,
  OFFROAD_EVENTS,
  pickGates,
} from '../src/simulation/offroad/formats.ts';
import {
  jumpRun,
  rideLine,
  rigBike,
  rigTrack,
  rollRun,
  standingStart,
} from '../src/simulation/offroad/jump-rig.ts';
import { DirtBikeVehicle } from '../src/simulation/offroad/dirt-bike-vehicle.ts';
import { flightDistance, takeoffSpeed } from '../src/simulation/offroad/profile.ts';
import { GATE_DROP_SECONDS, gateSlots } from '../src/simulation/offroad/session.ts';
import { OFFROAD_CIRCUITS, offroadCourse, venueAdmits } from '../src/simulation/offroad/venues.ts';
import { CAR_STRIDE, H, HEADER, O, OFFROAD_BASE, carBase } from '../src/simulation/protocol.ts';
import { PHASE } from '../src/simulation/race.ts';
import { MATERIAL } from '../src/simulation/surface-material.ts';
import { makeTire, peakGrip } from '../src/simulation/tire.ts';
import { SURFACE, surfaceSample, Track, trackPoint } from '../src/simulation/track.ts';
import { StartGate } from '../src/rendering/offroad/start-gate.ts';
import { machineOptions } from '../src/ui/machine-options.ts';
import { Simulation } from '../src/simulation/world.ts';
import { TerrainView } from '../src/rendering/offroad/terrain-view.ts';
import { disciplineEvents, disciplineTiers, licenceAvailability } from '../src/career/ladder.ts';
import { disciplineStatus, liveRegistry } from '../src/career/registry.ts';
import { newCareer } from '../src/career/save.ts';

const MX = DIRT_BIKES.mx450;
const jump = (venue: 'valley-ridge-mx' | 'arena-nord-sx', name: string) =>
  offroadCourse(circuitDefinition(venue))!.jumps.find((j) => j.name === name)!;
const session = (over: Partial<SessionOptions>): SessionOptions => ({
  ...DEFAULT_OPTIONS,
  mode: 'race',
  laps: 2,
  seed: 51007,
  ...over,
});
function runUntil(sim: Simulation, done: () => boolean, seconds: number) {
  for (let i = 0; i < seconds * 120 && !done(); i++) sim.step(1 / 120);
}

describe('WP37 dirt-bike jump ballistics and landing', () => {
  it('inverts the ballistic take-off speed and flight distance', () => {
    for (const [distance, drop, angle] of [
      [12, 0.6, 0.48],
      [18, -0.4, 0.52],
      [8, 1, 0.42],
    ]) {
      const v = takeoffSpeed(distance, drop, angle);
      expect(flightDistance(v, drop, angle)).toBeCloseTo(distance, 6);
    }
    // A landing above the launch line is unreachable.
    expect(takeoffSpeed(5, -10, 0.2)).toBeNaN();
  });
  it('flies the ballistic distance at the AI hold speed and lands on the face', () => {
    for (const name of ['RIDGE TABLE', 'BARN DOUBLE', 'VALLEY DOUBLE']) {
      const j = jump('valley-ridge-mx', name),
        r = jumpRun(MX, 'valley-ridge-mx', j, jumpHoldSpeed(j));
      expect(r.flew, name).toBe(true);
      expect(r.crashes, name).toBe(0);
      expect(['clean', 'bottomed'], name).toContain(r.outcome);
      const ballistic = flightDistance(r.takeoffSpeed, j.lipHeight - j.landingHeight, j.lipAngle);
      expect(r.distance / ballistic, name).toBeGreaterThan(0.8);
      expect(r.distance / ballistic, name).toBeLessThan(1.2);
    }
  });
  it('crashes casing a triple short and overshooting it long', () => {
    const j = jump('valley-ridge-mx', 'SKY TRIPLE'),
      hold = jumpHoldSpeed(j);
    const short = jumpRun(MX, 'valley-ridge-mx', j, hold - 1.8),
      long = jumpRun(MX, 'valley-ridge-mx', j, hold + 2.6);
    expect(short.outcome.startsWith('crash')).toBe(true);
    expect(long.outcome.startsWith('crash')).toBe(true);
    // The overshoot bottoms the suspension on the flat beyond the landing.
    expect(long.bottomSpeed).toBeGreaterThan(MX.bike!.offroad!.bottomOutSpeed);
  });
  it('rolls a gap jump at walking pace down into the gap and out past its end', () => {
    for (const name of ['BARN DOUBLE', 'SKY TRIPLE']) {
      const j = jump('valley-ridge-mx', name),
        r = rollRun(MX, 'valley-ridge-mx', j, ROLL_SPEED);
      expect(r.crashes, name).toBe(0);
      expect(r.passed, name).toBe(true);
      expect(mod(r.endS - j.end, rigTrack('valley-ridge-mx').length), name).toBeLessThan(10);
    }
    // The rig rides the ground with the rear brake (the air pitch aid's) off.
    const track = rigTrack('valley-ridge-mx'),
      bike = rigBike(MX, track, 100, 8);
    bike.input.clutch = 1;
    rideLine(bike, track, 8);
    expect(bike.input.clutch).toBe(0);
  });
  it('covers 60 m from the gate on hard-packed dirt in a motocross time', () => {
    const r = standingStart(MX, 'valley-ridge-mx', 60);
    expect(r.crashes).toBe(0);
    expect(r.seconds).toBeGreaterThan(3.4);
    expect(r.seconds).toBeLessThan(5.4);
  });
});

describe('WP38 deformable course terrain', () => {
  it('ruts deepen where a wheel passes, firm up the line and never deform asphalt', () => {
    const track = rigTrack('valley-ridge-mx'),
      t = (Track.offroadOf(track) as TrackTerrainSurface).terrain;
    t.reset();
    const s = 300.25,
      lateral = 1.1,
      before = t.contact(lateral, s, {} as never);
    for (let i = 0; i < 240; i++) t.deform(lateral, s, 1800, 0.3, 1 / 120);
    const after = t.contact(lateral, s, {} as never);
    expect(t.depthAt(lateral, s)).toBeGreaterThan(0.004);
    expect(after.height).toBeLessThan(before.height);
    expect(after.compaction).toBeGreaterThan(before.compaction);
    // The rut is wider than one cell: the neighbours sink, less.
    expect(t.depthAt(lateral + 0.25, s)).toBeGreaterThan(0);
    expect(t.depthAt(lateral + 0.25, s)).toBeLessThan(t.depthAt(lateral, s));
    const rx = (Track.offroadOf(rigTrack('kestrel-rx')) as TrackTerrainSurface).terrain,
      course = offroadCourse(circuitDefinition('kestrel-rx'))!,
      paved = course.spec.zones.find((z) => z.soil === 'asphalt')!;
    rx.reset();
    const at = paved.from + 5;
    for (let i = 0; i < 120; i++) rx.deform(0, at, 4000, 0.5, 1 / 120);
    expect(rx.depthAt(0, at)).toBe(0);
    t.reset();
    expect(t.stats().cells).toBe(0);
  });
  it('is deterministic run to run and identical after a re-simulation', () => {
    const options = session({
      circuit: 'valley-ridge-mx',
      ruleset: 'motocross-moto',
      opponents: 3,
      vehicles: Array(4).fill('mx450'),
    });
    const run = () => {
      const sim = new Simulation(options);
      sim.autoPlayer = true;
      runUntil(sim, () => false, 16);
      return sim;
    };
    const a = run(),
      b = run();
    expect(a.offroad!.terrain.stats().cells).toBeGreaterThan(50);
    expect(a.offroad!.terrain.hash()).toBe(b.offroad!.terrain.hash());
    // The flashback path: the input journal re-simulated to the same tick.
    const log = new InputLog();
    log.autopilot(0, true);
    const job = new Resimulation(options, log.entries, a.tick);
    while (!job.run()) void 0;
    expect(job.simulation.tick).toBe(a.tick);
    expect(job.simulation.offroad!.terrain.hash()).toBe(a.offroad!.terrain.hash());
    // A new session on the same venue starts on prepared ground.
    const fresh = new Simulation(options);
    expect(fresh.offroad!.terrain.stats().cells).toBe(0);
  });
});

describe('WP39 off-road venues', () => {
  it('builds four valid venues with surveyed features and admits the right machines', () => {
    expect(Object.keys(OFFROAD_CIRCUITS)).toEqual([
      'valley-ridge-mx',
      'arena-nord-sx',
      'kestrel-rx',
      'pinewood-stage',
    ]);
    for (const def of Object.values(OFFROAD_CIRCUITS)) {
      expect(validateCircuitDefinition(def), def.id).toEqual([]);
      expect(validateCircuitGeometry(def), def.id).toEqual([]);
    }
    const mx = offroadCourse(OFFROAD_CIRCUITS['valley-ridge-mx'])!;
    expect(mx.jumps.map((j) => j.kind)).toEqual(
      expect.arrayContaining(['tabletop', 'double', 'triple', 'kicker']),
    );
    expect(mx.rough.length).toBeGreaterThan(0);
    expect(mx.spec.berms.length).toBeGreaterThan(3);
    expect(mx.spec.gate).toBeTruthy();
    const sx = offroadCourse(OFFROAD_CIRCUITS['arena-nord-sx'])!;
    expect(sx.spec.indoor).toBe(true);
    expect(sx.jumps.filter((j) => j.kind === 'triple').length).toBeGreaterThanOrEqual(2);
    const rx = offroadCourse(OFFROAD_CIRCUITS['kestrel-rx'])!;
    expect(rx.spec.joker).toBeTruthy();
    expect(rx.spec.zones.some((z) => z.soil === 'asphalt')).toBe(true);
    const stage = offroadCourse(OFFROAD_CIRCUITS['pinewood-stage'])!;
    expect(stage.spec.stage!.splits.length).toBe(2);
    expect(venueAdmits(OFFROAD_CIRCUITS['valley-ridge-mx'], 'motocross')).toBe(true);
    expect(venueAdmits(OFFROAD_CIRCUITS['valley-ridge-mx'], 'rallycross')).toBe(false);
    expect(venueAdmits(OFFROAD_CIRCUITS['kestrel-rx'], 'rallycross')).toBe(true);
    expect(venueAdmits(OFFROAD_CIRCUITS['kestrel-rx'], 'motocross')).toBe(false);
    for (const e of OFFROAD_EVENTS)
      expect(() => eventSession(e, DEFAULT_OPTIONS), e.id).not.toThrow();
    expect(
      sessionIncompatibilities(
        session({
          circuit: 'valley-ridge-mx',
          ruleset: 'rallycross-joker',
          opponents: 0,
          vehicles: ['rcx6'],
        }),
      ).length,
    ).toBeGreaterThan(0);
  });
});

describe('WP42 off-road formats', () => {
  it('pays moto points, combines two motos and picks gates in qualifying order', () => {
    expect(MOTO_POINTS.slice(0, 5)).toEqual([25, 22, 20, 18, 16]);
    const overall = combineMotos([
      { order: [1, 2, 3], finished: [1, 2, 3] },
      { order: [2, 1, 3], finished: [2, 1, 3] },
    ]);
    // 1 and 2 tie on 47; the better result in the last moto wins.
    expect(overall.map((r) => [r.id, r.total, r.overall])).toEqual([
      [2, 47, 1],
      [1, 47, 2],
      [3, 40, 3],
    ]);
    const dnf = combineMotos([{ order: [5, 6], finished: [6] }]);
    expect(dnf.find((r) => r.id === 5)!.total).toBe(0);
    const slots = pickGates([7, 3, 9], [4, 5, 3, 6]);
    expect([slots.get(7), slots.get(3), slots.get(9)]).toEqual([4, 5, 3]);
    expect(() => pickGates([1, 2], [0])).toThrow();
  });
  it('holds the field at the gate, releases it together and flags a jump start', () => {
    const sim = new Simulation(
      session({
        circuit: 'valley-ridge-mx',
        ruleset: 'motocross-moto',
        opponents: 3,
        vehicles: Array(4).fill('mx450'),
      }),
    );
    const s = sim.offroad!;
    const slots = s.entrants.map((e) => e.slot);
    expect(new Set(slots).size).toBe(4);
    // The player revs into the gate while it is still up: a jump start.
    sim.setInput({ ...controls(), throttle: 1 });
    runUntil(sim, () => sim.race.phase === PHASE.RACING, 12);
    expect(s.entrants[0].jumped).toBe(true);
    // One judge: the format's penalty, not the lights check's on top.
    expect(sim.race.laps[0].penalty).toBe(s.format!.jumpStartPenalty);
    expect(sim.race.laps[0].jumped).toBe(true);
    const frame = new Float32Array(HEADER + sim.cars.length * CAR_STRIDE);
    sim.writeFrame(frame, 0, 0);
    expect(frame[carBase(0) + OFFROAD_BASE + O.START]).toBe(3);
    // The AI were held to the drop and leave together; none jumped.
    const at = sim.cars.map((c) => c.s);
    runUntil(sim, () => sim.race.time > sim.race.greenAt + GATE_DROP_SECONDS + 1.5, 4);
    for (let id = 1; id < 4; id++) {
      expect(s.entrants[id].jumped).toBe(false);
      expect(mod(sim.cars[id].s - at[id], sim.track.length)).toBeGreaterThan(2);
    }
    runUntil(sim, () => s.holeshot >= 0, 20);
    expect(s.holeshot).toBeGreaterThanOrEqual(0);
  });
  it('counts the joker only through all three checkpoints on the joker road', () => {
    const sim = new Simulation(
      session({
        circuit: 'kestrel-rx',
        ruleset: 'rallycross-joker',
        opponents: 1,
        vehicles: ['rcx6', 'rcx6'],
      }),
    );
    const s = sim.offroad!,
      course = s.course,
      L = sim.track.length,
      lines = s.jokerLines();
    runUntil(
      sim,
      () => sim.race.phase === PHASE.RACING && sim.race.time > sim.race.greenAt + 1,
      12,
    );
    const drive = (id: number, line: number, lateral: number) => {
      sim.cars[id].place(sim.track, mod(line - 2, L), lateral);
      for (let i = 0; i < 120; i++) sim.step(1 / 120);
    };
    // A token wide line at the apex is not the joker road: the roads are
    // apart there (an island between them), and it is outside the track.
    const p = trackPoint();
    sim.track.at(lines[1], p);
    const edge = p.width + 0.8;
    expect(course.onJoker(lines[1], -(edge + 0.7))).toBe(false);
    expect(course.legalWidth(p.width, lines[1], -(edge + 0.7))).toBeLessThan(edge + 0.7);
    const joker = course.spec.joker!,
      inner = Math.abs(course.jokerCentre(lines[1])!) - joker.halfWidth,
      relief = { h: 0, ds: 0, dl: 0 };
    expect(inner - edge).toBeGreaterThan(1.6);
    course.relief(lines[1], joker.side * (edge + inner) * 0.5, p, relief);
    expect(relief.h).toBeGreaterThan(0.15);
    // The midpoint alone on the joker road is not a joker lap.
    drive(1, lines[1], course.jokerCentre(lines[1])!);
    drive(1, lines[2], course.jokerCentre(lines[2])!);
    expect(s.entrants[1].jokers).toBe(0);
    // Entry, midpoint and exit in order on the joker road: one.
    for (const line of lines) drive(1, line, course.jokerCentre(line)!);
    expect(s.entrants[1].jokers).toBe(1);
  });
  it('penalises a missed joker at the flag, the last car to finish included', () => {
    const sim = new Simulation(
      session({
        circuit: 'kestrel-rx',
        ruleset: 'rallycross-joker',
        laps: 1,
        opponents: 1,
        vehicles: ['rcx6', 'rcx6'],
      }),
    );
    sim.autoPlayer = true;
    const s = sim.offroad!,
      penalty = s.format!.joker!.penaltySeconds;
    // Nobody is credited a joker: every car must pay for it at the flag.
    for (let i = 0; i < 400 * 120 && sim.race.phase !== PHASE.FINISHED; i++) {
      for (const e of s.entrants) e.jokers = 0;
      sim.step(1 / 120);
    }
    expect(sim.race.phase).toBe(PHASE.FINISHED);
    for (const [id, c] of sim.cars.entries()) {
      expect(s.entrants[id].jokerJudged, `car ${id}`).toBe(true);
      expect(sim.race.laps[id].penalty, `car ${id}`).toBeGreaterThanOrEqual(penalty);
      expect(c.finishTime).toBeGreaterThan(0);
    }
    // The classification includes the penalties of every finisher.
    const [first, second] = sim.race.order;
    expect(sim.cars[first].finishTime).toBeLessThanOrEqual(sim.cars[second].finishTime);
  });
  it('starts a rally stage at intervals and stops the clock at the finish', () => {
    const sim = new Simulation(
      session({
        circuit: 'pinewood-stage',
        ruleset: 'rally-stage',
        laps: 1,
        opponents: 1,
        vehicles: ['rl2', 'rl2'],
      }),
    );
    sim.autoPlayer = true;
    const s = sim.offroad!;
    const interval = s.course.spec.stage!.interval;
    runUntil(sim, () => s.entrants[1].start >= 2, 60);
    expect(s.entrants[1].stageStart - s.entrants[0].stageStart).toBeCloseTo(interval, 6);
    expect(s.entrants[0].jumped).toBe(false);
  });
  it('lets the first stage starter go on the green, with a countdown before it', () => {
    const sim = new Simulation(
      session({
        circuit: 'pinewood-stage',
        ruleset: 'rally-stage',
        laps: 1,
        opponents: 1,
        vehicles: ['rl2', 'rl2'],
      }),
    );
    const s = sim.offroad!,
      frame = new Float32Array(HEADER + sim.cars.length * CAR_STRIDE),
      at = (id: number, field: number) => frame[carBase(id) + OFFROAD_BASE + field];
    runUntil(sim, () => sim.race.time > sim.race.greenAt - 2, 12);
    sim.writeFrame(frame, 0, 0);
    // At the control during the lights, counting down to the green; the
    // second starter queued, counting down to its own start.
    expect(at(0, O.START)).toBe(1);
    expect(at(0, O.FORMAT)).toBeLessThan(0);
    expect(at(0, O.FORMAT)).toBeGreaterThan(-2.1);
    expect(at(1, O.START)).toBe(0);
    expect(at(1, O.FORMAT)).toBeLessThan(-s.format!.stage!.interval + 2.1);
    // The player launches on the green, as on any lights start: no jump.
    runUntil(sim, () => sim.race.phase === PHASE.RACING, 4);
    sim.setInput({ ...controls(), throttle: 1 });
    runUntil(sim, () => sim.race.time > sim.race.greenAt + 3, 4);
    expect(s.entrants[0].jumped).toBe(false);
    expect(sim.race.laps[0].penalty).toBe(0);
    expect(s.entrants[0].stageStart).toBe(0);
    expect(s.entrants[0].start).toBe(2);
    sim.writeFrame(frame, 0, 0);
    expect(at(0, O.FORMAT)).toBeGreaterThan(2.5);
    expect(sim.cars[0].speed).toBeGreaterThan(3);
  });
});

describe('WP41 terrain presentation', () => {
  it('poses the render grid from worker keyframes and rewinds them for replays', () => {
    const track = rigTrack('valley-ridge-mx'),
      surface = Track.offroadOf(track) as TrackTerrainSurface;
    const view = new TerrainView(track);
    const t = surface.terrain;
    t.reset();
    expect(t.renderDelta(true).blocks.length).toBe(0);
    view.record(t.renderDelta(true), 0.5, true);
    for (let i = 0; i < 240; i++) t.deform(0.6, 400.25, 2000, 0.4, 1 / 120);
    const delta = t.renderDelta();
    expect(delta.blocks.length).toBeGreaterThan(0);
    view.record(delta, 1.0, true);
    expect(view.deformedBlocks).toBeGreaterThan(0);
    view.showAt(0.6);
    expect(view.deformedBlocks).toBe(0);
    view.showLive();
    expect(view.deformedBlocks).toBeGreaterThan(0);
    // A full export (new session) replaces the field.
    t.reset();
    view.record(t.renderDelta(true), 0.5, true);
    expect(view.deformedBlocks).toBe(0);
    view.dispose();
    const p = trackPoint();
    track.at(0, p);
    expect(Number.isFinite(p.x)).toBe(true);
  });
});

describe('WP42 off-road career from the registry', () => {
  it('opens the off-road discipline with tiers that race only where they are admitted', () => {
    const registry = liveRegistry();
    expect(disciplineStatus(registry, 'off-road').state).toBe('open');
    expect(disciplineTiers(registry, 'off-road').map((t) => t.id)).toEqual([
      'motocross',
      'rallycross',
      'rally',
    ]);
    const events = disciplineEvents(registry, newCareer(), 'off-road');
    const recovery = events.find((e) => e.kind === 'recovery')!;
    expect(recovery.status).toBe('open');
    expect(recovery.definition!.circuit).toBe('valley-ridge-mx');
    expect(recovery.definition!.ruleset).toBe('motocross-moto');
    // Every event a fully progressed rider could enter names a venue that
    // admits its machines and a format the venue is built for.
    const save = newCareer();
    save.reputation['off-road'] = 100;
    save.licences.jump = { medal: 'gold', best: 0, attempts: 1 };
    save.owned = registry.vehicles.map((v) => ({ id: v.id, source: 'purchase' as const }));
    for (const e of disciplineEvents(registry, save, 'off-road')) {
      if (!e.definition) continue;
      expect(sessionIncompatibilities(eventSession(e.definition, DEFAULT_OPTIONS)), e.key).toEqual(
        [],
      );
    }
    const licence = licenceAvailability(registry, newCareer(), 'jump');
    expect(licence.status).toBe('open');
    expect(licence.venue).toBe('valley-ridge-mx');
  });
});

describe('off-road integration guards', () => {
  it('gives loose-ground tyres their recovery on terrain-venue soil only', () => {
    const loose = makeTire('medium', 155, 0.33, 1, 1, 0.6),
      plain = makeTire('medium', 155, 0.33, 1, 1, 0);
    const mu = (t: typeof loose, surface: number, grip: number, terrain?: boolean) => {
      const s = surfaceSample();
      s.surface = surface;
      s.grip = grip;
      if (terrain !== undefined) s.terrain = terrain;
      return peakGrip(t, 2500, s, 20);
    };
    // Dirt, sand and snow outside a terrain venue (the festival world's
    // samples): the original rule, no recovery.
    for (const [surface, grip] of [
      [MATERIAL.DIRT, 0.66],
      [MATERIAL.SAND, 0.48],
      [MATERIAL.SNOW, 0.36],
      [MATERIAL.MUD, 0.3],
    ])
      expect(mu(loose, surface, grip)).toBe(mu(plain, surface, grip));
    // Grass and gravel everywhere, loose soil on a terrain venue's ground.
    expect(mu(loose, SURFACE.GRAVEL, 0.5)).toBeGreaterThan(mu(plain, SURFACE.GRAVEL, 0.5));
    expect(mu(loose, MATERIAL.SNOW, 0.36, true)).toBeGreaterThan(mu(plain, MATERIAL.SNOW, 0.36));
    // Track samples carry the flag only on a terrain venue's own ground.
    const track = rigTrack('valley-ridge-mx'),
      p = trackPoint(),
      out = surfaceSample();
    track.at(300, p);
    track.sample(p.x, p.z, out, p.y);
    expect(out.terrain).toBe(true);
    const paved = new Track('clear', false, undefined, circuitDefinition('aurel')),
      q = trackPoint(),
      road = surfaceSample();
    paved.at(300, q);
    paved.sample(q.x, q.z, road, q.y);
    expect(road.terrain).toBeUndefined();
  });
  it('loops a raw rider out on the ground at full throttle, never into a flight', () => {
    const track = rigTrack('valley-ridge-mx'),
      course = offroadCourse(track.circuit)!;
    for (const assist of ['raw', 'sport'] as const) {
      const bike = new DirtBikeVehicle(0, 'medium', DEFAULT_SETUP, assist, MX);
      bike.place(track, mod(course.spec.gate!.s - 1.5, track.length), 0);
      bike.gear = 1;
      let flew = false;
      for (let t = 0; t < 3; t += 1 / 240) {
        bike.input.throttle = 1;
        bike.input.steer = Math.max(-1, Math.min(1, -bike.lateral * 0.08));
        bike.step(1 / 240, track);
        if (bike.riding && bike.airborne) flew = true;
      }
      expect(flew, assist).toBe(false);
      if (assist === 'raw') expect(bike.crashCauses.map((c) => c.cause)).toEqual(['loop-out']);
      else expect(bike.dynamics.crashes).toBe(0);
      // The chassis never pitched past what the ground allows a wheelie.
      expect(Math.abs(bike.pitch)).toBeLessThan(1);
    }
    // In a session: a raw rider launching flat out from the gate.
    const sim = new Simulation(
      session({
        circuit: 'valley-ridge-mx',
        ruleset: 'motocross-moto',
        opponents: 3,
        assist: 'raw',
        vehicles: Array(4).fill('mx450'),
      }),
    );
    runUntil(sim, () => sim.race.phase === PHASE.RACING, 12);
    sim.setInput({ ...controls(), throttle: 1 });
    const bike = sim.cars[0] as DirtBikeVehicle;
    let flew = false;
    runUntil(
      sim,
      () => {
        if (bike.riding && bike.airborne) flew = true;
        return bike.crashCauses.length > 0;
      },
      3,
    );
    expect(flew).toBe(false);
    expect(bike.crashCauses[0]?.cause).toBe('loop-out');
  });
  it('keeps a machine flying when its rider comes off in the air', () => {
    const track = rigTrack('valley-ridge-mx'),
      j = jump('valley-ridge-mx', 'SKY TRIPLE'),
      hold = jumpHoldSpeed(j),
      bike = rigBike(MX, track, j.start - 12, hold);
    const dt = 1 / 240;
    let hit = false;
    for (let t = 0; t < 6 && !hit; t += dt) {
      if (!bike.airborne) rideLine(bike, track, Math.max(hold, bike.dynamics.speed));
      bike.step(dt, track);
      if (bike.airborne && bike.airTime > 0.6) {
        bike.impactAt(10000, bike.body.position);
        hit = true;
      }
    }
    expect(hit).toBe(true);
    const y0 = bike.body.position.y,
      ground = bike.contacts[2].height;
    expect(y0 - ground).toBeGreaterThan(1);
    let worst = 0,
      steps = 0;
    for (let prev = y0; bike.airborne && steps < 4 * 240; steps++) {
      bike.step(dt, track);
      worst = Math.max(worst, Math.abs(bike.body.position.y - prev));
      prev = bike.body.position.y;
    }
    expect(bike.riding).toBe(false);
    expect(bike.crashCauses.at(-1)?.cause).toBe('contact');
    // Ballistic all the way down: no tick drops it more than its fall speed
    // allows, and it took real time to come down.
    expect(worst).toBeLessThan(0.06);
    expect(steps).toBeGreaterThan(48);
    expect(bike.body.position.y - bike.contacts[2].height).toBeLessThan(1);
  });
  it('judges a gate start once: no penalty for a tap the gate held back', () => {
    const sim = new Simulation(
      session({
        circuit: 'valley-ridge-mx',
        ruleset: 'motocross-moto',
        opponents: 3,
        vehicles: Array(4).fill('mx450'),
      }),
    );
    const s = sim.offroad!;
    runUntil(sim, () => sim.race.time > sim.race.greenAt - 2, 12);
    sim.setInput({ ...controls(), throttle: 1 });
    runUntil(sim, () => false, 0.15);
    sim.setInput(controls());
    runUntil(sim, () => sim.race.phase === PHASE.RACING, 4);
    const frame = new Float32Array(HEADER + sim.cars.length * CAR_STRIDE);
    sim.writeFrame(frame, 0, 0);
    // Whatever the verdict, the penalty, the flag and the HUD agree.
    expect(s.entrants[0].jumped).toBe(sim.race.laps[0].jumped);
    expect(sim.race.laps[0].penalty).toBe(s.entrants[0].jumped ? s.format!.jumpStartPenalty : 0);
    expect(frame[carBase(0) + OFFROAD_BASE + O.START] > 2.5).toBe(s.entrants[0].jumped);
    expect(s.entrants[0].jumped).toBe(false);
  });
  it('runs a terrain venue format in a quick race', () => {
    const resolve = (circuit: SessionOptions['circuit'], machine: string) => {
      const base = { ...DEFAULT_OPTIONS, mode: 'race' as const, circuit, opponents: 7 };
      return validateOptions({ ...base, ...machineOptions(base, machine) });
    };
    const kestrel = resolve('kestrel-rx', 'rcx6'),
      stage = resolve('pinewood-stage', 'rl2'),
      moto = resolve('valley-ridge-mx', 'mx450');
    expect(kestrel.ruleset).toBe('rallycross-joker');
    expect(stage.ruleset).toBe('rally-stage');
    expect(moto.ruleset).toBe('motocross-moto');
    for (const o of [kestrel, stage, moto]) expect(sessionIncompatibilities(o)).toEqual([]);
    expect(new Simulation(kestrel).offroad!.format!.joker!.required).toBe(1);
    // A paved circuit keeps the class's own ruleset.
    expect(resolve('aurel', 'rcx6').ruleset).toBe('rallycross-heat');
  });
  it('builds a start-gate panel for every rider the session lines up', () => {
    const track = rigTrack('valley-ridge-mx'),
      course = offroadCourse(track.circuit)!,
      gate = new StartGate(track, course);
    expect(gate.panelCount).toBe(course.spec.gate!.slots);
    const frame = new Float32Array(HEADER + 12 * CAR_STRIDE);
    frame[H.CARS] = 12;
    gate.update(frame);
    expect(gate.panelCount).toBe(gateSlots(track, course, 12).lateral.length);
    expect(gate.panelCount).toBe(12);
    gate.dispose();
  });
});
