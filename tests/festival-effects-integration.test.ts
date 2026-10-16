import * as T from 'three';
import { describe, expect, it } from 'vitest';
import { Effects, EFFECT_CAPACITY, PARTICLE_KIND, SPRAY_PLUME } from '../src/rendering/effects.ts';
import {
  createFestivalContactOffset,
  festivalContactEnabled,
  festivalContactLocal,
  festivalDiffuserEnabled,
} from '../src/rendering/open-world/festival-contacts.ts';
import {
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
import { VEHICLES, vehicleIndex } from '../src/simulation/vehicles.ts';
import { MATERIAL } from '../src/simulation/surface-material.ts';

function contactFrame(vehicle: string, surface: number, water = 0) {
  const frame = new Float32Array(HEADER + CAR_STRIDE),
    o = carBase(0);
  frame[H.TIME] = 1;
  frame[H.CARS] = 1;
  frame[o + F.QW] = 1;
  frame[o + F.Y] = 1;
  frame[o + F.SPEED] = 30;
  frame[o + F.VZ] = 30;
  frame[o + RACE_BASE + R.VEHICLE] = vehicleIndex(vehicle);
  for (let wheel = 0; wheel < 4; wheel++) {
    const p = o + WHEEL_BASE + wheel * WHEEL_STRIDE;
    frame[p + W.LOAD] = 2500;
    frame[p + W.RADIUS] = 0.32;
    frame[p + W.LENGTH] = 0.3;
    frame[p + W.SURFACE] = surface;
    frame[p + W.WATER] = water;
  }
  return frame;
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

describe('festival motorcycle ground contacts', () => {
  const bike = Object.values(VEHICLES).find((v) => v.dynamicsKind === 'bike' && v.bike)!;
  it('keeps both tyre contacts on the ground through lean without subtracting fork telemetry twice', () => {
    const frame = contactFrame(bike.id, MATERIAL.ASPHALT),
      o = carBase(0),
      config = bike.bike!;
    const local = new T.Vector3();
    for (const roll of [0, Math.PI / 4, -Math.PI / 3]) {
      const q = new T.Quaternion().setFromAxisAngle(new T.Vector3(0, 0, 1), roll);
      q.toArray(frame, o + F.QX);
      // The simulation leans its CG about the tyre crown, not world zero.
      const lift = config.cgHeight - config.crownRadius;
      const position = new T.Vector3(
        -lift * Math.sin(roll),
        config.crownRadius + lift * Math.cos(roll),
        0,
      );
      for (const length of [0.08, 0.62])
        for (const wheel of [0, 2]) {
          frame[o + WHEEL_BASE + wheel * WHEEL_STRIDE + W.LENGTH] = length;
          const point = festivalContactLocal(frame, 0, wheel, local)
            .applyQuaternion(q)
            .add(position);
          expect(point.x).toBeCloseTo(0, 6);
          expect(point.y).toBeCloseTo(0, 6);
          expect(point.z).toBeCloseTo(bike.wheelPositions[wheel][2], 6);
        }
    }
  });

  it('conforms banked car and bike births to terrain and gives bikes no diffuser displacement', () => {
    const ground = (x: number, z: number) => 3 + x * 0.08 - z * 0.13;
    const offset = createFestivalContactOffset(ground),
      local = new T.Vector3();
    for (const id of ['rh3', bike.id]) {
      const frame = contactFrame(id, MATERIAL.ASPHALT),
        o = carBase(0);
      const q = new T.Quaternion().setFromEuler(new T.Euler(0.12, 0.53, -0.4));
      q.toArray(frame, o + F.QX);
      const position = new T.Vector3(23, 7, 41);
      position.toArray(frame, o + F.X);
      const ordinary = new T.Vector3();
      for (const plume of [false, true]) {
        const floor = offset(frame, 0, 2, plume, local);
        const point = local.applyQuaternion(q).add(position);
        const clearance = plume && id !== bike.id ? 0.22 : 0.035;
        expect(point.y - ground(point.x, point.z)).toBeCloseTo(clearance, 6);
        expect(position.y + floor).toBeCloseTo(ground(point.x, point.z), 6);
        if (!plume) ordinary.copy(point);
        else if (id === bike.id) expect(point.distanceTo(ordinary)).toBeLessThan(1e-6);
        else expect(point.distanceTo(ordinary)).toBeGreaterThan(0.5);
      }
    }
  });
});

describe('festival soft effects integration', () => {
  it('uploads separate snow and mud albedos into the actual bounded cloud instance draw', () => {
    const effects = new Effects();
    try {
      const snow = [0.81, 0.85, 0.89] as const,
        mud = [0.23, 0.19, 0.14] as const;
      effects.looseColours = new Map<number, readonly [number, number, number]>([
        [MATERIAL.SNOW, snow],
        [MATERIAL.MUD, mud],
      ]);
      effects.contactOffset = createFestivalContactOffset(() => 0);
      const clouds = effects.group.getObjectByName('Lit wheel-water spray clouds') as T.Mesh<
        T.InstancedBufferGeometry,
        T.ShaderMaterial
      >;
      const points = effects.group.getObjectByName('Contact smoke, sparks and debris') as T.Points;
      const tint = clouds.geometry.getAttribute('cloudColor') as T.InstancedBufferAttribute;
      const floor = clouds.geometry.getAttribute('floor');
      expect(tint.array.buffer).toBe(points.geometry.getAttribute('color').array.buffer);
      expect(tint.count).toBe(EFFECT_CAPACITY.contact);
      expect(clouds.material.defines.USE_CLOUD_COLOR).toBe(1);
      expect(clouds.material.vertexShader).toContain('if(dust) albedo=cloudColor;');
      const version = tint.version;
      effects.update(contactFrame('rh3', MATERIAL.SNOW), 0.1);
      const snowCount = effects.diagnostics().spawned[PARTICLE_KIND.DUST];
      expect(snowCount).toBeGreaterThan(0);
      effects.update(contactFrame('rh3', MATERIAL.MUD), 0.1);
      const total = effects.diagnostics().spawned[PARTICLE_KIND.DUST];
      expect(total).toBeGreaterThan(snowCount);
      expect(tint.version).toBeGreaterThan(version);
      expect(clouds.geometry.instanceCount).toBe(total);
      for (let i = 0; i < total; i++) {
        const expected = i < snowCount ? snow : mud;
        for (let channel = 0; channel < 3; channel++)
          expect(tint.array[i * 3 + channel]).toBeCloseTo(expected[channel], 6);
        expect(floor.getX(i)).toBe(0);
      }
      expect(effects.group.children).toHaveLength(3);
      expect(effects.diagnostics().contactCapacity).toBe(3600);
    } finally {
      disposeEffects(effects);
    }
  });

  it('emits wet motorcycle spray only at two tyres, with no diffuser height or plume velocity', () => {
    const effects = new Effects();
    try {
      const bike = Object.values(VEHICLES).find((v) => v.dynamicsKind === 'bike' && v.bike)!;
      const frame = contactFrame(bike.id, MATERIAL.ASPHALT, 0.7),
        o = carBase(0);
      const contacts: number[] = [],
        plumeFlags: boolean[] = [],
        birthHeights: number[] = [];
      const offset = createFestivalContactOffset(() => 0);
      effects.contactEnabled = festivalContactEnabled;
      effects.diffuserEnabled = festivalDiffuserEnabled;
      effects.contactOffset = (sample, car, wheel, plume, target) => {
        const floor = offset(sample, car, wheel, plume, target);
        contacts.push(wheel);
        plumeFlags.push(plume);
        birthHeights.push(target.y + sample[o + F.Y]);
        return floor;
      };
      for (let i = 0; i < 12; i++) {
        frame[H.TIME] += 1 / 30;
        effects.update(frame, 1 / 30);
      }
      expect(effects.diagnostics().spawned[PARTICLE_KIND.SPRAY]).toBeGreaterThan(20);
      expect(new Set(contacts)).toEqual(new Set([0, 2]));
      expect(plumeFlags.every((plume) => !plume)).toBe(true);
      expect(birthHeights.every((y) => Math.abs(y - 0.035) < 1e-6)).toBe(true);
      const clouds = effects.group.getObjectByName(
        'Lit wheel-water spray clouds',
      ) as T.Mesh<T.InstancedBufferGeometry>;
      const velocity = clouds.geometry.getAttribute('velocity');
      for (let i = 0; i < clouds.geometry.instanceCount; i++)
        expect(velocity.getY(i)).toBeLessThan(SPRAY_PLUME.vy[0]);
    } finally {
      disposeEffects(effects);
    }
  });
});
