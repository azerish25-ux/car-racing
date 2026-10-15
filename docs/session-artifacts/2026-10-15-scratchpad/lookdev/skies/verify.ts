import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
const repo = '/home/user/Experiment-3/.claude/worktrees/wf_1ec31848-637-1';
const tools = '/tmp/claude-0/-home-user-Experiment-3/c20c3567-05b6-5daa-8126-ea386a6ddfeb/scratchpad/tools/node_modules';
const H = await import(pathToFileURL(join(repo, 'scripts/assets/hdri.ts')).href);
const jpeg = (await import(pathToFileURL(join(tools, 'jpeg-js/index.js')).href)).default;
const [out, file, gainMaxArg, exposureArg] = process.argv.slice(2);
const bytes = new Uint8Array(readFileSync(file));
const spans = H.jpegImageSpans(bytes);
const base = jpeg.decode(bytes.subarray(spans[0].start, spans[0].end), { useTArray: true, formatAsRGBA: true });
const gain = jpeg.decode(bytes.subarray(spans[1].start, spans[1].end), { useTArray: true, formatAsRGBA: true });
const levels = new Uint8Array(gain.width * gain.height);
for (let p = 0; p < levels.length; p++) levels[p] = gain.data[p * 4];
let img = H.reconstruct(base.data, base.width, base.height, levels, gain.width, gain.height, Number(gainMaxArg));
while (img.width > 1024) img = H.halveImage(img);
const e = Number(exposureArg ?? 0.35);
const px = Buffer.alloc(img.width * img.height * 3);
for (let p = 0; p < img.width * img.height; p++)
  for (let c = 0; c < 3; c++) {
    const x = img.data[p * 3 + c] * e;
    px[p * 3 + c] = Math.min(255, Math.round(H.linearToSrgb(x / (1 + x)) * 255 * 1.6));
  }
writeFileSync(out, Buffer.concat([Buffer.from(`P6\n${img.width} ${img.height}\n255\n`), px]));
console.log(base.width, base.height, gain.width, gain.height, spans);
