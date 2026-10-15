// Runs scan.ts for each variant and scenario sequentially at low priority.
// node runscans.mjs <scenario> <arg> <variant...>
import { spawnSync } from 'node:child_process';
import { appendFileSync } from 'node:fs';
const base = '/tmp/claude-0/-home-user-Experiment-3/c20c3567-05b6-5daa-8126-ea386a6ddfeb/scratchpad/wetfollow-d575';
const [scenario, arg, ...variants] = process.argv.slice(2);
for (const v of variants) {
  const root = v.startsWith('/') ? v : `${base}/${v}`;
  const r = spawnSync(
    'node',
    ['--experimental-transform-types', '--no-warnings', `${base}/scan.ts`, root, scenario, arg],
    { encoding: 'utf8' },
  );
  appendFileSync(`${base}/scan-${scenario}.log`, (r.stdout || '') + (r.stderr || '').slice(-400));
}
appendFileSync(`${base}/scan-${scenario}.log`, `done ${variants.join(',')}\n`);
