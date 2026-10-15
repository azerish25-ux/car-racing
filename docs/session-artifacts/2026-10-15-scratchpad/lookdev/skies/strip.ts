// Horizon strip (-2..14 deg) of an HDR at full resolution, split into 4 rows of 90 degrees,
// with a tick every 10 degrees of azimuth (atan2(z,x) convention) and a line every 2 degrees elevation.
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
const repo = '/home/user/Experiment-3/.claude/worktrees/wf_1ec31848-637-1';
const tools = '/tmp/claude-0/-home-user-Experiment-3/c20c3567-05b6-5daa-8126-ea386a6ddfeb/scratchpad/tools/node_modules';
const H = await import(pathToFileURL(join(repo, 'scripts/assets/hdri.ts')).href);
const hdrify = await import(pathToFileURL(join(tools, 'hdrify/dist/index.js')).href);
const [file, out, exposure = '0.5'] = process.argv.slice(2);
const img = hdrify.readHdr(new Uint8Array(readFileSync(file)));
const im0 = { width: img.width, height: img.height, data: img.data, channels: 4 };
const a = H.analyseHdri(im0);
const im = H.normaliseHdri(im0, a, 64).image;
const W = im.width, Hh = im.height;
const j0 = Math.round((0.5 - 14 / 180) * Hh), j1 = Math.round((0.5 + 2 / 180) * Hh), rows = j1 - j0;
const seg = W / 4;
const px = Buffer.alloc(seg * rows * 4 * 3);
for (let s = 0; s < 4; s++)
  for (let j = j0; j < j1; j++)
    for (let x = 0; x < seg; x++) {
      const i = s * seg + x;
      const lat = (0.5 - (j + 0.5) / Hh) * 180;
      const az = ((i + 0.5) / W - 0.5) * 360;
      const o = ((s * rows + (j - j0)) * seg + x) * 3;
      const tick = Math.abs(az - Math.round(az / 10) * 10) < 0.06 && lat < 1;
      const grid = Math.abs(lat - Math.round(lat / 2) * 2) < 0.03 && x % 8 < 2;
      for (let c = 0; c < 3; c++) {
        const v = im.data[(j * W + i) * 3 + c] * Number(exposure);
        px[o + c] = tick ? (c === 0 ? 255 : 0) : grid ? (c === 2 ? 255 : 0) : Math.min(255, Math.round(H.linearToSrgb(v / (1 + v)) * 255 * 1.5));
      }
    }
writeFileSync(out, Buffer.concat([Buffer.from(`P6\n${seg} ${rows * 4}\n255\n`), px]));
console.log('rows of 90 deg starting at azimuth -180, -90, 0, 90; red ticks every 10 deg; blue dotted every 2 deg elevation');
