import * as T from 'three';
import { describe, expect, it } from 'vitest';
import { buyVehicle } from '../src/career/economy.ts';
import {
  FESTIVAL_PAY,
  FESTIVAL_RULES,
  settleFestival,
  validateFestivalResult,
} from '../src/career/festival.ts';
import { liveRegistry } from '../src/career/registry.ts';
import { newCareer } from '../src/career/save.ts';
import { DragStrip } from '../src/rendering/open-world/drag-strip.ts';
import { EVENT_COLOURS } from '../src/rendering/open-world/markers.ts';
import { controls } from '../src/simulation/config.ts';
import {
  DRAG,
  DragTimer,
  dragLanes,
  dragTree,
  treeLamps,
} from '../src/simulation/open-world/drag.ts';
import {
  EVENT_KIND_LABEL,
  isRace,
  resolveEvents,
  starsFor,
  type FestivalResult,
} from '../src/simulation/open-world/festival-events.ts';
import { QUARTER_MILE, ROAD_CLASSES } from '../src/simulation/open-world/region-data.ts';
import { REWIND, RewindBuffer, type RewindFrame } from '../src/simulation/open-world/rewind.ts';
import { RouteDriver } from '../src/simulation/open-world/route-driver.ts';
import { pathPoint } from '../src/simulation/open-world/route-path.ts';
import { OpenWorldSimulation } from '../src/simulation/open-world/session.ts';
import {
  FESTIVAL_SKILLS,
  FestivalSkillChain,
  type FestivalSkillSample,
} from '../src/simulation/open-world/skill-chain.ts';
import { openWorld } from '../src/simulation/open-world/world.ts';

/** Festival gameplay depth (FH6 ref 043/044/048/077-079/085): a touge
 * battle on the Varda switchbacks, a quarter-mile drag on the Kestrel strip
 * with a sequenced start tree, rewind, and the Air / Near Miss skills. */
const world = openWorld();
const events = resolveEvents(world);
const touge = events.find((e) => e.spec.id === 'varda-touge')!;
const drag = events.find((e) => e.spec.id === 'kestrel-drag')!;
const live = liveRegistry();

/** Step a session with fixed input from `input(time)` until a result. */
function runUntilResult(
  sim: OpenWorldSimulation,
  seconds: number,
  input = (_t: number) => controls(),
) {
  for (let i = 0; i < seconds * 120; i++) {
    sim.setInput(input(sim.time));
    sim.step(1 / 120);
    const r = sim.takeResult();
    if (r) return r;
  }
  return null;
}
function startEvent(id: string, vehicle = 'tc1') {
  const sim = new OpenWorldSimulation({ vehicle, tileBudget: 24, session: 'r4-events' });
  sim.discovered.add(id);
  sim.command({ type: 'travel', event: id });
  sim.command({ type: 'start', event: id });
  return sim;
}

describe('touge battle and drag strip event data', () => {
  it('adds both formats with labels, colours, career rules and race handling', () => {
    for (const kind of ['touge', 'drag'] as const) {
      expect(isRace(kind)).toBe(true);
      expect(EVENT_KIND_LABEL[kind].length).toBeGreaterThan(3);
      expect(EVENT_COLOURS[kind]).toBeTypeOf('number');
      expect(FESTIVAL_RULES[kind].completion).toBeGreaterThan(0);
    }
    expect(live.festival![0].events.map((e) => e.id)).toEqual(
      expect.arrayContaining(['varda-touge', 'kestrel-drag']),
    );
  });
  it('runs the touge down the Varda switchbacks: four hairpins on the narrow mountain road', () => {
    const path = touge.path,
      p = pathPoint();
    expect(touge.spec.rivals).toBe(1);
    expect(path.finishDistance).toBeGreaterThan(3300);
    expect(path.finishDistance).toBeLessThan(3800);
    let hairpins = 0,
      inHairpin = false,
      mountain = 0,
      samples = 0;
    for (let d = 0; d < path.finishDistance; d += 4) {
      path.at(d, p);
      samples++;
      if (world.network.edges[p.edge].roadClass === 'mountain') mountain++;
      const tight = Math.abs(p.curvature) > 1 / 25;
      if (tight && !inHairpin) hairpins++;
      inHairpin = tight;
    }
    expect(hairpins).toBe(4);
    expect(mountain / samples).toBe(1);
    // Downhill: from below the summit to the first switchback.
    expect(path.at(0, p).y - path.at(path.finishDistance, pathPoint()).y).toBeGreaterThan(200);
    expect(touge.spec.lighting).toBe('sunset');
  });
  it('measures the drag strip as a quarter mile from the hub launch line, braking room beyond', () => {
    const launch = events.find((e) => e.spec.id === 'runway-launch')!;
    expect(
      Math.hypot(drag.marker.x - launch.marker.x, drag.marker.z - launch.marker.z),
    ).toBeLessThan(1);
    expect(drag.path.finishDistance).toBeCloseTo(QUARTER_MILE, 6);
    expect(drag.distance).toBeCloseTo(QUARTER_MILE, 6);
    expect(drag.path.length - drag.path.finishDistance).toBeGreaterThan(600);
    // Four 5 m lanes inside the runway carriageway.
    const half = ROAD_CLASSES.runway.halfWidth;
    for (const { offset } of dragLanes(4)) expect(Math.abs(offset) + 1.2).toBeLessThan(half);
    expect(dragLanes(4).map((l) => l.offset)).toEqual([7.5, 2.5, -2.5, -7.5]);
    expect(dragLanes(2).map((l) => l.lane)).toEqual([1, 2]);
  });
});

