import { readFileSync, readdirSync } from 'node:fs';
const dir = process.env.PROF_DIR ?? '/tmp/claude-0/-home-user-Experiment-3/c20c3567-05b6-5daa-8126-ea386a6ddfeb/scratchpad/prof';
const file = process.argv[2] ?? readdirSync(dir).sort().at(-1)!;
const prof = JSON.parse(readFileSync(`${dir}/${file}`, 'utf8'));
const self = new Map<string, number>();
const byId = new Map<number, { callFrame: { functionName: string; url: string; lineNumber: number } }>();
for (const n of prof.nodes) byId.set(n.id, n);
const dt = prof.timeDeltas as number[];
const samples = prof.samples as number[];
for (let i = 0; i < samples.length; i++) {
  const n = byId.get(samples[i])!;
  const key = `${n.callFrame.functionName || '(anon)'} ${n.callFrame.url.split('/').pop()}:${n.callFrame.lineNumber}`;
  self.set(key, (self.get(key) ?? 0) + (dt[i] ?? 0));
}
const total = [...self.values()].reduce((a, b) => a + b, 0);
for (const [k, v] of [...self.entries()].sort((a, b) => b[1] - a[1]).slice(0, 25))
  console.log(((v / total) * 100).toFixed(1).padStart(5), (v / 1000).toFixed(1).padStart(8), 'ms', k);
