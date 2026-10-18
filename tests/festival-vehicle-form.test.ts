import * as T from 'three';
import { describe, expect, it } from 'vitest';
import { VEHICLES, type VehicleDefinition } from '../src/simulation/vehicles.ts';
import { bodySheetFor, type ClosedSheet } from '../src/rendering/vehicle-bodies/body-sheet.ts';
import { buildVehicleBody, VehicleBodies } from '../src/rendering/vehicle-bodies/index.ts';
import { ClosedBodyModel } from '../src/rendering/vehicle-bodies/closed-body.ts';
import {
  FestivalBodyModel,
  festivalFormFor,
  sampleCreased,
} from '../src/rendering/vehicle-bodies/festival-form.ts';
import { festivalCars } from '../src/simulation/open-world/festival-machines.ts';

/** Geometry fingerprint: vertex and triangle counts and an FNV hash of every
 * vertex position (0.1 mm) and index of a built group. */
function fingerprint(root: T.Object3D) {
  let h = 2166136261,
    verts = 0,
    tris = 0;
  const mix = (v: number) => {
    h ^= v;
    h = Math.imul(h, 16777619) >>> 0;
  };
  root.updateMatrixWorld(true);
  const v = new T.Vector3();
  root.traverse((o) => {
    if (!(o instanceof T.Mesh)) return;
    const g = o.geometry as T.BufferGeometry;
    const p = g.getAttribute('position');
    verts += p.count;
    tris += (g.index ? g.index.count : p.count) / 3;
    for (let i = 0; i < p.count; i++) {
      v.fromBufferAttribute(p, i).applyMatrix4(o.matrixWorld);
      mix(Math.round(v.x * 1e4));
      mix(Math.round(v.y * 1e4));
      mix(Math.round(v.z * 1e4));
    }
    if (g.index) for (let i = 0; i < g.index.count; i++) mix(g.index.getX(i));
  });
  return `${verts}/${tris}/${h.toString(16)}`;
}
const triangles = (root: T.Object3D) => {
  let n = 0;
  root.traverse((o) => {
    if (!(o instanceof T.Mesh)) return;
    const g = o.geometry as T.BufferGeometry;
    n += (g.index ? g.index.count : g.getAttribute('position').count) / 3;
  });
  return n;
};
const festivalBody = (def: VehicleDefinition) =>
  buildVehicleBody(0, def, bodySheetFor(def)!, { festival: true });

