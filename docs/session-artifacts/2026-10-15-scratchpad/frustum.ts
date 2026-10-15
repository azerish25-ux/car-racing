const W = '/home/user/Experiment-3/.claude/worktrees/wf_466ee687-d89-2/src';
const T = await import('/home/user/Experiment-3/node_modules/three/build/three.module.js');
const { VEHICLES } = await import(`${W}/simulation/vehicles.ts`);
const { bodySheetFor } = await import(`${W}/rendering/vehicle-bodies/body-sheet.ts`);
const { buildVehicleBody } = await import(`${W}/rendering/vehicle-bodies/index.ts`);
const { cabinFor, cabinFov, mountFov } = await import(`${W}/rendering/vehicle-bodies/cabin.ts`);
const drawn = (o: any, root: any) => { for (let p = o; p && p !== root; p = p.parent) if (!p.visible) return false; return true; };
const which = process.argv[2]; // 'mount' or 'cockpit'
for (const id of process.argv.slice(3)) {
  const def = VEHICLES[id];
  const b = buildVehicleBody(1, def, bodySheetFor(def));
  const cabin = b.lods[0].cabin; cabin.detail.visible = true; cabin.head.visible = which !== 'cockpit';
  const layout = cabinFor(def);
  const view = which === 'cockpit' ? layout.cockpit : layout.mount;
  const fov = which === 'cockpit' ? cabinFov(layout, 54) : mountFov(layout, 0);
  const cam = new T.PerspectiveCamera(fov, 16 / 9, 0.045, 100);
  cam.position.set(...view.eye);
  cam.lookAt(new T.Vector3(...view.eye).add(new T.Vector3(0, Math.sin(view.pitch), Math.cos(view.pitch))));
  cam.updateMatrixWorld();
  const root = b.lods[0].group; root.updateMatrixWorld(true);
  const ray = new T.Raycaster();
  let n = 0, nearHits = 0, clipped = 0; const names = new Map();
  for (let i = 0; i < 64; i++) for (let j = 0; j < 36; j++) {
    const ndc = new T.Vector2((i + 0.5) / 64 * 2 - 1, (j + 0.5) / 36 * 2 - 1);
    ray.setFromCamera(ndc, cam);
    ray.near = 0; ray.far = 50;
    const hits = ray.intersectObject(root, true).filter((h: any) => drawn(h.object, root));
    n++;
    // first hit regardless of side
    const h = hits[0];
    if (h && h.distance < 0.1) { nearHits++; names.set(h.object.name, (names.get(h.object.name) ?? 0) + 1); }
    // hits nearer than near plane (distance along ray < near / cos)
    if (h && h.distance < 0.06) clipped++;
  }
  console.log(id, which, `fov ${fov.toFixed(1)}`, `pixels with geometry <0.10 m: ${(100 * nearHits / n).toFixed(1)}%`, `<0.06 m: ${(100 * clipped / n).toFixed(1)}%`, [...names.entries()].map(([k, v]) => `${k}:${v}`).join(', '));
}
