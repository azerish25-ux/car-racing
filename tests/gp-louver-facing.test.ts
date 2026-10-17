import * as T from 'three';
import { describe, expect, it } from 'vitest';
import { gpCoolingLouvers } from '../src/rendering/gp-cooling-louvers.ts';

describe('GP mirrored cooling-outlet retainers', () => {
  it.each([-1, 1])('shows all four solid screw heads from exterior side %s', (side) => {
    const material = new T.MeshStandardMaterial();
    const group = gpCoolingLouvers('high', material, material);
    try {
      group.updateMatrixWorld(true);
      const bolts = group.getObjectByName('Flush titanium cooling-outlet retainers')!;
      for (const y of [-0.086, 0.021])
        for (const z of [0.23, 0.347]) {
          const hits = new T.Raycaster(
            new T.Vector3(side * 0.27, y, z),
            new T.Vector3(-side, 0, 0),
          ).intersectObject(bolts);
          expect(hits.length).toBeGreaterThan(0);
          expect(hits[0].point.x).toBeCloseTo(side * 0.2472, 6);
          expect(hits[0].face!.normal.x * side).toBeGreaterThan(0.99);
        }
    } finally {
      group.traverse((o) => {
        if (o instanceof T.Mesh) o.geometry.dispose();
      });
      material.dispose();
    }
  });
});