describe('Festival road-car production form', () => {
  it('leaves every plain (circuit) body exactly as it was', () => {
    // Fingerprints of the near LOD before the festival form existed: a GT
    // race car, the touring car, a prototype, and two road cars that also
    // carry the class-gated festival detail on a circuit.
    const before: Record<string, string> = {
      tc1: '166720/80192/3768821c',
      hy9: '185694/87810/e8f20e75',
      gt8f: '180512/84744/5e15da5a',
      eh3: '178016/85102/38ad305a',
      rh3: '155272/76966/c364610a',
    };
    for (const [id, print] of Object.entries(before)) {
      const def = VEHICLES[id];
      const body = buildVehicleBody(0, def, bodySheetFor(def)!);
      expect(body.model instanceof FestivalBodyModel, id).toBe(false);
      expect(fingerprint(body.lods[0].group), id).toBe(print);
    }
    // The library defaults to the plain bodies; FestivalCars opts in.
    expect((new VehicleBodies() as unknown as { options: object }).options).toEqual({});
  });

  it('draws every festival road car with the form, within budget and on its wheels', () => {
    const road = festivalCars().filter((d) => {
      const sheet = bodySheetFor(d);
      return sheet?.kind === 'closed' && festivalFormFor(d, sheet);
    });
    expect(road.map((d) => d.id).sort()).toEqual(
      ['eh3', 'lx12', 'rd2', 'rg63', 'rh3', 'rm8', 'rp6', 'rr4', 'rs5', 'sc7'].sort(),
    );
    for (const def of road) {
      const body = festivalBody(def);
      expect(body.model instanceof FestivalBodyModel, def.id).toBe(true);
      const counts = body.lods.map((l) => triangles(l.group));
      expect(counts[0], def.id).toBeGreaterThan(counts[1]);
      expect(counts[1], def.id).toBeGreaterThan(counts[2]);
      // The player's near LOD (wheels, cabin and all) stays near 80k.
      expect(counts[0], def.id).toBeLessThan(90000);
      expect(counts[2], def.id).toBeLessThan(12000);
      expect(triangles(body.proxy), def.id).toBeLessThan(15000);
      let finite = true;
      body.root.traverse((o) => {
        if (!(o instanceof T.Mesh)) return;
        const p = (o.geometry as T.BufferGeometry).getAttribute('position').array;
        for (let i = 0; i < p.length; i++) if (!Number.isFinite(p[i])) finite = false;
      });
      expect(finite, def.id).toBe(true);
      for (const wheels of body.wheels)
        wheels.forEach((w, i) => {
          expect(w.pivot.position.x).toBeCloseTo(def.wheelPositions[i][0], 6);
          expect(w.pivot.position.z).toBeCloseTo(def.wheelPositions[i][2], 6);
          expect(w.radius).toBe(def.spec.wheelRadius);
        });
      const box = new T.Box3().setFromObject(body.lods[0].group);
      expect(box.max.z, def.id).toBeLessThan(def.halfExtents[2] + 0.45);
      expect(box.min.z, def.id).toBeGreaterThan(-def.halfExtents[2] - 0.45);
      expect(box.max.x - box.min.x, def.id).toBeLessThan(def.halfExtents[0] * 2 + 0.45);
    }
  });

  it('keeps each wheel inside its arch: lip over the tyre face, ceiling over the tread', () => {
    for (const id of ['eh3', 'sc7', 'rh3', 'rs5', 'lx12', 'rp6']) {
      const def = VEHICLES[id],
        body = festivalBody(def),
        model = body.model as FestivalBodyModel,
        sheet = bodySheetFor(def) as ClosedSheet;
      const f = model.f;
      for (const [axle, hub, half, track] of [
        [f.frontAxle, f.hubFront, sheet.wheels.width[0] / 2, f.trackFront],
        [f.rearAxle, f.hubRear, sheet.wheels.width[1] / 2, f.trackRear],
      ]) {
        // The tyre's outer face stays within 3 cm of the body side.
        expect(model.halfWidth(axle), id).toBeGreaterThan(track / 2 + half - 0.03);
        // The arch ceiling clears the tread at rest across the opening.
        for (const dz of [-0.2, -0.1, 0, 0.1, 0.2]) {
          const arch = model.arch(axle + dz)!;
          expect(arch, id).not.toBeNull();
          const tread = hub + Math.sqrt(f.radius ** 2 - dz * dz);
          const half = model.ring(axle + dz, 0).half;
          const ceiling = Math.min(half[model.sampleOf(2, 0)][1], half[model.sampleOf(3, 0)][1]);
          expect(ceiling - tread, `${id} arch at ${dz}`).toBeGreaterThan(0.025);
        }
      }
    }
  });

  it('splits normals along its character lines', () => {
    // A crease point is emitted twice; the loft's faces on either side give
    // the two copies different normals (a sharp shoulder, not a soft roll).
    const half = sampleCreased(
      [
        [0, 0],
        [1, 0],
        [1, 1],
      ],
      [2, 2],
      [1],
    );
    expect(half).toHaveLength(6);
    expect(half[2]).toEqual(half[3]);
    const def = VEHICLES.rs5,
      body = festivalBody(def),
      model = body.model as FestivalBodyModel;
    let loft: T.Mesh | null = null;
    body.lods[0].group.traverse((o) => {
      if (o instanceof T.Mesh && o.name === 'Body (lofted)') loft = o;
    });
    expect(loft).not.toBeNull();
    const g = (loft as unknown as T.Mesh).geometry as T.BufferGeometry,
      p = g.getAttribute('position'),
      n = g.getAttribute('normal');
    // Find the two copies of the shoulder crease on a mid-door ring.
    const ring = model.ring(0, 0).half,
      shoulder = model.sampleOf(6, 0);
    const [sx, sy] = ring[shoulder];
    const copies: T.Vector3[] = [];
    for (let i = 0; i < p.count; i++)
      if (
        Math.abs(p.getX(i) - sx) < 1e-4 &&
        Math.abs(p.getY(i) - sy) < 0.02 &&
        Math.abs(p.getZ(i)) < 0.03
      )
        copies.push(new T.Vector3().fromBufferAttribute(n, i));
    expect(copies.length).toBeGreaterThanOrEqual(2);
    const spread = Math.max(...copies.map((a) => Math.max(...copies.map((b) => a.angleTo(b)))));
    expect(spread).toBeGreaterThan(0.25);
    // The plain model keeps its single smooth chain.
    const plain = new ClosedBodyModel(model.f, model.s, [0.1, 0.1]);
    expect(new Set(plain.ring(0, 0).half.map((q) => q.join())).size).toBe(
      plain.ring(0, 0).half.length,
    );
  });

  it('curves the end faces in plan: bumper corners sit behind the face centre', () => {
    for (const id of ['eh3', 'rs5', 'rh3']) {
      const body = festivalBody(VEHICLES[id]),
        model = body.model!;
      let cap: T.Mesh | null = null;
      body.lods[0].group.traverse((o) => {
        if (o instanceof T.Mesh && o.name === 'Sculpted front fascia') cap = o;
      });
      expect(cap, id).not.toBeNull();
      const p = ((cap as unknown as T.Mesh).geometry as T.BufferGeometry).getAttribute('position');
      let centre = -Infinity,
        corner = Infinity;
      const xMax = model.halfWidth(model.zFront);
      for (let i = 0; i < p.count; i++) {
        if (Math.abs(p.getX(i)) < 0.05) centre = Math.max(centre, p.getZ(i));
        if (Math.abs(p.getX(i)) > xMax * 0.9) corner = Math.min(corner, p.getZ(i));
      }
      expect(centre - corner, id).toBeGreaterThan(0.04);
    }
  });
});
