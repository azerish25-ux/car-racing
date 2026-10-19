import { readFileSync, writeFileSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { createHash } from 'node:crypto';
import * as T from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';

const directory = process.argv[2];
if (!directory) throw new Error('Usage: node scripts/verify-mx-trackside-glb.mjs OUTPUT_DIRECTORY');
const out = resolve(directory),
  bytes = readFileSync(join(out, 'mx-trackside-source.json'));
const source = JSON.parse(bytes),
  results = [];
if (
  createHash('sha256').update(bytes).digest('hex') !==
  readFileSync(join(out, 'mx-trackside-source.sha256'), 'utf8').trim()
)
  throw new Error('Source transport identity mismatch');
for (const variant of source.variants) {
  const buffer = readFileSync(join(out, `${variant.model}-${variant.detail}.glb`));
  const gltf = await new GLTFLoader().parseAsync(
    buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength),
    '',
  );
  gltf.scene.updateMatrixWorld(true);
  let triangles = 0,
    maximumPositionError = 0,
    maximumNormalError = 0,
    maximumColourError = 0;
  const seen = new Set();
  gltf.scene.traverse((o) => {
    if (!(o instanceof T.Mesh)) return;
    const i = o.userData.source_part;
    if (!Number.isInteger(i) || seen.has(i))
      throw new Error('Missing or duplicate source-part identity');
    seen.add(i);
    const p = variant.parts[i],
      a = p.attributes,
      g = o.geometry;
    const position = g.getAttribute('position'),
      normal = g.getAttribute('normal'),
      color = g.getAttribute('color');
    const count = g.index?.count ?? position.count;
    if (count !== a.position.length / 3) throw new Error(`Triangle count changed: ${p.name}`);
    triangles += count / 3;
    const normalMatrix = new T.Matrix3().getNormalMatrix(o.matrixWorld);
    for (let j = 0; j < count; j++) {
      const index = g.index ? g.index.getX(j) : j;
      const actual = new T.Vector3()
        .fromBufferAttribute(position, index)
        .applyMatrix4(o.matrixWorld);
      const expected = new T.Vector3().fromArray(a.position, j * 3);
      maximumPositionError = Math.max(maximumPositionError, actual.distanceTo(expected));
      const n = new T.Vector3().fromBufferAttribute(normal, index).applyNormalMatrix(normalMatrix);
      const en = new T.Vector3().fromArray(a.normal, j * 3).normalize();
      maximumNormalError = Math.max(maximumNormalError, n.distanceTo(en));
      if (!color) throw new Error('Lost authored vertex colours');
      maximumColourError = Math.max(
        maximumColourError,
        Math.abs(color.getX(index) - a.color[j * 3]),
        Math.abs(color.getY(index) - a.color[j * 3 + 1]),
        Math.abs(color.getZ(index) - a.color[j * 3 + 2]),
      );
    }
  });
  // Blender encodes editable custom split normals; allow at most 0.3 degrees.
  if (
    seen.size !== variant.parts.length ||
    triangles !== variant.triangles ||
    maximumPositionError > 0.00002 ||
    maximumNormalError > 2 * Math.sin((0.3 * Math.PI) / 360) ||
    maximumColourError > 0.005
  )
    throw new Error(
      JSON.stringify({
        model: variant.model,
        detail: variant.detail,
        seen: seen.size,
        triangles,
        maximumPositionError,
        maximumNormalError,
        maximumColourError,
      }),
    );
  results.push({
    model: variant.model,
    detail: variant.detail,
    parts: seen.size,
    triangles,
    maximumPositionError,
    maximumNormalError,
    maximumColourError,
    passed: true,
  });
  gltf.scene.traverse((o) => {
    if (o instanceof T.Mesh) {
      o.geometry.dispose();
      (Array.isArray(o.material) ? o.material : [o.material]).forEach((m) => m.dispose());
    }
  });
}
writeFileSync(
  join(out, 'glb-verification.json'),
  JSON.stringify({ passed: true, results }, null, 2) + '\n',
);
console.log(JSON.stringify({ passed: true, results }, null, 2));
