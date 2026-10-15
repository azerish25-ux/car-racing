const root = '/home/user/Experiment-3/.claude/worktrees/wf_9d9479b4-356-1';
const { CATALOGUE_SPECS } = await import(root + '/src/simulation/circuit-catalogue/index.ts');
const { traceSpec } = await import(root + '/src/simulation/circuit-catalogue/builder.ts');
const { CIRCUITS } = await import(root + '/src/simulation/circuits.ts');
const { CATALOGUE_CIRCUIT_IDS } = await import(root + '/src/simulation/circuit-catalogue/venue-data.ts');
const wave2 = CATALOGUE_CIRCUIT_IDS.slice(20);
for (const spec of CATALOGUE_SPECS) {
  if (!wave2.includes(spec.id)) continue;
  const tr = traceSpec(spec);
  const def = CIRCUITS[spec.id];
  const m = def.catalogue;
  const arcs = spec.path.filter((s: any) => s.r !== undefined).length;
  console.log(spec.id.padEnd(22), 'authored', tr.length.toFixed(0).padStart(6), 'len', m.length.toFixed(0).padStart(6), 'ref', String(m.referenceLength ?? '-').padStart(6), 'scale', m.authoring.scale.toFixed(3), 'hdgErr', tr.headingError.toFixed(1).padStart(7), 'gap', tr.gap.toFixed(0).padStart(5), 'closeAdj', m.authoring.closureAdjustment.toFixed(0).padStart(5), 'arcs', arcs, 'corners', def.corners.length, 'pts', def.design.length, 'samples', def.samples ?? 1536, 'rev', !!spec.reverse);
}
