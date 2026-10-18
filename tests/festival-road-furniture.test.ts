import { describe, expect, it } from 'vitest';
import * as T from 'three';
import { openWorld } from '../src/simulation/open-world/world.ts';
import { regionStructures } from '../src/simulation/open-world/placement.ts';
import { carvedGroundHeight } from '../src/simulation/open-world/ground-height.ts';
import { roadCandidates } from '../src/simulation/open-world/road-network.ts';
import { RoadMeshes } from '../src/rendering/open-world/roads.ts';
import { RoadFurniture } from '../src/rendering/open-world/road-furniture.ts';
import {
  bendZones,
  junctionApproaches,
  junctionClearance,
  noOvertaking,
} from '../src/rendering/open-world/road-layout.ts';
import { glyphRect, ROAD_GLYPHS, ROAD_PHRASES } from '../src/rendering/open-world/road-glyphs.ts';

const world = openWorld(),
  net = world.network,
  structures = regionStructures(world),
  ground = (x: number, z: number) => carvedGroundHeight(world.carver, x, z);

describe('Japanese road layout', () => {
  it('finds the Varda hairpins as sharp-bend zones inside their edge', () => {
    const pass = net.edges.find((e) => e.id === 'pass#0')!;
    const zones = bendZones(net, pass);
    expect(zones.length).toBeGreaterThanOrEqual(5);
    const clear = junctionClearance(net, pass);
    for (const z of zones) {
      expect(z.s0).toBeLessThan(z.apex);
      expect(z.apex).toBeLessThan(z.s1);
      expect(z.s0).toBeGreaterThanOrEqual(clear[0]);
      expect(z.s1).toBeLessThanOrEqual(pass.length - clear[1]);
      expect(Math.abs(z.curvature)).toBeGreaterThan(1 / 60);
    }
    // Straight roads have none.
    for (const e of net.edges.filter((e) => e.roadClass === 'highway' || e.roadClass === 'town'))
      expect(bendZones(net, e)).toHaveLength(0);
  });
  it('marks one major road per junction and stops the other arms', () => {
    const approaches = junctionApproaches(net);
    const byNode = new Map<number, typeof approaches>();
    for (const a of approaches) byNode.set(a.node, [...(byNode.get(a.node) ?? []), a]);
    for (const arms of byNode.values()) {
      expect(arms.some((a) => !a.minor)).toBe(true);
      for (const a of arms) {
        expect(a.mouth).toBeGreaterThan(a.edge.spec.halfWidth);
        expect((a.dir > 0 ? a.edge.to : a.edge.from) === a.node).toBe(true);
      }
    }
    // Port Ilse's grid crossings get zebras; its cross streets stop.
    expect(approaches.filter((a) => a.crossing).length).toBeGreaterThan(30);
    expect(approaches.filter((a) => a.minor && a.edge.roadClass === 'town').length).toBeGreaterThan(
      8,
    );
  });
  it('paints the orange no-overtaking line on every mountain road', () => {
    for (const e of net.edges.filter((e) => e.roadClass === 'mountain')) {
      const orange = noOvertaking(net, e);
      for (let s = 0; s < e.length; s += 97) expect(orange(s)).toBe(true);
    }
    for (const e of net.edges.filter((e) => e.roadClass === 'town'))
      expect(noOvertaking(net, e)(e.length / 2)).toBe(false);
  });
  it('lays out every glyph the phrases use', () => {
    for (const phrase of Object.values(ROAD_PHRASES))
      for (const c of phrase) expect(ROAD_GLYPHS).toContain(c);
    const [u0, v0, u1, v1] = glyphRect('止');
    expect(u1).toBeGreaterThan(u0);
    expect(v1).toBeGreaterThan(v0);
  });
});

describe('Japanese road markings and furniture', () => {
  it('builds markings, anti-skid and barriers on the road surface without NaN', () => {
    const roads = new RoadMeshes(net, world.field);
    expect(roads.stats.crossings).toBeGreaterThan(30);
    expect(roads.stats.glyphs).toBeGreaterThan(40);
    expect(roads.stats.antiSkidM).toBeGreaterThan(200);
    // Town lamp sockets are unchanged (StreetLightPools input).
    expect(roads.lampSockets.length).toBe(roads.stats.lamps);
    roads.root.traverse((o) => {
      if (!(o instanceof T.Mesh)) return;
      const p = o.geometry.getAttribute('position').array as Float32Array;
      for (let i = 0; i < p.length; i += 97) expect(Number.isFinite(p[i])).toBe(true);
    });
    roads.dispose();
  });
  it('stands every pole, post and sign outside every road footprint', () => {
    const furniture = new RoadFurniture(world, structures, ground);
    const s = furniture.stats;
    expect(s.poles).toBeGreaterThan(300);
    expect(s.wireSpans).toBeGreaterThan(s.poles * 0.6);
    expect(s.mirrors).toBeGreaterThan(10);
    expect(s.chevrons).toBeGreaterThan(20);
    expect(s.gantries).toBeGreaterThan(4);
    const candidates = roadCandidates();
    expect(furniture.anchors.length).toBeGreaterThan(1000);
    for (const a of furniture.anchors) {
      expect(Number.isFinite(a.y)).toBe(true);
      expect(net.covering(a.x, a.z, a.y, 0.2, candidates)).toBe(0);
    }
    // Expressway lamp sockets hang over the shoulder, above the road.
    expect(furniture.lampSockets.length).toBe(s.lamps);
    for (const socket of furniture.lampSockets) {
      expect(socket.position.y - socket.target.y).toBeGreaterThan(7);
      expect(socket.position.y - socket.target.y).toBeLessThan(13);
    }
    // Culling: nothing drawn from far outside the region.
    const camera = new T.PerspectiveCamera();
    camera.position.set(20000, 50, 20000);
    camera.updateMatrixWorld();
    furniture.update(camera, 'ultra', 1080);
    expect(furniture.root.children.every((o) => !o.visible)).toBe(true);
    furniture.dispose();
  });
  it('is deterministic', () => {
    const a = new RoadFurniture(world, structures, ground),
      b = new RoadFurniture(world, structures, ground);
    expect(b.stats).toEqual(a.stats);
    expect(b.anchors.slice(0, 50)).toEqual(a.anchors.slice(0, 50));
    a.dispose();
    b.dispose();
  });
});