describe('touge battle', () => {
  it('starts two cars side by side, standing, and scores the margin over the rival', () => {
    const sim = startEvent('varda-touge');
    expect(sim.cars).toHaveLength(2);
    expect(sim.mode).toBe('countdown');
    const [a, b] = sim.cars.map((c) => c.body.position);
    const at = (x: number, z: number) => {
      const out = { lateral: 0, distance: 0 };
      return { d: touge.path.locate(x, z, 10, 30, out), lateral: out.lateral };
    };
    const pa = at(a.x, a.z),
      pb = at(b.x, b.z);
    expect(Math.abs(pa.d - pb.d)).toBeLessThan(1);
    expect(Math.hypot(a.x - b.x, a.z - b.z)).toBeGreaterThan(3);
    expect(Math.hypot(a.x - b.x, a.z - b.z)).toBeLessThan(3.8);
    // Both inside the 3.5 m lanes of the mountain road, the player on the right.
    for (const q of [pa, pb])
      expect(Math.abs(q.lateral) + 0.9).toBeLessThan(ROAD_CLASSES.mountain.halfWidth);
    expect(pa.lateral).toBeLessThan(0);
    // Held through the countdown even with the throttle open.
    for (let i = 0; i < 120 * 2.5; i++) {
      sim.setInput({ ...controls(), throttle: 1 });
      sim.step(1 / 120);
    }
    expect(sim.player.speed).toBeLessThan(0.5);
    expect(sim.status().event?.live?.label).toBe('GAP');
  });
  it('awards stars by the margin over the rival at the finish', () => {
    const stars = (margin: number | null, position: number) =>
      starsFor(touge.spec, {
        completed: true,
        position,
        trapKmh: null,
        averageKmh: null,
        driftScore: null,
        time: 100,
        margin,
      });
    expect(stars(2.4, 1)).toBe(3);
    expect(stars(0.5, 1)).toBe(2);
    expect(stars(-1.2, 2)).toBe(1);
    expect(stars(-6, 2)).toBe(0);
    expect(stars(null, 1)).toBe(2);
  });
});

