const W = '/home/user/Experiment-3/.claude/worktrees/wf_9577868e-cce-1';
const T = await import('three');
const { VEHICLES } = await import(W + '/src/simulation/vehicles.ts');
const { BODY_SHEETS, bodySheetFor } = await import(W + '/src/rendering/vehicle-bodies/body-sheet.ts');
const { buildVehicleBody } = await import(W + '/src/rendering/vehicle-bodies/index.ts');
const BINS = 24;
function silhouette(root: any) {
  root.updateMatrixWorld(true);
  const box = new T.Box3().setFromObject(root), top = new Array(BINS).fill(0), side = new Array(BINS).fill(0), v = new T.Vector3();
  root.traverse((o: any) => {
    if (!(o instanceof T.Mesh)) return;
    const p = o.geometry.getAttribute('position');
    for (let i = 0; i < p.count; i++) {
      v.fromBufferAttribute(p, i).applyMatrix4(o.matrixWorld);
      const b = Math.min(BINS - 1, Math.floor(((v.z - box.min.z) / (box.max.z - box.min.z)) * BINS));
      top[b] = Math.max(top[b], v.y - box.min.y); side[b] = Math.max(side[b], Math.abs(v.x));
    }
  });
  return { top, side, length: box.max.z - box.min.z, h: box.max.y - box.min.y, w: box.max.x - box.min.x };
}
const shapes: any[] = [];
for (const def of Object.values(VEHICLES) as any[]) {
  if (def.id === 'apx01' || def.dynamicsKind !== 'four-wheel') continue;
  const body = buildVehicleBody(1, def, bodySheetFor(def)!);
  const s = silhouette(body.lods[0].group);
  shapes.push({ id: def.id, s, kind: BODY_SHEETS[def.id]?.kind ?? BODY_SHEETS[def.id]?.type });
}
const pairs: any[] = [];
for (let i = 0; i < shapes.length; i++) for (let j = i + 1; j < shapes.length; j++) {
  const a = shapes[i].s, b = shapes[j].s; let sum = 0;
  for (let k = 0; k < BINS; k++) sum += (a.top[k] - b.top[k]) ** 2 + (a.side[k] - b.side[k]) ** 2;
  pairs.push([Math.sqrt(sum / (2 * BINS) + (a.length - b.length) ** 2 / 4), shapes[i].id, shapes[j].id]);
}
pairs.sort((a, b) => a[0] - b[0]);
console.log(pairs.slice(0, 15).map((p) => p.map((x: any) => typeof x === 'number' ? x.toFixed(3) : x).join(' ')).join('\n'));
for (const s of shapes) console.log(s.id, s.s.length.toFixed(2), s.s.h.toFixed(2), s.s.w.toFixed(2));
