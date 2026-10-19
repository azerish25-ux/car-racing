import * as T from 'three';
import { describe, expect, it } from 'vitest';
import { GP_R1, GP_R2 } from '../src/simulation/bike-definitions.ts';
import { BikeVehicle, writeBikeBlock } from '../src/simulation/bike-vehicle.ts';
import { DEFAULT_OPTIONS, DEFAULT_SETUP } from '../src/simulation/config.ts';
import { BIKE_PIT_SERVICE } from '../src/simulation/pit-service.ts';
import {
  B,
  BIKE_BASE,
  CAR_STRIDE,
  F,
  H,
  HEADER,
  R,
  RACE_BASE,
  W,
  WHEEL_BASE,
  WHEEL_STRIDE,
  carBase,
} from '../src/simulation/protocol.ts';
import type { SurfaceSample, Track, TrackPoint } from '../src/simulation/track.ts';
import { vehicleIndex } from '../src/simulation/vehicles.ts';
import { Simulation } from '../src/simulation/world.ts';
import { Effects, EFFECT_CAPACITY, PARTICLE_KIND, SPRAY_PLUME } from '../src/rendering/effects.ts';
import { EffectPlayback } from '../src/rendering/effect-playback.ts';
import { GP_CONTACT_CLEARANCE, GpContactEffects } from '../src/rendering/gp-contact-effects.ts';
import { SPRAY_PROFILE } from '../src/rendering/spray-clouds.ts';
import { createStudioUniforms, StudioFrame } from '../src/rendering/studio/studio-frame.ts';

class PoseProbe extends BikeVehicle {
  pose(track: Track) {
    this.writeBody(track, 0);
  }
}

function onRoad(definition = GP_R1, heading = 0, slope = 0) {
  const ground = (x: number, z: number) =>
    3 + slope * (x * Math.sin(heading) + z * Math.cos(heading));
  const track = {
    sample(x: number, z: number, out: SurfaceSample) {
      out.height = ground(x, z);
      return out;
    },
    nearest(_x: number, z: number, out: TrackPoint) {
      out.s = z;
      return 0;
    },
  } as unknown as Track;
  const bike = new PoseProbe(0, 'wet', DEFAULT_SETUP, 'sport', definition);
  bike.placeFree(track, 7, 11, heading, ground(7, 11));
  bike.dynamics.speed = 30;
  const frame = new Float32Array(HEADER + CAR_STRIDE),
    o = carBase(0);
  const write = () => {
    bike.pose(track);
    frame[H.CARS] = 1;
    frame[H.TIME] = 1;
    frame[o + F.X] = bike.body.position.x;
    frame[o + F.Y] = bike.body.position.y;
    frame[o + F.Z] = bike.body.position.z;
    frame[o + F.QX] = bike.body.orientation.x;
    frame[o + F.QY] = bike.body.orientation.y;
    frame[o + F.QZ] = bike.body.orientation.z;
    frame[o + F.QW] = bike.body.orientation.w;
    frame[o + F.SPEED] = 30;
    frame[o + F.VX] = Math.sin(heading) * 30;
    frame[o + F.VZ] = Math.cos(heading) * 30;
    frame[o + F.COMPOUND] = 4;
    frame[o + RACE_BASE + R.VEHICLE] = vehicleIndex(definition.id);
    writeBikeBlock(frame, o + BIKE_BASE, bike);
    for (let wheel = 0; wheel < 4; wheel++) {
      const p = o + WHEEL_BASE + wheel * WHEEL_STRIDE;
      // Deliberately retain positive aliased load even during a wheel lift or
      // crash. Geometry/state must suppress impossible contact emissions.
      frame[p + W.LOAD] = 1200;
      frame[p + W.LENGTH] = 0.3;
      frame[p + W.RADIUS] = 0.335;
      frame[p + W.SURFACE] = 1;
      frame[p + W.WATER] = 0.7;
    }
    return frame;
  };
  write();
  return { frame, bike, ground, write };
}

