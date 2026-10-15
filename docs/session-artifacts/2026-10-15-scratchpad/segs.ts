const root = '/home/user/Experiment-3/.claude/worktrees/agent-a964cb482ef4886a4/src/simulation/circuit-catalogue/';
const { REAL_WORLD_SPECS } = await import(root + 'real-world.ts');
const { UNCONVENTIONAL_SPECS } = await import(root + 'unconventional.ts');
const id = process.argv[2];
const spec = [...REAL_WORLD_SPECS, ...UNCONVENTIONAL_SPECS].find((s: any) => s.id === id);
let x = 0, z = 0, phi = (spec.heading ?? 90) * Math.PI / 180, d = 0;
for (const [i, seg] of spec.path.entries()) {
  let len = 0;
  if (seg.r !== undefined) {
    const t = seg.turn * Math.PI / 180, sg = Math.sign(t);
    const cx = x - Math.sin(phi) * seg.r * sg, cz = z + Math.cos(phi) * seg.r * sg;
    phi += t; x = cx + Math.sin(phi) * seg.r * sg; z = cz - Math.cos(phi) * seg.r * sg;
    len = seg.r * Math.abs(t);
  } else { x += Math.cos(phi) * seg.s; z += Math.sin(phi) * seg.s; len = seg.s; }
  d += len;
  const h = ((phi * 180 / Math.PI) % 360 + 360) % 360;
  console.log(`${i}:${(seg.name ?? (seg.r ? `A${seg.r}/${seg.turn}` : `S${seg.s}`)).slice(0,10)} (${x.toFixed(0)},${z.toFixed(0)}) h${h.toFixed(0)}`);
}
