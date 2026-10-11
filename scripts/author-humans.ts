/** Bakes the procedural people kit (sculpted SDF bodies and heads, QEM
 * decimated LODs, derived skin weights) into src/rendering/human-kit.json.
 *
 *   node --experimental-transform-types scripts/author-humans.ts
 *
 * The runtime only decodes quantised buffers; it never evaluates the sculpt. */
import { createHash } from 'node:crypto';
import { writeFileSync } from 'node:fs';
import {
  sculptCrewBody,
  sculptHead,
  sculptHand,
  sculptSpectator,
  type SculptedMesh,
} from './lib/human-sculpt.ts';

const only = process.argv[2];
const out: Record<string, unknown> = {};
const b64 = (a: ArrayBufferView) =>
  Buffer.from(a.buffer, a.byteOffset, a.byteLength).toString('base64');

function pack(name: string, mesh: SculptedMesh, extra: Record<string, unknown> = {}) {
  const n = mesh.positions.length / 3;
  if (n >= 65536) throw new Error(`${name}: too many vertices`);
  const min = [Infinity, Infinity, Infinity],
    max = [-Infinity, -Infinity, -Infinity];
  for (let i = 0; i < n * 3; i++) {
    min[i % 3] = Math.min(min[i % 3], mesh.positions[i]);
    max[i % 3] = Math.max(max[i % 3], mesh.positions[i]);
  }
  const position = new Uint16Array(n * 3);
  for (let i = 0; i < n * 3; i++)
    position[i] = Math.round(
      ((mesh.positions[i] - min[i % 3]) / (max[i % 3] - min[i % 3] || 1)) * 65535,
    );
  const normal = new Int8Array(n * 3);
  for (let i = 0; i < n * 3; i++) normal[i] = Math.round(mesh.normals[i] * 127);
  const entry: Record<string, unknown> = {
    vertices: n,
    triangles: mesh.indices.length / 3,
    min,
    max,
    position: b64(position),
    normal: b64(normal),
    index: b64(Uint16Array.from(mesh.indices)),
    ...extra,
  };
  if (mesh.joints && mesh.weights) {
    const weights = new Uint8Array(n * 4);
    for (let i = 0; i < n; i++) {
      let used = 0;
      for (let k = 1; k < 4; k++) {
        weights[i * 4 + k] = Math.round(mesh.weights[i * 4 + k] * 255);
        used += weights[i * 4 + k];
      }
      weights[i * 4] = 255 - used;
    }
    entry.joints = b64(mesh.joints);
    entry.weights = b64(weights);
  }
  if (mesh.cloth)
    entry.cloth = b64(Uint8Array.from(mesh.cloth, (c) => (c > 0.75 ? 255 : c > 0.25 ? 127 : 0)));
  if (mesh.standing) {
    const standing = new Uint16Array(n * 3);
    const smin = [Infinity, Infinity, Infinity],
      smax = [-Infinity, -Infinity, -Infinity];
    for (let i = 0; i < n * 3; i++) {
      smin[i % 3] = Math.min(smin[i % 3], mesh.standing[i]);
      smax[i % 3] = Math.max(smax[i % 3], mesh.standing[i]);
    }
    for (let i = 0; i < n * 3; i++)
      standing[i] = Math.round(
        ((mesh.standing[i] - smin[i % 3]) / (smax[i % 3] - smin[i % 3] || 1)) * 65535,
      );
    const standingNormal = Int8Array.from(mesh.standingNormal!, (v) => Math.round(v * 127));
    Object.assign(entry, {
      standingMin: smin,
      standingMax: smax,
      standing: b64(standing),
      standingNormal: b64(standingNormal),
    });
  }
  if (mesh.tags) entry.tags = b64(mesh.tags);
  if (mesh.zone) entry.zone = b64(mesh.zone);
  out[name] = entry;
  console.log(name, n, 'vertices', mesh.indices.length / 3, 'triangles');
}

const jobs: [string, () => SculptedMesh][] = [];
for (const kit of ['polo', 'suit'] as const)
  [
    [0.0085, 9000],
    [0.015, 3000],
    [0.028, 1000],
  ].forEach(([cell, tris], lod) =>
    jobs.push([`body_${kit}_${lod}`, () => sculptCrewBody(kit, cell, tris)]),
  );
for (const wear of ['bare', 'cap', 'headset', 'cap-headset'] as const)
  [
    [0.0026, 5200],
    [0.0045, 1700],
    [0.009, 480],
  ].forEach(([cell, tris], lod) =>
    jobs.push([`head_${wear}_${lod}`, () => sculptHead(wear, cell, tris)]),
  );
[
  [0.0024, 1400],
  [0.0045, 420],
].forEach(([cell, tris], lod) => {
  jobs.push([`hand_${lod}`, () => sculptHand(cell, tris)]);
  jobs.push([`handbare_${lod}`, () => sculptHand(cell, tris, true)]);
});
for (const variant of ['a', 'b'] as const)
  [
    [0.0085, 2200],
    [0.016, 1050],
    [0.028, 545],
  ].forEach(([cell, tris], lod) =>
    jobs.push([`spectator_${variant}_${lod}`, () => sculptSpectator(variant, cell, tris, lod < 2)]),
  );

for (const [name, job] of jobs) {
  if (only && !name.startsWith(only)) continue;
  const t = performance.now();
  pack(name, job());
  console.log('  ', ((performance.now() - t) / 1000).toFixed(1), 's');
}
const path = new URL('../src/rendering/human-kit.json', import.meta.url);
let previous: Record<string, unknown> = {};
if (only) {
  try {
    previous = (
      JSON.parse((await import('node:fs')).readFileSync(path, 'utf8')) as {
        meshes: Record<string, unknown>;
      }
    ).meshes;
  } catch {
    previous = {};
  }
}
const meshes = { ...previous, ...out };
const body = JSON.stringify({
  version: 1,
  units: 'metres-Y-up',
  source: 'scripts/author-humans.ts',
  meshes,
});
writeFileSync(
  path,
  JSON.stringify({
    version: 1,
    units: 'metres-Y-up',
    source: 'scripts/author-humans.ts',
    sha256: createHash('sha256').update(body).digest('hex'),
    meshes,
  }) + '\n',
);
