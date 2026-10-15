const W = process.env.SRC!;
const T = await import('/home/user/Experiment-3/node_modules/three/build/three.module.js');
const { VEHICLES } = await import(`${W}/simulation/vehicles.ts`);
const { bodySheetFor } = await import(`${W}/rendering/vehicle-bodies/body-sheet.ts`);
const { buildVehicleBody } = await import(`${W}/rendering/vehicle-bodies/index.ts`);
const drawn = (o: any, root: any) => { for (let p = o; p && p !== root; p = p.parent) if (!p.visible) return false; return true; };
const out: string[] = [];
for (const def of Object.values(VEHICLES) as any[]) {
  if (def.dynamicsKind !== 'four-wheel' || def.classId === 'kart') continue;
  const sheet = bodySheetFor(def); if (!sheet) continue;
  const b = buildVehicleBody(1, def, sheet);
  const c = b.lods[0].cabin; if (c) { c.detail.visible = true; c.head.visible = true; for (const w of c.wheelDetail) w.visible = true; }
  const cam = new T.PerspectiveCamera(66, 16 / 9, 0.045, 100);
  cam.position.set(0, 1.18, 0.35);
  cam.lookAt(new T.Vector3(0, 1.18 + 0.6, 0.35 + 30));
  cam.updateMatrixWorld();
  const root = b.lods[0].group; root.updateMatrixWorld(true);
  const ray = new T.Raycaster();
  let n = 0, near = 0; const names = new Map();
  for (let i = 0; i < 48; i++) for (let j = 0; j < 27; j++) {
    ray.setFromCamera(new T.Vector2((i + 0.5) / 48 * 2 - 1, (j + 0.5) / 27 * 2 - 1), cam);
    const h = ray.intersectObject(root, true).find((h: any) => drawn(h.object, root));
    n++;
    if (h && h.distance < 0.6) { near++; names.set(h.object.name, (names.get(h.object.name) ?? 0) + 1); }
  }
  out.push(`${def.id} ${(100 * near / n).toFixed(1)}% ${[...names.entries()].map(([k, v]) => `${k}:${v}`).join(',')}`);
}
console.log(out.join('\n'));