function worldContact(adapter: GpContactEffects, frame: Float32Array, wheel: number, id = 0) {
  const o = carBase(id),
    target = new T.Vector3(),
    q = new T.Quaternion().fromArray(frame, o + F.QX).normalize();
  const floor = adapter.contactOffset(frame, id, wheel, false, target);
  target.applyQuaternion(q).add(new T.Vector3().fromArray(frame, o + F.X));
  return { point: target, floor: floor + frame[o + F.Y] };
}

function configuredEffects() {
  const effects = new Effects(),
    adapter = new GpContactEffects();
  effects.contactEnabled = adapter.contactEnabled;
  effects.contactOffset = adapter.contactOffset;
  effects.diffuserEnabled = adapter.diffuserEnabled;
  effects.smokeSliding = adapter.smokeSliding;
  effects.sprayProfile = adapter.sprayProfile;
  return { effects, adapter };
}

function clouds(effects: Effects) {
  return effects.group.getObjectByName(
    'Lit wheel-water spray clouds',
  ) as T.Mesh<T.InstancedBufferGeometry>;
}

function bytes(array: ArrayBufferView) {
  return new Uint8Array(array.buffer, array.byteOffset, array.byteLength);
}

function expectParticleBytes(actual: Effects, expected: Effects, omitProfile = false) {
  for (let i = 0; i < expected.group.children.length; i++) {
    const a = (actual.group.children[i] as T.Mesh).geometry,
      b = (expected.group.children[i] as T.Mesh).geometry;
    for (const name of Object.keys(b.attributes)) {
      if (omitProfile && name === 'sprayProfile') continue;
      expect(bytes(a.getAttribute(name).array)).toEqual(bytes(b.getAttribute(name).array));
    }
    expect(a.drawRange).toEqual(b.drawRange);
  }
}

function disposeEffects(effects: Effects) {
  effects.clear();
  effects.group.traverse((node) => {
    if (!(node instanceof T.Mesh) && !(node instanceof T.Points)) return;
    node.geometry.dispose();
    for (const material of Array.isArray(node.material) ? node.material : [node.material])
      material.dispose();
  });
}

