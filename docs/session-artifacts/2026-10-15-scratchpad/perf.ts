const W = '/home/user/Experiment-3/.claude/worktrees/wf_9d9479b4-356-1';
const { CIRCUITS } = await import(W + '/src/simulation/circuits.ts');
const { Track, trackPoint, surfaceSample } = await import(W + '/src/simulation/track.ts');
const { Vec3 } = await import(W + '/src/core/math.ts').catch(() => ({}));
for (const id of process.argv.slice(2)) {
  const def = CIRCUITS[id];
  let t0 = performance.now();
  const t = new Track('clear', false, undefined, def);
  const build = performance.now() - t0;
  // nearest cost
  const p = trackPoint(); const s = surfaceSample();
  t0 = performance.now();
  let N = 20000;
  for (let i = 0; i < N; i++) { t.at((i * 7.3) % t.length, p); t.sample(p.x + 1, p.z + 1, s, p.y); }
  const per = (performance.now() - t0) / N * 1000;
  // hash bucket size
  let maxBucket = 0, total = 0, n = 0;
  for (const v of (t as any).hash.values()) { maxBucket = Math.max(maxBucket, v.length); total += v.length; n++; }
  t0 = performance.now();
  const o = { x: p.x, y: p.y + 1, z: p.z } as any;
  try { (t as any).cast({ x: p.x, y: p.y + 1, z: p.z, clone() { return this; } }, { x: 0, y: -1, z: 0 }, 3, s); } catch (e) { }
  const mesh = performance.now() - t0;
  console.log(id, 'len', t.length.toFixed(0), 'points', t.points.length, 'build ms', build.toFixed(0), 'sample us', per.toFixed(2), 'maxBucket', maxBucket, 'avgBucket', (total / n).toFixed(1), 'contact mesh ms', mesh.toFixed(0));
}
