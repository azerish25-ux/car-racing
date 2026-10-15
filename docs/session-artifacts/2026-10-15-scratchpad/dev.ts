// Authoring tool: node --experimental-transform-types dev.ts <id> [--png]
import { execFileSync } from 'node:child_process';
import { writeFileSync } from 'node:fs';
const R = '/home/user/Experiment-3/.claude/worktrees/wf_9d9479b4-356-1/src/simulation';
process.env.CATALOGUE_DEV = '1';
const { CATALOGUE_SPECS } = await import(`${R}/circuit-catalogue/index.ts`);
const { defineCircuit, traceSpec } = await import(`${R}/circuit-catalogue/builder.ts`);
const { Track, trackPoint } = await import(`${R}/track.ts`);
const { trackGeometryReport, bikeSafetyReport } = await import(
  `${R}/circuit-catalogue/geometry-checks.ts`
);
const { validateCircuitDefinition } = await import(`${R}/content-validation.ts`);

const ids = process.argv.slice(2).filter((a) => !a.startsWith('--'));
const png = process.argv.includes('--png');
const OUT = '/tmp/claude-0/-home-user-Experiment-3/c20c3567-05b6-5daa-8126-ea386a6ddfeb/scratchpad/plots';
for (const id of ids) {
  const spec = CATALOGUE_SPECS.find((s: { id: string }) => s.id === id);
  if (!spec) throw new Error(`no spec ${id}`);
  const tr = traceSpec(spec);
  console.log(
    `== ${id}: authored ${tr.length.toFixed(0)} m, gap ${tr.gap.toFixed(1)} m, heading error ${tr.headingError.toFixed(1)}°, end ${tr.end.map((v: number) => v.toFixed(0))}`,
  );
  let def;
  try {
    def = defineCircuit(spec);
  } catch (e) {
    console.log('  BUILD FAILED', (e as Error).message);
    continue;
  }
  const meta = def.catalogue;
  const track = new Track('clear', false, undefined, def);
  console.log(
    `  L ${track.length.toFixed(0)} scale ${meta.authoring.scale.toFixed(3)} closure ${meta.authoring.closureAdjustment.toFixed(0)} m, points ${meta.authoring.controlPoints} samples ${def.samples ?? 1536}, corners ${def.corners.length}, drs ${def.drsZones.length}`,
  );
  const v = validateCircuitDefinition(def);
  if (v.length) console.log('  DEF:', v.join('\n  DEF: '));
  const rep = trackGeometryReport(track);
  console.log(
    `  margin ${rep.minimumMargin.toFixed(1)} m, crossings ${rep.crossings.map((c: { clearance: number }) => c.clearance.toFixed(1)).join(',')}, grade ${(rep.maximumGradient * 100).toFixed(1)}%, bank ${((Math.atan(rep.maximumBank) * 180) / Math.PI).toFixed(1)}°, crest R ${rep.minimumCrestRadius.toFixed(0)} m`,
  );
  for (const e of rep.errors) console.log('  GEOM:', e);
  const ys = track.points.map((p: { y: number }) => p.y);
  console.log(`  elevation ${Math.min(...ys).toFixed(0)}..${Math.max(...ys).toFixed(0)} m`);
  const bike = bikeSafetyReport(track);
  console.log(
    `  bike: corner barrier ${bike.minimumCornerBarrier.toFixed(1)} min barrier ${bike.minimumBarrier.toFixed(1)} grass ${bike.grassOutsideMetres} m kerb ${(bike.maximumKerbHeight * 1000).toFixed(0)} mm ${spec.bikeSafe ? 'FLAGGED' : ''}`,
  );
  for (const e of bike.errors) console.log('  BIKE:', e);
  console.log(
    '  corners:',
    def.corners.map((c: { s: number; name: string }) => `${c.name}@${c.s.toFixed(0)}`).join(', '),
  );
  if (!png) continue;
  // Plot (JSON primitives drawn by draw.py).
  const p = trackPoint();
  let minX = Infinity,
    maxX = -Infinity,
    minZ = Infinity,
    maxZ = -Infinity;
  for (const q of track.points) {
    minX = Math.min(minX, q.x);
    maxX = Math.max(maxX, q.x);
    minZ = Math.min(minZ, q.z);
    maxZ = Math.max(maxZ, q.z);
  }
  const pad = 80,
    size = 2200,
    k = (size - 2 * pad) / Math.max(maxX - minX, maxZ - minZ);
  const X = (x: number) => pad + (x - minX) * k,
    Z = (z: number) => size - pad - (z - minZ) * k;
  const lo = Math.min(...ys),
    hi = Math.max(...ys);
  const lines: { pts: number[][]; color: string; width: number }[] = [],
    circles: { x: number; y: number; r: number; color: string; fill?: boolean }[] = [],
    texts: { x: number; y: number; text: string; color?: string; small?: boolean }[] = [];
  const step = Math.max(2, track.length / 8000);
  for (const side of [-1, 1]) {
    const edge: number[][] = [],
      wall: number[][] = [];
    for (let s = 0; s <= track.length; s += step) {
      track.at(s, p);
      const w = p.width * side,
        b = track.boundaryAt(p, side) * side;
      edge.push([X(p.x + p.nx * w), Z(p.z + p.nz * w)]);
      wall.push([X(p.x + p.nx * b), Z(p.z + p.nz * b)]);
    }
    lines.push({ pts: wall, color: '#d44', width: 1 });
    lines.push({ pts: edge, color: '#222', width: 2 });
  }
  for (let s = 0; s < track.length; s += step * 3) {
    track.at(s, p);
    const a = [X(p.x), Z(p.z)];
    const t = (p.y - lo) / (hi - lo || 1);
    track.at(s + step * 3, p);
    lines.push({
      pts: [a, [X(p.x), Z(p.z)]],
      color: `rgb(${Math.round(255 * t)},${Math.round(60 + 100 * (1 - t))},${Math.round(255 * (1 - t))})`,
      width: 5,
    });
  }
  const pit: number[][] = [];
  for (let s = -track.pit.divergeStart; s <= track.pit.mergeEnd; s += 5) {
    track.at(s, p);
    const o = track.pitOffset(((s % track.length) + track.length) % track.length);
    pit.push([X(p.x + p.nx * o), Z(p.z + p.nz * o)]);
  }
  lines.push({ pts: pit, color: '#0a0', width: 3 });
  track.at(0, p);
  circles.push({ x: X(p.x), y: Z(p.z), r: 10, color: '#0c0', fill: true });
  track.at(80, p);
  circles.push({ x: X(p.x), y: Z(p.z), r: 6, color: '#060', fill: true });
  for (const c of def.corners) {
    track.at(c.s, p);
    texts.push({ x: X(p.x) + 8, y: Z(p.z) - 22, text: c.name });
    circles.push({ x: X(p.x), y: Z(p.z), r: 4, color: '#000', fill: true });
  }
  for (const z of def.drsZones) {
    const span = (((z.end - z.start) % track.length) + track.length) % track.length;
    for (let d = 0; d < span; d += 12) {
      track.at(z.start + d, p);
      circles.push({ x: X(p.x), y: Z(p.z), r: 3, color: '#09f', fill: true });
    }
  }
  for (let s = 0; s < track.length; s += 250) {
    track.at(s, p);
    texts.push({ x: X(p.x) - 10, y: Z(p.z) + 10, text: `${s}`, color: '#666', small: true });
  }
  for (const e of rep.errors) {
    const m = /at (\d+) m and (\d+) m/.exec(e);
    if (m)
      for (const s of [Number(m[1]), Number(m[2])]) {
        track.at(s, p);
        circles.push({ x: X(p.x), y: Z(p.z), r: 18, color: '#f0f' });
      }
  }
  lines.push({ pts: [[40, 50], [40 + 500 * k, 50]], color: '#000', width: 5 });
  texts.push({
    x: 40,
    y: 15,
    text: `500 m | ${id} ${track.length.toFixed(0)} m | elev ${lo.toFixed(0)}..${hi.toFixed(0)} | green=start, dark green=+80 m`,
  });
  writeFileSync(`${OUT}/${id}.json`, JSON.stringify({ size, lines, circles, texts }));
  execFileSync('python3', [
    '/tmp/claude-0/-home-user-Experiment-3/c20c3567-05b6-5daa-8126-ea386a6ddfeb/scratchpad/draw.py',
    `${OUT}/${id}.json`,
    `${OUT}/${id}.png`,
  ]);
  console.log(`  plot ${OUT}/${id}.png`);
}