describe('GP contact effect geometry', () => {
  it('places two wet tyre births at the actual wheelbase and projected ground through lean and grade', () => {
    const adapter = new GpContactEffects();
    for (const definition of [GP_R1, GP_R2])
      for (const heading of [0, 0.83, -2.4])
        for (const slope of [-0.18, 0, 0.22]) {
          const road = onRoad(definition, heading, slope);
          for (const lean of [-1.12, -0.6, 0, 0.6, 1.12]) {
            road.bike.dynamics.lean = lean;
            const frame = road.write(),
              before = frame.slice();
            const contacts = [0, 2].map((wheel) => worldContact(adapter, frame, wheel));
            for (const contact of contacts) {
              expect(contact.floor).toBeCloseTo(road.ground(contact.point.x, contact.point.z), 5);
              expect(contact.point.y - contact.floor).toBeCloseTo(GP_CONTACT_CLEARANCE, 6);
            }
            // Upright contacts agree with actual BikeVehicle contact points;
            // at lean the visible crown can shift relative to the solver line.
            if (lean === 0 && slope === 0) {
              expect(contacts[0].point.distanceTo(contacts[1].point)).toBeCloseTo(
                definition.spec.wheelbase,
                5,
              );
              for (let i = 0; i < 2; i++) {
                expect(contacts[i].point.x).toBeCloseTo(road.bike.contactPoints[i * 2].x, 5);
                expect(contacts[i].point.z).toBeCloseTo(road.bike.contactPoints[i * 2].z, 5);
              }
            }
            expect([1, 3].map((wheel) => adapter.contactEnabled(frame, 0, wheel))).toEqual([
              false,
              false,
            ]);
            expect(adapter.diffuserEnabled(frame, 0)).toBe(false);
            expect(frame).toEqual(before);
          }
        }
  });

  it('uses exactly the same crown points as the receiving road material, independently of update order', () => {
    const road = onRoad(GP_R2, 0.74, 0.2),
      adapter = new GpContactEffects(),
      studio = new StudioFrame(createStudioUniforms()),
      camera = new T.PerspectiveCamera(),
      sun = new T.DirectionalLight();
    camera.updateMatrixWorld();
    sun.updateMatrixWorld();
    sun.target.updateMatrixWorld();
    for (const lean of [-1.12, 0, 1.12]) {
      road.bike.dynamics.lean = lean;
      const frame = road.write();
      // Emit first: the callbacks must not read last frame's studio uniforms.
      const front = worldContact(adapter, frame, 0),
        rear = worldContact(adapter, frame, 2);
      studio.update(frame, camera, sun, 'chase:0');
      for (const [contact, uniform] of [
        [front, studio.uniforms.studioGpFront.value[0]],
        [rear, studio.uniforms.studioGpRear.value[0]],
      ] as const) {
        expect(contact.point.x).toBeCloseTo(uniform.x, 10);
        expect(contact.point.z).toBeCloseTo(uniform.y, 10);
        expect(contact.floor).toBeCloseTo(uniform.z, 10);
      }
    }
  });

  it('ignores Formula suspension aliases and updates same-time edited poses without a stale cache', () => {
    const road = onRoad(),
      adapter = new GpContactEffects(),
      o = carBase(0),
      initial = worldContact(adapter, road.frame, 0);
    road.frame[o + WHEEL_BASE + W.LENGTH] = 0.8;
    road.frame[o + WHEEL_BASE + W.RADIUS] = 0.8;
    road.frame[o + BIKE_BASE + B.FORK] = 0.18;
    road.frame[o + BIKE_BASE + B.SHOCK] = 0.16;
    expect(worldContact(adapter, road.frame, 0)).toEqual(initial);
    road.frame[o + F.X] += 4;
    road.frame[o + F.Y] += 2;
    const moved = worldContact(adapter, road.frame, 0);
    expect(moved.point.x - initial.point.x).toBeCloseTo(4, 8);
    expect(moved.point.y - initial.point.y).toBeCloseTo(2, 8);
    expect(moved.floor - initial.floor).toBeCloseTo(2, 8);
    expect(road.frame[H.TIME]).toBe(1);
  });

  it('suppresses the raised tyre in wheelies/stoppies and both tyres after falls or on pit stands', () => {
    const adapter = new GpContactEffects();
    for (const definition of [GP_R1, GP_R2])
      for (const slope of [-0.2, 0.2]) {
        const road = onRoad(definition, 0.53, slope),
          o = carBase(0);
        for (const pitch of [-0.2, 0, 0.25]) {
          road.bike.dynamics.pitch = pitch;
          const frame = road.write();
          expect(adapter.contactEnabled(frame, 0, 0)).toBe(pitch <= 0);
          expect(adapter.contactEnabled(frame, 0, 2)).toBe(pitch >= 0);
        }
        road.bike.dynamics.pitch = 0;
        const frame = road.write();
        for (const state of [1, 2, 3, 4]) {
          frame[o + BIKE_BASE + B.STATE] = state;
          expect(adapter.contactEnabled(frame, 0, 0)).toBe(false);
          expect(adapter.contactEnabled(frame, 0, 2)).toBe(false);
        }
        frame[o + BIKE_BASE + B.STATE] = 0;
        frame[o + F.IN_PIT] = 1;
        frame[o + F.JACK_HEIGHT] = BIKE_PIT_SERVICE.liftHeight;
        expect(adapter.contactEnabled(frame, 0, 0)).toBe(false);
        expect(adapter.contactEnabled(frame, 0, 2)).toBe(false);
        frame[o + F.JACK_HEIGHT] = 0;
        expect(adapter.contactEnabled(frame, 0, 0)).toBe(true);
        frame[o + WHEEL_BASE + W.LOAD] = 0;
        expect(adapter.contactEnabled(frame, 0, 0)).toBe(false);
      }
  });
});

