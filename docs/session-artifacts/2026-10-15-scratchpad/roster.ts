// Prints markdown roster rows and the race table for CIRCUIT_CATALOGUE.md.
import { readFileSync } from 'node:fs';
const R = '/home/user/Experiment-3/.claude/worktrees/wf_9d9479b4-356-1';
const { CIRCUITS } = await import(`${R}/src/simulation/circuits.ts`);
const { CATALOGUE_CIRCUIT_IDS } = await import(`${R}/src/simulation/circuit-catalogue/venue-data.ts`);
const { Track, trackPoint } = await import(`${R}/src/simulation/track.ts`);
const { trackGeometryReport } = await import(`${R}/src/simulation/circuit-catalogue/geometry-checks.ts`);
const mode = process.argv[2] ?? 'roster';
const ids = CATALOGUE_CIRCUIT_IDS.slice(20);
if (mode === 'roster')
  for (const id of ids) {
    const def = CIRCUITS[id],
      meta = def.catalogue,
      t = new Track('clear', false, undefined, def),
      rep = trackGeometryReport(t),
      p = trackPoint();
    let lo = Infinity,
      hi = -Infinity;
    for (let s = 0; s < t.length; s += 4) {
      t.at(s, p);
      lo = Math.min(lo, p.y);
      hi = Math.max(hi, p.y);
    }
    const name = meta.layout === 'Grand Prix' ? meta.venueName : `${meta.venueName} — ${meta.layout}`;
    const special: string[] = [];
    if (def.bikeSafe) special.push('bike-safe');
    if (meta.night) special.push('night');
    if (meta.dayNight) special.push('day-night lit');
    if (meta.dressing.crossings.length)
      special.push(`flyover, ${meta.dressing.crossings[0].clearance.toFixed(1)} m headroom`);
    if (meta.dressing.gantries.length) special.push('crane gantries');
    if (def.samples) special.push(`${def.samples} samples`);
    console.log(
      `| ${name} (\`${id}\`) | ${meta.group} | ${Math.round(t.length)} | ${meta.referenceLength ?? '—'} | ${def.corners.length} | ${def.drsZones.length} | ${def.pit.side > 0 ? 'right' : 'left'} | ${Math.round(hi - lo)} | ${(rep.maximumGradient * 100).toFixed(1)}% | ${Math.round((Math.atan(rep.maximumBank) * 180) / Math.PI)}° | ${special.join(', ')} |`,
    );
  }
else {
  const doc = JSON.parse(readFileSync(`${R}/docs/circuit-catalogue-races.json`, 'utf8'));
  const fmt = (s: number) => {
    const m = Math.floor(s / 60);
    return `${m}:${(s - m * 60).toFixed(3).padStart(6, '0')}`;
  };
  for (const r of doc.reports)
    console.log(
      `| ${r.id} | ${r.lengthM} | ${fmt(r.bestLapS)} | ${r.bestLapAverageKmh} km/h | ${fmt(r.slowestBestLapS)} |`,
    );
}
