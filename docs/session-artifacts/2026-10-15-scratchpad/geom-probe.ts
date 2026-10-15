import * as T from 'three';
const R = process.env.ROOT!;
const { VEHICLES } = await import(R + '/src/simulation/vehicles.ts');
const { bodySheetFor } = await import(R + '/src/rendering/vehicle-bodies/body-sheet.ts');
const { buildVehicleBody } = await import(R + '/src/rendering/vehicle-bodies/index.ts');
const ids = ['tc1','jf2','hf67','hy9','pr2','gt8f','gt10m','gs4','tc2','cr1','rl2','rcx6','dx8','sk125','eh3','sc7'];
const out: Record<string, string> = {};
for (const id of ids) {
  const def = VEHICLES[id];
  const body = buildVehicleBody(1, def, bodySheetFor(def)!);
  const parts: string[] = [];
  body.lods.forEach((l: any) => {
    let n = 0, h = 0;
    l.group.updateMatrixWorld(true);
    const v = new T.Vector3();
    l.group.traverse((o: any) => {
      if (!(o instanceof T.Mesh)) return;
      const p = o.geometry.getAttribute('position');
      n += p.count;
      for (let i = 0; i < p.count; i += 7) { v.fromBufferAttribute(p, i).applyMatrix4(o.matrixWorld); h = (h * 31 + Math.round(v.x * 1000) * 7 + Math.round(v.y * 1000) * 13 + Math.round(v.z * 1000)) % 1000000007; }
    });
    parts.push(`${n}:${h}`);
  });
  out[id] = parts.join('/');
}
console.log(JSON.stringify(out));
