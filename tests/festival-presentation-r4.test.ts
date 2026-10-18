import { describe, expect, it } from 'vitest';
import * as T from 'three';
import { FestivalRenderer } from '../src/rendering/open-world/festival-renderer.ts';
import { DRIFT_SMOKE, FestivalDriftSmoke } from '../src/rendering/open-world/drift-smoke.ts';
import { FestivalEventDressing } from '../src/rendering/open-world/event-dressing.ts';
import { SPECTATOR_FEET } from '../src/rendering/open-world/festival-crowd.ts';
import { FESTIVAL_BLUR, FestivalSpeedBlur } from '../src/rendering/open-world/speed-blur.ts';
import { resolveEvents } from '../src/simulation/open-world/festival-events.ts';
import { regionStructures } from '../src/simulation/open-world/placement.ts';
import { openWorld } from '../src/simulation/open-world/world.ts';
import { trackPoint } from '../src/simulation/track.ts';
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
import { gaugeScale } from '../src/ui/festival-hud.ts';

const world = openWorld();
const groundHeight = FestivalRenderer.prototype.groundHeight.bind({ world } as FestivalRenderer);

/** A car sliding at 20 m/s on flat dry asphalt at y = 0, heading +z. */
function slidingFrame(time: number, z: number, slip = 0.5, surface = 0, water = 0) {
  const frame = new Float32Array(HEADER + CAR_STRIDE),
    o = carBase(0);
  frame[H.CARS] = 1;
  frame[H.TIME] = time;
  frame[o + F.SPEED] = 20;
  frame[o + F.VZ] = 20;
  frame[o + F.Z] = z;
  frame[o + F.Y] = 0.45;
  frame[o + F.QW] = 1;
  frame[o + RACE_BASE + R.VEHICLE] = vehicleIndex('rh3');
  for (let wheel = 0; wheel < 4; wheel++) {
    const p = o + WHEEL_BASE + wheel * WHEEL_STRIDE;
    frame[p + W.LENGTH] = 0.3;
    frame[p + W.RADIUS] = VEHICLES.rh3.spec.wheelRadius;
    frame[p + W.LOAD] = 2500;
    frame[p + W.SLIP] = slip;
    frame[p + W.ANGLE] = 0;
    frame[p + W.SLIP_POWER] = 18000;
    frame[p + W.SURFACE] = surface;
    frame[p + W.WATER] = water;
  }
  return frame;
}
const flat = () => 0;
function drive(smoke: FestivalDriftSmoke, hz: number, seconds: number, slip = 0.5) {
  for (let i = 0; i <= Math.round(seconds * hz); i++)
    smoke.update(slidingFrame(1 + i / hz, (i / hz) * 20, slip), flat);
}
const centres = (smoke: FestivalDriftSmoke) =>
  (smoke as unknown as { centers: Float32Array }).centers;

describe('festival drift smoke', () => {
  it('smokes only from sliding, loaded, dry sealed tyres, more with more slip', () => {
    const counts: number[] = [];
    for (const slip of [0.1, 0.3, 0.6]) {
      const smoke = new FestivalDriftSmoke();
      smoke.setQuality('high');
      drive(smoke, 60, 1.5, slip);
      counts.push(smoke.live);
    }
    expect(counts[0]).toBe(0); // grip, not a slide
    expect(counts[1]).toBeGreaterThan(0);
    expect(counts[2]).toBeGreaterThan(counts[1]);
    // Full rear slide: ~DRIFT_SMOKE.rate puffs per rear tyre per second.
    expect(counts[2]).toBeGreaterThan(DRIFT_SMOKE.rate * 2 * 1.5 * 0.8);
    for (const [surface, water] of [
      [3, 0], // loose: dust, not rubber smoke
      [0, 0.6], // wet: spray
    ]) {
      const smoke = new FestivalDriftSmoke();
      smoke.setQuality('high');
      for (let i = 0; i <= 90; i++)
        smoke.update(slidingFrame(1 + i / 60, i / 3, 0.6, surface, water), flat);
      expect(smoke.live).toBe(0);
    }
    const low = new FestivalDriftSmoke();
    low.setQuality('low');
    drive(low, 60, 1);
    expect(low.live).toBe(0);
    expect(low.root.visible).toBe(false);
  });

  it('lays the same trail at 20, 60 and 144 Hz and never bridges a teleport', () => {
    const trails = [20, 60, 144].map((hz) => {
      const smoke = new FestivalDriftSmoke();
      smoke.setQuality('high');
      drive(smoke, hz, 2);
      const c = centres(smoke);
      let min = Infinity,
        max = -Infinity;
      for (let i = 0; i < smoke.live; i++) {
        min = Math.min(min, c[i * 3 + 2]);
        max = Math.max(max, c[i * 3 + 2]);
      }
      return { live: smoke.live, min, max };
    });
    for (const t of trails.slice(1)) {
      expect(Math.abs(t.live - trails[0].live)).toBeLessThanOrEqual(4);
      expect(t.max - t.min).toBeCloseTo(trails[0].max - trails[0].min, -0.5);
    }
    // The trail spans the ~40 m driven, not one spot.
    expect(trails[1].max - trails[1].min).toBeGreaterThan(30);
    const smoke = new FestivalDriftSmoke();
    smoke.setQuality('high');
    smoke.update(slidingFrame(1, 0), flat);
    smoke.update(slidingFrame(1.05, 1), flat);
    smoke.update(slidingFrame(1.1, 900), flat);
    const c = centres(smoke);
    for (let i = 0; i < smoke.live; i++) expect(c[i * 3 + 2] < 30 || c[i * 3 + 2] > 850).toBe(true);
    smoke.update(slidingFrame(0.5, 900), flat);
    expect(smoke.live).toBe(0);
  });
});

