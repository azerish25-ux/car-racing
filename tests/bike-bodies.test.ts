import * as T from 'three';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { VEHICLES } from '../src/simulation/vehicles.ts';
import { BikeMaterials, BikeModel } from '../src/rendering/bike.ts';
import { BIKE_SHEETS, bikeSheetFor, DEFAULT_BIKE_SHEET } from '../src/rendering/bike-sheet.ts';

/** Road-motorcycle presentation (WP34, catalogue growth): every road bike
 * builds three cheaper-by-level models from its body sheet, and no two bikes
 * share a silhouette. Canvas textures (paint, carbon, number plates) are
 * stubbed: geometry is what is measured. */
const ROAD_BIKE_CLASSES = new Set([
  'gp-bike',
  'superbike',
  'supersport',
  'classic-bike',
  'road-bike',
]);
const roadBikes = Object.values(VEHICLES).filter(
  (v) => v.dynamicsKind === 'bike' && ROAD_BIKE_CLASSES.has(v.classId),
);
beforeAll(() => {
  const ctx = new Proxy(
    {},
    {
      get: (_, key) =>
        key === 'createLinearGradient' || key === 'createRadialGradient'
          ? () => ({ addColorStop: () => undefined })
          : key === 'measureText'
            ? () => ({ width: 10 })
            : () => undefined,
      set: () => true,
    },
  );
  vi.stubGlobal('document', {
    createElement: () => ({ width: 0, height: 0, getContext: () => ctx }),
  });
});
afterAll(() => vi.unstubAllGlobals());
const triangles = (root: T.Object3D) => {
  let n = 0;
  root.traverse((o) => {
    if (!(o instanceof T.Mesh)) return;
    const g = o.geometry as T.BufferGeometry;
    n +=
      ((g.index ? g.index.count : g.getAttribute('position').count) / 3) *
      (o instanceof T.InstancedMesh ? o.count : 1);
  });
  return n;
};
const BINS = 20;
/** Side outline (top height per station) and plan half width per station,
 * from the posed near model (rider included: a bike's silhouette is rider and
 * machine together). */
function signature(root: T.Object3D) {
  root.updateMatrixWorld(true);
  const box = new T.Box3().setFromObject(root),
    top = new Array<number>(BINS).fill(0),
    side = new Array<number>(BINS).fill(0),
    v = new T.Vector3();
  root.traverse((o) => {
    if (!(o instanceof T.Mesh)) return;
    const p = (o.geometry as T.BufferGeometry).getAttribute('position');
    for (let i = 0; i < p.count; i++) {
      v.fromBufferAttribute(p, i).applyMatrix4(o.matrixWorld);
      const b = Math.min(
        BINS - 1,
        Math.floor(((v.z - box.min.z) / (box.max.z - box.min.z)) * BINS),
      );
      top[b] = Math.max(top[b], v.y - box.min.y);
      side[b] = Math.max(side[b], Math.abs(v.x));
    }
  });
  return { top, side, box };
}
const pose = {
  fork: 0,
  shock: 0,
  steer: 0,
  frontRotation: 0,
  rearRotation: 0,
  chassisLean: 0,
  riderOffset: 0,
  tuck: 0,
  brake: 0,
  rearBrake: 0,
  discTemp: 300,
  compoundColour: 0xffffff,
  riding: true,
};
describe('road motorcycle bodies (bike sheets)', () => {
  it('keeps the original design for GP-R1 and SBK-1000 and a sheet for every other road bike', () => {
    expect(Object.hasOwn(BIKE_SHEETS, 'gpr1')).toBe(false);
    expect(Object.hasOwn(BIKE_SHEETS, 'sbk1000')).toBe(false);
    expect(bikeSheetFor(VEHICLES.sbk1000)).toBe(DEFAULT_BIKE_SHEET);
    expect(bikeSheetFor(VEHICLES.gpr1).wings).toBe('stacked');
    for (const def of roadBikes)
      if (def.id !== 'gpr1' && def.id !== 'sbk1000')
        expect(Object.hasOwn(BIKE_SHEETS, def.id), def.id).toBe(true);
    expect(roadBikes.length).toBeGreaterThanOrEqual(6);
  });
  it('builds three cheaper levels inside the collision box, with distinct silhouettes', () => {
    const signatures: { id: string; sig: ReturnType<typeof signature> }[] = [];
    for (const def of roadBikes) {
      const materials = new BikeMaterials(1);
      const models = (['high', 'mid', 'far'] as const).map((detail) => {
        const model = new BikeModel(def, 1, detail, materials, detail === 'high');
        model.pose({ ...pose, fork: 0.03, shock: 0.03 });
        return model;
      });
      const counts = models.map((m) => triangles(m.root));
      expect(counts[0], def.id).toBeGreaterThan(counts[1]);
      expect(counts[1], def.id).toBeGreaterThan(counts[2]);
      expect(counts[0], def.id).toBeLessThan(200000);
      const sig = signature(models[0].root);
      // Machine and rider fit the bike's own collision box (generous margin
      // for the rider's helmet and elbows).
      expect(sig.box.max.z, def.id).toBeLessThan(def.halfExtents[2] + 0.35);
      expect(sig.box.min.z, def.id).toBeGreaterThan(-def.halfExtents[2] - 0.35);
      expect(sig.box.max.x - sig.box.min.x, def.id).toBeLessThan(def.halfExtents[0] * 2 + 0.45);
      signatures.push({ id: def.id, sig });
      for (const m of models) m.dispose();
      materials.dispose();
    }
    // RMS difference of the side and plan outlines (m): every pair of road
    // bikes must differ by more than 2 cm, i.e. visibly.
    let closest = Infinity,
      pair = '';
    for (let i = 0; i < signatures.length; i++)
      for (let j = i + 1; j < signatures.length; j++) {
        const a = signatures[i].sig,
          b = signatures[j].sig;
        let s = 0;
        for (let k = 0; k < BINS; k++)
          s += (a.top[k] - b.top[k]) ** 2 + (a.side[k] - b.side[k]) ** 2;
        const d = Math.sqrt(s / (2 * BINS));
        if (d < closest) [closest, pair] = [d, `${signatures[i].id}/${signatures[j].id}`];
      }
    expect(closest, pair).toBeGreaterThan(0.02);
  });
});
