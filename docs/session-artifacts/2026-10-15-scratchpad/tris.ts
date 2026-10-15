import * as T from '/home/user/Experiment-3/node_modules/three/build/three.module.js';
import { VEHICLES } from '/home/user/Experiment-3/.claude/worktrees/wf_466ee687-d89-2/src/simulation/vehicles.ts';
import { bodySheetFor } from '/home/user/Experiment-3/.claude/worktrees/wf_466ee687-d89-2/src/rendering/vehicle-bodies/body-sheet.ts';
import { buildVehicleBody } from '/home/user/Experiment-3/.claude/worktrees/wf_466ee687-d89-2/src/rendering/vehicle-bodies/index.ts';
const triangles = (root: T.Object3D) => {
  let n = 0;
  root.traverse((o) => {
    if (!(o instanceof T.Mesh)) return;
    const g = o.geometry as T.BufferGeometry;
    n += (g.index ? g.index.count : g.getAttribute('position').count) / 3;
  });
  return n;
};
const draws = (root: T.Object3D) => {
  let n = 0;
  root.traverse((o) => {
    if (!(o instanceof T.Mesh)) return;
    if (Array.isArray(o.material)) n += (o.geometry as T.BufferGeometry).groups.filter((g) => (o.material as T.Material[])[g.materialIndex!]?.visible !== false).length;
    else n++;
  });
  return n;
};
const ids = process.argv.slice(2);
for (const def of Object.values(VEHICLES)) {
  if (ids.length && !ids.includes(def.id)) continue;
  const sheet = bodySheetFor(def);
  if (!sheet) continue;
  const t0 = performance.now();
  const body = buildVehicleBody(1, def, sheet);
  const ms = performance.now() - t0;
  console.log(
    def.id.padEnd(6),
    body.lods.map((l) => `${triangles(l.group)}/${draws(l.group)}`).join('  '),
    'proxy',
    triangles(body.proxy),
    `${ms.toFixed(0)}ms`,
  );
}
