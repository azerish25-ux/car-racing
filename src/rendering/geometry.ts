import * as T from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
/** Closed elliptical sections along +Z. Original, smooth bodywork rather than box primitives. */
export function loft(sections: readonly (readonly [number, number, number, number])[], sides = 32) {
  const p: number[] = [],
    uv: number[] = [],
    indices: number[] = [];
  for (let i = 0; i < sections.length; i++) {
    const [z, y, w, h] = sections[i];
    for (let j = 0; j <= sides; j++) {
      const a = (j / sides) * Math.PI * 2;
      p.push(Math.cos(a) * w, y + Math.sin(a) * h, z);
      uv.push(j / sides, i / (sections.length - 1));
    }
  }
  for (let i = 0; i < sections.length - 1; i++)
    for (let j = 0; j < sides; j++) {
      const a = i * (sides + 1) + j,
        b = a + sides + 1;
      indices.push(a, a + 1, b, a + 1, b + 1, b);
    }
  const g = new T.BufferGeometry();
  g.setAttribute('position', new T.Float32BufferAttribute(p, 3));
  g.setAttribute('uv', new T.Float32BufferAttribute(uv, 2));
  g.setIndex(indices);
  g.computeVertexNormals();
  return g;
}
export function mesh(parent: T.Object3D, g: T.BufferGeometry, m: T.Material, x = 0, y = 0, z = 0) {
  const o = new T.Mesh(g, m);
  o.position.set(x, y, z);
  o.castShadow = true;
  o.receiveShadow = true;
  parent.add(o);
  return o;
}
export function box(
  parent: T.Object3D,
  m: T.Material,
  x: number,
  y: number,
  z: number,
  w: number,
  h: number,
  d: number,
) {
  return mesh(parent, new T.BoxGeometry(w, h, d), m, x, y, z);
}
export function rod(parent: T.Object3D, m: T.Material, a: T.Vector3, b: T.Vector3, r = 0.016) {
  const o = mesh(parent, new T.CylinderGeometry(r, r, a.distanceTo(b), 10), m);
  o.position.copy(a).add(b).multiplyScalar(0.5);
  o.quaternion.setFromUnitVectors(new T.Vector3(0, 1, 0), b.clone().sub(a).normalize());
  return o;
}
export function tube(parent: T.Object3D, m: T.Material, points: number[][], r = 0.025) {
  return mesh(
    parent,
    new T.TubeGeometry(
      new T.CatmullRomCurve3(points.map((p) => new T.Vector3(...(p as [number, number, number])))),
      48,
      r,
      10,
      false,
    ),
    m,
  );
}
/** Merge only a deliberately static group; preserve every articulated part outside it.
 * Keep indexed vertices: expanding every triangle used several times the geometry
 * storage for each complete car. Inputs are cloned before transform/normalization;
 * a failed merge leaves the original group usable and releases temporary buffers. */
export function mergeStatic(group: T.Group) {
  group.updateMatrixWorld(true);
  const inverse = group.matrixWorld.clone().invert();
  const groups = new Map<T.Material, T.BufferGeometry[]>();
  const temporary: T.BufferGeometry[] = [];
  const merged: { material: T.Material; geometry: T.BufferGeometry }[] = [];
  try {
    group.traverse((o) => {
      if (!(o instanceof T.Mesh) || Array.isArray(o.material)) return;
      const g = o.geometry.clone();
      temporary.push(g);
      g.applyMatrix4(inverse.clone().multiply(o.matrixWorld));
      // An unindexed input already has a distinct vertex per corner. Giving it
      // a sequential index preserves every UV/normal seam; never weld by position.
      if (!g.index) {
        const count = g.getAttribute('position').count;
        const indices = count > 65535 ? new Uint32Array(count) : new Uint16Array(count);
        for (let i = 0; i < count; i++) indices[i] = i;
        g.setIndex(new T.BufferAttribute(indices, 1));
      }
      const list = groups.get(o.material);
      if (list) list.push(g);
      else groups.set(o.material, [g]);
    });
    for (const [material, geometries] of groups) {
      const geometry = mergeGeometries(geometries, false);
      if (!geometry) throw new Error('Static geometry has incompatible attributes');
      geometry.computeBoundingBox();
      geometry.computeBoundingSphere();
      merged.push({ material, geometry });
    }
  } catch (error) {
    for (const item of merged) item.geometry.dispose();
    throw error;
  } finally {
    for (const g of temporary) g.dispose();
  }
  const original = [...group.children];
  group.clear();
  for (const { material, geometry } of merged) mesh(group, geometry, material);
  const disposed = new Set<T.BufferGeometry>();
  for (const o of original)
    o.traverse((n) => {
      if (n instanceof T.Mesh && !disposed.has(n.geometry)) {
        disposed.add(n.geometry);
        n.geometry.dispose();
      }
    });
}
export function canvasTexture(
  width: number,
  height: number,
  draw: (c: CanvasRenderingContext2D) => void,
  settings?: CanvasRenderingContext2DSettings,
) {
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const c = canvas.getContext('2d', settings);
  if (!c) throw new Error('Canvas 2D unavailable');
  draw(c);
  const texture = new T.CanvasTexture(canvas);
  texture.colorSpace = T.SRGBColorSpace;
  texture.anisotropy = 8;
  // TextureBudget keeps the resampled copies of a CPU-read canvas CPU-backed too.
  if (settings?.willReadFrequently) texture.userData.cpuReadback = true;
  return texture;
}
export function label(text: string, bg = '#171d21', fg = '#f5eee2', w = 512, h = 128) {
  return canvasTexture(w, h, (c) => {
    c.fillStyle = bg;
    c.fillRect(0, 0, w, h);
    c.fillStyle = fg;
    c.font = `700 ${h * 0.52}px Arial`;
    c.textAlign = 'center';
    c.textBaseline = 'middle';
    c.fillText(text, w / 2, h / 2, w * 0.94);
  });
}

