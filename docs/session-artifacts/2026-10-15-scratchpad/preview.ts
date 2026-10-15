import { writeFileSync } from 'node:fs';
const root = '/home/user/Experiment-3/.claude/worktrees/agent-a964cb482ef4886a4/src/simulation/';
const { CATALOGUE_CIRCUITS } = await import(root + 'circuit-catalogue/index.ts');
const { Track, trackPoint } = await import(root + 'track.ts');
const only = process.argv[2];
const out: Record<string, unknown> = {};
for (const def of Object.values(CATALOGUE_CIRCUITS) as any[]) {
  if (only && !only.split(',').includes(def.id)) continue;
  const t0 = performance.now();
  const track = new Track('clear', false, undefined, def);
  const ms = performance.now() - t0;
  const pts = [];
  const p = trackPoint();
  for (let s = 0; s < track.length; s += 4) {
    track.at(s, p);
    pts.push([p.x, p.z, p.y, p.width, p.bank, track.boundary(s, -1), track.boundary(s, 1), track.isCovered(s) ? 1 : 0]);
  }
  const a = def.catalogue.authoring;
  console.log(
    `${def.id.padEnd(22)} L=${track.length.toFixed(0)} scale=${a.scale.toFixed(3)} closure=${a.closureAdjustment.toFixed(0)}m authored=${a.authoredLength.toFixed(0)} pts=${a.controlPoints} build=${ms.toFixed(0)}ms crossings=${def.catalogue.dressing.crossings.map((c: any) => c.clearance.toFixed(1)).join('/')} yRange=${Math.min(...pts.map((q) => q[2])).toFixed(0)}..${Math.max(...pts.map((q) => q[2])).toFixed(0)} drs=${def.drsZones.length} corners=${def.corners.length}`,
  );
  out[def.id] = {
    pts,
    corners: def.corners.map((c: any) => {
      track.at(c.s, p);
      return [c.name, p.x, p.z];
    }),
    pit: track.pit.side,
    pitPts: Array.from({ length: 60 }, (_, i) => {
      const s = track.length - track.pit.divergeStart + ((track.pit.divergeStart + track.pit.mergeEnd) * i) / 59;
      track.at(s, p);
      const l = track.pitOffset(s);
      return [p.x + p.nx * l, p.z + p.nz * l];
    }),
  };
}
writeFileSync('/tmp/claude-0/-home-user-Experiment-3/c20c3567-05b6-5daa-8126-ea386a6ddfeb/scratchpad/preview.json', JSON.stringify(out));
