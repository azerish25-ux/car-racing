import * as T from 'three';
const ctx: any = new Proxy({}, { get: (_, key) => key === 'createLinearGradient' || key === 'createRadialGradient' ? () => ({ addColorStop: () => undefined }) : key === 'measureText' ? () => ({ width: 10 }) : () => undefined, set: () => true });
(globalThis as any).document = { createElement: () => ({ width: 0, height: 0, getContext: () => ctx }) };
const R = process.env.ROOT!;
const { VEHICLES } = await import(R + '/src/simulation/vehicles.ts');
const B = await import(R + '/src/rendering/bike.ts');
const out: Record<string, string> = {};
for (const id of ['gpr1', 'sbk1000']) {
  const def = VEHICLES[id];
  const Mat = (B as any).BikeMaterials;
  const parts: string[] = [];
  for (const detail of ['high', 'mid', 'far']) {
    let model: any;
    if (Mat) model = new B.BikeModel(def, 1, detail as any, new Mat(1), detail === 'high');
    else { parts.push('nomat'); continue; }
    model.root.updateMatrixWorld(true);
    let n = 0, h = 0; const v = new T.Vector3();
    model.root.traverse((o: any) => { if (!(o instanceof T.Mesh)) return; const p = o.geometry.getAttribute('position'); n += p.count; for (let i = 0; i < p.count; i += 5) { v.fromBufferAttribute(p, i).applyMatrix4(o.matrixWorld); h = (h * 31 + Math.round(v.x * 1000) * 7 + Math.round(v.y * 1000) * 13 + Math.round(v.z * 1000)) % 1000000007; } });
    parts.push(`${n}:${h}`);
  }
  out[id] = parts.join('/');
}
console.log(JSON.stringify(out));