describe('drag race', () => {
  it('sequences a full tree: pre-stage, stage, three ambers 0.5 s apart, green; red on a jump', () => {
    const tree = dragTree(10, 0.5);
    expect(tree.staged).toBe(10 + DRAG.stage);
    expect(tree.ambers[0] - tree.staged).toBeCloseTo(1.0, 6);
    expect(tree.ambers[1] - tree.ambers[0]).toBeCloseTo(0.5, 9);
    expect(tree.green - tree.ambers[2]).toBeCloseTo(0.5, 9);
    for (const draw of [0, 0.999]) {
      const t = dragTree(0, draw),
        delay = t.ambers[0] - t.staged;
      expect(delay).toBeGreaterThanOrEqual(DRAG.delay[0]);
      expect(delay).toBeLessThanOrEqual(DRAG.delay[1]);
    }
    const lit = (time: number, left: number | null = null) =>
      treeLamps(tree, time, left)
        .map((on, i) => (on ? i : -1))
        .filter((i) => i >= 0);
    expect(lit(10.5)).toEqual([0]);
    expect(lit(11.2)).toEqual([0, 1]);
    expect(lit(tree.ambers[0] + 0.1)).toEqual([0, 1, 2]);
    expect(lit(tree.ambers[1] + 0.1)).toEqual([0, 1, 3]);
    expect(lit(tree.ambers[2] + 0.1)).toEqual([0, 1, 4]);
    expect(lit(tree.green + 0.05)).toEqual([0, 1, 5]);
    expect(lit(tree.green + 0.5, tree.green + 0.3)).toEqual([5]);
    // Left 0.2 s before green: red from that moment, never green.
    expect(lit(tree.green - 0.1, tree.green - 0.2)).toEqual([4, 6]);
    expect(lit(tree.green + 1, tree.green - 0.2)).toEqual([6]);
  });
  it('times a lane independently of the step rate (interpolated crossings)', () => {
    const slips = [30, 120, 240].map((hz) => {
      const timer = new DragTimer(QUARTER_MILE);
      // Constant 6 m/s² launch at t = 1.2 s.
      for (let i = 0; i <= 30 * hz; i++) {
        const t = i / hz,
          run = Math.max(0, t - 1.2);
        timer.update(t, 3 * run * run);
      }
      return timer.slip(1, 1);
    });
    for (const s of slips) {
      expect(s.reaction).toBeCloseTo(slips[1].reaction!, 3);
      expect(s.elapsed).toBeCloseTo(slips[1].elapsed!, 3);
      expect(s.trapKmh).toBeCloseTo(slips[1].trapKmh!, 1);
    }
    const s = slips[1];
    expect(s.redLight).toBe(false);
    expect(s.reaction).toBeCloseTo(0.2 + Math.sqrt(DRAG.rollout / 3), 3);
    expect(s.elapsed).toBeCloseTo(Math.sqrt(QUARTER_MILE / 3) - Math.sqrt(DRAG.rollout / 3), 3);
    // Trap: average over the last 66 ft.
    const tf = Math.sqrt(QUARTER_MILE / 3),
      tt = Math.sqrt((QUARTER_MILE - DRAG.trap) / 3);
    expect(s.trapKmh).toBeCloseTo((DRAG.trap / (tf - tt)) * 3.6, 1);
  });
  const sim = startEvent('kestrel-drag');
  const green = sim.status().event!.drag!.tree.green;
  it('stages four cars at the line in their lanes and holds them on the brakes', () => {
    expect(sim.cars).toHaveLength(4);
    expect(sim.status().mode).toBe('countdown');
    // One step: each car's forward vector comes from the simulation.
    sim.step(1 / 120);
    const p = pathPoint();
    drag.path.at(0, p);
    const laterals = sim.cars.map((c) => {
      const front = c.definition.halfExtents[2],
        x = c.body.position.x + c.forward.x * front,
        z = c.body.position.z + c.forward.z * front;
      return (x - p.x) * p.nx + (z - p.z) * p.nz;
    });
    expect(laterals.map((l) => Math.round(l * 2) / 2).sort((a, b) => a - b)).toEqual([
      -7.5, -2.5, 2.5, 7.5,
    ]);
    // The HUD shows the tree, not a digit countdown; the player's lane is a middle one.
    expect(sim.status().event!.drag!.lane).toBe(1);
  });
  it('disqualifies a jump start (red light) and times a clean launch', () => {
    const jump = runUntilResult(sim, 40, (t) => ({
      ...controls(),
      throttle: t >= green - 0.4 ? 1 : 0,
    }))!;
    expect(jump.eventKind).toBe('drag');
    expect(jump.drag!.redLight).toBe(true);
    expect(jump.drag!.reaction!).toBeLessThan(0);
    expect(jump.completed).toBe(false);
    expect(jump.position).toBe(jump.entrants);
    expect(jump.stars).toBe(0);
    expect(validateFestivalResult(jump)).not.toBeNull();
    const clean = startEvent('kestrel-drag');
    const go = clean.status().event!.drag!.tree.green;
    // Brake-torque launch: throttle against the brakes, release 0.15 s after green.
    const result = runUntilResult(clean, 40, (t) => ({
      ...controls(),
      throttle: t >= go - 1 ? 1 : 0,
      brake: t < go + 0.15 ? 1 : 0,
    }))!;
    expect(result.completed).toBe(true);
    const slip = result.drag!;
    expect(slip.redLight).toBe(false);
    expect(slip.reaction!).toBeGreaterThan(0.15);
    expect(slip.reaction!).toBeLessThan(0.7);
    expect(slip.sixtyFoot!).toBeGreaterThan(1);
    expect(slip.sixtyFoot!).toBeLessThan(slip.eighthMile!);
    expect(slip.eighthMile!).toBeLessThan(slip.elapsed!);
    expect(slip.elapsed!).toBeGreaterThan(9);
    expect(slip.elapsed!).toBeLessThan(18);
    expect(slip.trapKmh!).toBeGreaterThan(120);
    expect(result.trapKmh).toBe(slip.trapKmh);
    // Race clock from green: reaction plus elapsed time.
    expect(result.time!).toBeCloseTo(slip.reaction! + slip.elapsed!, 3);
    // Every lane ran its quarter mile (the result waits for the slips).
    expect(result.standings.filter((s) => s.time !== null)).toHaveLength(4);
    expect(result.stars).toBeGreaterThanOrEqual(1);
  });
  it('lights the 3D trees in step with the frame clock; the centre tree only while a run is on', () => {
    const dressing = { startLamps: [] as { matrix: T.Matrix4; row: number; lane: number }[] };
    const strip = new DragStrip(drag, dressing.startLamps, (x, z) => world.field.height(x, z));
    const camera = new T.PerspectiveCamera();
    camera.position.set(drag.marker.x, drag.marker.y + 3, drag.marker.z - 10);
    strip.update(0, null, camera);
    expect(strip.root.getObjectByName('Drag strip centre tree')!.visible).toBe(false);
    expect(strip.litLamps()).toHaveLength(0);
    const tree = dragTree(0, 0.5);
    const view = { tree, lanes: [1, 2].map((lane) => ({ lane, leftAt: null })) };
    strip.update(tree.ambers[1] + 0.1, view, camera);
    expect(strip.root.getObjectByName('Drag strip centre tree')!.visible).toBe(true);
    const lamps = strip.litLamps();
    expect(lamps).toHaveLength(14);
    expect(
      lamps
        .filter((l) => l.lit)
        .map((l) => l.row)
        .sort(),
    ).toEqual([0, 0, 1, 1, 3, 3]);
    strip.update(tree.green + 0.1, view, camera);
    expect(strip.litLamps().filter((l) => l.lit && l.row === 5)).toHaveLength(2);
    strip.dispose();
  });
});

