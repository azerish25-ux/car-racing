const W = '/home/user/Experiment-3/.claude/worktrees/wf_466ee687-d89-2/src';
const T = await import('/home/user/Experiment-3/node_modules/three/build/three.module.js');
const { VEHICLES } = await import(`${W}/simulation/vehicles.ts`);
const { bodySheetFor } = await import(`${W}/rendering/vehicle-bodies/body-sheet.ts`);
const { buildVehicleBody } = await import(`${W}/rendering/vehicle-bodies/index.ts`);
const { cabinFor, cabinDirection } = await import(`${W}/rendering/vehicle-bodies/cabin.ts`);
const drawn = (o: any, root: any) => { for (let p = o; p && p !== root; p = p.parent) if (!p.visible) return false; return true; };
function nearest(root: any, point: any) {
  root.updateMatrixWorld(true);
  const tri = new T.Triangle(), a = new T.Vector3(), b = new T.Vector3(), c = new T.Vector3(), q = new T.Vector3();
  let best = Infinity, name = '', mat = '', at = new T.Vector3();
  root.traverse((o: any) => {
    if (!(o instanceof T.Mesh) || !drawn(o, root)) return;
    const g = o.geometry, p = g.getAttribute('position'), index = g.index;
    const count = index ? index.count : p.count;
    for (let k = 0; k < count; k += 3) {
      const i0 = index ? index.getX(k) : k, i1 = index ? index.getX(k + 1) : k + 1, i2 = index ? index.getX(k + 2) : k + 2;
      tri.set(a.fromBufferAttribute(p, i0).applyMatrix4(o.matrixWorld), b.fromBufferAttribute(p, i1).applyMatrix4(o.matrixWorld), c.fromBufferAttribute(p, i2).applyMatrix4(o.matrixWorld));
      const d = tri.closestPointToPoint(point, q).distanceTo(point);
      if (d < best) { best = d; name = o.name; mat = Array.isArray(o.material) ? 'multi' : o.material.name || o.material.color?.getHexString(); at.copy(q); }
    }
  });
  return { best, name, mat, at };
}
for (const id of process.argv.slice(2)) {
  const def = VEHICLES[id];
  const b = buildVehicleBody(1, def, bodySheetFor(def));
  const cabin = b.lods[0].cabin; cabin.detail.visible = true; cabin.head.visible = true;
  const layout = cabinFor(def);
  const e = new T.Vector3(...layout.mount.eye);
  const r = nearest(b.lods[0].group, e);
  const dir = cabinDirection(layout.mount, new T.Vector3());
  const rel = r.at.clone().sub(e);
  const ray = new T.Raycaster(e, dir, 0, 3);
  const hit = ray.intersectObject(b.lods[0].group, true).find((h: any) => drawn(h.object, b.lods[0].group));
  // cast a fan of rays in the frustum, report the closest hit distance
  let minHit = Infinity, minName = '';
  for (let yaw = -0.8; yaw <= 0.8; yaw += 0.1) for (let pitch = -0.5; pitch <= 0.5; pitch += 0.1) {
    const d = new T.Vector3(Math.sin(yaw), Math.sin(layout.mount.pitch + pitch), Math.cos(yaw)).normalize();
    const h = new T.Raycaster(e, d, 0, 3).intersectObject(b.lods[0].group, true).find((h: any) => drawn(h.object, b.lods[0].group));
    if (h && h.distance < minHit) { minHit = h.distance; minName = `${h.object.name} yaw ${yaw.toFixed(1)} pitch ${pitch.toFixed(1)}`; }
  }
  console.log(id, layout.mount.kind, 'eye', layout.mount.eye.map((v: number) => v.toFixed(3)).join(','), 'nearest', r.best.toFixed(3), r.name, r.mat, 'rel', rel.toArray().map((v: number) => v.toFixed(3)).join(','), '| gaze hit', hit ? hit.distance.toFixed(3) + ' ' + hit.object.name : 'none', '| frustum min hit', minHit.toFixed(3), minName);
}
