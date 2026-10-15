// Build the checkout once into BUILD (outside the repo) and serve it with vite preview on PORT.
import { createRequire } from 'node:module';
import { join, resolve } from 'node:path';
const [repoArg, buildArg, portArg] = process.argv.slice(2);
const repo = resolve(repoArg), outDir = resolve(buildArg), port = Number(portArg);
const need = createRequire(join(repo, 'package.json'));
const vite = need('vite');
if (!process.env.SKIP_BUILD) {
  console.log(`building ${repo} -> ${outDir}`);
  await vite.build({ root: repo, logLevel: 'warn', build: { outDir, emptyOutDir: true } });
}
await vite.preview({ root: repo, logLevel: 'warn', build: { outDir }, preview: { host: '127.0.0.1', port, strictPort: true } });
console.log(`serving http://127.0.0.1:${port}/`);
