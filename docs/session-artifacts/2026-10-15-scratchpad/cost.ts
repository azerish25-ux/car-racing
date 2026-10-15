const W = process.env.SRC!;
const T = await import('/home/user/Experiment-3/node_modules/three/build/three.module.js');
const { VEHICLES } = await import(`${W}/simulation/vehicles.ts`);
const { bodySheetFor } = await import(`${W}/rendering/vehicle-bodies/body-sheet.ts`);
const { buildVehicleBody } = await import(`${W}/rendering/vehicle-bodies/index.ts`);
const drawn = (o: any, root: any) => { for (let p = o; p && p !== root; p = p.parent) if (!p.visible) return false; return true; };
function cost(root: any, skipDetail: boolean) {
  let draws = 0, tris = 0;
  root.traverse((o: any) => {
    if (!(o instanceof T.Mesh)) return;
    if (!drawn(o, root)) return;
    const g = o.geometry; const count = g.index ? g.index.count : g.getAttribute('position').count;
    if (Array.isArray(o.material) && g.groups.length) { for (const gr of g.groups) { draws++; tris += gr.count / 3; } }
    else { draws++; tris += count / 3; }
  });
  return { draws, tris: Math.round(tris) };
}
const out: Record<string, any> = {};
for (const def of Object.values(VEHICLES) as any[]) {
  const sheet = bodySheetFor(def); if (!sheet) continue;
  const b = buildVehicleBody(1, def, sheet);
  const c = b.lods[0].cabin;
  if (c) { c.detail.visible = false; for (const w of c.wheelDetail) w.visible = false; }
  const l0 = cost(b.lods[0].group, true);
  let l0d = l0;
  if (c) { c.detail.visible = true; for (const w of c.wheelDetail) w.visible = true; l0d = cost(b.lods[0].group, false); }
  const l1 = cost(b.lods[1].group, true), l2 = cost(b.lods[2].group, true);
  const pg = b.proxy.geometry; const pt = (pg.index ? pg.index.count : pg.getAttribute('position').count) / 3;
  out[def.id] = { l0, l0d, l1, l2, proxy: pt };
}
console.log(JSON.stringify(out));
