import * as T from 'three';
import type { RiderDetail } from './rider.ts';

/** Metric, symmetric GP-R1 side cooling exits. The original louvers were
 * modeled and inspected in Blender 5.2.2, then their control sections were
 * transferred to the synchronously constructed Three.js geometry. No texture
 * downloads, imported manufacturer models or moving meshes are introduced.
 * REF 001, 003, 018, 022, 049, 056, 060, 073.
 *
 * Two extra draw calls on high LOD, one on mid, zero on distant bikes.
 * Their dimensions are deliberately clear of the moving fork/wheel envelope.
 */
export function gpCoolingLouvers(
  detail: RiderDetail,
  carbon: T.Material,
  steel: T.Material,
): T.Group {
  const root = new T.Group();
  root.name = 'Blender-authored GP fairing cooling exits';
  if (detail === 'far') return root;

  const segments = detail === 'high' ? 10 : 4;
  const layers = detail === 'high' ? 4 : 3;
  const position: number[] = [];
  const uv: number[] = [];
  const index: number[] = [];
  const cap = (vertices: number[]) => {
    for (let i = 1; i < vertices.length - 1; i++)
      index.push(vertices[0], vertices[i], vertices[i + 1]);
  };
  for (const side of [-1, 1]) {
    for (let layer = 0; layer < layers; layer++) {
      const y = -0.065 + (layer * 0.065) / (layers - 1);
      const base = position.length / 3;
      for (let step = 0; step <= segments; step++) {
        const t = step / segments;
        const x = side * (0.2415 + 0.0028 * Math.sin(t * Math.PI) + 0.001 * (1 - t));
        const z = 0.231 + 0.114 * t;
        const chord = 0.012 * (0.75 + 0.25 * Math.sin(Math.PI * t));
        const slope = 0.0022 * (t - 0.5);
        const profile = [
          [x + side * 0.0018, y - chord / 2 + slope],
          [x + side * 0.003, y + chord * 0.32 + slope],
          [x - side * 0.0018, y + chord * 0.5 + slope],
          [x - side * 0.003, y - chord * 0.44 + slope],
        ];
        for (let corner = 0; corner < 4; corner++) {
          position.push(profile[corner][0], profile[corner][1], z);
          uv.push(t, corner / 3);
        }
      }
      for (let step = 0; step < segments; step++) {
        for (let corner = 0; corner < 4; corner++) {
          const a = base + 4 * step + corner;
          const b = base + 4 * step + ((corner + 1) % 4);
          const c = base + 4 * (step + 1) + ((corner + 1) % 4);
          const d = base + 4 * (step + 1) + corner;
          if (side > 0) index.push(a, b, c, a, c, d);
          else index.push(d, c, b, d, b, a);
        }
      }
      const start = Array.from({ length: 4 }, (_, i) => base + i);
      const end = Array.from({ length: 4 }, (_, i) => base + 4 * segments + i);
      cap(side > 0 ? [...start].reverse() : start);
      cap(side > 0 ? end : [...end].reverse());
    }
  }
  const geometry = new T.BufferGeometry();
  geometry.setAttribute('position', new T.Float32BufferAttribute(position, 3));
  geometry.setAttribute('uv', new T.Float32BufferAttribute(uv, 2));
  geometry.setIndex(index);
  geometry.computeVertexNormals();
  geometry.computeBoundingSphere();
  const vanes = new T.Mesh(geometry, carbon);
  vanes.name = 'Cambered carbon side-exit vanes';
  vanes.castShadow = vanes.receiveShadow = true;
  root.add(vanes);

  if (detail === 'high') {
    const screwPos: number[] = [];
    const screwUV: number[] = [];
    const screwIndices: number[] = [];
    for (const side of [-1, 1]) {
      for (const y of [-0.086, 0.021]) {
        for (const z of [0.23, 0.347]) {
          const base = screwPos.length / 3;
          for (const [radius, x] of [
            [0.004, side * 0.246],
            [0.0032, side * 0.2472],
          ]) {
            for (let i = 0; i < 10; i++) {
              const angle = (2 * Math.PI * i) / 10;
              const a = y + radius * Math.cos(angle);
              const b = z + radius * Math.sin(angle);
              screwPos.push(x, a, b);
              screwUV.push(a * 8, b * 8);
            }
          }
          for (let i = 0; i < 10; i++) {
            const a = base + i;
            const b = base + ((i + 1) % 10);
            const c = base + 10 + ((i + 1) % 10);
            const d = base + 10 + i;
            if (side > 0) screwIndices.push(a, b, c, a, c, d);
            else screwIndices.push(d, c, b, d, b, a);
          }
          // Mirroring X reverses the cap winding as well as the sidewall.
          // Otherwise the left screw heads are backfaces and disappear.
          for (let i = 1; i < 9; i++) {
            if (side > 0) screwIndices.push(base + 10, base + 10 + i, base + 10 + i + 1);
            else screwIndices.push(base + 10, base + 10 + i + 1, base + 10 + i);
          }
        }
      }
    }
    const metal = new T.BufferGeometry();
    metal.setAttribute('position', new T.Float32BufferAttribute(screwPos, 3));
    metal.setAttribute('uv', new T.Float32BufferAttribute(screwUV, 2));
    metal.setIndex(screwIndices);
    metal.computeVertexNormals();
    metal.computeBoundingSphere();
    const bolts = new T.Mesh(metal, steel);
    bolts.name = 'Flush titanium cooling-outlet retainers';
    bolts.castShadow = bolts.receiveShadow = true;
    root.add(bolts);
  }

  root.userData.authoredIn = 'Blender 5.2.2';
  root.userData.referenceRevision = 'motogp-100-r3';
  return root;
}
