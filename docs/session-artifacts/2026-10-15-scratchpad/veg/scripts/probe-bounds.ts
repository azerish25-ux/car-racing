import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { parsePly } from '/home/user/Experiment-3/.claude/worktrees/wf_1ec31848-637-3/scripts/assets/vegetation/ply.ts';
import { plantParts } from '/home/user/Experiment-3/.claude/worktrees/wf_1ec31848-637-3/scripts/assets/vegetation/pbrt.ts';

const root = process.argv[2];
const scene = readFileSync(join(root, 'geometry/geometry.pbrt'), 'utf8');
for (const name of process.argv.slice(3)) {
  const parts = plantParts(scene, name);
  console.log(`== ${name}: ${parts.length} parts`);
  const all = [Infinity, Infinity, Infinity, -Infinity, -Infinity, -Infinity];
  for (const part of parts) {
    const t0 = Date.now();
    const mesh = parsePly(new Uint8Array(readFileSync(join(root, part.mesh))));
    const b = [Infinity, Infinity, Infinity, -Infinity, -Infinity, -Infinity];
    const m = part.transform;
    for (let i = 0; i < mesh.positions.length; i += 3) {
      const x = mesh.positions[i], y = mesh.positions[i + 1], z = mesh.positions[i + 2];
      const p = [m[0] * x + m[4] * y + m[8] * z + m[12], m[1] * x + m[5] * y + m[9] * z + m[13], m[2] * x + m[6] * y + m[10] * z + m[14]];
      for (let k = 0; k < 3; k++) {
        b[k] = Math.min(b[k], p[k]);
        b[k + 3] = Math.max(b[k + 3], p[k]);
        all[k] = Math.min(all[k], p[k]);
        all[k + 3] = Math.max(all[k + 3], p[k]);
      }
    }
    let uvMin = Infinity, uvMax = -Infinity;
    for (const v of mesh.uvs) { uvMin = Math.min(uvMin, v); uvMax = Math.max(uvMax, v); }
    console.log(
      part.mesh, part.material, 'tris', mesh.indices.length / 3, 'verts', mesh.positions.length / 3,
      'color', part.color, 'alpha', part.alpha, 'bump', part.bump, 'const', part.reflectance,
      'bounds', b.map((v) => v.toFixed(1)).join(' '), 'uv', uvMin.toFixed(2), uvMax.toFixed(2), `${Date.now() - t0} ms`,
      'T', m.map((v) => +v.toFixed(3)).join(','),
    );
  }
  console.log('ALL', all.map((v) => v.toFixed(1)).join(' '));
}