describe('festival speed blur', () => {
  const camera = new T.PerspectiveCamera(57, 16 / 9, 0.3, 26000);
  camera.position.set(0, 1.9, -5);
  camera.lookAt(0, 0.5, 8);
  camera.updateMatrixWorld();
  camera.updateProjectionMatrix();
  function presented(speed: number) {
    const frame = slidingFrame(1, 0);
    frame[carBase(0) + F.SPEED] = speed;
    frame[carBase(0) + F.VZ] = speed;
    return frame;
  }
  it('stays still when parked, in photo mode or with the setting off', () => {
    const blur = new FestivalSpeedBlur(true);
    blur.prepare(presented(2), camera, 0, 0.5, true, 1280);
    expect(blur.motion.uniforms.motionActive.value).toBe(0);
    blur.prepare(presented(30), camera, 0, 0.5, false, 1280);
    expect(blur.motion.uniforms.motionActive.value).toBe(0);
    blur.prepare(presented(30), camera, 0, 0, true, 1280);
    expect(blur.motion.uniforms.motionActive.value).toBe(0);
    expect(new FestivalSpeedBlur(false).motion.enabled).toBe(false);
  });
  it('streaks the roadside at speed and keeps the followed car sharp', () => {
    const blur = new FestivalSpeedBlur(true);
    blur.prepare(presented(30), camera, 0, 0.5, true, 1280);
    expect(blur.motion.uniforms.motionActive.value).toBe(1);
    expect(blur.motion.uniforms.motionMaxPixels.value).toBeCloseTo(FESTIVAL_BLUR.maxWidth * 1280);
    const size = new T.Vector2(1280, 720);
    const verge = blur.motion.field.pixels(new T.Vector3(4, 0, 4), camera, size).length();
    const car = blur.motion.field.pixels(new T.Vector3(0, 0.8, -1), camera, size).length();
    expect(verge).toBeGreaterThan(8);
    expect(car).toBeLessThan(0.01);
  });
});

