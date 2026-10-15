const W = '/home/user/Experiment-3/.claude/worktrees/wf_466ee687-d89-2/src';
const T = await import('/home/user/Experiment-3/node_modules/three/build/three.module.js');
const { VEHICLES } = await import(`${W}/simulation/vehicles.ts`);
const { bodySheetFor } = await import(`${W}/rendering/vehicle-bodies/body-sheet.ts`);
const { buildVehicleBody } = await import(`${W}/rendering/vehicle-bodies/index.ts`);
const { cabinFor } = await import(`${W}/rendering/vehicle-bodies/cabin.ts`);
const { bodyFrame } = await import(`${W}/rendering/vehicle-bodies/frame.ts`);
for (const id of process.argv.slice(2)) {
  const def = VEHICLES[id], b = buildVehicleBody(1, def, bodySheetFor(def)), L = cabinFor(def), f = bodyFrame(def);
  const e = new T.Vector3(...L.mount.eye);
  console.log(id, 'mount', L.mount.kind, e.toArray().map((v: number) => v.toFixed(3)), 'frontAxle', f.frontAxle.toFixed(3), 'wheel centre', L.wheel.centre.map((v: number) => v.toFixed(3)), 'eye', L.eye.map((v: number) => v.toFixed(3)));
  const root = b.lods[0].group; root.updateMatrixWorld(true);
  // For each merged mesh, count triangles whose bbox is within 3 cm of the eye.
  const tri = new T.Triangle(), a = new T.Vector3(), bb = new T.Vector3(), c = new T.Vector3(), q = new T.Vector3();
  root.traverse((o: any) => {
    if (!(o instanceof T.Mesh)) return;
    const g = o.geometry, p = g.getAttribute('position'), idx = g.index; const n = idx ? idx.count : p.count;
    let close = 0; const box = new T.Box3();
    for (let k = 0; k < n; k += 3) {
      const i0 = idx ? idx.getX(k) : k, i1 = idx ? idx.getX(k + 1) : k + 1, i2 = idx ? idx.getX(k + 2) : k + 2;
      tri.set(a.fromBufferAttribute(p, i0).applyMatrix4(o.matrixWorld), bb.fromBufferAttribute(p, i1).applyMatrix4(o.matrixWorld), c.fromBufferAttribute(p, i2).applyMatrix4(o.matrixWorld));
      if (tri.closestPointToPoint(e, q).distanceTo(e) < 0.03) { close++; box.expandByPoint(a); box.expandByPoint(bb); box.expandByPoint(c); }
    }
    if (close) console.log('  ', o.name, Array.isArray(o.material) ? 'multi' : o.material.name || '#' + o.material.color?.getHexString(), close, 'tris; bbox', box.min.toArray().map((v: number) => v.toFixed(3)), box.max.toArray().map((v: number) => v.toFixed(3)));
  });
}
