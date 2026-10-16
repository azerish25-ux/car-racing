import * as T from 'three';
import { describe, expect, it } from 'vitest';
import { tripleClampGeometry } from '../src/rendering/bike.ts';
import { Rider } from '../src/rendering/rider.ts';

describe('machined GP steering detail', () => {
  it('retains an aligned helmet shadow without writing colour or depth over the onboard view', () => {
    // Far detail avoids Canvas-dependent artwork while using the same head
    // visibility and shadow code as both nearer levels.
    const rider = new Rider({ primary: 0xe43f28, secondary: 0x19212c, accent: 0xf1ebd4 }, 'far');
    try {
      const head = rider.root.getObjectByName('Rider head and helmet')!;
      const proxy = rider.root.getObjectByName('Onboard helmet shadow proxy')!;
      expect(proxy.visible).toBe(false);
      rider.setFirstPerson(true);
      for (const lean of [-1, 0, 1]) {
        rider.ride({ lean, offset: lean * 0.2, tuck: 0.7, braking: 0.3, steer: lean * 0.18 });
        rider.root.updateMatrixWorld(true);
        expect(head.visible).toBe(false);
        expect(proxy.visible).toBe(true);
        expect(proxy.matrixWorld.elements).toEqual(head.matrixWorld.elements);
        for (const child of proxy.children) {
          const mesh = child as T.Mesh<T.BufferGeometry, T.MeshBasicMaterial>;
          expect(mesh.castShadow).toBe(true);
          expect(mesh.material.colorWrite).toBe(false);
          expect(mesh.material.depthWrite).toBe(false);
          expect(mesh.material.alphaTest).toBe(0);
        }
      }
      rider.setFirstPerson(false);
      expect(head.visible).toBe(true);
      expect(proxy.visible).toBe(false);
    } finally {
      rider.dispose();
    }
  });

  it('keeps the existing fork tube and steering-stem bores open through both detail levels', () => {
    const material = new T.MeshBasicMaterial({ side: T.DoubleSide });
    const ray = new T.Raycaster(new T.Vector3(), new T.Vector3(0, -1, 0));
    try {
      for (const segments of [5, 9]) {
        const geometry = tripleClampGeometry(0.024, segments);
        const clamp = new T.Mesh(geometry, material);
        try {
          clamp.updateMatrixWorld(true);
          for (const side of [-1, 1])
            for (let sample = 0; sample < 16; sample++) {
              const angle = (sample / 16) * Math.PI * 2;
              // Existing outer tubes are radius 0.029 m at x=+/-0.105,
              // z=0.03. Check the circumference, not just the hole centre.
              ray.ray.origin.set(
                side * 0.105 + Math.cos(angle) * 0.029,
                0.15,
                0.03 + Math.sin(angle) * 0.029,
              );
              expect(ray.intersectObject(clamp)).toHaveLength(0);
            }
          ray.ray.origin.set(0, 0.15, -0.031);
          expect(ray.intersectObject(clamp)).toHaveLength(0);
          // A real bridge must still connect the two fork bosses to the stem.
          for (const x of [-0.032, 0.032]) {
            ray.ray.origin.set(x, 0.15, -0.029);
            expect(ray.intersectObject(clamp).length).toBeGreaterThan(0);
          }
        } finally {
          geometry.dispose();
        }
      }
    } finally {
      material.dispose();
    }
  });
});
