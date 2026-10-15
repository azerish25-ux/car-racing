const W = process.env.SRC!;
const T = await import('/home/user/Experiment-3/node_modules/three/build/three.module.js');
const { VEHICLES } = await import(`${W}/simulation/vehicles.ts`);
const { bodySheetFor } = await import(`${W}/rendering/vehicle-bodies/body-sheet.ts`);
const { buildVehicleBody } = await import(`${W}/rendering/vehicle-bodies/index.ts`);
const { sharedMaterials } = await import(`${W}/rendering/vehicle-bodies/materials.ts`);
const def = VEHICLES.bg2, b = buildVehicleBody(1, def, bodySheetFor(def));
const far = b.lods[2].group;
far.traverse((o: any) => { if (o instanceof T.Mesh && o.material === sharedMaterials.interior()) { const g = o.geometry; console.log('far LOD interior-material mesh', o.name, (g.index ? g.index.count : g.getAttribute('position').count) / 3, 'tris'); } });
// ray straight down through each seat centre against the proxy
const proxy = b.proxy; proxy.updateMatrixWorld(true);
(proxy.material as any).side = T.DoubleSide;
const zc = (await import(`${W}/rendering/vehicle-bodies/frame.ts`)).bodyFrame(def).z(bodySheetFor(def).cockpit);
for (const x of [-0.28, 0.28]) {
  const hits = new T.Raycaster(new T.Vector3(x, 3, zc - 0.05), new T.Vector3(0, -1, 0), 0, 10).intersectObject(proxy);
  console.log('seat x', x, 'proxy hits (y):', hits.map((h: any) => h.point.y.toFixed(3)).join(','));
}