describe('festival event dressing', () => {
  const events = resolveEvents(world);
  const dressing = new FestivalEventDressing(events, world, regionStructures(world), groundHeight);
  dressing.root.updateMatrixWorld(true);
  const p = trackPoint();
  it('dresses every event start and the Kestrel hub within a bounded budget', () => {
    expect(dressing.stats.arches).toBeGreaterThanOrEqual(10);
    expect(dressing.stats.flags).toBeGreaterThan(20);
    expect(dressing.stats.tents).toBeGreaterThan(4);
    expect(dressing.stats.speakers).toBeGreaterThanOrEqual(2);
    expect(dressing.stats.people).toBeGreaterThan(300);
    expect(dressing.stats.triangles).toBeLessThan(450_000);
    let draws = 0;
    dressing.root.traverse((node) => {
      if (node instanceof T.Mesh) draws++;
    });
    expect(draws).toBeLessThan(60);
  });
  it('levels and thins the authored spectators per tier', () => {
    const hub = events.find((e) => e.spec.id === 'runway-launch')!;
    const camera = new T.PerspectiveCamera();
    camera.position.set(hub.marker.x, hub.marker.y + 3, hub.marker.z);
    const drawn = (preset: string) => {
      dressing.update(camera, 0, preset, 1);
      let people = 0,
        triangles = 0;
      dressing.root.traverse((node) => {
        if (!(node instanceof T.InstancedMesh) || node.name !== 'Festival spectators') return;
        if (!node.visible) return;
        people += node.count;
        triangles += (node.geometry.index!.count / 3) * node.count;
      });
      return { people, triangles };
    };
    expect(drawn('low').people).toBe(0);
    const medium = drawn('medium'),
      ultra = drawn('ultra');
    expect(medium.people).toBeLessThan(ultra.people * 0.7);
    // Every hub spectator on ULTRA; distant lines (the harbour corner) are culled.
    expect(ultra.people).toBeGreaterThan(600);
    expect(ultra.people).toBeLessThanOrEqual(dressing.stats.people);
    // Mid sculpts only near the camera: well under the all-mid count.
    expect(medium.triangles).toBeLessThan(medium.people * 1100);
  });
  it('stands arches and flags on the festival ground and off the carriageway', () => {
    const net = world.network;
    dressing.root.traverse((node) => {
      if (!(node instanceof T.InstancedMesh) || !node.name.startsWith('Drift zone flags')) return;
      const m = new T.Matrix4(),
        at = new T.Vector3();
      for (let i = 0; i < node.count; i++) {
        node.getMatrixAt(i, m);
        at.setFromMatrixPosition(m);
        const lateral = net.nearest(at.x, at.z, p);
        const edge = net.edges[net.edgeOf[net.lastSegment]];
        expect(Math.abs(lateral)).toBeGreaterThan(edge.spec.halfWidth + edge.spec.shoulder);
        expect(Math.abs(at.y + 0.05 - groundHeight(at.x, at.z))).toBeLessThan(0.6);
      }
    });
    // The hub crowd stands on the ground beyond the strip's shoulders.
    // Authored standing spectators: their feet (bind space) on the ground.
    const hub = dressing.root.getObjectByName('Kestrel festival hub')!;
    const clusters = hub.children.filter(
      (n): n is T.InstancedMesh => n instanceof T.InstancedMesh && n.name === 'Festival spectators',
    );
    expect(clusters.reduce((a, c) => a + c.instanceMatrix.count, 0)).toBeGreaterThan(200);
    const m = new T.Matrix4(),
      at = new T.Vector3();
    for (const bodies of clusters)
      for (let i = 0; i < bodies.instanceMatrix.count; i += 7) {
        bodies.getMatrixAt(i, m);
        at.copy(SPECTATOR_FEET).applyMatrix4(m);
        const lateral = net.nearest(at.x, at.z, p);
        const edge = net.edges[net.edgeOf[net.lastSegment]];
        expect(Math.abs(lateral)).toBeGreaterThan(edge.spec.halfWidth + edge.spec.shoulder + 1);
        expect(Math.abs(at.y - groundHeight(at.x, at.z))).toBeLessThan(0.01);
      }
    // Arch banners clear a 5.3 m vehicle envelope over the road centre.
    dressing.root.traverse((node) => {
      if (!(node instanceof T.Mesh) || node.name !== 'Arch banner') return;
      const g = node.geometry as T.BufferGeometry;
      g.computeBoundingBox();
      const box = g.boundingBox!;
      const centre = box.getCenter(new T.Vector3());
      expect(box.min.y - groundHeight(centre.x, centre.z)).toBeGreaterThan(5.2);
    });
  });
  it('hides distant placements and lights banners at night', () => {
    const camera = new T.PerspectiveCamera();
    camera.position.set(5000, 10, 5000);
    dressing.update(camera, 1, 'medium');
    expect(dressing.root.children.every((group) => !group.visible)).toBe(true);
    expect(dressing.materials.banner.emissiveIntensity).toBeGreaterThan(0.5);
    const hub = events.find((e) => e.spec.id === 'runway-launch')!;
    camera.position.set(hub.marker.x, hub.marker.y + 3, hub.marker.z);
    dressing.update(camera, 0, 'high');
    expect(dressing.root.getObjectByName('Kestrel festival hub')?.visible).toBe(true);
  });
  it('lights start flares only at night near a race or drift start', () => {
    const camera = new T.PerspectiveCamera();
    const start = events.find((e) => e.spec.id === 'harbour-welcome')!;
    camera.position.set(start.marker.x - 30, start.marker.y + 2, start.marker.z);
    dressing.update(camera, 0, 'medium', 12);
    expect(dressing.flares.mesh.visible).toBe(false);
    dressing.update(camera, 1, 'medium', 12);
    expect(dressing.flares.mesh.visible).toBe(true);
    // Two flares per race/drift arch, each on the ground beside a tower.
    const origin = dressing.flares.mesh.geometry.getAttribute('origin');
    expect(origin.count).toBeGreaterThanOrEqual(2 * 8 * 22);
    for (let i = 0; i < origin.count; i += 22)
      expect(Math.abs(origin.getY(i) - groundHeight(origin.getX(i), origin.getZ(i)))).toBeLessThan(
        0.01,
      );
    camera.position.set(5000, 10, 5000);
    dressing.update(camera, 1, 'medium', 12);
    expect(dressing.flares.mesh.visible).toBe(false);
  });
});

describe('festival speedometer scale', () => {
  it('ends on the next thousand above the limiter with a readable step', () => {
    expect(gaugeScale(8100)).toMatchObject({ max: 9, step: 1 });
    expect(gaugeScale(13700)).toMatchObject({ max: 14, step: 2 });
    expect(gaugeScale(18500)).toMatchObject({ max: 20, step: 4 });
    const s = gaugeScale(8100);
    expect(s.red).toBeCloseTo((8100 * 0.9) / 9000, 6);
  });
});
