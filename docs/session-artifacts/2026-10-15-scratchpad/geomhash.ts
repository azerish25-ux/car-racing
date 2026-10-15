import { createHash } from 'node:crypto';
const root = process.argv[2];
const { CIRCUITS, CIRCUIT_IDS } = await import(`${root}/src/simulation/circuits.ts`);
const { Track, trackPoint } = await import(`${root}/src/simulation/track.ts`);
const out: string[] = [];
for (const id of CIRCUIT_IDS as string[]) {
  const def = CIRCUITS[id], t = new Track('clear', false, undefined, def), p = trackPoint(), h = createHash('sha256');
  h.update(JSON.stringify(def.design));
  for (let s = 0; s < t.length; s += 3) {
    t.at(s, p);
    h.update(`${p.x.toFixed(6)},${p.y.toFixed(6)},${p.z.toFixed(6)},${p.width.toFixed(6)},${p.bank.toFixed(6)};`);
    if (def.runoff) h.update(`${def.runoff(s, 1)},${def.runoff(s, -1)},${def.barrier?.(s, 1)},${def.barrier?.(s, -1)}`);
  }
  out.push(`${id} ${t.length.toFixed(3)} ${h.digest('hex').slice(0, 16)}`);
}
console.log(out.join('\n'));
