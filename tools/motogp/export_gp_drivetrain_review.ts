/** Export exact runtime geometry/instances for Blender, without a substitute art mesh.
 * node --experimental-transform-types tools/motogp/export_gp_drivetrain_review.ts --out DIR
 * No authoring output is written into the running game's source tree.
 */
import * as T from 'three';
import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { GPChainDrive } from '../../src/rendering/gp-chain-drive.ts';

const args = process.argv.slice(2);
const outIndex = args.indexOf('--out');
if (outIndex < 0 || !args[outIndex + 1]) throw new Error('Supply --out DIR');
const out = resolve(args[outIndex + 1]);
mkdirSync(out, { recursive: true });
const arm = 0.52;
const materials = [
  new T.MeshStandardMaterial({ color: 0x70767a, roughness: 0.32, metalness: 0.85 }),
  new T.MeshStandardMaterial({ color: 0x252b30, roughness: 0.42, metalness: 0.65 }),
  new T.MeshStandardMaterial({ color: 0x93989c, roughness: 0.3, metalness: 0.9 }),
] as const;
const chain = new GPChainDrive(arm, ...materials);
chain.update(0.15);
chain.sprocket.position.z = -arm;
chain.sprocket.rotation.x = 0.15;
chain.root.updateMatrixWorld(true);
chain.sprocket.updateMatrixWorld(true);
try {
  const meshes = [chain.rollers, chain.plates, chain.sprocket].map((mesh, material) => {
    const geometry = mesh.geometry;
    const p = geometry.getAttribute('position');
    const n = geometry.getAttribute('normal');
    const uv = geometry.getAttribute('uv');
    const index = geometry.index
      ? Array.from(geometry.index.array)
      : Array.from({ length: p.count }, (_, i) => i);
    const matrices: number[][] = [];
    if (mesh instanceof T.InstancedMesh) {
      const matrix = new T.Matrix4();
      for (let i = 0; i < mesh.count; i++) {
        mesh.getMatrixAt(i, matrix);
        matrices.push(matrix.premultiply(mesh.matrixWorld).toArray());
      }
    } else matrices.push(mesh.matrixWorld.toArray());
    return {
      name: mesh.name,
      material,
      position: Array.from(p.array),
      normal: Array.from(n.array),
      uv: Array.from(uv.array),
      index,
      matrices,
    };
  });
  const source = 'src/rendering/gp-chain-drive.ts';
  const output = {
    schema: 1,
    unit: 'metre',
    forward: '+Z',
    up: '+Y',
    arm,
    wheelPhase: 0.15,
    source,
    sourceSHA256: createHash('sha256').update(readFileSync(source)).digest('hex'),
    links: chain.links,
    expandedTriangles: meshes.reduce((n, m) => n + (m.index.length / 3) * m.matrices.length, 0),
    materials: materials.map((m) => ({
      colour: m.color.toArray(),
      roughness: m.roughness,
      metalness: m.metalness,
    })),
    meshes,
  };
  writeFileSync(resolve(out, 'gp-drivetrain-runtime.json'), JSON.stringify(output));
  console.log(
    JSON.stringify({
      sourceSHA256: output.sourceSHA256,
      links: output.links,
      triangles: output.expandedTriangles,
      out,
    }),
  );
} finally {
  chain.rollers.dispose();
  chain.plates.dispose();
  for (const mesh of [chain.rollers, chain.plates, chain.sprocket]) mesh.geometry.dispose();
  for (const material of materials) material.dispose();
}
