import { describe, expect, it } from 'vitest';
import { PerspectiveCamera, Vector3 } from 'three';
import {
  MOTOCROSS_CHASE,
  MotocrossChaseCamera,
  type MotocrossCameraFrame,
} from '../src/rendering/offroad/chase-camera.ts';
import { rigTrack } from '../src/simulation/offroad/jump-rig.ts';
import { offroadCourse } from '../src/simulation/offroad/venues.ts';
import { surfaceSample, trackPoint, type Track } from '../src/simulation/track.ts';

const flat: Pick<Track, 'sample' | 'at'> = {
  sample(x, z, out) {
    out.height = 0;
    out.normal.set(0, 1, 0);
    out.s = z;
    out.lateral = x;
    return out;
  },
  at(s, out) {
    Object.assign(out, { x: 0, y: 0, z: s, s, tx: 0, tz: 1, nx: 1, nz: 0, width: 5 });
    return out;
  },
};
const frame = (over: Partial<MotocrossCameraFrame> = {}): MotocrossCameraFrame => ({
  anchor: new Vector3(0, 0.86, 0),
  heading: 0,
  s: 0,
  speed: 15,
  cgHeight: 0.86,
  lean: 0,
  airborne: false,
  airTime: 0,
  landingSpeed: 0,
  bottom: 0,
  motion: 0.35,
  ...over,
});

