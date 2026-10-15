import * as T from 'three';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { CircuitScene } from '../src/rendering/circuit.ts';
import { terrainFor } from '../src/rendering/terrain.ts';
import { venuePlan } from '../src/rendering/venue-plan.ts';
import { LANDMARK, landmarkSitePlan } from '../src/rendering/venue-landmark.ts';
import { venueKitFor } from '../src/rendering/venue-kit/index.ts';
import { PLAZA_RADIUS } from '../src/rendering/venue-kit/plan.ts';
import { CATALOGUE_CIRCUIT_IDS } from '../src/simulation/circuit-catalogue/venue-data.ts';
import { CIRCUITS } from '../src/simulation/circuits.ts';
import { Track, trackPoint } from '../src/simulation/track.ts';

/** Canvas stand-in for texture generation in Node (as in probe-detail). */
class Canvas {
  width = 300;
  height = 150;
  getContext() {
    const noop = () => {};
    return new Proxy(
      {
        canvas: this,
        measureText: () => ({ width: 40 }),
        createLinearGradient: () => ({ addColorStop: noop }),
        createRadialGradient: () => ({ addColorStop: noop }),
        createPattern: () => ({ setTransform: noop }),
        createImageData: (w: number, h: number) => ({ data: new Uint8ClampedArray(w * h * 4) }),
        getImageData: (_x: number, _y: number, w: number, h: number) => ({
          data: new Uint8ClampedArray(w * h * 4),
        }),
      },
      { get: (target, key) => Reflect.get(target, key) ?? noop },
    );
  }
}

describe('WP30 procedural venue kit', () => {
  beforeAll(() => {
    vi.stubGlobal('document', { createElement: () => new Canvas() });
    vi.stubGlobal('HTMLCanvasElement', Canvas);
  });
  afterAll(() => vi.unstubAllGlobals());

  it('is never built for the bespoke Aurel and Vellamar venues', () => {
    expect(venueKitFor(new Track())).toBeNull();
    expect(venueKitFor(new Track('clear', false, undefined, CIRCUITS.vellamar))).toBeNull();
    expect(PLAZA_RADIUS).toBe(LANDMARK.plazaRadius);
  });

  it('plans stands, terrain and a levelled landmark plaza from data alone', () => {
    for (const id of CATALOGUE_CIRCUIT_IDS) {
      const track = new Track('clear', false, undefined, CIRCUITS[id]);
      const plan = venuePlan(track);
      expect(plan.grandstands.length).toBeGreaterThanOrEqual(1);
      expect(plan.districts).toEqual([]);
      const terrain = terrainFor(track),
        site = landmarkSitePlan(track);
      expect(Math.abs(terrain.height(site.x, site.z) - (site.deckY - 0.06))).toBeLessThan(0.05);
      // The ground never rises over the road it borders.
      const p = trackPoint();
      for (let s = 0; s < track.length; s += 97) {
        track.at(s, p);
        expect(terrain.height(p.x, p.z)).toBeLessThan(p.y + 0.01);
      }
    }
  });

  // One venue per dressing family: street+tunnel, flyover+docks, mountain, oval.
  for (const id of ['riviera', 'dockyard', 'alpine-pass', 'speedbowl'] as const)
    it(`dresses ${id} from its CircuitDefinition`, () => {
      const track = new Track('clear', false, undefined, CIRCUITS[id]);
      const circuit = new CircuitScene(track);
      const kit = circuit.venueKit!;
      expect(kit).not.toBeNull();
      const names: string[] = [];
      kit.root.traverse((o) => names.push(o.name));
      const report = kit.diagnostics();
      expect(report.meshes).toBeGreaterThan(40);
      expect(report.finalArtApproved).toBe(false);
      expect(names.some((n) => n.startsWith('Venue kit paddock'))).toBe(true);
      expect(names.some((n) => n.startsWith('Venue kit barriers'))).toBe(true);
      const meta = CIRCUITS[id].catalogue!;
      if (meta.dressing.tunnels.length) {
        expect(names.some((n) => n.startsWith('Venue kit tunnel'))).toBe(true);
        // A point under the roof is sheltered; open road is not.
        const p = track.at(meta.dressing.tunnels[0].from + 20, trackPoint());
        expect(kit.covers(p.x, p.z)).toBe(true);
        const q = track.at(meta.dressing.tunnels[0].from - 200, trackPoint());
        expect(kit.covers(q.x, q.z)).toBe(false);
      }
      if (meta.dressing.crossings.length)
        expect(names.some((n) => n.startsWith('Venue kit bridge'))).toBe(true);
      if (meta.dressing.facades.length)
        expect(names.some((n) => n === 'Venue kit city frontage')).toBe(true);
      // Distance LOD: far detail hides, near detail shows.
      const camera = new T.PerspectiveCamera();
      const start = track.at(0, trackPoint());
      camera.position.set(start.x, start.y + 2, start.z);
      camera.updateMatrixWorld();
      kit.update(camera, true);
      const visible = kit.context.cells.filter((c) => c.object.visible).length;
      expect(visible).toBeGreaterThan(0);
      expect(visible).toBeLessThan(kit.context.cells.length);
      // Night: emissive facades and lamps light up; day turns them off.
      expect(kit.context.materials.lamp.emissiveIntensity).toBeGreaterThan(1);
      kit.update(camera, false);
      expect(kit.context.materials.lamp.emissiveIntensity).toBeLessThan(0.1);
    }, 240000);
});
