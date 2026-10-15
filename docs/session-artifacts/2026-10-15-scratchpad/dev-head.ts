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
