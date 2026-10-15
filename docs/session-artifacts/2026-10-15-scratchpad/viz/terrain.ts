import { writePng } from './png.ts';
import { TerrainField } from '/home/user/Experiment-3/.claude/worktrees/wf_50bf1819-515-1/src/simulation/open-world/terrain-field.ts';
import { SOLVANE } from '/home/user/Experiment-3/.claude/worktrees/wf_50bf1819-515-1/src/simulation/open-world/region-data.ts';
const f = new TerrainField(SOLVANE);
const N = 512,
  half = 4600,
  step = (2 * half) / N;
const rgb = new Uint8Array(N * N * 3);
const t0 = performance.now();
let min = Infinity,
  max = -Infinity;
const hs = new Float32Array(N * N);
for (let j = 0; j < N; j++)
  for (let i = 0; i < N; i++) {
    const x = -half + i * step,
      z = half - j * step;
    const h = f.height(x, z, 0);
    hs[j * N + i] = h;
    min = Math.min(min, h);
    max = Math.max(max, h);
  }
console.log('per sample us', ((performance.now() - t0) * 1000) / (N * N), min, max, 'flats', f.flatHeights);
const colors: Record<number, number[]> = {
  0: [30, 70, 120],
  1: [220, 205, 160],
  2: [110, 150, 70],
  3: [160, 160, 80],
  4: [40, 90, 40],
  5: [120, 110, 100],
  6: [240, 240, 245],
  7: [150, 140, 130],
  8: [90, 90, 90],
  9: [40, 110, 170],
};
for (let j = 0; j < N; j++)
  for (let i = 0; i < N; i++) {
    const h = hs[j * N + i];
    const hx = hs[j * N + Math.min(N - 1, i + 1)] - h,
      hz = hs[Math.min(N - 1, j + 1) * N + i] - h;
    const slope = Math.hypot(hx, hz) / step;
    const x = -half + i * step,
      z = half - j * step;
    const b = f.biome(x, z, h, slope);
    const shade = Math.max(0.35, Math.min(1.3, 0.85 + ((-hx + hz) / step) * 1.5));
    const c = colors[b];
    const k = (j * N + i) * 3;
    rgb[k] = Math.min(255, c[0] * shade);
    rgb[k + 1] = Math.min(255, c[1] * shade);
    rgb[k + 2] = Math.min(255, c[2] * shade);
    if (Math.abs(Math.abs(x) - 4096) < step || Math.abs(Math.abs(z) - 4096) < step) {
      rgb[k] = 255;
      rgb[k + 1] = 255;
      rgb[k + 2] = 0;
    }
  }
writePng(process.argv[2] ?? '/tmp/claude-0/-home-user-Experiment-3/c20c3567-05b6-5daa-8126-ea386a6ddfeb/scratchpad/viz/terrain.png', N, N, rgb);
