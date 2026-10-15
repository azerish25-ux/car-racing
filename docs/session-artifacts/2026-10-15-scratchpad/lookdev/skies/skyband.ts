// Horizon band (-5..35 deg) with the detected skyline in red, plus a "masked" band
// showing what the shader will draw (sky clamped at the skyline).
import { readFileSync, writeFileSync } from 'node:fs';
import { basename, dirname, join } from 'node:path';
import { pathToFileURL } from 'node:url';
const repo = '/home/user/Experiment-3/.claude/worktrees/wf_1ec31848-637-1';
const tools = '/tmp/claude-0/-home-user-Experiment-3/c20c3567-05b6-5daa-8126-ea386a6ddfeb/scratchpad/tools/node_modules';
const H = await import(pathToFileURL(join(repo, 'scripts/assets/hdri.ts')).href);
const hdrify = await import(pathToFileURL(join(tools, 'hdrify/dist/index.js')).href);
const [out, ...args] = process.argv.slice(2);
const files = args.map((a) => a.split('@')[0]);
const caps = args.map((a) => Number(a.split('@')[1] ?? 0));
for (const [fi, file] of files.entries()) {
  const img = hdrify.readHdr(new Uint8Array(readFileSync(file)));
  let im = { width: img.width, height: img.height, data: img.data, channels: 4 };
  const a = H.analyseHdri(im);
  im = H.normaliseHdri(im, a, 64).image;
  while (im.width > 1024) im = H.halveImage(im);
  const t0 = Date.now();
  const sky = H.detectSkyline(im, caps[fi]);
  const ms = Date.now() - t0;
  const W = im.width, Hh = im.height;
  const j0 = Math.round((0.5 - 35 / 180) * Hh), j1 = Math.round((0.5 + 5 / 180) * Hh);
  const rows = j1 - j0;
  const px = Buffer.alloc(W * rows * 2 * 3);
  const put = (row: number, i: number, rgb: number[]) => {
    for (let c = 0; c < 3; c++) {
      const x = rgb[c] * 0.5;
      px[(row * W + i) * 3 + c] = Math.min(255, Math.round(H.linearToSrgb(x / (1 + x)) * 255 * 1.5));
    }
  };
  for (let j = j0; j < j1; j++)
    for (let i = 0; i < W; i++) {
      const lat = (0.5 - (j + 0.5) / Hh) * 180;
      const k = Math.floor((i / W) * sky.length);
      const line = sky[k];
      const p = (j * W + i) * 3;
      const rgb = [im.data[p], im.data[p + 1], im.data[p + 2]];
      put(j - j0, i, Math.abs(lat - line) < 0.18 ? [40, 0, 0] : rgb);
      // masked: blurred sky at the skyline below it
      const t = Math.min(1, Math.max(0, (lat - (line - 1)) / 1));
      const hazeW = 1 - t * t * (3 - 2 * t);
      let rgbm = rgb;
      if (hazeW > 0) {
        const jf = Math.min(Hh - 1, Math.max(0, Math.round((0.5 - (Math.max(line, 0) + 0.75) / 180) * Hh)));
        const f = [0, 0, 0];
        const R = Math.round(W / 64);
        for (let d = -R; d <= R; d++) {
          const ii = (i + d + W) % W, q = (jf * W + ii) * 3;
          f[0] += im.data[q]; f[1] += im.data[q + 1]; f[2] += im.data[q + 2];
        }
        rgbm = rgb.map((v, c) => v * (1 - hazeW) + (f[c] / (2 * R + 1)) * hazeW);
      }
      put(rows + j - j0, i, rgbm);
    }
  const name = basename(dirname(file)).replace(/^x$/, basename(file));
  writeFileSync(join(out, `sky-${name}.ppm`), Buffer.concat([Buffer.from(`P6\n${W} ${rows * 2}\n255\n`), px]));
  const max = Math.max(...sky), mean = sky.reduce((s, v) => s + v, 0) / sky.length;
  console.log(name, 'skyline mean', mean.toFixed(2), 'max', max.toFixed(1), ms + 'ms');
}