describe('motocross chase composition', () => {
  it.each([0, 15, 32])(
    'keeps the full bike/rider silhouette and a forward corridor in frame at %i m/s',
    (speed) => {
      const rig = new MotocrossChaseCamera().update(0, flat, frame({ speed })),
        camera = new PerspectiveCamera(rig.fov, 16 / 9, 0.045, 1000);
      camera.position.copy(rig.eye);
      camera.up.copy(rig.up);
      camera.lookAt(rig.gaze);
      camera.updateMatrixWorld(true);
      // Full riding envelope: boots/wheel contact through standing helmet.
      for (const x of [-0.5, 0.5])
        for (const y of [0.05, 2.1])
          for (const z of [-0.9, 0.9]) {
            const projected = new Vector3(x, y, z).project(camera);
            expect(Math.abs(projected.x)).toBeLessThan(0.9);
            expect(Math.abs(projected.y)).toBeLessThan(0.97);
            expect(projected.z).toBeGreaterThan(-1);
            expect(projected.z).toBeLessThan(1);
          }
      for (const x of [-4, 4]) {
        const lane = new Vector3(x, 0.2, 12).project(camera);
        expect(Math.abs(lane.x)).toBeLessThan(0.85);
        expect(Math.abs(lane.y)).toBeLessThan(0.9);
      }
    },
  );

  it('pulls back in the air and keeps the gaze directed into the landing corridor', () => {
    const riding = new MotocrossChaseCamera().update(0, flat, frame()),
      airFrame = frame({ anchor: new Vector3(0, 6.86, 0), airborne: true, airTime: 0.5 }),
      jumping = new MotocrossChaseCamera().update(0, flat, airFrame);
    expect(jumping.eye.z).toBeLessThan(riding.eye.z - 0.6);
    expect(jumping.fov).toBeGreaterThan(riding.fov);
    expect(jumping.gaze.y).toBeLessThan(airFrame.anchor.y - 1.5);
    expect(jumping.gaze.z).toBeGreaterThan(10);
  });

  it('clears the physical terrain and sightline at every surveyed outdoor and arena jump', () => {
    for (const venue of ['valley-ridge-mx', 'arena-nord-sx'] as const) {
      const track = rigTrack(venue),
        course = offroadCourse(track.circuit)!,
        p = trackPoint(),
        probe = surfaceSample(),
        rig = new MotocrossChaseCamera();
      for (const jump of course.jumps)
        for (let s = jump.start - 3; s <= jump.end + 3; s += 2) {
          track.at(s, p);
          track.sample(p.x, p.z, probe);
          const f = frame({
            s,
            heading: Math.atan2(p.tx, p.tz),
            anchor: new Vector3(p.x, probe.height + 0.86, p.z),
          });
          rig.update(1 / 60, track, f);
          // Repeat the check on an eye that lagged a metre below its target.
          const eye = rig.eye.clone().add(new Vector3(0, -1, 0));
          rig.clearTerrain(eye, f.anchor, track, f.cgHeight);
          track.sample(eye.x, eye.z, probe);
          expect(eye.y - probe.height, `${venue} ${jump.name} ${s}`).toBeGreaterThanOrEqual(
            MOTOCROSS_CHASE.terrainClearance - 1e-6,
          );
          for (let i = 1; i <= 3; i++) {
            const t = i / 4,
              x = eye.x + (f.anchor.x - eye.x) * t,
              z = eye.z + (f.anchor.z - eye.z) * t,
              lineY = eye.y + (f.anchor.y + 0.38 - eye.y) * t;
            track.sample(x, z, probe);
            expect(lineY - probe.height).toBeGreaterThanOrEqual(
              MOTOCROSS_CHASE.sightlineClearance - 1e-6,
            );
          }
        }
    }
  });

  it('keeps a sideways whip and its landing corridor in view along the actual flight path', () => {
    const jumping = frame({
      anchor: new Vector3(0, 6.86, 0),
      airborne: true,
      airTime: 0.6,
      velocityX: 0,
      velocityZ: 20,
      motion: 0,
    });
    const straight = new MotocrossChaseCamera().update(0, flat, jumping);
    for (const heading of [-1.1, 1.1]) {
      const whipped = new MotocrossChaseCamera().update(0, flat, { ...jumping, heading });
      expect(whipped.eye.toArray()).toEqual(straight.eye.toArray());
      expect(whipped.gaze.toArray()).toEqual(straight.gaze.toArray());
      const camera = new PerspectiveCamera(whipped.fov, 16 / 9, 0.045, 1000);
      camera.position.copy(whipped.eye);
      camera.lookAt(whipped.gaze);
      camera.updateMatrixWorld(true);
      for (const x of [-3, 3]) {
        const landing = new Vector3(x, 0.2, 15).project(camera);
        expect(Math.abs(landing.x)).toBeLessThan(0.85);
        expect(Math.abs(landing.y)).toBeLessThan(0.95);
      }
    }
    // Grounded steering and near-stationary/recovery views retain body heading.
    for (const over of [{ airborne: false }, { velocityZ: 0.1 }]) {
      const turned = new MotocrossChaseCamera().update(0, flat, {
        ...jumping,
        ...over,
        heading: 1,
      });
      expect(turned.eye.x).toBeLessThan(-4);
    }
  });

  it('freezes at paused presentation time and clears landing motion on reset', () => {
    const rig = new MotocrossChaseCamera(),
      a = frame({ airborne: true, airTime: 0.6, lean: 0.5 }),
      landed = frame({ landingSpeed: 5, bottom: 0.2, lean: 0.2 });
    rig.update(0, flat, a);
    rig.update(1 / 60, flat, landed);
    const snapshot = () => [rig.eye.toArray(), rig.gaze.toArray(), rig.up.toArray(), rig.fov];
    const before = snapshot();
    for (let i = 0; i < 60; i++) rig.update(0, flat, landed);
    expect(snapshot()).toEqual(before);
    rig.reset();
    rig.update(0, flat, landed);
    const fresh = new MotocrossChaseCamera().update(0, flat, landed);
    expect(rig.eye.toArray()).toEqual(fresh.eye.toArray());
    expect(rig.gaze.toArray()).toEqual(fresh.gaze.toArray());
  });

  it('makes a small damped landing dip, honors zero motion, and converges across render rates', () => {
    const results = [30, 60, 144].map((fps) => {
      const moving = new MotocrossChaseCamera(),
        still = new MotocrossChaseCamera();
      const air = frame({ airborne: true, airTime: 0.7, motion: 1, lean: 0.6 }),
        down = frame({ landingSpeed: 8, bottom: 0.7, motion: 1, lean: 0.4 });
      moving.update(0, flat, air);
      still.update(0, flat, { ...air, motion: 0 });
      let largestDip = 0;
      for (let i = 0; i < fps; i++) {
        moving.update(1 / fps, flat, down);
        still.update(1 / fps, flat, { ...down, motion: 0 });
        largestDip = Math.max(largestDip, still.eye.y - moving.eye.y);
        expect(still.up.toArray()).toEqual([0, 1, -0]);
      }
      expect(largestDip).toBeGreaterThan(0.025);
      expect(largestDip).toBeLessThan(0.13);
      expect(Math.abs(moving.up.x)).toBeLessThanOrEqual(Math.sin(MOTOCROSS_CHASE.maximumRoll));
      return moving.eye.y;
    });
    expect(results[0]).toBeCloseTo(results[2], 8);
  });

  it('rejects non-finite input before it can poison the world camera', () => {
    expect(() => new MotocrossChaseCamera().update(NaN, flat, frame())).toThrow();
    expect(() =>
      new MotocrossChaseCamera().update(1 / 60, flat, frame({ speed: Infinity })),
    ).toThrow();
  });
});