describe('rewind', () => {
  it('keeps a bounded history in driving time', () => {
    const buffer = new RewindBuffer();
    expect(buffer.capacity).toBe(Math.round(REWIND.seconds / REWIND.interval) + 1);
    const frame = (time: number): RewindFrame => ({ time, vehicles: [], cars: [], run: null });
    for (let t = 0; t <= 30; t += 1 / 120) if (buffer.due(1 / 120)) buffer.push(frame(t));
    expect(buffer.size).toBe(buffer.capacity);
    expect(buffer.newest - buffer.oldest).toBeCloseTo(REWIND.seconds, 1);
    expect(buffer.available(buffer.newest)).toBeLessThanOrEqual(REWIND.seconds + 1e-6);
    const at = buffer.at(buffer.newest - 3.04)!;
    expect(buffer.newest - at.time).toBeGreaterThanOrEqual(3.04 - 1e-9);
    expect(buffer.newest - at.time).toBeLessThan(3.04 + REWIND.interval);
    const span = buffer.around(buffer.newest - 2.05)!;
    expect(span.b.time - span.a.time).toBeCloseTo(REWIND.interval, 6);
    expect(span.t).toBeGreaterThan(0);
    expect(span.t).toBeLessThan(1);
    const restored = at.time;
    buffer.truncate(restored);
    expect(buffer.newest).toBe(restored);
    buffer.shift(5);
    expect(buffer.newest).toBeCloseTo(restored + 5, 9);
    buffer.clear();
    expect(buffer.size).toBe(0);
  });
  it('scrubs back while held and resumes the recorded motion on release', () => {
    const sim = new OpenWorldSimulation({ vehicle: 'tc1', tileBudget: 24 });
    const drive = (seconds: number) => {
      for (let i = 0; i < seconds * 120; i++) {
        sim.setInput({ ...controls(), throttle: 1 });
        sim.step(1 / 120);
      }
    };
    drive(4);
    const mid = { ...sim.player.body.position, speed: sim.player.speed };
    drive(3);
    const ahead = sim.player.body.position.x;
    sim.command({ type: 'rewind', active: true });
    expect(sim.status().rewind!.active).toBe(true);
    // Held 1.5 s at twice real time: three seconds back.
    for (let i = 0; i < 120 * 1.5; i++) sim.step(1 / 120);
    expect(Math.abs(sim.player.body.position.x - mid.x)).toBeLessThan(2);
    expect(sim.status().rewind!.back).toBeCloseTo(3, 1);
    sim.command({ type: 'rewind', active: false });
    const back = sim.player.body.position;
    expect(ahead - back.x).toBeGreaterThan(30);
    // The frame at or before the cursor: within one sampling interval.
    expect(Math.hypot(back.x - mid.x, back.z - mid.z)).toBeLessThan(
      mid.speed * REWIND.interval + 0.5,
    );
    expect(sim.status().rewind!.count).toBe(1);
    // The motion resumes from the recorded instant (engine and wheels
    // turning with it): it keeps accelerating, no stall.
    drive(0.5);
    expect(sim.player.speed).toBeGreaterThan(mid.speed);
    expect(sim.player.speed).toBeLessThan(mid.speed + 6);
  });
  it('restores legal progress and the event clock; never on the drag strip or in a countdown', () => {
    const sim = startEvent('varda-touge');
    sim.command({ type: 'rewind', active: true });
    expect(sim.status().rewind!.active).toBe(false);
    for (let i = 0; i < 120 * 3.1; i++) sim.step(1 / 120);
    // The player's own pedals and steering, from a route driver (not the
    // festival autopilot, which would mark the run assisted).
    const driver = new RouteDriver(sim.player, touge.path, 0.8);
    for (let i = 0; i < 120 * 8; i++) {
      driver.update(1 / 120, sim.cars);
      sim.step(1 / 120);
    }
    const before = sim.status().event!;
    sim.command({ type: 'rewind', active: true });
    for (let i = 0; i < 120 * 1; i++) sim.step(1 / 120);
    sim.command({ type: 'rewind', active: false });
    const after = sim.status().event!;
    expect(after.rewinds).toBe(1);
    expect(before.elapsed - after.elapsed).toBeGreaterThanOrEqual(2 - 1e-6);
    expect(before.elapsed - after.elapsed).toBeLessThan(2 + REWIND.interval + 1e-6);
    expect(after.progress).toBeLessThan(before.progress);
    expect(after.offRoute).toBe(false);
    // Driving on from the restored instant is credited normally.
    const again = new RouteDriver(sim.player, touge.path, 0.8);
    again.relocate();
    for (let i = 0; i < 120 * 3; i++) {
      again.update(1 / 120, sim.cars);
      sim.step(1 / 120);
    }
    expect(sim.status().event!.progress).toBeGreaterThan(after.progress);
    expect(sim.status().event!.offRoute).toBe(false);
    // Abandon: the result carries the rewind count.
    sim.command({ type: 'cancel' });
    const result = sim.takeResult()!;
    expect(result.rewinds).toBe(1);
    // The drag strip has no rewind (the start is the event).
    const strip = startEvent('kestrel-drag');
    runUntilResult(strip, 6, () => controls());
    strip.command({ type: 'rewind', active: true });
    expect(strip.status().rewind!.allowed).toBe(false);
    expect(strip.status().rewind!.active).toBe(false);
  });
  it('forgets the history on a reset (a new car)', () => {
    const sim = new OpenWorldSimulation({ vehicle: 'tc1', tileBudget: 24 });
    for (let i = 0; i < 120 * 2; i++) {
      sim.setInput({ ...controls(), throttle: 1 });
      sim.step(1 / 120);
    }
    expect(sim.rewindBuffer.size).toBeGreaterThan(10);
    sim.command({ type: 'reset' });
    expect(sim.rewindBuffer.size).toBe(0);
    sim.command({ type: 'autopilot', value: true });
    for (let i = 0; i < 120; i++) sim.step(1 / 120);
    expect(sim.rewindBuffer.size).toBe(0);
  });
});

