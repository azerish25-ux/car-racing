import { readFile } from 'node:fs/promises';
import { expect, it } from 'vitest';
import * as T from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';

it('mounts both balcony finials on actual metal across the former air gap', async () => {
  const bytes = await readFile('public/models/solvane/detail-kit.glb');
  const buffer = new Uint8Array(bytes).buffer;
  const source = (await new GLTFLoader().parseAsync(buffer, '')).scene;
  source.updateMatrixWorld(true);
  const balcony = source.getObjectByName('balcony_near');
  expect(balcony).toBeDefined();
  try {
    for (const x of [-0.91, 0.91]) {
      // Above the rail and below the sphere: only a real mounting pin can hit.
      const ray = new T.Raycaster(new T.Vector3(x, 0.962, 0.55), new T.Vector3(0, 0, -1));
      const hits = ray.intersectObject(balcony!, true);
      expect(hits.length).toBeGreaterThan(0);
      expect(hits[0].distance).toBeGreaterThan(0.1);
      expect(hits[0].distance).toBeLessThan(0.17);
    }
  } finally {
    const materials = new Set<T.Material>();
    source.traverse((node) => {
      if (!(node instanceof T.Mesh)) return;
      node.geometry.dispose();
      for (const material of Array.isArray(node.material) ? node.material : [node.material])
        materials.add(material);
    });
    for (const material of materials) material.dispose();
  }
});
