// Open turtle trace of a spec: node --experimental-transform-types trace.ts <id>...
import { execFileSync } from 'node:child_process';
import { writeFileSync } from 'node:fs';
const R = '/home/user/Experiment-3/.claude/worktrees/wf_9d9479b4-356-1/src/simulation';
process.env.CATALOGUE_DEV = '1';
const { CATALOGUE_SPECS } = await import(`${R}/circuit-catalogue/index.ts`);
const { traceSpec } = await import(`${R}/circuit-catalogue/builder.ts`);
const OUT = '/tmp/claude-0/-home-user-Experiment-3/c20c3567-05b6-5daa-8126-ea386a6ddfeb/scratchpad/plots';
const DEG = Math.PI / 180;
for (const id of process.argv.slice(2)) {
  const spec = CATALOGUE_SPECS.find((s: { id: string }) => s.id === id);
  const tr = traceSpec(spec);
  console.log(
    `${id}: authored ${tr.length.toFixed(0)} m, gap ${tr.gap.toFixed(1)} m, end (${tr.end.map((v: number) => v.toFixed(0)).join(', ')}), heading error ${tr.headingError.toFixed(1)}°`,
  );
  // Segment start points and labels.
  let x = 0,
    z = 0,
    phi = (spec.heading ?? 90) * DEG;
  const labels: { x: number; z: number; text: string }[] = [];
  spec.path.forEach((seg: { s?: number; r?: number; turn?: number; name?: string }, i: number) => {
    labels.push({ x, z, text: `${i}${seg.name ? ' ' + seg.name : ''}` });
    if (seg.r !== undefined && seg.turn !== undefined) {
      const steps = Math.max(2, Math.ceil(seg.r * Math.abs(seg.turn * DEG)));
      for (let k = 0; k < steps; k++) {
        phi += (seg.turn * DEG) / steps;
        const ds = (seg.r * Math.abs(seg.turn * DEG)) / steps;
        x += Math.cos(phi) * ds;
        z += Math.sin(phi) * ds;
      }
    } else {
      x += Math.cos(phi) * (seg.s ?? 0);
      z += Math.sin(phi) * (seg.s ?? 0);
    }
  });
  const pts = tr.points as [number, number][];
  let minX = Infinity,
    maxX = -Infinity,
    minZ = Infinity,
    maxZ = -Infinity;
  for (const [a, b] of pts) {
    minX = Math.min(minX, a);
    maxX = Math.max(maxX, a);
    minZ = Math.min(minZ, b);
    maxZ = Math.max(maxZ, b);
  }
  const size = 2000,
    pad = 100,
    k = (size - 2 * pad) / Math.max(maxX - minX, maxZ - minZ);
  const X = (v: number) => pad + (v - minX) * k,
    Z = (v: number) => size - pad - (v - minZ) * k;
  const lines = [
    { pts: pts.map(([a, b]) => [X(a), Z(b)]), color: '#225', width: 4 },
    { pts: [[40, 50], [40 + 500 * k, 50]], color: '#000', width: 5 },
  ];
  const circles = [
    { x: X(0), y: Z(0), r: 12, color: '#0c0', fill: true },
    { x: X(tr.end[0]), y: Z(tr.end[1]), r: 12, color: '#c00', fill: true },
  ];
  const texts = [
    { x: 40, y: 15, text: `500 m | ${id} open trace, gap ${tr.gap.toFixed(0)} m, green start, red end` },
    ...labels.map((l) => ({ x: X(l.x) + 6, y: Z(l.z) + 4, text: l.text, small: true })),
  ];
  writeFileSync(`${OUT}/${id}-trace.json`, JSON.stringify({ size, lines, circles, texts }));
  execFileSync('python3', [
    '/tmp/claude-0/-home-user-Experiment-3/c20c3567-05b6-5daa-8126-ea386a6ddfeb/scratchpad/draw.py',
    `${OUT}/${id}-trace.json`,
    `${OUT}/${id}-trace.png`,
  ]);
}
