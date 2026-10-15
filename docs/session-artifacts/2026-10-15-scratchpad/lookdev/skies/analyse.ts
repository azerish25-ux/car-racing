import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
const repo = '/home/user/Experiment-3/.claude/worktrees/wf_1ec31848-637-1';
const tools = '/tmp/claude-0/-home-user-Experiment-3/c20c3567-05b6-5daa-8126-ea386a6ddfeb/scratchpad/tools/node_modules';
const { analyseHdri } = await import(pathToFileURL(join(repo, 'scripts/assets/hdri.ts')).href);
const hdrify = await import(pathToFileURL(join(tools, 'hdrify/dist/index.js')).href);
const root = process.argv[2];
const only = process.argv.slice(3);
const f = (v: number[]) => v.map((x) => x.toFixed(3)).join(',');
for (const id of readdirSync(root).sort()) {
  if (only.length && !only.includes(id)) continue;
  const dir = join(root, id);
  const file = readdirSync(dir).find((n) => n.endsWith('.hdr'));
  if (!file || !existsSync(join(dir, file))) continue;
  const t0 = Date.now();
  const img = hdrify.readHdr(new Uint8Array(readFileSync(join(dir, file))));
  const a = analyseHdri({ width: img.width, height: img.height, data: img.data, channels: 4 });
  const y = (c: number[]) => 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
  console.log(
    `${id.padEnd(24)} az ${a.sunAzimuth.toFixed(1).padStart(7)} el ${a.sunElevation.toFixed(1).padStart(5)} sun/sky ${a.sunToSky.toFixed(2).padStart(6)} sunC ${f(a.sunColor)} dome ${y(a.domeMean).toFixed(3)} [${f(a.domeMean)}] hzAnti/dome ${(y(a.horizonAntiSun) / y(a.domeMean)).toFixed(2)} hzSun/dome ${(y(a.horizonSunSide) / y(a.domeMean)).toFixed(2)} gnd/dome ${(y(a.groundMean) / y(a.domeMean)).toFixed(2)} peak ${a.peak.toFixed(0)} ${Date.now() - t0}ms`,
  );
}