describe('career payouts for the new formats', () => {
  const save = (() => {
    let s = newCareer();
    s.credits = 1e6;
    s = buyVehicle(s, live, 'rs5');
    return { ...s, reputation: { ...s.reputation, festival: 40 } };
  })();
  const base: FestivalResult = {
    kind: 'festival-result',
    version: 2,
    runId: 'r4:1',
    regionId: 'solvane',
    eventId: 'varda-touge',
    eventName: 'Varda Touge Battle',
    eventKind: 'touge',
    vehicleId: 'rs5',
    completed: true,
    abandoned: false,
    position: 1,
    entrants: 2,
    time: 110,
    trapKmh: null,
    averageKmh: null,
    driftScore: null,
    driftLines: [],
    stars: 3,
    legalDistance: 3500,
    offRouteSeconds: 0,
    standings: [],
    at: 200,
    assisted: false,
    rewinds: 0,
    margin: 2.5,
  };
  it('pays a touge win with its completion rate and the rival beaten', () => {
    const { payout } = settleFestival(save, live, base);
    expect(payout.paid).toBe(true);
    const stakes = payout.lines[0].amount / FESTIVAL_RULES.touge.completion;
    expect(payout.lines[0].label).toContain('Touge battle finished P1 of 2');
    expect(
      Math.abs(payout.lines[1].amount - FESTIVAL_PAY.rivalBeaten * stakes),
    ).toBeLessThanOrEqual(10);
    expect(payout.lines.some((l) => l.label === 'On the route throughout' && l.amount > 0)).toBe(
      true,
    );
  });
  it('pays a rewound run but no clean-route bonus, and refuses a red-lit drag', () => {
    const rewound = settleFestival(save, live, { ...base, runId: 'r4:2', rewinds: 2 }).payout;
    expect(rewound.paid).toBe(true);
    const clean = rewound.lines.find((l) => l.label.startsWith('Rewound 2 times'))!;
    expect(clean.amount).toBe(0);
    expect(validateFestivalResult({ ...base, rewinds: -1 })).toBeNull();
    expect(validateFestivalResult({ ...base, rewinds: 1.5 })).toBeNull();
    const redLight = settleFestival(save, live, {
      ...base,
      runId: 'r4:3',
      eventId: 'kestrel-drag',
      eventName: 'Kestrel Quarter Mile',
      eventKind: 'drag',
      completed: false,
      position: 4,
      entrants: 4,
      time: null,
      stars: 0,
      margin: null,
    });
    expect(redLight.payout.paid).toBe(false);
    expect(redLight.save.paidSessions).toContain('festival:r4:3');
    const win = settleFestival(save, live, {
      ...base,
      runId: 'r4:4',
      eventId: 'kestrel-drag',
      eventName: 'Kestrel Quarter Mile',
      eventKind: 'drag',
      position: 1,
      entrants: 4,
      time: 12.1,
      trapKmh: 190,
      margin: null,
    }).payout;
    expect(win.paid).toBe(true);
    expect(win.lines[0].label).toContain('Drag race finished P1 of 4');
  });
});

