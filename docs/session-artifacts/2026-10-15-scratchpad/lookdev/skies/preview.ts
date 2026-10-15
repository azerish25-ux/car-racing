// Tone-mapped 1024x512 PPM previews of HDR files: node preview.ts OUTDIR file.hdr...
import { readFileSync, writeFileSync } from 'node:fs';
import { basename, join } from 'node:path';
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
  const n = H.normaliseHdri(im, a, 64).image;
  im = n;
  while (im.width > 1024) im = H.halveImage(im);
  const px = Buffer.alloc(im.width * im.height * 3);
  for (let p = 0; p < im.width * im.height; p++)
    for (let c = 0; c < 3; c++) {
      const x = im.data[p * 3 + c] * 0.35;
      px[p * 3 + c] = Math.round(H.linearToSrgb(x / (1 + x)) * 255 * 1.6 > 255 ? 255 : H.linearToSrgb(x / (1 + x)) * 255 * 1.6);
    }
  const name = basename(file).replace(/\.hdr$/, '') + '-' + basename(join(file, '..'));
  writeFileSync(join(out, name + '.ppm'), Buffer.concat([Buffer.from(`P6\n${im.width} ${im.height}\n255\n`), px]));
  console.log(name, a.sunAzimuth.toFixed(1), a.sunElevation.toFixed(1));
}
