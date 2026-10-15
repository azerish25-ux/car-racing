const W = '/home/user/Experiment-3/.claude/worktrees/wf_50bf1819-515-1/src/simulation/';
const { OpenWorld } = await import(W + 'open-world/world.ts');
const { OpenWorldTrack } = await import(W + 'open-world/open-world-track.ts');
const { resolveEvents } = await import(W + 'open-world/festival-events.ts');
const { pathPoint } = await import(W + 'open-world/route-path.ts');
const { surfaceSample } = await import(W + 'track.ts');
const world = new OpenWorld();
const track = new OpenWorldTrack(world, 'clear', undefined, 2048);
const net = world.network;
const s = surfaceSample();
const pp = pathPoint();
for (const ev of resolveEvents(world)) {
  const path = ev.path;
  const found: string[] = [];
  for (const off of [0, -1.5, 1.5]) {
    let prevH = NaN, prevE = -1, prevOn = true;
    for (let d = 0; d < path.length; d += 0.25) {
      path.at(d, pp);
      const lat = path.lineAt(d) + off;
      const x = pp.x + pp.nx * lat, z = pp.z + pp.nz * lat;
      track.sample(x, z, s, pp.y + 0.6);
      const h = s.height, e = track.query.edge, on = track.query.onRoad;
      if (Number.isFinite(prevH)) {
        const jump = h - prevH;
        // grade over 0.25 m is at most ~4 cm; flag > 8 cm
        if (Math.abs(jump) > 0.08 && found.length < 6) found.push(`d=${d.toFixed(1)} off=${off} jump=${jump.toFixed(2)} ${net.edges[prevE].id}${prevOn ? '' : '*'}->${net.edges[e].id}${on ? '' : '*'} @(${x.toFixed(0)},${z.toFixed(0)})`);
      }
      prevH = h; prevE = e; prevOn = on;
    }
  }
  console.log(ev.spec.id, found.length ? '\n   ' + found.join('\n   ') : 'clean');
}
