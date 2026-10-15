// Print a coarse land-top profile (dark pixels relative to the sky at 12-16 deg) per 2 degrees of azimuth.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
const repo = '/home/user/Experiment-3/.claude/worktrees/wf_1ec31848-637-1';
const tools = '/tmp/claude-0/-home-user-Experiment-3/c20c3567-05b6-5daa-8126-ea386a6ddfeb/scratchpad/tools/node_modules';
const H = await import(pathToFileURL(join(repo, 'scripts/assets/hdri.ts')).href);
const hdrify = await import(pathToFileURL(join(tools, 'hdrify/dist/index.js')).href);
const [file, darkArg = '0.5'] = process.argv.slice(2);
const img = hdrify.readHdr(new Uint8Array(readFileSync(file)));
const W = img.width, Hh = img.height, d = img.data;
const Y = (i: number, j: number) => { const p = (j * W + i) * 4; return 0.2126 * d[p] + 0.7152 * d[p + 1] + 0.0722 * d[p + 2]; };
const row = (e: number) => Math.round((0.5 - e / 180) * Hh);
const out: string[] = [];
for (let az = -180; az < 180; az += 2) {
  let top = -1;
  for (let i = Math.floor((az / 360 + 0.5) * W); i < Math.floor(((az + 2) / 360 + 0.5) * W); i++) {
    let ref = 0, n = 0;
    for (let e = 12; e <= 16; e += 0.5) { ref += Y(i, row(e)); n++; }
    ref /= n;
    for (let e = 0; e <= 12; e += 0.1) if (Y(i, row(e)) < Number(darkArg) * ref) top = Math.max(top, e);
  }
  out.push(`${az}:${top.toFixed(1)}`);
}
console.log(out.join(' '));
