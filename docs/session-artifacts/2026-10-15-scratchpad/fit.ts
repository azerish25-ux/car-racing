// Close a spec by changing two straights: fit.ts <id> <i> <j>
// Prints the straight segment table (index, length, heading) and the solved
// lengths for segments i and j that bring the open trace's end to the start.
const R = '/home/user/Experiment-3/.claude/worktrees/wf_9d9479b4-356-1/src/simulation';
process.env.CATALOGUE_DEV = '1';
const { CATALOGUE_SPECS } = await import(`${R}/circuit-catalogue/index.ts`);
const { traceSpec } = await import(`${R}/circuit-catalogue/builder.ts`);
const DEG = Math.PI / 180;
const [id, a, b] = process.argv.slice(2);
const spec = CATALOGUE_SPECS.find((s: { id: string }) => s.id === id);
const tr = traceSpec(spec);
let phi = spec.heading ?? 90;
const dirs: Record<number, number> = {};
spec.path.forEach((seg: { s?: number; r?: number; turn?: number }, i: number) => {
  if (seg.s !== undefined) {
    dirs[i] = phi;
    console.log(`  S[${i}] ${seg.s} m heading ${(((phi % 360) + 540) % 360) - 180}`);
  } else phi += seg.turn!;
});
console.log(`${id}: total turn ${(phi - (spec.heading ?? 90)).toFixed(1)}, gap end (${tr.end.map((v: number) => v.toFixed(1)).join(', ')}), length ${tr.length.toFixed(0)}`);
if (a !== undefined && b !== undefined) {
  const i = Number(a),
    j = Number(b);
  const ux = Math.cos(dirs[i] * DEG),
    uz = Math.sin(dirs[i] * DEG),
    vx = Math.cos(dirs[j] * DEG),
    vz = Math.sin(dirs[j] * DEG);
  // da*u + db*v = -end
  const det = ux * vz - uz * vx;
  const ex = -tr.end[0],
    ez = -tr.end[1];
  const da = (ex * vz - ez * vx) / det,
    db = (ux * ez - uz * ex) / det;
  console.log(
    `  S[${i}]: ${spec.path[i].s} -> ${(spec.path[i].s + da).toFixed(0)}; S[${j}]: ${spec.path[j].s} -> ${(spec.path[j].s + db).toFixed(0)}`,
  );
}
