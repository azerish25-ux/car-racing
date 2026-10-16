import { describe, expect, it, vi } from 'vitest';
import * as T from 'three';
import { PresentedFrame } from '../src/rendering/frame-state.ts';
import { FestivalRenderer } from '../src/rendering/open-world/festival-renderer.ts';
import {
  createFestivalContactOffset,
  festivalContactLocal,
} from '../src/rendering/open-world/festival-contacts.ts';
import { FestivalTrails } from '../src/rendering/open-world/festival-trails.ts';
import { HorizonGuidance } from '../src/rendering/open-world/horizon-guidance.ts';
import { carvedGroundHeight } from '../src/simulation/open-world/ground-height.ts';
import { openWorld } from '../src/simulation/open-world/world.ts';
import { OpenWorldTrack } from '../src/simulation/open-world/open-world-track.ts';
import { resolveEvents } from '../src/simulation/open-world/festival-events.ts';
import { pathPoint } from '../src/simulation/open-world/route-path.ts';
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

const world = openWorld();
// Real checkpoint-flag positions at the Varda drift zone's start, middle
// and finish. The untouched landscape is 21–46 m above these road cuts.
const cuts = [
  { x: -1682.5545136541218, z: 2636.626143232747, y: 205.13417202798857 },
  { x: -2020.23633665374, z: 2253.671176037966, y: 291.22982783706874 },
  { x: -2417.2995620002052, z: 2603.8927299699967, y: 477.0705518830065 },
];

// Exercise the real renderer method without constructing WebGL, workers,
// scene assets or a canvas. groundHeight depends only on the static world.
const renderer = { world } as FestivalRenderer;
const groundHeight = FestivalRenderer.prototype.groundHeight.bind(renderer);

// Actual h2-over-valley crossing contact and an h2 span over bare ground.
// Before the height hint, these queries incorrectly chose the upper deck
// by approximately 7.42 m and 8.17 m respectively.
const bridgeSamples = [
  {
    name: 'h2 over the valley road',
    x: -887.8813977633121,
    z: 876.0116774193868,
    below: 87.72358071225304,
    deck: 95.139348088,
  },
  {
    name: 'h2 over bare ground',
    x: -622.0734616919605,
    z: 974.1306862475266,
    below: 103.58574361103601,
    deck: 111.7533081287277,
  },
];

function slidingFrameAtContact(x: number, z: number, height: number, yaw: number) {
  const frame = new Float32Array(HEADER + CAR_STRIDE),
    o = carBase(0);
  const quaternion = new T.Quaternion().setFromAxisAngle(new T.Vector3(0, 1, 0), yaw);
  frame[H.CARS] = 1;
  frame[H.TIME] = 1;
  frame[o + F.SPEED] = 25;
  frame[o + F.VZ] = 25;
  frame[o + RACE_BASE + R.VEHICLE] = vehicleIndex('rh3');
  quaternion.toArray(frame, o + F.QX);
  for (let wheel = 0; wheel < 4; wheel++) {
    const p = o + WHEEL_BASE + wheel * WHEEL_STRIDE;
    frame[p + W.LENGTH] = 0.3;
    frame[p + W.RADIUS] = VEHICLES.rh3.spec.wheelRadius;
    frame[p + W.LOAD] = 2500;
    frame[p + W.SLIP] = 0.5;
    frame[p + W.SLIP_POWER] = 12000;
  }
  const wheel = festivalContactLocal(frame, 0, 0, new T.Vector3()).applyQuaternion(quaternion);
  frame[o + F.X] = x - wheel.x;
  frame[o + F.Z] = z - wheel.z;
  frame[o + F.Y] = height - wheel.y;
  return { frame, quaternion };
}

