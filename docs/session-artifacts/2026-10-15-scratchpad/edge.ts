const W = '/home/user/Experiment-3/.claude/worktrees/wf_50bf1819-515-1/src/simulation/';
const { OpenWorld } = await import(W + 'open-world/world.ts');
const { OpenWorldTrack } = await import(W + 'open-world/open-world-track.ts');
const { ROAD_FLAG } = await import(W + 'open-world/road-network.ts');
const { surfaceSample, trackPoint } = await import(W + 'track.ts');
const world = new OpenWorld();
const track = new OpenWorldTrack(world, 'clear', undefined, 2048);
const net = world.network;
const s = surfaceSample();
const p = trackPoint();
const steps: { d: number; at: string }[] = [];
let terrainAboveDeck: { d: number; at: string }[] = [];
for (const e of net.edges) {
  const hw = e.spec.halfWidth, edge = hw + e.spec.shoulder;
  for (let i = e.first; i <= e.last; i++) {
    net.pointOnSegment(Math.min(i, e.last - 1), i === e.last ? 1 : 0, p);
    if (net.flags[i] & ROAD_FLAG.JUNCTION) continue;
    for (const side of [-1, 1]) {
      const inX = p.x + p.nx * side * (edge - 0.05), inZ = p.z + p.nz * side * (edge - 0.05);
      const outX = p.x + p.nx * side * (edge + 0.05), outZ = p.z + p.nz * side * (edge + 0.05);
      const y0 = p.y + 0.6;
      track.sample(inX, inZ, s, y0); const hin = s.height; const onIn = track.query.onRoad; const eIn = track.query.edge;
      track.sample(outX, outZ, s, y0); const hout = s.height; const onOut = track.query.onRoad;
      if (onIn && !onOut && eIn === e.index) {
        const bridge = !!(net.flags[i] & ROAD_FLAG.BRIDGE);
        const d = hout - hin;
        if (!bridge && Math.abs(d) > 0.15) steps.push({ d, at: `${e.id} ${e.roadClass} i=${i - e.first} (${p.x.toFixed(0)},${p.z.toFixed(0)}) side ${side}` });
      }
    }
    if (net.flags[i] & ROAD_FLAG.BRIDGE) {
      const th = track.tiles.height(p.x, p.z);
      if (th > p.y - 0.5) terrainAboveDeck.push({ d: th - p.y, at: `${e.id} i=${i - e.first} (${p.x.toFixed(0)},${p.z.toFixed(0)})` });
    }
  }
}
steps.sort((a, b) => Math.abs(b.d) - Math.abs(a.d));
console.log('road-edge steps > 15 cm (non-bridge):', steps.length);
for (const x of steps.slice(0, 15)) console.log(x.d.toFixed(2), x.at);
terrainAboveDeck.sort((a, b) => b.d - a.d);
console.log('bridge samples with terrain above deck-0.5:', terrainAboveDeck.length);
for (const x of terrainAboveDeck.slice(0, 15)) console.log(x.d.toFixed(2), x.at);
// dead ends
for (const node of net.nodes) if (node.edges.length === 1) {
  const e = net.edges[node.edges[0]];
  const atStart = e.from === node.index;
  const i = atStart ? e.first : e.last - 1;
  net.pointOnSegment(i, atStart ? 0 : 1, p);
  const dir = atStart ? -1 : 1;
  const out: string[] = [];
  for (const k of [5, 20, 50, 100]) {
    const x = p.x + p.tx * dir * k, z = p.z + p.tz * dir * k;
    track.sample(x, z, s, p.y + 0.6);
    out.push(`+${k}m onRoad=${track.query.onRoad} h=${s.height.toFixed(2)} terrain=${track.tiles.height(x, z).toFixed(2)} surf=${track.query.surface}`);
  }
  console.log('dead end', e.id, e.roadClass, `(${p.x.toFixed(0)},${p.z.toFixed(0)}) y=${p.y.toFixed(2)}`, out.join(' | '));
}