describe('Air and Near Miss skills', () => {
  const calm: FestivalSkillSample = {
    lateral: 0,
    forward: 25,
    onRoad: true,
    grounded: true,
    impact: false,
    assisted: false,
  };
  const advance = (chain: FestivalSkillChain, sample: FestivalSkillSample, seconds: number) => {
    for (let i = 0; i < Math.round(seconds * 120); i++) chain.update(sample, 1 / 120);
  };
  it('awards air on a clean landing by its time off the ground', () => {
    const chain = new FestivalSkillChain();
    advance(chain, { ...calm, grounded: false }, 0.6);
    chain.update(calm, 1 / 120);
    const status = chain.status();
    expect(status.award?.name).toBe('GREAT AIR');
    expect(status.award?.points).toBe(Math.round(FESTIVAL_SKILLS.airRate * 0.6));
    expect(status.phase).toBe('active');
  });
  it('gives nothing for a hop, a fall from a height, a slow drop, a hard landing or the autopilot', () => {
    const cases: [FestivalSkillSample, number, FestivalSkillSample][] = [
      [{ ...calm, grounded: false }, 0.2, calm],
      [{ ...calm, grounded: false }, 2.2, calm],
      [{ ...calm, forward: 8, grounded: false }, 0.8, { ...calm, forward: 8 }],
      [{ ...calm, grounded: false }, 0.8, { ...calm, impact: true }],
      [{ ...calm, grounded: false, assisted: true }, 0.8, { ...calm, assisted: true }],
    ];
    for (const [air, seconds, landing] of cases) {
      const chain = new FestivalSkillChain();
      advance(chain, air, seconds);
      chain.update(landing, 1 / 120);
      expect(chain.status().total).toBe(0);
    }
  });
  it('names the traffic pass a near miss', () => {
    const chain = new FestivalSkillChain();
    chain.update({ ...calm, nearMiss: true }, 1 / 120);
    expect(chain.status().award?.name).toBe('NEAR MISS');
  });
});