describe('GP contact effects in the bounded production particle pool', () => {
  it('does not mistake GP handlebar steering for front-tyre sideslip smoke', () => {
    const { effects, adapter } = configuredEffects();
    try {
      const frame = onRoad().frame,
        o = carBase(0);
      for (let wheel = 0; wheel < 4; wheel++) {
        const p = o + WHEEL_BASE + wheel * WHEEL_STRIDE;
        frame[p + W.WATER] = 0;
        frame[p + W.ANGLE] = wheel < 2 ? 0.3 : 0;
        frame[p + W.SLIP_POWER] = 14000;
      }
      for (let i = 0; i < 20; i++) effects.update(frame, 1 / 30);
      expect(effects.diagnostics().spawned[PARTICLE_KIND.SMOKE]).toBe(0);
      // The same value is a real sideslip angle in a car snapshot, so retain
      // the established Formula interpretation outside the GP selector.
      frame[o + RACE_BASE + R.VEHICLE] = vehicleIndex('apx01');
      expect(adapter.smokeSliding(frame, 0, 0)).toBe(1);
      frame[o + RACE_BASE + R.VEHICLE] = vehicleIndex('gpr1');
      frame[o + WHEEL_BASE + 2 * WHEEL_STRIDE + W.SLIP] = 0.3;
      for (let i = 0; i < 20; i++) effects.update(frame, 1 / 30);
      expect(effects.diagnostics().spawned[PARTICLE_KIND.SMOKE]).toBeGreaterThan(0);
      expect(adapter.smokeSliding(frame, 0, 0)).toBe(0);
    } finally {
      disposeEffects(effects);
    }
  });

  it.each([
    ['wet spray', 1, 0.7, 0, PARTICLE_KIND.SPRAY],
    ['gravel dust', 3, 0, 0, PARTICLE_KIND.DUST],
    ['sliding tyre smoke', 1, 0, 0.7, PARTICLE_KIND.SMOKE],
  ] as const)('emits %s from only the two crown contacts', (_name, surface, water, slip, kind) => {
    const { effects, adapter } = configuredEffects();
    try {
      const road = onRoad(GP_R1, 0.8, -0.12),
        o = carBase(0),
        births: { wheel: number; plume: boolean; clearance: number }[] = [];
      road.bike.dynamics.lean = 0.6;
      const frame = road.write(),
        q = new T.Quaternion().fromArray(frame, o + F.QX).normalize();
      for (let wheel = 0; wheel < 4; wheel++) {
        const p = o + WHEEL_BASE + wheel * WHEEL_STRIDE;
        frame[p + W.SURFACE] = surface;
        frame[p + W.WATER] = water;
        frame[p + W.SLIP] = slip;
        frame[p + W.SLIP_POWER] = 8000;
      }
      effects.contactOffset = (sample, id, wheel, plume, target) => {
        const floor = adapter.contactOffset(sample, id, wheel, plume, target);
        const point = target.clone().applyQuaternion(q);
        births.push({ wheel, plume, clearance: point.y - floor });
        return floor;
      };
      for (let i = 0; i < 20; i++) effects.update(frame, 1 / 30);
      expect(effects.diagnostics().spawned[kind]).toBeGreaterThan(2);
      expect(new Set(births.map((birth) => birth.wheel))).toEqual(new Set([0, 2]));
      expect(births.every((birth) => !birth.plume)).toBe(true);
      for (const birth of births) expect(birth.clearance).toBeCloseTo(GP_CONTACT_CLEARANCE, 6);
      const clouds = effects.group.getObjectByName(
        'Lit wheel-water spray clouds',
      ) as T.Mesh<T.InstancedBufferGeometry>;
      if (kind === PARTICLE_KIND.SPRAY)
        for (let i = 0; i < clouds.geometry.instanceCount; i++)
          expect(clouds.geometry.getAttribute('velocity').getY(i)).toBeLessThan(SPRAY_PLUME.vy[0]);
      const profiles = clouds.geometry.getAttribute('sprayProfile');
      for (let i = 0; i < clouds.geometry.instanceCount; i++)
        expect(profiles.getX(i)).toBe(
          kind === PARTICLE_KIND.SPRAY ? SPRAY_PROFILE.GP : SPRAY_PROFILE.DEFAULT,
        );
      expect(effects.group.children).toHaveLength(3);
      expect(effects.diagnostics().contactCapacity).toBe(EFFECT_CAPACITY.contact);
    } finally {
      disposeEffects(effects);
    }
  });

  it.each(['apx01', 'tc1', 'sbk1000', 'mx450'])(
    'preserves every %s particle attribute and birth count',
    (vehicle) => {
      const legacy = new Effects(),
        { effects, adapter } = configuredEffects();
      try {
        const frame = onRoad().frame;
        frame[carBase(0) + RACE_BASE + R.VEHICLE] = vehicleIndex(vehicle);
        for (let wheel = 0; wheel < 4; wheel++)
          expect(adapter.contactEnabled(frame, 0, wheel)).toBe(true);
        expect(adapter.diffuserEnabled(frame, 0)).toBe(true);
        expect(adapter.sprayProfile(frame, 0)).toBe(SPRAY_PROFILE.DEFAULT);
        // Wet spray, loose-ground dust and slipping tyre smoke all retain
        // their original data, not only the first car-water birth path.
        for (const [water, surface, slip] of [
          [0.7, 1, 0],
          [0, 3, 0],
          [0, 1, 0.7],
        ]) {
          for (let wheel = 0; wheel < 4; wheel++) {
            const p = carBase(0) + WHEEL_BASE + wheel * WHEEL_STRIDE;
            frame[p + W.WATER] = water;
            frame[p + W.SURFACE] = surface;
            frame[p + W.SLIP] = slip;
            frame[p + W.SLIP_POWER] = 8000;
          }
          for (let i = 0; i < 20; i++) {
            frame[H.TIME] += 1 / 30;
            legacy.update(frame, 1 / 30);
            effects.update(frame, 1 / 30);
          }
        }
        expect(effects.diagnostics()).toEqual(legacy.diagnostics());
        expectParticleBytes(effects, legacy);
        expect(
          clouds(effects)
            .geometry.getAttribute('sprayProfile')
            .array.every((v) => v === 0),
        ).toBe(true);
      } finally {
        disposeEffects(legacy);
        disposeEffects(effects);
      }
    },
  );

  it('changes only GP presentation bytes while preserving moving births, advection and complete lifetime', () => {
    const { effects } = configuredEffects(),
      { effects: unprofiled } = configuredEffects();
    unprofiled.sprayProfile = null;
    try {
      const frame = onRoad().frame;
      for (let i = 0; i < 45; i++) {
        frame[H.TIME] += 1 / 30;
        frame[carBase(0) + F.Z] += 1;
        effects.update(frame, 1 / 30);
        unprofiled.update(frame, 1 / 30);
      }
      expect(effects.diagnostics()).toEqual(unprofiled.diagnostics());
      expect(effects.diagnostics().spawned[PARTICLE_KIND.SPRAY]).toBeGreaterThan(60);
      expectParticleBytes(effects, unprofiled, true);
      const geometry = clouds(effects).geometry,
        profiles = geometry.getAttribute('sprayProfile');
      expect(profiles.array).toBeInstanceOf(Uint8Array);
      expect(profiles.array.byteLength).toBe(EFFECT_CAPACITY.contact);
      for (let i = 0; i < geometry.instanceCount; i++)
        expect(profiles.getX(i)).toBe(SPRAY_PROFILE.GP);
      // Stop water births and follow every old puff through expiry. A profile
      // cannot alter raw opacity, growth, motion or life during its decay.
      for (let wheel = 0; wheel < 4; wheel++)
        frame[carBase(0) + WHEEL_BASE + wheel * WHEEL_STRIDE + W.WATER] = 0;
      for (let i = 0; i < 90; i++) {
        frame[H.TIME] += 1 / 30;
        effects.update(frame, 1 / 30);
        unprofiled.update(frame, 1 / 30);
      }
      expect(effects.diagnostics()).toEqual(unprofiled.diagnostics());
      expect(effects.diagnostics().active[PARTICLE_KIND.SPRAY]).toBe(0);
      expectParticleBytes(effects, unprofiled, true);
    } finally {
      disposeEffects(effects);
      disposeEffects(unprofiled);
    }
  });

  it.each(['car spray', 'GP dust'])(
    'retains mixed-grid birth ownership and overwrites recycled GP slots with %s',
    (replacement) => {
      const { effects } = configuredEffects();
      try {
        const seed = onRoad().frame,
          frame = new Float32Array(HEADER + 2 * CAR_STRIDE),
          geometry = clouds(effects).geometry;
        frame.set(seed.subarray(0, HEADER));
        frame[H.CARS] = 2;
        for (let id = 0; id < 2; id++) {
          frame.set(seed.subarray(HEADER), carBase(id));
          frame[carBase(id) + F.X] += id * 40;
          frame[carBase(id) + RACE_BASE + R.VEHICLE] = vehicleIndex(id ? 'apx01' : 'gpr1');
        }
        for (let i = 0; i < 20; i++) {
          frame[H.TIME] += 1 / 30;
          effects.update(frame, 1 / 30);
        }
        const profile = geometry.getAttribute('sprayProfile'),
          center = geometry.getAttribute('center'),
          previous = profile.array.slice(),
          oldCount = geometry.instanceCount;
        expect(new Set(profile.array.slice(0, oldCount))).toEqual(new Set([0, 1]));
        for (let i = 0; i < oldCount; i++)
          expect(profile.getX(i)).toBe(
            center.getX(i) < 27 ? SPRAY_PROFILE.GP : SPRAY_PROFILE.DEFAULT,
          );
        // Entrant identity changes only affect subsequent births. Aging the
        // existing trail cannot read the current definition or camera owner.
        frame[carBase(0) + RACE_BASE + R.VEHICLE] = vehicleIndex('apx01');
        frame[carBase(1) + RACE_BASE + R.VEHICLE] = vehicleIndex('gpr1');
        effects.update(frame, 1 / 30, false);
        expect(profile.array).toEqual(previous);
        for (let i = 0; i < 12; i++) {
          frame[H.TIME] += 1 / 30;
          effects.update(frame, 1 / 30);
        }
        expect(geometry.instanceCount).toBeGreaterThan(oldCount);
        for (let i = oldCount; i < geometry.instanceCount; i++)
          expect(profile.getX(i)).toBe(
            center.getX(i) < 27 ? SPRAY_PROFILE.DEFAULT : SPRAY_PROFILE.GP,
          );
        const bornBeforeReuse = effects.diagnostics().spawned.reduce((sum, n) => sum + n, 0);
        for (let id = 0; id < 2; id++) {
          const o = carBase(id);
          frame[o + RACE_BASE + R.VEHICLE] = vehicleIndex(
            replacement === 'car spray' ? 'apx01' : 'gpr1',
          );
          frame[o + F.SPEED] = 160;
          for (let wheel = 0; wheel < 4; wheel++) {
            const p = o + WHEEL_BASE + wheel * WHEEL_STRIDE;
            frame[p + W.LOAD] = 2500;
            frame[p + W.WATER] = replacement === 'car spray' ? 3 : 0;
            frame[p + W.SURFACE] = replacement === 'car spray' ? 1 : 3;
          }
        }
        for (let i = 0; i < 120; i++) {
          frame[H.TIME] += 1 / 30;
          effects.update(frame, 1 / 30);
        }
        const totalBorn = effects.diagnostics().spawned.reduce((sum, n) => sum + n, 0);
        expect(totalBorn - bornBeforeReuse).toBeGreaterThan(EFFECT_CAPACITY.contact);
        expect(profile.array.every((value) => value === SPRAY_PROFILE.DEFAULT)).toBe(true);
      } finally {
        disposeEffects(effects);
      }
    },
  );

  it('freezes paused snapshots and clears replay seeks while reusing the same GPU resources', () => {
    const { effects } = configuredEffects(),
      playback = new EffectPlayback(effects);
    try {
      const frame = onRoad().frame,
        mesh = effects.group.getObjectByName(
          'Lit wheel-water spray clouds',
        ) as T.Mesh<T.InstancedBufferGeometry>,
        geometry = mesh.geometry,
        material = mesh.material,
        attributes = Object.values(geometry.attributes).map((attribute) => attribute.array);
      playback.update(frame);
      for (let i = 0; i < 30; i++) {
        frame[H.TIME] += 1 / 30;
        frame[carBase(0) + F.Z] += 1;
        playback.update(frame);
      }
      const before = effects.diagnostics(),
        positions = geometry.getAttribute('center').array.slice(),
        profile = geometry.getAttribute('sprayProfile') as T.InstancedBufferAttribute,
        profiles = profile.array.slice(),
        profileVersion = profile.version;
      for (let i = 0; i < 30; i++) playback.update(frame);
      expect(effects.diagnostics()).toEqual(before);
      expect(geometry.getAttribute('center').array).toEqual(positions);
      expect(profile.array).toEqual(profiles);
      expect(profile.version).toBe(profileVersion);
      frame[H.TIME] = 0.5;
      frame[carBase(0) + F.X] += 10;
      playback.update(frame);
      expect(effects.diagnostics().active.every((count) => count === 0)).toBe(true);
      expect(geometry.instanceCount).toBe(0);
      expect(profile.array.every((value) => value === SPRAY_PROFILE.DEFAULT)).toBe(true);
      for (let i = 0; i < 6; i++) {
        frame[H.TIME] += 1 / 30;
        playback.update(frame);
      }
      expect(effects.diagnostics().spawned[PARTICLE_KIND.SPRAY]).toBeGreaterThan(0);
      expect(profile.array.some((value) => value === SPRAY_PROFILE.GP)).toBe(true);
      expect(mesh.geometry).toBe(geometry);
      expect(mesh.material).toBe(material);
      Object.values(geometry.attributes).forEach((attribute, i) =>
        expect(attribute.array).toBe(attributes[i]),
      );
      expect(effects.group.children).toHaveLength(3);
    } finally {
      disposeEffects(effects);
    }
  });

  it('uses actual wet GP practice snapshots and measured wheel water/load to form the trail', () => {
    const sim = new Simulation({
      ...DEFAULT_OPTIONS,
      circuit: 'poggio-alto',
      mode: 'practice',
      ruleset: 'gp-motorcycle',
      vehicles: ['gpr1'],
      weather: 'rain',
      compound: 'wet',
      opponents: 0,
    });
    sim.autoPlayer = true;
    const { effects, adapter } = configuredEffects(),
      playback = new EffectPlayback(effects),
      contacts = new Set<number>();
    effects.contactOffset = (frame, id, wheel, plume, target) => {
      expect(plume).toBe(false);
      contacts.add(wheel);
      return adapter.contactOffset(frame, id, wheel, plume, target);
    };
    try {
      const frame = sim.makeFrame();
      playback.update(frame);
      for (let i = 0; i < 1200; i++) {
        sim.step(1 / 120);
        if (i % 4 === 0) {
          sim.writeFrame(frame);
          playback.update(frame, true, true);
        }
      }
      expect(frame[carBase(0) + F.SPEED]).toBeGreaterThan(5);
      expect(effects.diagnostics().spawned[PARTICLE_KIND.SPRAY]).toBeGreaterThan(30);
      expect(contacts).toEqual(new Set([0, 2]));
      expect(sim.cars[0].definition.id).toBe('gpr1');
    } finally {
      disposeEffects(effects);
    }
  });
});