/** A printed board is printed on one face. Seen from behind, a double-sided
 * label showed its artwork mirrored; back faces now show a plain backing
 * colour instead, in the same draw call. */
export function unprintedBack<M extends T.MeshStandardMaterial>(material: M, back = 0x2b3236) {
  const colour = new T.Color(back);
  const previous = material.onBeforeCompile.bind(material);
  material.onBeforeCompile = (shader, renderer) => {
    previous(shader, renderer);
    shader.uniforms.printedBack = { value: colour };
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', '#include <common>\nuniform vec3 printedBack;')
      .replace(
        '#include <map_fragment>',
        '#include <map_fragment>\nif (!gl_FrontFacing) diffuseColor.rgb = printedBack;',
      );
  };
  const key = material.customProgramCacheKey.bind(material);
  material.customProgramCacheKey = () => `${key()}|unprinted-back-v1`;
  return material;
}

/** Batch static scene meshes while retaining instances and explicitly articulated roots. */
export function batchScene(root: T.Group, preserve: Set<T.Object3D>) {
  root.updateMatrixWorld(true);
  const inverse = root.matrixWorld.clone().invert(),
    groups = new Map<T.Material, Map<string, { geometries: T.BufferGeometry[]; source: T.Mesh }>>(),
    remove: T.Mesh[] = [];
  root.traverse((o) => {
    if (!(o instanceof T.Mesh) || o instanceof T.InstancedMesh || Array.isArray(o.material)) return;
    for (let p: T.Object3D | null = o; p; p = p.parent) if (preserve.has(p)) return;
    // A hidden ancestor may be revealed later. Do not bake its child into the
    // visible root and accidentally erase that visibility gate.
    for (let p = o.parent; p && p !== root; p = p.parent) if (!p.visible) return;
    const geometry = o.geometry.clone().applyMatrix4(inverse.clone().multiply(o.matrixWorld));
    // Spatial buckets preserve culling. Render ownership is part of the key so
    // batching cannot silently turn a non-shadow caster into a shadow caster.
    geometry.computeBoundingBox();
    const centre = geometry.boundingBox!.getCenter(new T.Vector3());
    const cell =
      `${Math.floor(centre.x / 80)}:${Math.floor(centre.z / 80)}:` +
      `${o.castShadow}:${o.receiveShadow}:${o.renderOrder}:${o.layers.mask}:${o.visible}:${o.frustumCulled}`;
    let cells = groups.get(o.material);
    if (!cells) {
      cells = new Map();
      groups.set(o.material, cells);
    }
    const list = cells.get(cell);
    if (list) list.geometries.push(geometry);
    else cells.set(cell, { geometries: [geometry], source: o });
    remove.push(o);
  });
  // Seal all batches before removing source meshes. Indexed clones preserve the
  // exact triangle corners while avoiding repeated static vertex storage.
  const batches: { material: T.Material; geometry: T.BufferGeometry; source: T.Mesh }[] = [];
  try {
    for (const [material, cells] of groups)
      for (const { geometries, source } of cells.values()) {
        for (const geometry of geometries) {
          // Retain the existing static-scene attribute contract. Animated and
          // instanced roots remain outside this batching path.
          for (const key of Object.keys(geometry.attributes))
            if (!['position', 'normal', 'uv'].includes(key)) geometry.deleteAttribute(key);
          if (!geometry.index) {
            const count = geometry.getAttribute('position').count;
            const index = count > 65535 ? new Uint32Array(count) : new Uint16Array(count);
            for (let i = 0; i < count; i++) index[i] = i;
            geometry.setIndex(new T.BufferAttribute(index, 1));
          }
        }
        const geometry = mergeGeometries(geometries, false);
        if (!geometry) throw new Error('Static scene has incompatible attributes');
        geometry.computeBoundingBox();
        geometry.computeBoundingSphere();
        batches.push({ material, geometry, source });
      }
  } catch (error) {
    for (const batch of batches) batch.geometry.dispose();
    throw error;
  } finally {
    for (const cells of groups.values())
      for (const { geometries } of cells.values())
        for (const geometry of geometries) geometry.dispose();
  }
  const disposed = new Set<T.BufferGeometry>();
  for (const object of remove) {
    object.removeFromParent();
    if (!disposed.has(object.geometry)) {
      disposed.add(object.geometry);
      object.geometry.dispose();
    }
  }
  for (const { material, geometry, source } of batches) {
    const batch = mesh(root, geometry, material);
    batch.name = `Static ${source.name || material.name || 'geometry'} batch`;
    batch.castShadow = source.castShadow;
    batch.receiveShadow = source.receiveShadow;
    batch.renderOrder = source.renderOrder;
    batch.layers.mask = source.layers.mask;
    batch.visible = source.visible;
    batch.frustumCulled = source.frustumCulled;
  }
}