describe('festival carved-ground presentation queries', () => {
  it('samples the actual fine terrain at the three deep hairpin cuts', () => {
    const terrain = world.tileCache();
    for (const p of cuts) {
      const sampled = carvedGroundHeight(world.carver, p.x, p.z);
      expect(sampled).toBeCloseTo(p.y, 5);
      expect(sampled).toBeCloseTo(terrain.height(p.x, p.z), 5);
      expect(world.field.height(p.x, p.z) - sampled).toBeGreaterThan(20);
    }
  });

  it('places camera and verge queries on the carved surface rather than the uncut hillside', () => {
    for (const p of cuts) expect(groundHeight(p.x, p.z)).toBeCloseTo(p.y, 5);
  });

  it('keeps analytic carriageway and shoulder queries off the terrain-carving path', () => {
    const net = world.network,
      edge = net.edges.find((e) => e.road.id === 'pass')!,
      p = trackPoint(),
      nearest = trackPoint();
    net.at(edge.offset + edge.length * 0.4, p);
    const build = vi.spyOn(world.carver, 'build');
    try {
      for (const offset of [0, -p.width * 0.4, p.width + edge.spec.shoulder * 0.5]) {
        const x = p.x + p.nx * offset,
          z = p.z + p.nz * offset;
        const l = net.nearest(x, z, nearest),
          actualEdge = net.edges[net.edgeOf[net.lastSegment]];
        expect(Math.abs(l)).toBeLessThan(actualEdge.spec.halfWidth + actualEdge.spec.shoulder);
        expect(groundHeight(x, z)).toBeCloseTo(
          net.surfaceHeight(nearest, l, actualEdge.spec.halfWidth, actualEdge.spec.crown),
          8,
        );
      }
      expect(build).not.toHaveBeenCalled();
    } finally {
      build.mockRestore();
    }
  });

  it.each(bridgeSamples)(
    'keeps both height layers at $name and preserves 2D queries',
    ({ x, z, below, deck }) => {
      const track = new OpenWorldTrack(world);
      const lowerGround = track.groundHeight(x, z, below + 0.5);
      const upperGround = track.groundHeight(x, z, deck + 0.5);
      expect(upperGround - lowerGround).toBeGreaterThan(6);
      expect(groundHeight(x, z, below + 0.5)).toBeCloseTo(lowerGround, 5);
      expect(groundHeight(x, z, deck + 0.5)).toBeCloseTo(upperGround, 5);
      expect(groundHeight(x, z)).toBeCloseTo(upperGround, 5);
      // Hints inside one road's layer tolerance select that road. This API
      // retains RoadNetwork's overlapping tolerance between nearby decks.
      for (const hintHeight of [0.5, 1.8, 2.8])
        expect(groundHeight(x, z, below + hintHeight)).toBeCloseTo(lowerGround, 5);
      expect(groundHeight(x, z, deck + 0.75) + 0.8).toBeCloseTo(upperGround + 0.8, 5);
    },
  );

  it('preserves the road API layer overlap while photo mode retains the subject layer', () => {
    const { x, z, below, deck } = bridgeSamples[0];
    const overlappingHint = below + 3.5;
    expect(overlappingHint - below).toBeLessThan(4);
    expect(deck - overlappingHint).toBeLessThan(4);
    // Both layers are eligible; nearest XZ still chooses the upper road.
    // Photo clearance must not use this moving camera height as its hint.
    expect(groundHeight(x, z, overlappingHint)).toBeCloseTo(deck, 5);
  });

  it.each([
    { name: 'below the bridge', layer: bridgeSamples[0].below },
    { name: 'on the upper deck', layer: bridgeSamples[0].deck },
  ])('keeps a 3.5 m photo orbit with its subject $name', ({ layer }) => {
    const { x, z } = bridgeSamples[0],
      net = world.network,
      nearest = trackPoint(),
      subject = trackPoint();
    net.nearest(x, z, nearest, layer + 0.5);
    net.at(nearest.s - 6, subject);
    const { frame } = slidingFrameAtContact(
      subject.x,
      subject.z,
      groundHeight(subject.x, subject.z, subject.y),
      Math.atan2(subject.tx, subject.tz),
    );
    const camera = new T.PerspectiveCamera(57, 16 / 9, 0.08, 7000),
      originalEyeHeight = layer + 3.5;
    camera.position.set(x, originalEyeHeight, z);
    const target = new T.Vector3().fromArray(frame, carBase(0) + F.X),
      sampledGround = vi.fn(groundHeight),
      stop = new Error('Camera complete: stop before world streaming');
    // Exercise the production setPhoto/draw camera path with a real camera,
    // frame interpolation and world query. Only scene work is substituted;
    // the test ends at the streaming boundary without creating WebGL.
    const fixture = {
      camera,
      world,
      target,
      groundHeight: sampledGround,
      presented: new PresentedFrame(),
      cars: { update: vi.fn(), subject: () => new T.Group() },
      night: 0,
      mode: 'chase',
      preset: 'medium',
      photo: false,
      orbit: { enabled: false, target: new T.Vector3(), update: vi.fn() },
      gaze: new T.Vector3(),
      forward: new T.Vector3(),
      lastSubject: target.clone(),
      lastVehicle: vehicleIndex('rh3'),
      lastTime: frame[H.TIME],
      initialized: true,
      terrain: {
        update: () => {
          throw stop;
        },
      },
    };
    FestivalRenderer.prototype.setPhoto.call(fixture as unknown as FestivalRenderer, true);
    const orbitDistance = camera.position.distanceTo(fixture.orbit.target);
    expect(orbitDistance).toBeGreaterThan(2.5);
    expect(orbitDistance).toBeLessThan(22);
    expect(camera.position.y).toBeGreaterThan(fixture.orbit.target.y);
    expect(() =>
      FestivalRenderer.prototype.draw.call(
        fixture as unknown as FestivalRenderer,
        frame,
        frame,
        1,
        1 / 60,
      ),
    ).toThrow(stop);
    expect(sampledGround).toHaveBeenCalledExactlyOnceWith(x, z, frame[carBase(0) + F.Y]);
    expect(camera.position.y).toBeCloseTo(originalEyeHeight, 6);
    expect(sampledGround.mock.results[0].value).toBeCloseTo(layer, 5);
  });

  it('rejects a distant height-matching road endpoint above the actual carved ground', () => {
    const { x, z, below } = bridgeSamples[1],
      net = world.network,
      p = trackPoint();
    const lateral = net.nearest(x, z, p, below + 2.8),
      edge = net.edges[net.edgeOf[net.lastSegment]];
    // This real bridge sample selects an endpoint almost 24 m away when
    // the photo eye is 2.8 m above the ground. It is within lateral width,
    // but there is no road footprint at the camera's horizontal position.
    expect(net.lastLayerMatch).toBe(true);
    expect(Math.abs(lateral)).toBeLessThan(edge.spec.halfWidth + edge.spec.shoulder);
    expect(net.lastDistance).toBeGreaterThan(20);
    const renderedGround = world.tileCache().height(x, z);
    expect(carvedGroundHeight(world.carver, x, z)).toBeCloseTo(renderedGround, 5);
    expect(groundHeight(x, z, below + 2.8)).toBeCloseTo(renderedGround, 5);
  });

  it('keeps actual tyre particles and trail segments on the lower or upper road being driven', () => {
    const track = new OpenWorldTrack(world),
      sample = bridgeSamples[0],
      direction = trackPoint();
    world.network.nearest(sample.x, sample.z, direction, sample.below + 0.5);
    for (const layer of [sample.below, sample.deck]) {
      const { frame, quaternion } = slidingFrameAtContact(
        sample.x,
        sample.z,
        layer,
        Math.atan2(direction.tx, direction.tz),
      );
      const o = carBase(0),
        body = new T.Vector3().fromArray(frame, o + F.X),
        point = new T.Vector3();
      const floor = createFestivalContactOffset(groundHeight)(frame, 0, 0, false, point);
      point.applyQuaternion(quaternion).add(body);
      const physical = track.groundHeight(point.x, point.z, layer + 0.5);
      expect(point.y).toBeCloseTo(physical + 0.035, 5);
      expect(body.y + floor).toBeCloseTo(physical, 5);

      const trails = new FestivalTrails(),
        previous = frame.slice();
      previous[H.TIME] = 0.9;
      previous[o + F.X] -= direction.tx * 0.7;
      previous[o + F.Z] -= direction.tz * 0.7;
      try {
        trails.update(previous, groundHeight);
        trails.update(frame, groundHeight);
        expect(trails.segments).toBe(4);
        const positions = trails.root.geometry.getAttribute('position');
        // The new end of wheel zero's ribbon, averaged across its width.
        const x = (positions.getX(2) + positions.getX(3)) / 2;
        const z = (positions.getZ(2) + positions.getZ(3)) / 2;
        expect(positions.getY(2)).toBeCloseTo(track.groundHeight(x, z, layer + 0.5) + 0.028, 4);
      } finally {
        trails.dispose();
      }
    }
  });

  it('keeps lower-route chevrons, camber samples and checkpoint flags below the h2 overpass', () => {
    const crossing = { x: -886.4019544829016, z: 877.3575470587393 };
    const event = resolveEvents(world).find((candidate) => {
      const station = candidate.path.locate(
        crossing.x,
        crossing.z,
        candidate.path.length / 2,
        candidate.path.length,
      );
      const p = candidate.path.at(station, pathPoint());
      return (
        Math.hypot(p.x - crossing.x, p.z - crossing.z) < 1 && Math.abs(p.y - 87.76297806765137) < 1
      );
    })!;
    expect(event).toBeDefined();
    const station = event.path.locate(
      crossing.x,
      crossing.z,
      event.path.length / 2,
      event.path.length,
    );
    const gate = event.path.at(station, pathPoint()),
      subject = event.path.at(station - 7, pathPoint());
    const guidance = new HorizonGuidance(),
      track = new OpenWorldTrack(world);
    try {
      guidance.update(event, gate, new T.Vector3(subject.x, subject.y, subject.z), 0, groundHeight);
      const arrows = guidance.root.getObjectByName(
        'Road-following route chevrons',
      ) as T.InstancedMesh;
      expect(arrows.count).toBeGreaterThan(0);
      const matrix = new T.Matrix4(),
        position = new T.Vector3();
      arrows.getMatrixAt(0, matrix);
      position.setFromMatrixPosition(matrix);
      expect(position.y).toBeCloseTo(track.groundHeight(position.x, position.z, gate.y) + 0.045, 3);
      // A one-metre derivative sample must not aim the arrow up to the deck.
      const normal = new T.Vector3().setFromMatrixColumn(matrix, 1).normalize();
      expect(normal.y).toBeGreaterThan(0.9);
      for (const name of ['Left checkpoint flag', 'Right checkpoint flag']) {
        const flag = guidance.root.getObjectByName(name)!;
        // Flags stand beyond the shoulder, so their exact rendered ground
        // is the carved terrain grid rather than the physics verge blend.
        const renderedGround = world.tileCache().height(flag.position.x, flag.position.z);
        expect(flag.position.y).toBeCloseTo(renderedGround, 5);
        expect(flag.position.y).toBeLessThan(91);
      }
    } finally {
      guidance.dispose();
    }
  });
});
