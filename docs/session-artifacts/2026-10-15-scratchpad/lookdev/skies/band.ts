// Horizon band previews (elevation -5..35 deg), tone-mapped, from source .hdr files.
import { readFileSync, writeFileSync } from 'node:fs';
import { basename, dirname, join } from 'node:path';
import { pathToFileURL } from 'node:url';
const repo = '/home/user/Experiment-3/.claude/worktrees/wf_1ec31848-637-1';
const tools = '/tmp/claude-0/-home-user-Experiment-3/c20c3567-05b6-5daa-8126-ea386a6ddfeb/scratchpad/tools/node_modules';
const H = await import(pathToFileURL(join(repo, 'scripts/assets/hdri.ts')).href);
const hdrify = await import(pathToFileURL(join(tools, 'hdrify/dist/index.js')).href);
const [out, ...files] = process.argv.slice(2);
for (const file of files) {
  const img = hdrify.readHdr(new Uint8Array(readFileSync(file)));
  let im = { width: img.width, height: img.height, data: img.data, channels: 4 };
  const a = H.analyseHdri(im);
  im = H.normaliseHdri(im, a, 64).image;
  while (im.width > 2048) im = H.halveImage(im);
  const W = im.width, Hh = im.height;
  const j0 = Math.round((0.5 - 35 / 180) * Hh), j1 = Math.round((0.5 + 5 / 180) * Hh);
  const rows = j1 - j0;
  const px = Buffer.alloc(W * rows * 3);
  for (let j = j0; j < j1; j++)
    for (let i = 0; i < W; i++)
      for (let c = 0; c < 3; c++) {
        const x = im.data[(j * W + i) * 3 + c] * 0.5;
        px[((j - j0) * W + i) * 3 + c] = Math.min(255, Math.round(H.linearToSrgb(x / (1 + x)) * 255 * 1.5));
      }
  const name = basename(dirname(file));
  writeFileSync(join(out, `band-${name}.ppm`), Buffer.concat([Buffer.from(`P6\n${W} ${rows}\n255\n`), px]));
  console.log(name, a.sunAzimuth.toFixed(1), a.sunElevation.toFixed(1));
}
