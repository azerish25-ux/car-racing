const W = '/home/user/Experiment-3/.claude/worktrees/wf_466ee687-d89-2/src';
const T = await import('/home/user/Experiment-3/node_modules/three/build/three.module.js');
const { VEHICLES } = await import(`${W}/simulation/vehicles.ts`);
const { bodySheetFor } = await import(`${W}/rendering/vehicle-bodies/body-sheet.ts`);
const { buildVehicleBody } = await import(`${W}/rendering/vehicle-bodies/index.ts`);
const { cabinFor, CABIN_MOTION_LIMIT } = await import(`${W}/rendering/vehicle-bodies/cabin.ts`);
const drawn = (o: any, root: any) => { for (let p = o; p && p !== root; p = p.parent) if (!p.visible) return false; return true; };
function clearance(root: any, point: any) {
  root.updateMatrixWorld(true);
  const tri = new T.Triangle(), a = new T.Vector3(), b = new T.Vector3(), c = new T.Vector3(), q = new T.Vector3(), box = new T.Box3();
  let best = Infinity, name = '';
  root.traverse((o: any) => {
    if (!(o instanceof T.Mesh) || !drawn(o, root)) return;
    const g = o.geometry; g.computeBoundingBox();
    box.copy(g.boundingBox).applyMatrix4(o.matrixWorld).expandByScalar(0.2);
    if (!box.containsPoint(point)) return;
    const p = g.getAttribute('position'), index = g.index;
    const count = index ? index.count : p.count;
    const ranges = Array.isArray(o.material) && g.groups.length ? g.groups : [{ start: 0, count }];
    for (const r of ranges) for (let k = r.start; k < r.start + r.count; k += 3) {
      const i0 = index ? index.getX(k) : k, i1 = index ? index.getX(k + 1) : k + 1, i2 = index ? index.getX(k + 2) : k + 2;
      tri.set(a.fromBufferAttribute(p, i0).applyMatrix4(o.matrixWorld), b.fromBufferAttribute(p, i1).applyMatrix4(o.matrixWorld), c.fromBufferAttribute(p, i2).applyMatrix4(o.matrixWorld));
      const d = tri.closestPointToPoint(point, q).distanceTo(point);
      if (d < best) { best = d; name = o.name; }
    }
  });
  return { best, name };
}
const rows: any[] = [];
for (const def of Object.values(VEHICLES) as any[]) {
  const sheet = bodySheetFor(def); if (!sheet) continue;
  const b = buildVehicleBody(1, def, sheet);
  const cabin = b.lods[0].cabin; cabin.head.visible = false; cabin.detail.visible = true;
  const layout = cabinFor(def);
  const e = new T.Vector3(...layout.eye);
  const s = clearance(b.lods[0].group, e);
  let worst = { best: Infinity, name: '' };
  const m = CABIN_MOTION_LIMIT;
  for (const dx of [-1, 0, 1]) for (const dy of [-1, 0, 1]) for (const dz of [-1, 0, 1]) {
    const r = clearance(b.lods[0].group, e.clone().add(new T.Vector3(dx * m[0], dy * m[1], dz * m[2])));
    if (r.best < worst.best) worst = r;
  }
  // also mount eye clearance (head visible)
  cabin.head.visible = true;
  const mm = clearance(b.lods[0].group, new T.Vector3(...layout.mount.eye));
  rows.push([def.id, layout.family, layout.style, s.best.toFixed(3), s.name, worst.best.toFixed(3), worst.name, 'mount', layout.mount.kind, mm.best.toFixed(3), mm.name]);
}
rows.sort((x, y) => +x[5] - +y[5]);
for (const r of rows.slice(0, 15)) console.log(r.join(' | '));
console.log('mount sorted');
rows.sort((x, y) => +x[9] - +y[9]);
for (const r of rows.slice(0, 10)) console.log(r.join(' | '));
