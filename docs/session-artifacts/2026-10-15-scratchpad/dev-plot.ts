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
