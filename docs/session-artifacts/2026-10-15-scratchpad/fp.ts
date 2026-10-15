import { createHash } from 'node:crypto';
const root = process.argv[2];
const { CIRCUITS, CIRCUIT_IDS } = await import(root + '/src/simulation/circuits.ts');
const { Track, trackPoint } = await import(root + '/src/simulation/track.ts');
const out: Record<string, string> = {};
for (const id of CIRCUIT_IDS) {
  const def = CIRCUITS[id];
  const h = createHash('sha256');
  h.update(JSON.stringify(def.design));
  for (let i = 0; i < 4096; i++) { const u = i / 4096; h.update(JSON.stringify([def.elevation(u, false), def.halfWidth(u), def.crossFall(u, false), def.bankGain(u), def.gradient?.(u, 5000, false)])); }
  h.update(JSON.stringify([def.corners, def.drsZones, def.pit ?? null, def.maxBank]));
  const t = new Track('clear', false, undefined, def);
  h.update(String(t.length));
  for (let s = 0; s < t.length; s += 1) { h.update(JSON.stringify([def.runoff?.(s, -1), def.runoff?.(s, 1), def.barrier?.(s, -1), def.barrier?.(s, 1), def.covered?.(s)])); }
  if (def.catalogue) { const { dressing, ...rest } = def.catalogue; const { gantries, ...d } = dressing; const { dayNight, bikeSafe, signage, ...r } = rest; h.update(JSON.stringify([r, d])); }
  out[id] = h.digest('hex').slice(0, 16);
}
console.log(JSON.stringify(out));
