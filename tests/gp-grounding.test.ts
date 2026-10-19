import { describe, expect, it } from 'vitest';
import * as T from 'three';
import { BikeVehicle, writeBikeBlock } from '../src/simulation/bike-vehicle.ts';
import { GP_R1, GP_R2 } from '../src/simulation/bike-definitions.ts';
import { DEFAULT_SETUP } from '../src/simulation/config.ts';
import { BIKE_PIT_SERVICE } from '../src/simulation/pit-service.ts';
import {
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
import { vehicleIndex, type VehicleDefinition } from '../src/simulation/vehicles.ts';
import type { SurfaceSample, Track, TrackPoint } from '../src/simulation/track.ts';
import { tyreGeometry } from '../src/rendering/bike.ts';
import {
  createStudioUniforms,
  STUDIO_MAX_CARS,
  StudioFrame,
  studioUniforms,
} from '../src/rendering/studio/studio-frame.ts';
import {
  CAR_GROUNDING_HOOK,
  carGroundingAt,
  gpGroundingAt,
  installCarGrounding,
} from '../src/rendering/studio/car-grounding.ts';
import type { StudioShader } from '../src/rendering/studio/shader-hooks.ts';

/** Exercise the real physics pose writer against an independent planar road
 * fixture. There is no duplicate crown/pivot formula in these tests. */
class PoseProbe extends BikeVehicle {
  pose(track: Track) {
    this.writeBody(track, 0);
  }
}
function bikeOnPlane(definition = GP_R1, heading = 0, slope = 0) {
  const heightAt = (x: number, z: number) =>
    3 + slope * (x * Math.sin(heading) + z * Math.cos(heading));
  const track = {
    sample(x: number, z: number, out: SurfaceSample) {
      out.height = heightAt(x, z);
      return out;
    },
    nearest(_x: number, z: number, out: TrackPoint) {
      out.s = z;
      return 0;
    },
  } as unknown as Track;
  const bike = new PoseProbe(0, 'medium', DEFAULT_SETUP, 'sport', definition);
  bike.placeFree(track, 7, 11, heading, heightAt(7, 11));
  return { bike, track, heightAt };
}
function snapshot(bike: BikeVehicle, definition: VehicleDefinition = bike.definition) {
  const frame = new Float32Array(HEADER + CAR_STRIDE),
    o = carBase(0);
  frame[H.TIME] = 1;
  frame[H.CARS] = 1;
  frame[o + F.X] = bike.body.position.x;
  frame[o + F.Y] = bike.body.position.y;
  frame[o + F.Z] = bike.body.position.z;
  frame[o + F.QX] = bike.body.orientation.x;
  frame[o + F.QY] = bike.body.orientation.y;
  frame[o + F.QZ] = bike.body.orientation.z;
  frame[o + F.QW] = bike.body.orientation.w;
  frame[o + RACE_BASE + R.VEHICLE] = vehicleIndex(definition.id);
  writeBikeBlock(frame, o + BIKE_BASE, bike);
  // These Formula-style values deliberately do not describe the GP hubs.
  for (let i = 0; i < 4; i++) {
    frame[o + WHEEL_BASE + i * WHEEL_STRIDE + W.LENGTH] = 0.44;
    frame[o + WHEEL_BASE + i * WHEEL_STRIDE + W.RADIUS] = 0.335;
  }
  return frame;
}
function presentation(frame: Float32Array) {
  const studio = new StudioFrame(createStudioUniforms());
  const camera = new T.PerspectiveCamera(),
    sun = new T.DirectionalLight();
  camera.updateMatrixWorld(true);
  sun.updateMatrixWorld(true);
  sun.target.updateMatrixWorld(true);
  const update = (next: Float32Array) => studio.update(next, camera, sun, 'chase:0');
  update(frame);
  const u = studio.uniforms;
  return {
    studio,
    update,
    u,
    pose: u.studioCarPose.value[0],
    front: u.studioGpFront.value[0],
    rear: u.studioGpRear.value[0],
    shape: u.studioGpShape.value[0],
  };
}
function occlusion(p: ReturnType<typeof presentation>, x: number, y: number, z: number) {
  return gpGroundingAt({ x, y, z }, p.pose, p.front, p.rear, p.shape);
}

describe('GP tyre grounding from the presented physics pose', () => {
  it('places exactly two contacts at each GP definition’s actual wheelbase', () => {
    for (const definition of [GP_R1, GP_R2])
      for (const heading of [0, 0.83, -2.4]) {
        const { bike } = bikeOnPlane(definition, heading);
        const p = presentation(snapshot(bike));
        expect(p.pose.w).toBeCloseTo(3, 5);
        expect(Math.hypot(p.front.x - p.rear.x, p.front.y - p.rear.y)).toBeCloseTo(
          definition.spec.wheelbase,
          5,
        );
        for (const [contact, physical] of [
          [p.front, bike.contactPoints[0]],
          [p.rear, bike.contactPoints[2]],
        ] as const) {
          expect(contact.x).toBeCloseTo(physical.x, 5);
          expect(contact.y).toBeCloseTo(physical.z, 5);
          expect(contact.z).toBeCloseTo(physical.y, 5);
          expect(contact.w).toBe(1);
          expect(occlusion(p, contact.x, contact.z, contact.y)).toBeCloseTo(1, 5);
        }
        // The old Formula front-wing / left tyre stamp lies in open road here.
        const x = p.pose.x + 0.83 * Math.cos(heading) + 1.82 * Math.sin(heading),
          z = p.pose.y - 0.83 * Math.sin(heading) + 1.82 * Math.cos(heading);
        expect(occlusion(p, x, 3, z)).toBe(0);
        expect(carGroundingAt(0.83, 0, 1.82)).toBe(1);
      }
  });

  it('keeps the front contact on the physics road through normal lean, instead of following the displaced CG', () => {
    for (const lean of [-0.6, 0.6]) {
      const { bike, track } = bikeOnPlane(GP_R1, 0.91);
      bike.dynamics.lean = lean;
      bike.pose(track);
      const p = presentation(snapshot(bike));
      expect(p.pose.w).toBeCloseTo(3, 5);
      expect(p.front.x).toBeCloseTo(bike.contactPoints[0].x, 5);
      expect(p.front.y).toBeCloseTo(bike.contactPoints[0].z, 5);
      const across =
        (p.front.x - p.pose.x) * Math.cos(p.pose.z) - (p.front.y - p.pose.y) * Math.sin(p.pose.z);
      expect(Math.abs(across)).toBeGreaterThan(0.3);
      expect(Math.sign(across)).toBe(-Math.sign(lean));
      expect(p.front.w).toBe(1);
      expect(p.rear.w).toBe(1);
    }
  });

  it('keeps maximum-lean patches on the visible front and rear crown profiles', () => {
    for (const lean of [-1.12, 1.12]) {
      const { bike, track } = bikeOnPlane();
      bike.dynamics.lean = lean;
      bike.pose(track);
      const p = presentation(snapshot(bike));
      const q = new T.Quaternion(
        bike.body.orientation.x,
        bike.body.orientation.y,
        bike.body.orientation.z,
        bike.body.orientation.w,
      );
      for (let i = 0; i < 2; i++) {
        const spec = bike.bikeSpec,
          radius = i === 0 ? spec.frontWheelRadius : spec.rearWheelRadius;
        const geometry = tyreGeometry(
          radius,
          i === 0 ? 0.06 : 0.1,
          i === 0 ? spec.crownRadius : Math.max(spec.crownRadius, 0.11),
          0.21,
          128,
        );
        const positions = geometry.getAttribute('position'),
          point = new T.Vector3(),
          lowest = new T.Vector3(0, Infinity, 0);
        const centre = new T.Vector3().fromArray(bike.definition.wheelPositions[i * 2]);
        for (let v = 0; v < positions.count; v++) {
          point
            .fromBufferAttribute(positions, v)
            .add(centre)
            .applyQuaternion(q)
            .add(bike.body.position);
          if (point.y < lowest.y) lowest.copy(point);
        }
        const contact = i === 0 ? p.front : p.rear;
        expect(Math.hypot(contact.x - lowest.x, contact.y - lowest.z)).toBeLessThan(0.012);
        expect(contact.w).toBeGreaterThan(0.95);
        geometry.dispose();
      }
    }
  });

  it('recovers road height on grades without importing wheelie or stoppie pitch', () => {
    for (const definition of [GP_R1, GP_R2])
      for (const slope of [-0.22, 0.25])
        for (const pitch of [-0.2, 0, 0.25]) {
          const { bike, track, heightAt } = bikeOnPlane(definition, 0.63, slope);
          bike.dynamics.pitch = pitch;
          bike.pose(track);
          const p = presentation(snapshot(bike));
          expect(p.pose.w).toBeCloseTo(heightAt(p.pose.x, p.pose.y), 5);
          for (const contact of [p.front, p.rear])
            expect(contact.z).toBeCloseTo(heightAt(contact.x, contact.y), 5);
          const planted = pitch < 0 ? p.front : p.rear;
          expect(planted.w).toBeGreaterThan(0.98);
          if (pitch !== 0) expect((pitch < 0 ? p.rear : p.front).w).toBe(0);
        }
  });

  it('loses the raised tyre contact during wheelies and stoppies', () => {
    const { bike, track } = bikeOnPlane();
    for (const pitch of [-0.2, 0.25]) {
      bike.dynamics.pitch = pitch;
      bike.pose(track);
      const p = presentation(snapshot(bike));
      expect((pitch < 0 ? p.front : p.rear).w).toBe(1);
      expect((pitch < 0 ? p.rear : p.front).w).toBe(0);
    }
  });

  it('handles fallen bikes, separated riders, remounts, and the actual stand height', () => {
    const { bike, track, heightAt } = bikeOnPlane(GP_R2, -0.4, 0.2);
    bike.dynamics.lean = 1.5;
    bike.dynamics.state = 'separated';
    bike.pose(track);
    let p = presentation(snapshot(bike));
    expect(p.shape.x).toBe(2);
    expect(p.front.w).toBe(0);
    expect(p.rear.w).toBe(0);
    expect(p.pose.w).toBeCloseTo(heightAt(p.pose.x, p.pose.y), 5);
    expect(
      [...p.front.toArray(), ...p.rear.toArray(), ...p.shape.toArray()].every(Number.isFinite),
    ).toBe(true);
    bike.dynamics.lean = 0.3;
    bike.dynamics.state = 'remount';
    bike.pose(track);
    p = presentation(snapshot(bike));
    expect(p.shape.x).toBe(2);
    expect(p.front.w).toBeGreaterThan(0.98);
    expect(p.rear.w).toBeGreaterThan(0.98);
    const upright = bikeOnPlane();
    const frame = snapshot(upright.bike),
      o = carBase(0);
    frame[o + F.IN_PIT] = 1;
    frame[o + F.JACK_HEIGHT] = BIKE_PIT_SERVICE.liftHeight;
    p = presentation(frame);
    expect(p.shape.w).toBeCloseTo(0.08, 6);
    expect(p.front.w).toBe(0);
    expect(p.rear.w).toBe(0);
    expect(occlusion(p, p.pose.x, 3, p.pose.y)).toBeGreaterThan(0);
    expect(occlusion(p, p.pose.x, 3, p.pose.y)).toBeLessThan(0.42);
  });

  it('reuses and clears fixed GP slots for removed or non-GP entrants', () => {
    const { bike } = bikeOnPlane();
    const frame = snapshot(bike),
      p = presentation(frame);
    const arrays = [p.u.studioGpFront.value, p.u.studioGpRear.value, p.u.studioGpShape.value];
    const slots = arrays.map((a) => [...a]);
    expect(arrays.every((a) => a.length === STUDIO_MAX_CARS)).toBe(true);
    for (const vehicle of ['apx01', 'tc1', 'sbk1000', 'mx450']) {
      frame[carBase(0) + RACE_BASE + R.VEHICLE] = vehicleIndex(vehicle);
      p.update(frame);
      for (const array of arrays)
        for (const slot of array) expect(slot.toArray()).toEqual([0, 0, 0, 0]);
    }
    frame[carBase(0) + RACE_BASE + R.VEHICLE] = vehicleIndex('gpr1');
    p.update(frame);
    expect(p.shape.x).toBe(1);
    frame[H.CARS] = 0;
    p.update(frame);
    for (let i = 0; i < arrays.length; i++)
      for (let id = 0; id < STUDIO_MAX_CARS; id++) {
        expect(arrays[i][id]).toBe(slots[i][id]);
        expect(arrays[i][id].toArray()).toEqual([0, 0, 0, 0]);
      }
  });
});

describe('GP grounding material integration', () => {
  it('uses the shared fixed uniforms for standard and wet physical receivers, with instancing', () => {
    for (const id of ['standard', 'physical'] as const) {
      const material =
        id === 'standard'
          ? new T.MeshStandardMaterial()
          : new T.MeshPhysicalMaterial({ roughness: 0.08, clearcoat: 1 });
      expect(installCarGrounding(material)).toBe(true);
      expect(installCarGrounding(material)).toBe(false);
      expect(material.customProgramCacheKey()).toContain(CAR_GROUNDING_HOOK);
      const source = T.ShaderLib[id];
      const shader = {
        uniforms: T.UniformsUtils.clone(source.uniforms),
        vertexShader: source.vertexShader,
        fragmentShader: source.fragmentShader,
      } as unknown as StudioShader;
      material.onBeforeCompile(shader, {} as T.WebGLRenderer);
      for (const name of ['studioGpFront', 'studioGpRear', 'studioGpShape'] as const)
        expect(shader.uniforms[name]).toBe(studioUniforms[name]);
      expect(shader.vertexShader.indexOf('batchingMatrix * apexGroundWorld')).toBeLessThan(
        shader.vertexShader.indexOf('instanceMatrix * apexGroundWorld'),
      );
      expect(shader.vertexShader).toContain(
        'vApexGroundWorld = ( modelMatrix * apexGroundWorld ).xyz;',
      );
      expect(shader.fragmentShader).toContain('if ( studioGpShape[ i ].x > 0.5 )');
      expect(shader.fragmentShader).toContain('if ( shape.x < 1.5 )');
      expect(shader.fragmentShader).toContain('reflectedLight.indirectSpecular *= apexIndirect;');
      material.dispose();
    }
  });
});