/** Monocoque shell below an actual open cockpit. The upper arc is deliberately
 * absent, not hidden by material tricks. +Z remains the vehicle nose direction. */
export function cockpitShell(detail: 'high' | 'mid' | 'far' = 'high') {
  if (!['high', 'mid', 'far'].includes(detail)) throw new Error('Invalid cockpit detail');
  // z, width, rim height, cavity depth. The old four-ring open sheet left an
  // unmodelled gap below its padded rim and vanished at the distant LOD.
  const sections = [
    [-0.8, 0.287, 0.228, 0.465],
    [-0.63, 0.319, 0.218, 0.466],
    [-0.3, 0.326, 0.203, 0.455],
    [0.0, 0.33, 0.184, 0.428],
    [0.22, 0.316, 0.159, 0.385],
    [0.4, 0.296, 0.135, 0.342],
  ];
  const sides = detail === 'high' ? 32 : detail === 'mid' ? 16 : 8;
  const rows: number[][] = [];
  const subdivisions = detail === 'high' ? 4 : detail === 'mid' ? 2 : 1;
  for (let i = 0; i < sections.length - 1; i++)
    for (let j = 0; j < subdivisions; j++)
      rows.push(
        sections[i].map((v, axis) => T.MathUtils.lerp(v, sections[i + 1][axis], j / subdivisions)),
      );
  rows.push(sections.at(-1)!);
  const positions: number[] = [],
    uv: number[] = [],
    index: number[] = [];
  for (const inside of [false, true])
    for (const [z, width, rim, depth] of rows)
      for (let j = 0; j <= sides; j++) {
        const a = Math.PI + (j / sides) * Math.PI;
        positions.push(
          Math.cos(a) * (width - (inside ? 0.019 : 0)),
          rim + Math.sin(a) * (depth - (inside ? 0.019 : 0)),
          z,
        );
        uv.push(j / sides, (z + 0.8) / 1.2);
      }
  const stride = sides + 1,
    skin = rows.length * stride;
  for (let row = 0; row < rows.length - 1; row++)
    for (let j = 0; j < sides; j++) {
      const a = row * stride + j,
        b = a + stride;
      index.push(a, a + 1, b, a + 1, b + 1, b);
      index.push(a + skin, b + skin, a + 1 + skin, a + 1 + skin, b + skin, b + 1 + skin);
    }
  const rim = (a: number, b: number) => {
    const base = positions.length / 3;
    for (const v of [a, b, b + skin, a + skin]) {
      positions.push(...positions.slice(v * 3, v * 3 + 3));
      uv.push(v === a || v === a + skin ? 0 : 1, v >= skin ? 1 : 0);
    }
    index.push(base, base + 1, base + 2, base, base + 2, base + 3);
  };
  for (let j = 0; j < sides; j++) {
    rim(j + 1, j);
    rim((rows.length - 1) * stride + j, (rows.length - 1) * stride + j + 1);
  }
  for (let row = 0; row < rows.length - 1; row++) {
    rim(row * stride, (row + 1) * stride);
    rim((row + 1) * stride + sides, row * stride + sides);
  }
  const geometry = new T.BufferGeometry();
  geometry.setAttribute('position', new T.Float32BufferAttribute(positions, 3));
  geometry.setAttribute('uv', new T.Float32BufferAttribute(uv, 2));
  geometry.setIndex(index);
  geometry.computeVertexNormals();
  geometry.computeBoundingBox();
  geometry.computeBoundingSphere();
  return geometry;
}
